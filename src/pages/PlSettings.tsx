// 설정 › 손익계산서 올리기 — ERP 손익계산서(월별) 엑셀을 올려 '확정 금액'으로 저장
//   쓰는 곳: 국전 수익/비용(실현 수익) 화면 맨 위 '손익 요약(회계 기준)' — 마감 완료 월은 이 금액을 그대로 보여줍니다.
//   파일 모양: 첫 열 = 계정과목(I. 매출액, II. 매출원가 …), 나머지 열 = 월 (머리글이 날짜·2026-01·202601·2026년 1월 중 하나)
import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { fmt } from '../components/ui';
import { ymL } from '../components/charts';
import { loadPl, plMonths, type PlCfg, type PlRow } from '../lib/plStmt';

const ymOf = (v: unknown): string => {
  if (v instanceof Date && !isNaN(+v)) { const d = new Date(+v + 12 * 3600 * 1000); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0'); }
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = XLSX.SSF.parse_date_code(v); return d ? d.y + String(d.m).padStart(2, '0') : ''; }
  const s = String(v ?? '').trim();
  let m = s.match(/^(20\d{2})\D{0,2}(\d{1,2})(?:\D|$)/); if (m && +m[2] >= 1 && +m[2] <= 12) return m[1] + m[2].padStart(2, '0');
  m = s.match(/^(20\d{2})(\d{2})$/); if (m && +m[2] >= 1 && +m[2] <= 12) return m[1] + m[2];
  return '';
};
const num = (v: unknown) => { if (typeof v === 'number') return v; const n = Number(String(v ?? '').replace(/[,\s]/g, '')); return isFinite(n) ? n : null; };
const ROMAN = /^\s*([IVXⅠ-Ⅻ]+)\s*[.．]\s*/;
const PAREN = /^\s*\((\d+)\)\s*/;

function parse(buf: ArrayBuffer): { cfg: PlCfg; months: string[] } {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const a = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
  let hi = -1, cols: { c: number; ym: string }[] = [];
  for (let i = 0; i < Math.min(a.length, 15); i++) {
    const cs = (a[i] || []).map((v, c) => ({ c, ym: c === 0 ? '' : ymOf(v) })).filter(x => x.ym);
    if (cs.length) { hi = i; cols = cs; break; }
  }
  if (hi < 0) throw new Error('월 머리글(예: 2026-01)을 찾지 못했습니다. 첫 열이 계정과목, 나머지 열이 월인 손익계산서 파일인지 확인해 주세요.');
  const rows: Record<string, PlRow> = {}; const order: string[] = []; let parent = '';
  for (let i = hi + 1; i < a.length; i++) {
    const r = a[i] || []; const name = String(r[0] ?? ''); if (!name.trim()) continue;
    let lv = 0, label = '';
    if (ROMAN.test(name)) { lv = 1; label = name.replace(ROMAN, '').trim(); parent = label; }
    else if (PAREN.test(name)) { lv = 2; label = name.replace(PAREN, '').trim(); }
    else continue;
    const key = lv === 1 ? label : parent + ' > ' + label;
    const v: Record<string, number> = {};
    cols.forEach(({ c, ym }) => { const n = num(r[c]); if (n != null) v[ym] = n; });
    if (!rows[key]) order.push(key);
    rows[key] = { lv, label, v };
  }
  if (!order.some(k => /^영업(이익|손)/.test(rows[k].label))) throw new Error("'영업이익' 줄을 찾지 못했습니다. 손익계산서 파일인지 확인해 주세요.");
  return { cfg: { rows, order, closedThrough: '' }, months: cols.map(c => c.ym).sort() };
}

export default function PlSettings() {
  const { closeMonth } = useAuth();
  const [saved, setSaved] = useState<PlCfg | null>(null);
  const [draft, setDraft] = useState<PlCfg | null>(null);
  const [fileName, setFileName] = useState('');
  const [closed, setClosed] = useState('');
  const [msg, setMsg] = useState<{ text: string; cls: string }>({ text: '', cls: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadPl(true).then(v => { setSaved(v); if (v?.closedThrough) setClosed(v.closedThrough); }); }, []);

  // 저장될 모습 = 기존 저장분 + 새 파일 (같은 달은 새 파일이 덮어씀)
  const merged = useMemo<PlCfg | null>(() => {
    if (!draft) return saved;
    const rows: Record<string, PlRow> = JSON.parse(JSON.stringify(saved?.rows || {}));
    const order = [...(saved?.order || [])];
    draft.order.forEach(k => { const r = draft.rows[k]; if (!rows[k]) { rows[k] = { lv: r.lv, label: r.label, v: {} }; order.push(k); } Object.assign(rows[k].v, r.v); rows[k].lv = r.lv; });
    // 새 파일 순서를 우선
    const ord = [...draft.order, ...order.filter(k => draft.order.indexOf(k) < 0)];
    return { rows, order: ord, closedThrough: closed };
  }, [draft, saved, closed]);
  const months = useMemo(() => plMonths(merged), [merged]);
  const show = months.slice(-13);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setMsg({ text: '', cls: '' });
    try {
      const { cfg, months: ms } = parse(await f.arrayBuffer());
      setDraft(cfg); setFileName(f.name);
      // 마감 완료 월 기본값: 앱 마감월이 파일 범위 안이면 그 달, 아니면 이미 저장된 값 또는 파일의 마지막 달
      const cm = (closeMonth || '').replace(/\D/g, '').slice(0, 6);
      const all = [...new Set([...(saved ? plMonths(saved) : []), ...ms])].sort();
      setClosed(c => (cm && all.indexOf(cm) >= 0 ? cm : c && all.indexOf(c) >= 0 ? c : ms[ms.length - 1]));
      setMsg({ text: `${f.name} — ${ymL(ms[0])} ~ ${ymL(ms[ms.length - 1])} (${ms.length}개월) 읽었습니다. 아래 내용을 확인하고 [저장]을 눌러 주세요.`, cls: 'pos' });
    } catch (e) { setDraft(null); setFileName(''); setMsg({ text: (e as Error).message, cls: 'neg' }); }
  };
  const dirty = !!draft || (!!saved && closed !== saved.closedThrough);
  const save = async () => {
    if (!merged) return;
    if (!closed) return setMsg({ text: '마감 완료 월을 골라 주세요.', cls: 'neg' });
    setBusy(true);
    const next: PlCfg = { ...merged, closedThrough: closed };
    const { error } = await supabase.rpc('save_config', { p_key: 'plStmt', p_value: next, p_summary: `손익계산서 올리기 ${fileName || ''} (마감 ${ymL(closed)})`.trim() });
    setBusy(false);
    if (error) return setMsg({ text: error.message, cls: 'neg' });
    setSaved(next); setDraft(null); setFileName('');
    setMsg({ text: `저장했습니다. ${ymL(closed)} 까지는 국전 수익/비용(실현 수익) 화면에 손익계산서 금액이 그대로 표시됩니다.`, cls: 'pos' });
    await loadPl(true); window.dispatchEvent(new CustomEvent('kjhub:plsaved'));
  };
  const clear = async () => {
    if (!window.confirm('저장된 손익계산서 금액을 모두 지울까요? (화면은 앱 계산 추정값으로 돌아갑니다)')) return;
    setBusy(true);
    const { error } = await supabase.rpc('save_config', { p_key: 'plStmt', p_value: { rows: {}, order: [], closedThrough: '' }, p_summary: '손익계산서 지우기' });
    setBusy(false);
    if (error) return setMsg({ text: error.message, cls: 'neg' });
    setSaved(null); setDraft(null); setClosed(''); setMsg({ text: '지웠습니다.', cls: 'pos' });
    await loadPl(true); window.dispatchEvent(new CustomEvent('kjhub:plsaved'));
  };

  return (
    <div className="page pls" style={{ gap: 16, maxWidth: 1400 }}>
      <style>{`
        .pls>*{min-width:0}
        .pls table{width:100%;border-collapse:collapse;font-size:13px}
        .pls th{font-weight:500;color:var(--fg-3);font-size:11.5px;text-align:right;padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap;background:var(--surface-2)}
        .pls th:first-child,.pls td:first-child{text-align:left;position:sticky;left:0;background:var(--surface)}
        .pls th:first-child{background:var(--surface-2)}
        .pls td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums;white-space:nowrap}
        .pls td:first-child{font-family:var(--font-body)}
        .pls tr.l1 td{font-weight:700}.pls tr.l2 td:first-child{padding-left:24px;color:var(--fg-2)}
        .pls td.off,.pls th.off{color:var(--fg-3);background:#fafbfd}
        .pls .note{font-size:12.5px;color:var(--fg-2);line-height:1.7}
      `}</style>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>손익계산서 올리기</h1>
        <span className="help">회계 확정 금액 → 국전 수익/비용(실현 수익) 화면의 손익 요약</span>
      </div>
      <div className="card" style={{ padding: '14px 16px' }}>
        <div className="note">
          구매·판매·전표 데이터만으로는 <b>매출원가</b>를 회계와 원 단위까지 똑같이 만들 수 없습니다(재고 평가·분기 결산 조정은 ERP 원가계산 결과에만 있음).
          그래서 <b>마감이 끝난 달은 ERP 손익계산서 금액을 그대로</b> 보여주고, 아직 마감하지 않은 달만 앱이 계산한 추정값을 보여줍니다.<br />
          ① ERP에서 <b>월별 손익계산서</b>를 엑셀로 내려받습니다 (첫 열 계정과목, 그 뒤로 월별 금액). ② 아래에서 파일을 고릅니다. ③ <b>마감 완료 월</b>을 확인하고 저장합니다.
          매달 마감 후 같은 파일을 다시 올리면 됩니다 — 같은 달은 새 금액으로 바뀌고, 예전에 올린 다른 해의 달은 그대로 남습니다.
        </div>
        <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="file" accept=".xlsx,.xls" onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
          <span className="help">마감 완료 월</span>
          <select className="inp" style={{ fontFamily: 'var(--font-num)', fontWeight: 600 }} value={closed} onChange={e => setClosed(e.target.value)} disabled={!months.length}>
            {!closed && <option value="">선택</option>}
            {months.slice().reverse().map(m => <option key={m} value={m}>{ymL(m)}</option>)}
          </select>
          <span className="sp" />
          {saved && plMonths(saved).length > 0 && <button className="btn ghost" onClick={clear} disabled={busy}>모두 지우기</button>}
          <button className="btn pri" onClick={save} disabled={busy || !dirty || !merged}>{busy ? '저장 중…' : '저장'}</button>
        </div>
        {msg.text && <div className="help" style={{ marginTop: 8, color: msg.cls === 'neg' ? 'var(--neg)' : '#2c7f2c' }}>{msg.text}</div>}
      </div>

      {merged && months.length > 0 ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px' }} className="help">
            {draft ? <b style={{ color: '#9a6f00' }}>저장 전 미리보기</b> : '저장된 내용'} · {ymL(months[0])} ~ {ymL(months[months.length - 1])} ({months.length}개월){months.length > show.length ? ` 중 최근 ${show.length}개월` : ''} · 흐린 열 = 마감 전(화면에서 확정으로 쓰지 않음)
          </div>
          <div className="tbl-wrap" style={{ overflowX: 'auto' }}><table>
            <thead><tr><th>계정과목</th>{show.map(m => <th key={m} className={closed && m > closed ? 'off' : ''}>{ymL(m)}</th>)}</tr></thead>
            <tbody>
              {merged.order.filter(k => merged.rows[k]).map(k => { const r = merged.rows[k]; return (
                <tr key={k} className={r.lv === 1 ? 'l1' : 'l2'}><td>{r.label}</td>{show.map(m => <td key={m} className={closed && m > closed ? 'off' : ''} style={{ color: (r.v[m] || 0) < 0 ? 'var(--neg)' : undefined }}>{r.v[m] == null ? '-' : fmt(r.v[m])}</td>)}</tr>
              ); })}
            </tbody>
          </table></div>
        </div>
      ) : <div className="card"><div className="empty">아직 올린 손익계산서가 없습니다. 화면은 앱이 계산한 추정값으로 표시됩니다.</div></div>}
    </div>
  );
}
