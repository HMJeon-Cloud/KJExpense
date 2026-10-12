// 부서별 비용 — 전표 조회: 조건 → 계정별 합계 → 전표 상세 · CSV
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { fmt } from '../components/ui';
import { kor } from '../components/charts';
import VoucherTable from '../components/VoucherTable';
import { parseVouchers, type VRow } from '../lib/vouchers';
type VRow0 = ReturnType<typeof parseVouchers>[number];
const shiftYm = (ym: string, d: number) => { let y = +ym.slice(0, 4), m = +ym.slice(4, 6) + d; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y + ('0' + m).slice(-2); };

type Drill = { dept?: string; unit?: string; acc?: string; baseMonth?: string; months?: string[] };
const KJ = () => (window as unknown as { KJHub?: { data?: { voucher?: VRow[]; dept?: VRow[] }; closeMonth?: () => string; screenDepts?: (t: string) => string[] | null } }).KJHub;
const ymL = (m: string) => m.slice(0, 4) + '-' + m.slice(4, 6);
const monthsBack = (end: string, n: number) => { const out: string[] = []; let y = +end.slice(0, 4), m = +end.slice(4, 6); for (let i = 0; i < n; i++) { out.unshift(y + ('0' + m).slice(-2)); m--; if (m === 0) { m = 12; y--; } } return out; };

/** 다른 화면의 "전표 보기" 요청을 받아 두는 곳 */
let pending: Drill | null = null;
export function registerDrill() {
  (window as unknown as { __kjDeptCostDrill?: (o: Drill) => void }).__kjDeptCostDrill = (o: Drill) => { pending = o; window.dispatchEvent(new CustomEvent('kjhub:drill')); };
}
registerDrill();

export default function DeptCost() {
  const { closeMonth } = useAuth();
  const [tick, setTick] = useState(0);
  useEffect(() => { const h = () => setTick(t => t + 1); window.addEventListener('kjhub:data', h); return () => window.removeEventListener('kjhub:data', h); }, []);
  const vouchers = useMemo(() => parseVouchers(KJ()?.data?.voucher), [tick]); // eslint-disable-line
  const end0 = closeMonth || KJ()?.closeMonth?.() || '';
  const [endYm, setEndYm] = useState(end0);
  const [span, setSpan] = useState(1);
  const [depts, setDepts] = useState<string[]>([]);
  const [hq, setHq] = useState('');
  const [acc, setAcc] = useState('');
  useEffect(() => { if (!endYm && end0) setEndYm(end0); }, [end0]); // eslint-disable-line

  // 드릴 요청 적용
  useEffect(() => {
    const apply = () => {
      const o = pending; if (!o) return; pending = null;
      if (o.baseMonth) setEndYm(o.baseMonth);
      if (o.months?.length) setSpan(o.months.length);
      if (o.dept) { setDepts([o.dept]); setHq(''); } else if (o.unit) { setHq(o.unit); setDepts([]); }
      setAcc(o.acc || '');
    };
    apply(); window.addEventListener('kjhub:drill', apply); return () => window.removeEventListener('kjhub:drill', apply);
  }, []);

  // 부서 마스터 → 본부별 부서, 권한
  const deptMaster = useMemo(() => { const rows = KJ()?.data?.dept || []; const m: Record<string, string> = {}; rows.forEach(r => { const d = String(r['DeptName'] ?? r['DEPTNAME'] ?? '').trim(); const h = String(r['BizUnitName'] ?? r['BIZUNITNAME'] ?? '').trim(); if (d) m[d] = h; }); return m; }, [tick]); // eslint-disable-line
  const allowed = useMemo(() => { const l = KJ()?.screenDepts?.('부서별 비용'); return l == null ? null : new Set(l.map(s => s.replace(/\s+/g, '').toLowerCase())); }, [tick]); // eslint-disable-line
  const months = useMemo(() => (endYm ? monthsBack(endYm, span) : []), [endYm, span]);
  const inRange = useMemo(() => { const ms = new Set(months); return vouchers.filter(v => ms.has(v.ym) && (!allowed || allowed.has(v.dept.replace(/\s+/g, '').toLowerCase()))); }, [vouchers, months, allowed]);
  const deptList = useMemo(() => Array.from(new Set(inRange.map(v => v.dept))).filter(Boolean).sort(), [inRange]);
  const hqs = useMemo(() => Array.from(new Set(deptList.map(d => deptMaster[d] || '기타'))).sort(), [deptList, deptMaster]);
  const effDepts = depts.length ? depts : hq ? deptList.filter(d => (deptMaster[d] || '기타') === hq) : null;
  const scoped = useMemo(() => { const ds = effDepts ? new Set(effDepts) : null; return inRange.filter(v => !ds || ds.has(v.dept)); }, [inRange, effDepts]);
  const byDept = useMemo(() => { const m: Record<string, number> = {}; scoped.forEach(v => { m[v.dept] = (m[v.dept] || 0) + v.amt; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); }, [scoped]);
  const byAcc = useMemo(() => { const m: Record<string, number> = {}; scoped.forEach(v => { m[v.acc] = (m[v.acc] || 0) + v.amt; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); }, [scoped]);
  const total = scoped.reduce((s, v) => s + v.amt, 0);
  const maxD = Math.max(1, ...byDept.map(x => x[1])), maxA = Math.max(1, ...byAcc.map(x => x[1]));
  // 결론 띠: 같은 범위(부서·본부)로 최근 12개월 추이, 전기 대비, 가장 큰 변화
  const scopeOf = (v: VRow0) => (!allowed || allowed.has(v.dept.replace(/\s+/g, '').toLowerCase())) && (!effDepts || effDepts.includes(v.dept)) && (!acc || v.acc === acc);
  const trend = useMemo(() => { if (!endYm) return [] as [string, number][]; const ms = monthsBack(endYm, 12); const m: Record<string, number> = {}; ms.forEach(x => (m[x] = 0)); vouchers.forEach(v => { if (v.ym in m && scopeOf(v)) m[v.ym] += v.amt; }); return ms.map(x => [x, m[x]] as [string, number]); }, [vouchers, endYm, effDepts?.join('|'), acc, allowed]); // eslint-disable-line
  const tMax = Math.max(1, ...trend.map(t => t[1]));
  const prevMonths = useMemo(() => (endYm ? monthsBack(shiftYm(endYm, -span), span) : []), [endYm, span]);
  const prevTotal = useMemo(() => { const ms = new Set(prevMonths); return vouchers.filter(v => ms.has(v.ym) && scopeOf(v)).reduce((s, v) => s + v.amt, 0); }, [vouchers, prevMonths, effDepts?.join('|'), acc, allowed]); // eslint-disable-line
  const prevByAcc = useMemo(() => { const ms = new Set(prevMonths); const m: Record<string, number> = {}; vouchers.forEach(v => { if (ms.has(v.ym) && scopeOf(v)) m[v.acc] = (m[v.acc] || 0) + v.amt; }); return m; }, [vouchers, prevMonths, effDepts?.join('|'), acc, allowed]); // eslint-disable-line
  const biggestChange = useMemo<[string, number] | null>(() => { let best: [string, number] | null = null; const keys = new Set([...byAcc.map(x => x[0]), ...Object.keys(prevByAcc)]); keys.forEach(a => { const d = (byAcc.find(x => x[0] === a)?.[1] || 0) - (prevByAcc[a] || 0); if (best === null || Math.abs(d) > Math.abs((best as [string, number])[1])) best = [a, d]; }); return best; }, [byAcc, prevByAcc]);
  const diff = total - prevTotal, diffPct = prevTotal > 0 ? Math.round(diff / prevTotal * 1000) / 10 : null;
  // 부서 × 계정 매트릭스 (상위 10부서 × 상위 7계정)
  const mx = useMemo(() => { const ds = byDept.slice(0, 10).map(x => x[0]), as = byAcc.slice(0, 7).map(x => x[0]); const m: Record<string, Record<string, number>> = {}; scoped.forEach(v => { if (!m[v.dept]) m[v.dept] = {}; m[v.dept][v.acc] = (m[v.dept][v.acc] || 0) + v.amt; }); let max = 1; ds.forEach(d => as.forEach(a => { max = Math.max(max, m[d]?.[a] || 0); })); return { ds, as, m, max }; }, [scoped, byDept, byAcc]);

  return (
    <div className="page" style={{ gap: 20, maxWidth: 1360 }}>
      <style>{`.dc .list{display:grid;gap:3px}.dc .li{display:grid;grid-template-columns:150px 1fr 110px 48px;gap:10px;align-items:center;font-size:12.5px;padding:4px 6px;border-radius:6px;cursor:pointer}.dc .li:hover{background:var(--surface-2)}.dc .li.on{background:var(--brand-soft)}.dc .hbar{height:8px;background:var(--surface-2);border-radius:999px;overflow:hidden}.dc .hbar i{display:block;height:100%;background:#f26a1b;border-radius:999px}.dc .side{display:grid;grid-template-columns:1fr 1fr;gap:18px}.dc .verdict{display:grid;grid-template-columns:1fr 1.5fr;background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}.dc .verdict>div{padding:16px 20px;min-width:0}.dc .verdict>div+div{border-left:1px solid var(--line)}.dc .l{font-size:12px;color:var(--fg-3)}.dc .big{font:800 34px/1.1 var(--font-num);letter-spacing:-.02em;margin-top:4px;font-variant-numeric:tabular-nums;color:#c2561a}.dc .mini{display:flex;align-items:flex-end;gap:5px;height:70px;margin-top:10px}.dc .mini .col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;min-width:0;cursor:pointer}.dc .mini .col i{display:block;width:100%;border-radius:3px 3px 0 0;background:#f26a1b;opacity:.45}.dc .mini .col.on i{opacity:1}.dc .mini .col small{font-size:10px;color:var(--fg-3);margin-top:3px;white-space:nowrap}.dc .mx{width:100%;border-collapse:collapse;font-size:12px}.dc .mx th{font-weight:500;color:var(--fg-3);font-size:11px;padding:6px 6px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc .mx th:first-child{text-align:left}.dc .mx td{padding:5px 6px;text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums;border-bottom:1px solid var(--line);cursor:pointer;white-space:nowrap}.dc .mx td:first-child{text-align:left;font-family:var(--font-body);font-weight:600;overflow:hidden;text-overflow:ellipsis;max-width:130px}.dc .mx td.tot{font-weight:700}.dc .mx tr:hover td{outline:1px solid var(--brand-soft)}@media(max-width:1000px){.dc .verdict{grid-template-columns:1fr}.dc .verdict>div+div{border-left:0;border-top:1px solid var(--line)}}@media(max-width:900px){.dc .side{grid-template-columns:1fr}}`}</style>
      <div className="dc" style={{ display: 'grid', gap: 18 }}>
        <div className="page-head" style={{ alignItems: 'flex-end' }}>
          <div><h1>부서별 비용</h1><div className="help">전표를 부서·계정별로 모아 보고, 적요와 키워드로 내역을 확인합니다.</div></div>
          <span className="sp" />
          <label className="help" htmlFor="dc-end">기준월</label>
          <input id="dc-end" type="month" className="inp" min="2025-01" value={endYm ? endYm.slice(0, 4) + '-' + endYm.slice(4, 6) : ''} onChange={e => setEndYm(e.target.value.replace('-', ''))} />
          <span className="seg">{[1, 3, 6, 12].map(n => <button key={n} className={span === n ? 'on' : ''} onClick={() => setSpan(n)}>{n}개월</button>)}</span>
        </div>

        <div className="filters">
          <label>본부</label>
          <select className="inp" value={hq} onChange={e => { setHq(e.target.value); setDepts([]); }}><option value="">전체</option>{hqs.map(h => <option key={h} value={h}>{h}</option>)}</select>
          <label>부서</label>
          <select className="inp" value={depts.length === 1 ? depts[0] : ''} onChange={e => setDepts(e.target.value ? [e.target.value] : [])}><option value="">{hq ? hq + ' 전체' : '전체'}</option>{(hq ? deptList.filter(d => (deptMaster[d] || '기타') === hq) : deptList).map(d => <option key={d} value={d}>{d}</option>)}</select>
          {depts.length > 1 && <span className="chip on">{depts.length}개 부서 선택됨 <span className="x" onClick={() => setDepts([])}>×</span></span>}
          {acc && <span className="chip on">{acc} <span className="x" onClick={() => setAcc('')}>×</span></span>}
          <span className="sp" />
          <span className="help">{months.length ? (months.length === 1 ? ymL(months[0]) : `${ymL(months[0])} ~ ${ymL(months[months.length - 1])}`) : ''} · {fmt(scoped.length)}건 · 합계 <b className="num" style={{ color: 'var(--fg)', fontSize: 14 }}>{kor(total)}</b></span>
        </div>

        {months.length > 0 && (
          <div className="verdict">
            <div>
              <div className="l">{months.length === 1 ? ymL(months[0]) : `${ymL(months[0])} ~ ${ymL(months[months.length - 1])}`} 비용 합계{effDepts?.length === 1 ? ` · ${effDepts[0]}` : hq ? ` · ${hq}` : ''}{acc ? ` · ${acc.replace(/^\((판|제)\)/, '')}` : ''}</div>
              <div className="big">{kor(total)}</div>
              <div className="help" style={{ marginTop: 4 }}>{fmt(total)}원 · {fmt(scoped.length)}건{diffPct != null && <> · 직전 {span}개월 대비 <b style={{ color: diff > 0 ? 'var(--neg)' : '#2c7f2c' }}>{diff >= 0 ? '+' : ''}{diffPct}%</b> ({diff >= 0 ? '+' : ''}{kor(diff)})</>}</div>
              {biggestChange && Math.abs(biggestChange[1]) > 0 && <div className="help" style={{ marginTop: 6 }}>가장 크게 바뀐 계정: <b style={{ color: 'var(--fg)' }}>{biggestChange[0].replace(/^\((판|제)\)/, '')}</b> {biggestChange[1] >= 0 ? '+' : ''}{kor(biggestChange[1])}</div>}
              <div className="mini">{trend.map(([m, v]) => <div key={m} className={'col' + (months.includes(m) ? ' on' : '')} title={`${ymL(m)} · ${fmt(v)}원`} onClick={() => { setEndYm(m); setSpan(1); }}><i style={{ height: Math.max(2, Math.round(v / tMax * 52)) }} /><small>{+m.slice(4)}월</small></div>)}</div>
            </div>
            <div>
              <div className="l">부서 × 계정 <span>금액 큰 순 상위 {mx.ds.length}부서 · {mx.as.length}계정 · 칸을 누르면 그 전표만</span></div>
              <div className="tbl-wrap" style={{ marginTop: 8 }}><table className="mx">
                <thead><tr><th>부서</th>{mx.as.map(a => <th key={a} title={a}>{a.replace(/^\((판|제)\)/, '')}</th>)}<th>합계</th></tr></thead>
                <tbody>{mx.ds.map(d => { const row = mx.m[d] || {}; const rt = byDept.find(x => x[0] === d)?.[1] || 0; return <tr key={d}><td title={d} onClick={() => setDepts([d])}>{d}</td>{mx.as.map(a => { const v = row[a] || 0; const k = v / mx.max; return <td key={a} style={{ background: v ? `rgba(242,106,27,${0.06 + k * 0.6})` : undefined, color: k > 0.8 ? '#fff' : undefined, fontWeight: k > 0.5 ? 700 : undefined }} onClick={() => { setDepts([d]); setAcc(a); }}>{v ? fmt(v) : ''}</td>; })}<td className="tot" onClick={() => setDepts([d])}>{fmt(rt)}</td></tr>; })}</tbody>
              </table></div>
            </div>
          </div>
        )}

        <div className="side">
          <div className="card"><div className="hd">부서별 합계 <span className="help" style={{ fontWeight: 400 }}>누르면 그 부서만</span></div>
            <div className="list" style={{ padding: 10 }}>
              {byDept.slice(0, 30).map(([d, v]) => <div key={d} className={'li' + (depts.length === 1 && depts[0] === d ? ' on' : '')} onClick={() => setDepts(depts.length === 1 && depts[0] === d ? [] : [d])}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{d}</span><div className="hbar"><i style={{ width: Math.max(2, Math.round(v / maxD * 100)) + '%' }} /></div><span className="num">{fmt(v)}</span><span className="help num">{total ? Math.round(v / total * 100) + '%' : ''}</span></div>)}
              {!byDept.length && <div className="empty">전표가 없습니다.</div>}
            </div></div>
          <div className="card"><div className="hd">계정별 합계 <span className="help" style={{ fontWeight: 400 }}>누르면 그 계정만</span></div>
            <div className="list" style={{ padding: 10 }}>
              {byAcc.slice(0, 30).map(([a, v]) => <div key={a} className={'li' + (acc === a ? ' on' : '')} onClick={() => setAcc(acc === a ? '' : a)}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{a.replace(/^\((판|제)\)/, '')}</span><div className="hbar"><i style={{ width: Math.max(2, Math.round(v / maxA * 100)) + '%', background: '#1f6fe8' }} /></div><span className="num">{fmt(v)}</span><span className="help num">{total ? Math.round(v / total * 100) + '%' : ''}</span></div>)}
            </div></div>
        </div>

        <div className="card"><div className="hd">전표 상세</div>
          <div style={{ padding: 14 }}>{months.length ? <VoucherTable filter={{ depts: effDepts, months, acc }} onAccPick={setAcc} /> : <span className="help">기준월을 선택하세요.</span>}</div>
        </div>
      </div>
    </div>
  );
}
