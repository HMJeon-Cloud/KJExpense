import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase, DATASETS } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useUI, fmt, ymLabel, kst } from '../components/ui';

type Row = Record<string, unknown>;
type Mode = 'replace_month' | 'append' | 'replace_all';

/** 셀 값 → 'YYYYMM' (Date, 'YYYY-MM-DD', 'YYYYMMDD', 'YYYYMM', 엑셀 일련번호 모두 처리) */
export function toYm(v: unknown): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.getFullYear() + ('0' + (v.getMonth() + 1)).slice(-2);
  if (typeof v === 'number') {
    if (v > 190000 && v < 300000) return String(v);                         // 202608
    if (v > 19000000) return String(v).slice(0, 6);                            // 20260815
    const d = XLSX.SSF.parse_date_code(v); if (d) return d.y + ('0' + d.m).slice(-2); // 엑셀 날짜
    return '';
  }
  const s = String(v).trim().replace(/[.\/]/g, '-');
  const m = s.match(/^(\d{4})-?(\d{2})/); return m ? m[1] + m[2] : '';
}

/** Date → 'YYYY-MM-DD' (현지 시간 기준; toISOString 은 UTC 라 하루가 밀림) */
const localDate = (d: Date) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);

export default function Upload() {
  const { employee } = useAuth();
  const { toast, confirm } = useUI();
  const [dataset, setDataset] = useState('purchase');
  const [ym, setYm] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2); });
  const [mode, setMode] = useState<Mode>('replace_month');
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [cols, setCols] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const [summary, setSummary] = useState<{ dataset: string; ym: string; cnt: number; last_at: string }[]>([]);
  const [batches, setBatches] = useState<{ id: string; dataset: string; ym: string; mode: string; filename: string; row_count: number; uploaded_by: string; created_at: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const ds = DATASETS[dataset];

  async function loadStatus() {
    const [{ data: s }, { data: b }] = await Promise.all([
      supabase.rpc('dataset_summary'),
      supabase.from('upload_batches').select('*').order('created_at', { ascending: false }).limit(20),
    ]);
    setSummary((s as typeof summary) ?? []); setBatches((b as typeof batches) ?? []);
  }
  useEffect(() => { loadStatus(); }, []);
  useEffect(() => { if (ds.snapshot) setMode('replace_all'); else if (mode === 'replace_all') setMode('replace_month'); }, [dataset]); // eslint-disable-line

  async function pick(f: File) {
    setFile(f);
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Row>(ws, { defval: '', raw: true });
    // 헤더 공백 제거, 빈 행 제거
    const clean = json.map(r => { const o: Row = {}; for (const k in r) { const kk = String(k).trim(); if (kk && !kk.startsWith('__EMPTY')) o[kk] = r[k] instanceof Date ? localDate(r[k] as Date) : r[k]; } return o; })
      .filter(r => Object.values(r).some(v => v !== '' && v != null));
    setRows(clean); setCols(clean.length ? Object.keys(clean[0]) : []);
  }

  const monthCol = useMemo(() => cols.find(c => ds.monthField.some(m => m.toLowerCase() === c.toLowerCase())) ?? '', [cols, ds]);
  const monthStat = useMemo(() => {
    if (!monthCol) return null;
    const c: Record<string, number> = {};
    rows.forEach(r => { const k = toYm(r[monthCol]) || '(없음)'; c[k] = (c[k] ?? 0) + 1; });
    return Object.entries(c).sort();
  }, [rows, monthCol]);
  const existing = summary.filter(s => s.dataset === dataset);
  const existingMonth = existing.find(s => s.ym === ym);

  async function upload() {
    if (!rows.length) return;
    const what = mode === 'replace_all' ? `${ds.label} 데이터를 모두 지우고 ${fmt(rows.length)}줄로 바꿉니다.`
      : mode === 'replace_month' ? `${ds.label} ${ymLabel(ym)} 데이터${existingMonth ? ` (지금 ${fmt(existingMonth.cnt)}줄)` : ''}를 ${fmt(rows.length)}줄로 바꿉니다.`
      : `${ds.label} ${ymLabel(ym)}에 ${fmt(rows.length)}줄을 더합니다.`;
    if (!(await confirm('올릴까요?', what + ' 올린 기록은 아래 [최근 올린 기록]에 남습니다.', { okText: '올리기' }))) return;
    setBusy(true); setProg(0);
    try {
      const { data: batchId, error } = await supabase.rpc('begin_upload', { p_dataset: dataset, p_ym: ds.snapshot ? null : ym, p_mode: mode, p_filename: file?.name ?? '', p_columns: cols });
      if (error) throw error;
      const payload = rows.map(r => ({ dataset, batch_id: batchId, ym: ds.snapshot ? null : (monthCol ? (toYm(r[monthCol]) || ym) : ym), data: r }));
      const CH = 500;
      for (let i = 0; i < payload.length; i += CH) {
        const { error: e2 } = await supabase.from('rows').insert(payload.slice(i, i + CH));
        if (e2) throw e2;
        setProg(Math.min(100, Math.round(((i + CH) / payload.length) * 100)));
      }
      const { data: n } = await supabase.rpc('finish_upload', { p_batch: batchId });
      toast(`${ds.label} ${fmt(n as number)}줄을 올렸습니다.`);
      try { window.dispatchEvent(new CustomEvent('kjhub:uploaded', { detail: { dataset } })); } catch { /* noop */ }
      setRows([]); setCols([]); setFile(null); if (inputRef.current) inputRef.current.value = '';
      await loadStatus();
    } catch (e) { toast('올리지 못했습니다: ' + (e as Error).message, 'err'); } finally { setBusy(false); }
  }

  return (
    <div className="page">
      <div className="page-head"><div><h1>데이터 올리기</h1><div className="help">ERP에서 받은 엑셀(.xlsx · .csv)의 첫 번째 시트를 올립니다. 첫 줄은 열 이름이어야 합니다.</div></div></div>
      <div className="two" style={{ gridTemplateColumns: '1fr 1.3fr' }}>
        <div className="card"><div className="hd">1. 파일 고르기</div><div className="bd">
          <div className="field"><label htmlFor="up-ds">데이터 종류</label>
            <select id="up-ds" className="inp" value={dataset} onChange={e => setDataset(e.target.value)}>{Object.entries(DATASETS).map(([k, v]) => <option key={k} value={k}>{v.label}{v.snapshot ? ' (전체를 한 번에)' : ''}</option>)}</select></div>
          {!ds.snapshot && <div className="field"><label htmlFor="up-ym">올릴 달</label><input id="up-ym" className="inp" style={{ width: 140 }} value={ymLabel(ym)} onChange={e => setYm(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="YYYY-MM" />
            <span className="help">{monthCol ? `파일의 '${monthCol}' 열에서 달을 읽어 줄마다 저장합니다. 비어 있는 줄은 위에서 고른 달로 저장합니다.` : '파일에 날짜 열이 없으면 모든 줄을 위에서 고른 달로 저장합니다.'}</span></div>}
          <div className={'drop'} onClick={() => inputRef.current?.click()} onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('over'); }} onDragLeave={e => e.currentTarget.classList.remove('over')} onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) pick(f); }}>
            {file ? <><b>{file.name}</b><br /><span className="help">{fmt(rows.length)}줄 · 열 {cols.length}개</span></> : <>파일을 여기로 끌어다 놓거나 눌러서 골라 주세요<br /><span className="help">.xlsx .xls .csv</span></>}
            <input ref={inputRef} id="up-file" type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => { const f = e.target.files?.[0]; if (f) pick(f); }} />
          </div>
          <div className="field"><label>{ds.snapshot ? '저장 방법' : '같은 달 데이터가 이미 있으면'}</label>
            <span className="seg">
              {!ds.snapshot && <button className={mode === 'replace_month' ? 'on' : ''} onClick={() => setMode('replace_month')}>그 달만 바꾸기</button>}
              {!ds.snapshot && <button className={mode === 'append' ? 'on' : ''} onClick={() => setMode('append')}>뒤에 더하기</button>}
              <button className={mode === 'replace_all' ? 'on' : ''} onClick={() => setMode('replace_all')}>전체 바꾸기</button>
            </span>
            <span className="help">{mode === 'replace_all' ? '이 종류의 데이터를 모두 지우고 파일 내용으로 바꿉니다.' : mode === 'append' ? '있던 데이터는 그대로 두고 뒤에 더합니다. 같은 파일을 두 번 올리면 두 번 들어갑니다.' : '그 달 데이터만 지우고 파일 내용으로 바꿉니다.'}</span></div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {busy && <span className="help">{prog}%</span>}
            <button className="btn acc" disabled={busy || !rows.length} onClick={upload}>{busy ? <span className="spinner" /> : `${fmt(rows.length)}줄 올리기`}</button>
          </div>
        </div></div>

        <div className="card"><div className="hd">2. 미리 보기 <span className="sp" />{cols.length > 0 && <span className="tag g">열 {cols.length}</span>} {monthCol ? <span className="tag b">달을 읽는 열: {monthCol}</span> : cols.length > 0 && !ds.snapshot ? <span className="tag y">날짜 열 없음</span> : null}</div>
          {!rows.length ? <div className="empty">파일을 고르면 열 이름과 앞 5줄이 여기에 나옵니다.</div> : (
            <>
              {monthStat && <div className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}><span className="help">달마다 줄 수</span>{monthStat.map(([k, n]) => <span key={k} className={'chip' + (k === ym ? ' on' : '')}>{ymLabel(k)} {fmt(n)}</span>)}</div>}
              <div className="tbl-wrap" style={{ maxHeight: 360 }}><table className="tbl"><thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{rows.slice(0, 5).map((r, i) => <tr key={i}>{cols.map(c => <td key={c}>{String(r[c] ?? '')}</td>)}</tr>)}</tbody></table></div>
            </>
          )}
        </div>
      </div>

      <div className="two">
        <div className="card"><div className="hd">지금 저장된 데이터 <span className="sp" /><button className="btn sm ghost" onClick={loadStatus}>다시 불러오기</button></div>
          <div className="tbl-wrap" style={{ maxHeight: 420 }}><table className="tbl"><thead><tr><th>데이터</th><th>달</th><th className="num">줄 수</th><th>마지막으로 올린 때</th></tr></thead>
            <tbody>{summary.length === 0 ? <tr><td colSpan={4} className="empty">아직 데이터가 없습니다.</td></tr> : summary.map((s, i) => <tr key={i}><td>{DATASETS[s.dataset]?.label ?? s.dataset}</td><td>{s.ym ? ymLabel(s.ym) : <span className="tag gr">전체</span>}</td><td className="num">{fmt(s.cnt)}</td><td className="help">{kst(s.last_at)}</td></tr>)}</tbody></table></div></div>
        <div className="card"><div className="hd">최근 올린 기록</div>
          <div className="tbl-wrap" style={{ maxHeight: 420 }}><table className="tbl"><thead><tr><th>때</th><th>데이터</th><th>달</th><th>방법</th><th className="num">줄 수</th><th>파일</th><th>올린 사람</th></tr></thead>
            <tbody>{batches.map(b => <tr key={b.id}><td className="help">{kst(b.created_at)}</td><td>{DATASETS[b.dataset]?.label ?? b.dataset}</td><td>{b.ym ? ymLabel(b.ym) : '-'}</td><td><span className={'tag ' + (b.mode === 'replace_all' ? 'o' : b.mode === 'append' ? 'g' : 'b')}>{b.mode === 'replace_all' ? '전체 바꾸기' : b.mode === 'append' ? '뒤에 더하기' : '그 달만 바꾸기'}</span></td><td className="num">{fmt(b.row_count)}</td><td className="help">{b.filename}</td><td>{b.uploaded_by}</td></tr>)}</tbody></table></div></div>
      </div>
      <ConfigImport onDone={loadStatus} actor={employee?.login_id ?? ''} />
    </div>
  );
}

/** 기존 Apps Script 설정(JSON) 가져오기 — exportAllConfig() 결과 파일 */
function ConfigImport({ onDone, actor }: { onDone: () => void; actor: string }) {
  const { toast, confirm } = useUI();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function run() {
    let cfg: Record<string, unknown>;
    try { cfg = JSON.parse(text); } catch { return toast('JSON 형식이 아닙니다. 내용을 다시 확인해 주세요.', 'err'); }
    const keys = ['groups', 'items', 'support', 'closeMonth'].filter(k => k in cfg);
    if (!keys.length) return toast('groups / items / support / closeMonth 중 하나도 없습니다.', 'err');
    if (!(await confirm('설정을 가져올까요?', `${keys.join(', ')} 설정을 지금 값 대신 넣습니다. 이전 값은 [변경 이력]에 남습니다.`, { okText: '가져오기' }))) return;
    setBusy(true);
    try {
      for (const k of keys) { const { error } = await supabase.rpc('save_config', { p_key: k, p_value: cfg[k], p_summary: `Apps Script 설정 가져오기 (${actor})` }); if (error) throw error; }
      toast(`설정 ${keys.length}건을 가져왔습니다.`); setText(''); onDone();
      try { window.dispatchEvent(new CustomEvent('kjhub:allocsaved')); } catch { /* noop */ }
    } catch (e) { toast('가져오지 못했습니다: ' + (e as Error).message, 'err'); } finally { setBusy(false); }
  }
  return (
    <div className="card"><div className="hd">3. 예전 설정 가져오기 (처음 한 번만)</div><div className="bd">
      <span className="help">예전 Apps Script 편집기에서 <code>exportAllConfig()</code>를 실행해 나온 JSON 전체를 붙여 넣어 주세요. 배분 비율 · 품목/자재 판매가 · 지원 내역 · 마감월이 옮겨집니다.</span>
      <textarea id="cfg-json" className="inp" rows={5} value={text} onChange={e => setText(e.target.value)} placeholder='{"groups":{...},"items":{...},"support":{...},"closeMonth":"202608"}' style={{ fontFamily: 'monospace', fontSize: 12 }} />
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn pri" disabled={busy || !text.trim()} onClick={run}>{busy ? <span className="spinner" /> : '가져오기'}</button></div>
    </div></div>
  );
}
