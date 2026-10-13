// 집계 검증 (관리자) — DB 집계(SQL)와 화면 계산(JS)이 같은 숫자를 내는지 확인
//   1) 전표: DB voucher_agg vs 기존 JS aggregate (같은 범위) vs 이 화면의 독립 계산
//   2) "전체 원본으로 검증": 전체 전표를 받아 전 기간을 DB 집계와 대조
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fmt } from '../components/ui';
import { kor } from '../components/charts';
import { ymLabel } from '../lib/legacyData';
import { loadKeys } from '../legacy/hub';

type AggRow = { dept: string; ym: string; acc: string; ct: string; amt: number; n: number };
type DM = Record<string, Record<string, number>>;
type KJ = { data?: Record<string, Record<string, unknown>[] | null>; agg?: { voucher?: AggRow[] | null }; voucherRange?: () => { from: string; to: string }; verifyVoucher?: { db: (t?: string) => { deptMonth: DM; deptMonthAcc: Record<string, Record<string, Record<string, number>>> } | null; js: (t?: string) => { deptMonth: DM; deptMonthAcc: Record<string, Record<string, Record<string, number>>> } }; results?: { profitMonthlyByGroup?: Record<string, Record<string, number>>; marginMonthlyByBU?: Record<string, Record<string, number>> } };
const KJ = () => (window as unknown as { KJHub?: KJ }).KJHub;
const pickV = (r: Record<string, unknown>, ...ks: string[]) => { for (const k of ks) if (r[k] != null && r[k] !== '') return r[k]; return ''; };
const numV = (v: unknown) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0;

/** 기존 aggregate() 규칙의 독립 구현 (검증용 — profit.js 와 같아야 함) */
function aggregateRows(rows: Record<string, unknown>[]): { dm: DM; dma: Record<string, Record<string, Record<string, number>>> } {
  const dm: DM = {}, dma: Record<string, Record<string, Record<string, number>>> = {};
  for (const row of rows) {
    const acc = String(pickV(row, '계정과목', 'AccName'));
    const desc = String(pickV(row, '적요', 'Summary'));
    const dept = String(pickV(row, '코스트센터', 'CostCCtrName') || row['부서'] || '').trim();
    const ct = String(pickV(row, '비용구분', 'UMCostTypeName'));
    if (!dept) continue;
    if (acc.includes('집합') || desc.includes('제조원가대체') || desc.includes('손익대체') || desc.includes('원가대체') || dept.includes('원가계산')) continue;
    if (!(acc.includes('(판)') || acc.includes('(제)') || ct.includes('판관') || ct.includes('제조'))) continue;
    const m = String(pickV(row, '회계일', 'AccDate')).replace(/[^0-9]/g, '').slice(0, 6);
    if (m.length !== 6) continue;
    const cost = numV(pickV(row, '차변금액', 'DrAmt')) - numV(pickV(row, '대변금액', 'CrAmt'));
    (dm[dept] = dm[dept] || {})[m] = (dm[dept][m] || 0) + cost;
    const a = (dma[dept] = dma[dept] || {}); (a[m] = a[m] || {})[acc] = (a[m][acc] || 0) + cost;
  }
  return { dm, dma };
}
function dmFromAgg(agg: AggRow[]): { dm: DM; dma: Record<string, Record<string, Record<string, number>>> } {
  const dm: DM = {}, dma: Record<string, Record<string, Record<string, number>>> = {};
  for (const r of agg) { (dm[r.dept] = dm[r.dept] || {})[r.ym] = (dm[r.dept][r.ym] || 0) + Number(r.amt); const a = (dma[r.dept] = dma[r.dept] || {}); (a[r.ym] = a[r.ym] || {})[r.acc] = (a[r.ym][r.acc] || 0) + Number(r.amt); }
  return { dm, dma };
}
type Diff = { dept: string; ym: string; acc: string; a: number; b: number };
function diffDma(A: Record<string, Record<string, Record<string, number>>>, B: Record<string, Record<string, Record<string, number>>>, months: Set<string> | null): Diff[] {
  const out: Diff[] = []; const keys = new Set<string>();
  const walk = (X: typeof A) => { for (const d in X) for (const m in X[d]) if (!months || months.has(m)) for (const a in X[d][m]) keys.add(d + '\u0001' + m + '\u0001' + a); };
  walk(A); walk(B);
  keys.forEach(k => { const [d, m, a] = k.split('\u0001'); const x = A[d]?.[m]?.[a] || 0, y = B[d]?.[m]?.[a] || 0; if (Math.abs(x - y) > 0.5) out.push({ dept: d, ym: m, acc: a, a: x, b: y }); });
  return out.sort((p, q) => Math.abs(q.a - q.b) - Math.abs(p.a - p.b));
}
const monthTotals = (dm: DM) => { const t: Record<string, number> = {}; for (const d in dm) for (const m in dm[d]) t[m] = (t[m] || 0) + dm[d][m]; return t; };

export default function Verify() {
  const [tick, setTick] = useState(0);
  useEffect(() => { loadKeys(['voucher', 'dept']); }, []);
  useEffect(() => { const h = () => setTick(t => t + 1); ['kjhub:data', 'kjhub:results', 'kjhub:closemonth', 'kjhub:model'].forEach(e => window.addEventListener(e, h)); const iv = setInterval(h, 1500); return () => { ['kjhub:data', 'kjhub:results', 'kjhub:closemonth', 'kjhub:model'].forEach(e => window.removeEventListener(e, h)); clearInterval(iv); }; }, []);
  const kj = KJ();
  const agg = kj?.agg?.voucher ?? null;
  const raw = (kj?.data?.voucher ?? null) as Record<string, unknown>[] | null;
  const range = kj?.voucherRange?.();
  const [full, setFull] = useState<{ rows: number; months: string[]; diffs: Diff[]; tot: Record<string, [number, number]>; ms: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dbMonths, setDbMonths] = useState<{ ym: string; cnt: number }[] | null>(null);
  useEffect(() => { supabase.rpc('voucher_months').then(({ data, error }) => { if (!error && data) setDbMonths((data as { ym: string; cnt: number }[]).map(r => ({ ym: r.ym, cnt: Number(r.cnt) }))); }); }, [tick]);

  // ① 같은 범위(불러온 원본 월)에서 세 방식 비교
  const win = useMemo(() => {
    if (!agg || !raw) return null;
    const t0 = performance.now();
    const months = new Set<string>(); raw.forEach(r => { const m = String(pickV(r, '회계일', 'AccDate')).replace(/[^0-9]/g, '').slice(0, 6); if (m.length === 6) months.add(m); });
    const db = dmFromAgg(agg.filter(r => months.has(r.ym)));
    const ts = aggregateRows(raw);
    const legacy = kj?.verifyVoucher?.js('부서별 수익/비용');
    const dDbTs = diffDma(db.dma, ts.dma, months);
    const dTsJs = legacy ? diffDma(ts.dma, legacy.deptMonthAcc, months) : [];
    const tDb = monthTotals(db.dm), tTs = monthTotals(ts.dm), tJs = legacy ? monthTotals(legacy.deptMonth) : {};
    return { months: Array.from(months).sort(), dDbTs, dTsJs, tDb, tTs, tJs, ms: Math.round(performance.now() - t0), depts: Object.keys(db.dm).length };
  }, [agg, raw, tick]); // eslint-disable-line

  async function runFull() {
    setBusy(true); setErr('');
    try {
      const t0 = performance.now();
      const { data, error } = await supabase.rpc('dataset_rows', { p_dataset: 'voucher' });
      if (error) throw new Error(error.message);
      const rows = (data || []) as Record<string, unknown>[];
      const ts = aggregateRows(rows);
      const db = dmFromAgg(agg || []);
      const diffs = diffDma(db.dma, ts.dma, null);
      const tA = monthTotals(db.dm), tB = monthTotals(ts.dm); const tot: Record<string, [number, number]> = {};
      new Set([...Object.keys(tA), ...Object.keys(tB)]).forEach(m => { tot[m] = [tA[m] || 0, tB[m] || 0]; });
      setFull({ rows: rows.length, months: Object.keys(tot).sort(), diffs, tot, ms: Math.round(performance.now() - t0) });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const Badge = ({ ok, label }: { ok: boolean; label: string }) => <span className={'tag ' + (ok ? 'g' : 'n')} style={{ fontSize: 12, padding: '3px 10px' }}>{ok ? '✓ ' : '✗ '}{label}</span>;
  const results = kj?.results;

  return (
    <div className="page brief" style={{ gap: 16, maxWidth: 1400 }}>
      <style>{`.vf table{width:100%;border-collapse:collapse;font-size:12.5px}.vf th{text-align:left;color:var(--fg-3);font-weight:500;font-size:11.5px;padding:6px 8px;border-bottom:2px solid var(--line);white-space:nowrap}.vf td{padding:5px 8px;border-bottom:1px solid var(--line);white-space:nowrap}.vf td.n,.vf th.n{text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums}.vf .bad td{background:#fdeaea}.vf .kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.vf .kv div{background:var(--surface-2);border-radius:8px;padding:10px 12px;font-size:12px;color:var(--fg-3)}.vf .kv b{display:block;font:700 16px var(--font-num);color:var(--fg)}`}</style>
      <div className="vf" style={{ display: 'grid', gap: 16 }}>
        <div className="page-head"><div><h1>집계 검증</h1><div className="help">DB가 계산한 합계(SQL)와 화면 코드가 계산한 합계(JS)를 같은 규칙으로 대조합니다. 모두 ✓이면 DB 집계로 바꿔도 숫자가 바뀌지 않습니다.</div></div></div>

        <div className="card"><div className="hd">① 전표 집계 — 불러온 범위 {range ? `(${ymLabel(range.from)} ~ 마감월 이후)` : ''}</div>
          <div style={{ padding: 14, display: 'grid', gap: 12 }}>
            {!agg ? <div className="empty">DB 집계가 없습니다. Supabase에서 <b>0004_aggregates.sql</b>을 실행한 뒤 "다시 불러오기"를 하세요. (지금은 예전 방식 — 전체 원본으로 계산 중)</div> : !win ? <div className="empty"><span className="spinner" /> 전표를 불러오는 중…</div> : (
              <>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <Badge ok={!win.dDbTs.length} label={`DB(SQL) = 독립 계산(TS) · 차이 ${win.dDbTs.length}건`} />
                  <Badge ok={!win.dTsJs.length} label={`독립 계산(TS) = 기존 화면(JS) · 차이 ${win.dTsJs.length}건`} />
                  <span className="help">원본 {fmt(raw!.length)}건 · 집계 {fmt(agg.length)}행 · 부서 {win.depts} · 비교 {win.ms}ms</span>
                </div>
                <div className="tbl-wrap"><table>
                  <thead><tr><th>월</th><th className="n">DB(SQL)</th><th className="n">독립 계산(TS)</th><th className="n">기존 화면(JS)</th><th className="n">차이</th></tr></thead>
                  <tbody>{win.months.map(m => { const a = win.tDb[m] || 0, b = win.tTs[m] || 0, c = win.tJs[m] || 0; const bad = Math.abs(a - b) > 0.5 || Math.abs(b - c) > 0.5; return <tr key={m} className={bad ? 'bad' : ''}><td>{ymLabel(m)}</td><td className="n">{fmt(a)}</td><td className="n">{fmt(b)}</td><td className="n">{fmt(c)}</td><td className="n">{bad ? fmt(Math.max(Math.abs(a - b), Math.abs(b - c))) : '0'}</td></tr>; })}</tbody>
                </table></div>
                {win.dDbTs.length > 0 && <DiffTable title="DB ↔ 독립 계산 차이 (부서 × 월 × 계정)" diffs={win.dDbTs} aLabel="DB" bLabel="TS" />}
                {win.dTsJs.length > 0 && <DiffTable title="독립 계산 ↔ 기존 화면 차이" diffs={win.dTsJs} aLabel="TS" bLabel="JS" />}
              </>
            )}
          </div>
        </div>

        <div className="card"><div className="hd">② 전체 기간 검증 <span className="help" style={{ fontWeight: 400 }}>전체 전표 원본을 한 번 내려받아 전 기간을 DB 집계와 대조 (전송량이 크니 필요할 때만)</span><span className="sp" /><button className="btn pri sm" disabled={busy || !agg} onClick={runFull}>{busy ? '검증 중…' : '전체 원본으로 검증'}</button></div>
          <div style={{ padding: 14, display: 'grid', gap: 12 }}>
            {err && <div className="err">{err}</div>}
            {dbMonths && <div className="help">DB에 있는 전표 월: {dbMonths.length}개 ({dbMonths[0]?.ym ? ymLabel(dbMonths[0].ym) : ''} ~ {dbMonths[dbMonths.length - 1]?.ym ? ymLabel(dbMonths[dbMonths.length - 1].ym) : ''}) · 총 {fmt(dbMonths.reduce((s, r) => s + r.cnt, 0))}건{dbMonths.some(r => r.ym.length !== 6) && <b style={{ color: 'var(--neg)' }}> · 회계일을 읽을 수 없는 행 {fmt(dbMonths.filter(r => r.ym.length !== 6).reduce((s, r) => s + r.cnt, 0))}건 (집계 제외됨 — 업로드 파일의 날짜 열 확인)</b>}</div>}
            {full && (
              <>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><Badge ok={!full.diffs.length} label={`전 기간 DB(SQL) = 독립 계산(TS) · 차이 ${full.diffs.length}건`} /><span className="help">원본 {fmt(full.rows)}건 · {full.months.length}개월 · {full.ms}ms</span></div>
                <div className="tbl-wrap" style={{ maxHeight: 360, overflow: 'auto' }}><table>
                  <thead><tr><th>월</th><th className="n">DB(SQL)</th><th className="n">독립 계산(TS)</th><th className="n">차이</th></tr></thead>
                  <tbody>{full.months.map(m => { const [a, b] = full.tot[m]; const bad = Math.abs(a - b) > 0.5; return <tr key={m} className={bad ? 'bad' : ''}><td>{ymLabel(m)}</td><td className="n">{fmt(a)}</td><td className="n">{fmt(b)}</td><td className="n">{bad ? fmt(a - b) : '0'}</td></tr>; })}</tbody>
                </table></div>
                {full.diffs.length > 0 && <DiffTable title="차이 내역" diffs={full.diffs} aLabel="DB" bLabel="TS" />}
              </>
            )}
          </div>
        </div>

        <div className="card"><div className="hd">③ 수익(이윤 9종) — 현재 화면 계산값 <span className="help" style={{ fontWeight: 400 }}>2차(구매/판매 LOT·이윤 SQL)에서 DB 값과 대조할 기준표</span></div>
          <div style={{ padding: 14 }}>
            {!results?.profitMonthlyByGroup ? <div className="empty">구매/판매 계산 결과가 아직 없습니다.</div> : (() => { const g = results.profitMonthlyByGroup!; const months = Array.from(new Set(Object.values(g).flatMap(o => Object.keys(o)))).sort().slice(-12); const keys = Object.keys(g); return (
              <div className="tbl-wrap"><table>
                <thead><tr><th>그룹</th>{months.map(m => <th key={m} className="n">{ymLabel(m)}</th>)}<th className="n">합계</th></tr></thead>
                <tbody>{keys.map(k => <tr key={k}><td style={{ fontWeight: 600 }}>{k}</td>{months.map(m => <td key={m} className="n">{fmt(g[k][m] || 0)}</td>)}<td className="n" style={{ fontWeight: 700 }}>{kor(months.reduce((s, m) => s + (g[k][m] || 0), 0))}</td></tr>)}</tbody>
              </table></div>); })()}
          </div>
        </div>
      </div>
    </div>
  );
}

function DiffTable({ title, diffs, aLabel, bLabel }: { title: string; diffs: Diff[]; aLabel: string; bLabel: string }) {
  return (
    <div><div className="help" style={{ fontWeight: 600, color: 'var(--neg)', marginBottom: 6 }}>{title} — {fmt(diffs.length)}건 (큰 순 100건)</div>
      <div className="tbl-wrap" style={{ maxHeight: 320, overflow: 'auto' }}><table>
        <thead><tr><th>부서</th><th>월</th><th>계정</th><th className="n">{aLabel}</th><th className="n">{bLabel}</th><th className="n">차이</th></tr></thead>
        <tbody>{diffs.slice(0, 100).map((d, i) => <tr key={i} className="bad"><td>{d.dept}</td><td>{ymLabel(d.ym)}</td><td>{d.acc}</td><td className="n">{fmt(d.a)}</td><td className="n">{fmt(d.b)}</td><td className="n">{fmt(d.a - d.b)}</td></tr>)}</tbody>
      </table></div></div>
  );
}
