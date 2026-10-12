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
    const clean = json.map(r => { const o: Row = {}; for (const k in r) { const kk = String(k).trim(); if (kk && !kk.startsWith('__EMPTY')) o[kk] = r[k] instanceof Date ? (r[k] as Date).toISOString().slice(0, 10) : r[k]; } return o; })
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
    const what = mode === 'replace_all' ? `${ds.label} 전체 데이터를 지우고 ${fmt(rows.length)}행으로 교체합니다.`
      : mode === 'replace_month' ? `${ds.label} ${ymLabel(ym)} 데이터${existingMonth ? ` (기존 ${fmt(existingMonth.cnt)}행)` : ''}를 ${fmt(rows.length)}행으로 교체합니다.`
      : `${ds.label} ${ymLabel(ym)} 에 ${fmt(rows.length)}행을 추가합니다.`;
    if (!(await confirm('업로드할까요?', what + ' 완료 후 변경 이력에 기록됩니다.', { okText: '업로드' }))) return;
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
      toast(`${ds.label} ${fmt(n as number)}행 업로드 완료`);
      setRows([]); setCols([]); setFile(null); if (inputRef.current) inputRef.current.value = '';
      await loadStatus();
    } catch (e) { toast('업로드 실패: ' + (e as Error).message, 'err'); } finally { setBusy(false); }
  }

  return (
    <div className="page">
      <div className="page-head"><h1>데이터 업로드</h1><span className="meta">엑셀(.xlsx/.csv) 첫 번째 시트를 올립니다 · 1행 = 열 이름</span></div>
      <div className="two" style={{ gridTemplateColumns: '1fr 1.3fr' }}>
        <div className="card"><div className="hd">1. 파일 선택</div><div className="bd">
          <div className="field"><label htmlFor="up-ds">데이터 종류</label>
            <select id="up-ds" className="inp" value={dataset} onChange={e => setDataset(e.target.value)}>{Object.entries(DATASETS).map(([k, v]) => <option key={k} value={k}>{v.label}{v.snapshot ? ' (전체 스냅샷)' : ''}</option>)}</select></div>
          {!ds.snapshot && <div className="field"><label htmlFor="up-ym">대상 월</label><input id="up-ym" className="inp" style={{ width: 140 }} value={ymLabel(ym)} onChange={e => setYm(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="YYYY-MM" />
            <span className="help">{monthCol ? `파일의 '${monthCol}' 열에서 월을 읽어 행마다 저장합니다. 비어 있는 행은 대상 월로 저장됩니다.` : '파일에 날짜 열이 없으면 모든 행을 대상 월로 저장합니다.'}</span></div>}
          <div className={'drop'} onClick={() => inputRef.current?.click()} onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('over'); }} onDragLeave={e => e.currentTarget.classList.remove('over')} onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) pick(f); }}>
            {file ? <><b>{file.name}</b><br /><span className="help">{fmt(rows.length)}행 · 열 {cols.length}개 인식됨</span></> : <>여기에 파일을 끌어다 놓거나 클릭해서 선택<br /><span className="help">.xlsx .xls .csv</span></>}
            <input ref={inputRef} id="up-file" type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => { const f = e.target.files?.[0]; if (f) pick(f); }} />
          </div>
          <div className="field"><label>{ds.snapshot ? '저장 방식' : '같은 월 데이터가 있으면'}</label>
            <span className="seg">
              {!ds.snapshot && <button className={mode === 'replace_month' ? 'on' : ''} onClick={() => setMode('replace_month')}>월 교체</button>}
              {!ds.snapshot && <button className={mode === 'append' ? 'on' : ''} onClick={() => setMode('append')}>추가</button>}
              <button className={mode === 'replace_all' ? 'on' : ''} onClick={() => setMode('replace_all')}>전체 교체</button>
            </span>
            <span className="help">{mode === 'replace_all' ? '이 데이터 종류의 모든 행을 지우고 파일 내용으로 바꿉니다 (최초 이관 때 사용).' : mode === 'append' ? '기존 행을 유지하고 뒤에 붙입니다.' : '대상 월 행만 지우고 파일 내용으로 바꿉니다.'}</span></div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {busy && <span className="help">{prog}%</span>}
            <button className="btn acc" disabled={busy || !rows.length} onClick={upload}>{busy ? <span className="spinner" /> : `업로드 · ${fmt(rows.length)}행`}</button>
          </div>
        </div></div>

        <div className="card"><div className="hd">2. 미리보기 · 검증 <span className="sp" />{cols.length > 0 && <span className="tag g">열 {cols.length}</span>} {monthCol ? <span className="tag b">월 열: {monthCol}</span> : cols.length > 0 && !ds.snapshot ? <span className="tag y">월 열 없음</span> : null}</div>
          {!rows.length ? <div className="empty">파일을 선택하면 열 이름과 앞 5행이 여기 표시됩니다.</div> : (
            <>
              {monthStat && <div className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}><span className="help">월별 행 수:</span>{monthStat.map(([k, n]) => <span key={k} className={'chip' + (k === ym ? ' on' : '')}>{ymLabel(k)} {fmt(n)}</span>)}</div>}
              <div className="tbl-wrap" style={{ maxHeight: 360 }}><table className="tbl"><thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{rows.slice(0, 5).map((r, i) => <tr key={i}>{cols.map(c => <td key={c}>{String(r[c] ?? '')}</td>)}</tr>)}</tbody></table></div>
            </>
          )}
        </div>
      </div>

      <div className="two">
        <div className="card"><div className="hd">현재 저장된 데이터 <span className="sp" /><button className="btn sm ghost" onClick={loadStatus}>새로고침</button></div>
          <div className="tbl-wrap" style={{ maxHeight: 420 }}><table className="tbl"><thead><tr><th>데이터</th><th>월</th><th className="num">행 수</th><th>마지막 업로드</th></tr></thead>
            <tbody>{summary.length === 0 ? <tr><td colSpan={4} className="empty">아직 데이터가 없습니다.</td></tr> : summary.map((s, i) => <tr key={i}><td>{DATASETS[s.dataset]?.label ?? s.dataset}</td><td>{s.ym ? ymLabel(s.ym) : <span className="tag gr">스냅샷</span>}</td><td className="num">{fmt(s.cnt)}</td><td className="help">{kst(s.last_at)}</td></tr>)}</tbody></table></div></div>
        <div className="card"><div className="hd">최근 업로드 이력</div>
          <div className="tbl-wrap" style={{ maxHeight: 420 }}><table className="tbl"><thead><tr><th>시각</th><th>데이터</th><th>월</th><th>방식</th><th className="num">행</th><th>파일</th><th>담당</th></tr></thead>
            <tbody>{batches.map(b => <tr key={b.id}><td className="help">{kst(b.created_at)}</td><td>{DATASETS[b.dataset]?.label ?? b.dataset}</td><td>{b.ym ? ymLabel(b.ym) : '-'}</td><td><span className={'tag ' + (b.mode === 'replace_all' ? 'o' : b.mode === 'append' ? 'g' : 'b')}>{b.mode === 'replace_all' ? '전체 교체' : b.mode === 'append' ? '추가' : '월 교체'}</span></td><td className="num">{fmt(b.row_count)}</td><td className="help">{b.filename}</td><td>{b.uploaded_by}</td></tr>)}</tbody></table></div></div>
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
    try { cfg = JSON.parse(text); } catch { return toast('JSON 형식이 아닙니다.', 'err'); }
    const keys = ['groups', 'items', 'support', 'closeMonth'].filter(k => k in cfg);
    if (!keys.length) return toast('groups / items / support / closeMonth 중 하나도 없습니다.', 'err');
    if (!(await confirm('설정을 가져올까요?', `${keys.join(', ')} 설정을 현재 값 위에 덮어씁니다. 이전 값은 변경 이력에 남습니다.`, { okText: '가져오기' }))) return;
    setBusy(true);
    try {
      for (const k of keys) { const { error } = await supabase.rpc('save_config', { p_key: k, p_value: cfg[k], p_summary: `Apps Script 설정 가져오기 (${actor})` }); if (error) throw error; }
      toast(`설정 ${keys.length}건 가져오기 완료`); setText(''); onDone();
    } catch (e) { toast('실패: ' + (e as Error).message, 'err'); } finally { setBusy(false); }
  }
  return (
    <div className="card"><div className="hd">3. 기존 설정 가져오기 (Apps Script → Supabase, 최초 1회)</div><div className="bd">
      <span className="help">기존 Apps Script 편집기에서 <code>exportAllConfig()</code> 를 실행해 나온 JSON 전체를 붙여넣으세요. 배분 비율(groups)·품목/원자재(items)·지원 내역(support)·마감월(closeMonth)이 옮겨집니다.</span>
      <textarea id="cfg-json" className="inp" rows={5} value={text} onChange={e => setText(e.target.value)} placeholder='{"groups":{...},"items":{...},"support":{...},"closeMonth":"202608"}' style={{ fontFamily: 'monospace', fontSize: 12 }} />
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn pri" disabled={busy || !text.trim()} onClick={run}>{busy ? <span className="spinner" /> : '가져오기'}</button></div>
    </div></div>
  );
}
