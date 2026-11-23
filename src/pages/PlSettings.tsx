// 관리 › 손익계산서 올리기 — ERP 손익계산서(월별) 엑셀을 올려 '확정 금액'으로 저장
//   쓰는 곳: 경영 요약 · 손익 현황의 회사 전체 손익 — 마감이 끝난 달은 이 금액을 그대로 보여줍니다.
//   파일 모양: 첫 열 = 계정과목(I. 매출액, II. 매출원가 …), 나머지 열 = 월 (머리글이 날짜·2026-01·202601·2026년 1월 중 하나)
import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { fmt } from '../components/ui';
import { ymL } from '../components/charts';
import { PageHead, Card, Empty } from '../components/kit';
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
      setMsg({ text: `${f.name} — ${ymL(ms[0])} ~ ${ymL(ms[ms.length - 1])} (${ms.length}개월)을 읽었습니다. 아래 내용을 확인하고 [저장]을 눌러 주세요.`, cls: 'pos' });
    } catch (e) { setDraft(null); setFileName(''); setMsg({ text: (e as Error).message, cls: 'neg' }); }
  };
  const dirty = !!draft || (!!saved && closed !== saved.closedThrough);
  const save = async () => {
    if (!merged) return;
    if (!closed) return setMsg({ text: '마감이 끝난 마지막 달을 골라 주세요.', cls: 'neg' });
    setBusy(true);
    const next: PlCfg = { ...merged, closedThrough: closed };
    const { error } = await supabase.rpc('save_config', { p_key: 'plStmt', p_value: next, p_summary: `손익계산서 올리기 ${fileName || ''} (마감 ${ymL(closed)})`.trim() });
    setBusy(false);
    if (error) return setMsg({ text: error.message, cls: 'neg' });
    setSaved(next); setDraft(null); setFileName('');
    setMsg({ text: `저장했습니다. ${ymL(closed)}까지는 경영 화면에 손익계산서 금액이 그대로(확정) 표시됩니다.`, cls: 'pos' });
    await loadPl(true); window.dispatchEvent(new CustomEvent('kjhub:plsaved'));
  };
  const clear = async () => {
    if (!window.confirm('저장된 손익계산서 금액을 모두 지울까요? 지우면 모든 달이 추정값으로 표시됩니다.')) return;
    setBusy(true);
    const { error } = await supabase.rpc('save_config', { p_key: 'plStmt', p_value: { rows: {}, order: [], closedThrough: '' }, p_summary: '손익계산서 지우기' });
    setBusy(false);
    if (error) return setMsg({ text: error.message, cls: 'neg' });
    setSaved(null); setDraft(null); setClosed(''); setMsg({ text: '지웠습니다.', cls: 'pos' });
    await loadPl(true); window.dispatchEvent(new CustomEvent('kjhub:plsaved'));
  };

  return (
    <div className="page pls">
      <style>{`
        .pls table{width:100%;border-collapse:separate;border-spacing:0;font-size:13.5px}
        .pls th{font-weight:600;color:var(--fg-3);font-size:12px;text-align:right;padding:9px 10px;border-bottom:1px solid var(--line);white-space:nowrap;background:var(--surface-2)}
        .pls th:first-child,.pls td:first-child{text-align:left;position:sticky;left:0;background:var(--surface);box-shadow:1px 0 0 var(--line)}
        .pls th:first-child{background:var(--surface-2)}
        .pls td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .pls tr.l1 td{font-weight:700}.pls tr.l2 td:first-child{padding-left:26px;color:var(--fg-2)}
        .pls td.off,.pls th.off{color:var(--fg-4);background:#fafbfd}
      `}</style>
      <PageHead title="손익계산서 올리기" desc="마감이 끝난 달의 손익계산서를 올리면, 그 달은 경영 화면에 '확정' 금액으로 표시됩니다." />
      <Card>
        <ol className="steps">
          <li><span>ERP에서 <b>월별 손익계산서</b>를 엑셀로 내려받습니다. 첫 열은 계정과목, 그 뒤는 월별 금액입니다.</span></li>
          <li><span>아래에서 <b>파일을 고릅니다.</b> 같은 달은 새 금액으로 바뀌고 다른 달은 그대로 남습니다.</span></li>
          <li><span><b>마감이 끝난 마지막 달</b>을 확인하고 저장합니다. 그 뒤의 달은 추정값으로 표시됩니다.</span></li>
        </ol>
        <div className="row" style={{ gap: 10, marginTop: 14 }}>
          <input type="file" accept=".xlsx,.xls" onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
          <label className="help" htmlFor="pl-closed" style={{ fontWeight: 600 }}>마감이 끝난 마지막 달</label>
          <select id="pl-closed" className="inp" style={{ fontWeight: 600 }} value={closed} onChange={e => setClosed(e.target.value)} disabled={!months.length}>
            {!closed && <option value="">골라 주세요</option>}
            {months.slice().reverse().map(m => <option key={m} value={m}>{ymL(m)}</option>)}
          </select>
          <span className="sp" />
          {saved && plMonths(saved).length > 0 && <button className="btn ghost" onClick={clear} disabled={busy}>모두 지우기</button>}
          <button className="btn pri" onClick={save} disabled={busy || !dirty || !merged}>{busy ? '저장하는 중' : '저장'}</button>
        </div>
        {msg.text && <div className="help" style={{ marginTop: 8, color: msg.cls === 'neg' ? 'var(--red-2)' : 'var(--green-2)', fontWeight: 600 }}>{msg.text}</div>}
        <p className="help" style={{ marginTop: 12 }}>매출원가는 재고 평가 · 결산 조정 때문에 ERP 원가계산으로만 정확히 나옵니다. 그래서 마감한 달은 손익계산서 금액을 그대로 쓰고, 마감 전 달만 앱이 계산한 추정값을 씁니다.</p>
      </Card>

      {merged && months.length > 0 ? (
        <Card title={draft ? '저장 전 미리 보기' : '저장된 손익계산서'} desc={`${ymL(months[0])} ~ ${ymL(months[months.length - 1])} (${months.length}개월)${months.length > show.length ? ` 중 최근 ${show.length}개월` : ''} · 흐린 열 = 마감 전`} right={draft ? <span className="badge est">아직 저장 전</span> : undefined} flush>
          <div className="tbl-wrap"><table>
            <thead><tr><th>계정과목</th>{show.map(m => <th key={m} className={closed && m > closed ? 'off' : ''}>{ymL(m)}</th>)}</tr></thead>
            <tbody>
              {merged.order.filter(k => merged.rows[k]).map(k => { const r = merged.rows[k]; return (
                <tr key={k} className={r.lv === 1 ? 'l1' : 'l2'}><td>{r.label}</td>{show.map(m => <td key={m} className={closed && m > closed ? 'off' : ''} style={{ color: (r.v[m] || 0) < 0 ? 'var(--red-2)' : undefined }}>{r.v[m] == null ? '-' : fmt(r.v[m])}</td>)}</tr>
              ); })}
            </tbody>
          </table></div>
        </Card>
      ) : <Empty>아직 올린 손익계산서가 없습니다. 지금은 모든 달이 추정값으로 표시됩니다.</Empty>}
    </div>
  );
}
