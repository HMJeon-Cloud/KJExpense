// 부서 › 비용 내역 — 전표 조회: 조건 → 합계 · 전기 대비 → 계정 · 부서별 → 전표 · CSV
import { accL } from '../lib/acc';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { fmt } from '../components/ui';
import { MonthBars } from '../components/charts';
import { PageHead, MonthNav, RangeSeg, Stat, Card, Empty, Loading, won, ymText } from '../components/kit';
import VoucherTable from '../components/VoucherTable';
import { parseVouchers, type VRow } from '../lib/vouchers';
import { useData } from '../lib/useData';
type VRow0 = ReturnType<typeof parseVouchers>[number];
const shiftYm = (ym: string, d: number) => { let y = +ym.slice(0, 4), m = +ym.slice(4, 6) + d; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y + ('0' + m).slice(-2); };

type Drill = { dept?: string; unit?: string; acc?: string; baseMonth?: string; months?: string[] };
const KJ = () => (window as unknown as { KJHub?: { data?: { voucher?: VRow[]; dept?: VRow[] }; closeMonth?: () => string; screenDepts?: (t: string) => string[] | null } }).KJHub;
const monthsBack = (end: string, n: number) => { const out: string[] = []; let y = +end.slice(0, 4), m = +end.slice(4, 6); for (let i = 0; i < n; i++) { out.unshift(y + ('0' + m).slice(-2)); m--; if (m === 0) { m = 12; y--; } } return out; };

/** 다른 화면의 "전표 보기" 요청을 받아 두는 곳 */
let pending: Drill | null = null;
export function registerDrill() {
  (window as unknown as { __kjDeptCostDrill?: (o: Drill) => void }).__kjDeptCostDrill = (o: Drill) => { pending = o; window.dispatchEvent(new CustomEvent('kjhub:drill')); };
}
registerDrill();

export default function DeptCost() {
  const { closeMonth, employee } = useAuth();
  const { ver: tick, ready: vReady } = useData(['voucher', 'dept']);
  const [extraLoading, setExtraLoading] = useState(false);
  const vouchers = useMemo(() => parseVouchers(KJ()?.data?.voucher), [tick, extraLoading]); // eslint-disable-line
  const end0 = closeMonth || KJ()?.closeMonth?.() || '';
  const [endYm, setEndYm] = useState(end0);
  const [span, setSpan] = useState(1);
  const [depts, setDepts] = useState<string[]>([]);
  const [hq, setHq] = useState('');
  const [acc, setAcc] = useState('');
  const [nAcc, setNAcc] = useState(8);
  const [nDept, setNDept] = useState(10);
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
  // 볼 수 있는 부서 (null = 제한 없음). 일반 사용자인데 권한 정보가 아직 없으면 아무것도 보이지 않게 합니다.
  const allowed = useMemo(() => { const l = KJ()?.screenDepts?.('부서별 비용'); if (l == null) return employee?.role === 'user' ? new Set<string>() : null; return new Set(l.map(s => s.replace(/\s+/g, '').toLowerCase())); }, [tick, employee?.role]); // eslint-disable-line
  const months = useMemo(() => (endYm ? monthsBack(endYm, span) : []), [endYm, span]);
  // 최근 13개월보다 이전 달을 고르면 그 범위의 전표를 추가로 받음 (비교용 직전 기간 포함)
  useEffect(() => {
    if (!months.length || !vReady) return;
    const need = monthsBack(shiftYm(months[0], -1), Math.max(12, span))[0];
    const k = KJ() as unknown as { ensureVoucherFrom?: (ym: string) => Promise<boolean> };
    if (!k?.ensureVoucherFrom) return;
    setExtraLoading(true);
    k.ensureVoucherFrom(need).finally(() => setExtraLoading(false));
  }, [months.join('|'), vReady]); // eslint-disable-line
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
  const prevMonths = useMemo(() => (endYm ? monthsBack(shiftYm(endYm, -span), span) : []), [endYm, span]);
  const prevTotal = useMemo(() => { const ms = new Set(prevMonths); return vouchers.filter(v => ms.has(v.ym) && scopeOf(v)).reduce((s, v) => s + v.amt, 0); }, [vouchers, prevMonths, effDepts?.join('|'), acc, allowed]); // eslint-disable-line
  const prevByAcc = useMemo(() => { const ms = new Set(prevMonths); const m: Record<string, number> = {}; vouchers.forEach(v => { if (ms.has(v.ym) && scopeOf(v)) m[v.acc] = (m[v.acc] || 0) + v.amt; }); return m; }, [vouchers, prevMonths, effDepts?.join('|'), acc, allowed]); // eslint-disable-line
  // 직전 기간 대비 가장 많이 늘어난 계정과 가장 많이 줄어든 계정 (한쪽만 보면 계정 재분류를 증가로 오해할 수 있어 둘 다 표시)
  const biggestChange = useMemo<{ up: [string, number] | null; down: [string, number] | null }>(() => { let up: [string, number] | null = null, down: [string, number] | null = null; const keys = new Set([...byAcc.map(x => x[0]), ...Object.keys(prevByAcc)]); keys.forEach(a => { const d = (byAcc.find(x => x[0] === a)?.[1] || 0) - (prevByAcc[a] || 0); if (d > 0 && (!up || d > up[1])) up = [a, d]; if (d < 0 && (!down || d < down[1])) down = [a, d]; }); return { up, down }; }, [byAcc, prevByAcc]);
  const diff = total - prevTotal, diffPct = prevTotal > 0 ? Math.round(diff / prevTotal * 1000) / 10 : null;
  // 부서 × 계정 매트릭스 (상위 10부서 × 상위 7계정)
  const mx = useMemo(() => { const ds = byDept.slice(0, 10).map(x => x[0]), as = byAcc.slice(0, 7).map(x => x[0]); const m: Record<string, Record<string, number>> = {}; scoped.forEach(v => { if (!m[v.dept]) m[v.dept] = {}; m[v.dept][v.acc] = (m[v.dept][v.acc] || 0) + v.amt; }); let max = 1; ds.forEach(d => as.forEach(a => { max = Math.max(max, m[d]?.[a] || 0); })); return { ds, as, m, max }; }, [scoped, byDept, byAcc]);

  const rangeL = months.length ? (months.length === 1 ? ymText(months[0]) : `${ymText(months[0])} ~ ${ymText(months[months.length - 1])}`) : '';
  const scopeL = effDepts?.length === 1 ? effDepts[0] : hq ? hq : allowed ? (deptList.length === 1 ? deptList[0] : '볼 수 있는 부서 전체') : '회사 전체';
  const single = effDepts?.length === 1 || deptList.length <= 1;
  const prevL = span === 1 ? '전월' : `직전 ${span}개월`;

  return (
    <div className="page dc">
      <style>{`
        .dc .fbar{display:flex;gap:8px 10px;align-items:center;flex-wrap:wrap;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:10px 14px;box-shadow:var(--shadow-xs)}
        .dc .fbar label{font-size:12.5px;color:var(--fg-3);font-weight:600}
        .dc .fbar .inp{min-width:150px}
        .dc .chip .x{cursor:pointer;font-weight:700;margin-left:2px}
        .dc .al{display:grid;grid-template-columns:minmax(0,1fr) 104px 40px 82px;gap:10px;align-items:center;font-size:13.5px;padding:7px 8px;border-radius:8px;cursor:pointer}
        .dc .al:hover{background:var(--surface-2)}
        .dc .al.on{background:var(--blue-soft)}
        .dc .al .nm{font-weight:600;min-width:0;display:grid;gap:5px}.dc .al .nm>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dc .al .bar{height:5px}
        .dc .al .num{font-weight:600}
        .dc .al>:nth-child(n+3){text-align:right;font-size:12.5px;white-space:nowrap}
        .dc .al.h{cursor:default;font-size:12px;color:var(--fg-3);font-weight:600;border-bottom:1px solid var(--line);border-radius:0;padding-bottom:6px}
        .dc .al.h:hover{background:none}.dc .al.h>*{font-size:12px}
        .dc .al.d{grid-template-columns:minmax(0,1fr) 104px 40px}.dc .g21{align-items:stretch}
        .dc .bar i{background:var(--orange)}
        .dc .mx{width:100%;border-collapse:separate;border-spacing:3px;font-size:12.5px}
        .dc .mx th{font-size:11.5px;color:var(--fg-3);font-weight:600;padding:4px 6px;text-align:right;white-space:nowrap;max-width:92px;overflow:hidden;text-overflow:ellipsis}
        .dc .mx th:first-child,.dc .mx td:first-child{text-align:left}
        .dc .mx td{padding:7px 8px;border-radius:6px;text-align:right;font-variant-numeric:tabular-nums;cursor:pointer;white-space:nowrap;background:var(--surface-2)}
        .dc .mx td:first-child{background:none;font-weight:600;max-width:130px;overflow:hidden;text-overflow:ellipsis}
        .dc .mx td:first-child:hover{color:var(--blue)}
        .dc .mx td.tot{background:none;font-weight:700}
        .dc .big-s{font-size:18px!important;line-height:1.35!important;letter-spacing:-.01em!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        @media(max-width:820px){.dc .al{grid-template-columns:minmax(0,1fr) 96px 78px;gap:8px}.dc .al>:nth-child(3){display:none}.dc .al.d{grid-template-columns:minmax(0,1fr) 96px 40px}.dc .al.d>:nth-child(3){display:block}.dc .fbar .inp{min-width:0;flex:1}}
      `}</style>
      <PageHead title="비용 내역" desc="전표를 부서 · 계정별로 모아 보고, 적요까지 확인합니다.">
        <MonthNav id="dc-end" value={endYm ? endYm.slice(0, 4) + '-' + endYm.slice(4, 6) : ''} onChange={v => setEndYm(v.replace('-', ''))} />
        <RangeSeg value={span} onChange={setSpan} options={[1, 3, 6, 12]} />
      </PageHead>

      <div className="fbar">
        <label htmlFor="dc-hq">본부</label>
        <select id="dc-hq" className="inp" value={hq} onChange={e => { setHq(e.target.value); setDepts([]); }}><option value="">전체</option>{hqs.map(h => <option key={h} value={h}>{h}</option>)}</select>
        <label htmlFor="dc-dept">부서</label>
        <select id="dc-dept" className="inp" value={depts.length === 1 ? depts[0] : ''} onChange={e => setDepts(e.target.value ? [e.target.value] : [])}><option value="">{hq ? hq + ' 전체' : '전체'}</option>{(hq ? deptList.filter(d => (deptMaster[d] || '기타') === hq) : deptList).map(d => <option key={d} value={d}>{d}</option>)}</select>
        {depts.length > 1 && <span className="chip on">{depts.length}개 부서 <span className="x" onClick={() => setDepts([])}>×</span></span>}
        {acc && <span className="chip on">{accL(acc)} <span className="x" onClick={() => setAcc('')}>×</span></span>}
        {(hq || depts.length > 0 || acc) && <button className="btn sm ghost" onClick={() => { setHq(''); setDepts([]); setAcc(''); }}>조건 지우기</button>}
        <span className="sp" />
        {extraLoading && <span className="help"><span className="spinner" /> 이전 전표를 불러오는 중입니다.</span>}
      </div>

      {!vReady ? <Loading text="전표를 불러오는 중입니다." /> : !months.length ? <Empty>기준월을 고르면 표시됩니다.</Empty> : <>
        <div className="stats">
          <Stat label={<>{rangeL} 비용</>} help="cost.verdict" value={won(total)} keyColor="var(--orange)" sub={<>{scopeL}{acc ? ` · ${accL(acc)}` : ''} · {fmt(scoped.length)}건</>} />
          <Stat label={`${prevL} 대비`} value={prevTotal > 0 || total > 0 ? (diff > 0 ? '+' : diff < 0 ? '−' : '') + won(Math.abs(diff)) : '-'} tone={diff > 0 ? 'neg' : diff < 0 ? 'pos' : undefined} sub={diffPct == null ? `${prevL} 비용 없음` : <>{prevL} {won(prevTotal)} · {diff >= 0 ? '+' : ''}{diffPct}%</>} />
          <Stat label="가장 늘어난 계정" value={<span className="big-s" style={{ display: 'block' }}>{biggestChange.up ? accL(biggestChange.up[0]) : '-'}</span>} sub={biggestChange.up ? <span className="dl bad"><i>▲</i>{won(biggestChange.up[1])}</span> : '늘어난 계정이 없습니다'} onClick={biggestChange.up ? () => setAcc(biggestChange.up![0]) : undefined} title={biggestChange.up ? '누르면 이 계정만 봅니다' : undefined} />
          <Stat label="가장 줄어든 계정" value={<span className="big-s" style={{ display: 'block' }}>{biggestChange.down ? accL(biggestChange.down[0]) : '-'}</span>} sub={biggestChange.down ? <span className="dl good"><i>▼</i>{won(-biggestChange.down[1])}</span> : '줄어든 계정이 없습니다'} onClick={biggestChange.down ? () => setAcc(biggestChange.down![0]) : undefined} title={biggestChange.down ? '누르면 이 계정만 봅니다' : undefined} />
        </div>

        <div className="g21">
          <Card title="월별 추이" desc={`최근 ${trend.length}개월 · 진한 막대 = 조회 중인 달 · 누르면 그 달만`}>
            <MonthBars items={trend.map(([m, v]) => ({ m, v }))} mode="orange" height={250} sel={months} onPick={m => { setEndYm(m); setSpan(1); }} label="월별 전표 비용" />
            {(() => { const vs = trend.filter(t => t[1] !== 0); if (vs.length < 2) return null; const avg = vs.reduce((a, t) => a + t[1], 0) / vs.length; const mx2 = vs.reduce((a, t) => (t[1] > a[1] ? t : a)); return <div className="help" style={{ marginTop: 10 }}>{vs.length}개월 평균 <b style={{ color: 'var(--fg)' }}>{won(avg)}</b> · 가장 많았던 달 <b style={{ color: 'var(--fg)' }}>{ymText(mx2[0])} {won(mx2[1])}</b></div>; })()}
          </Card>
          <Card title="계정별" help="cost.byAcc" desc="누르면 그 계정만">
            {byAcc.length ? <>
              <div className="al h"><span>계정</span><span className="num">금액</span><span>비중</span><span>{prevL} 대비</span></div>
              {byAcc.slice(0, nAcc).map(([a, v]) => { const d = v - (prevByAcc[a] || 0); return (
                <div key={a} className={'al' + (acc === a ? ' on' : '')} onClick={() => setAcc(acc === a ? '' : a)} title={a}>
                  <span className="nm"><span>{accL(a)}</span><div className="bar"><i style={{ width: Math.max(2, Math.round(v / maxA * 100)) + '%' }} /></div></span><span className="num">{fmt(v)}</span><span className="mut">{total ? Math.round(v / total * 100) + '%' : ''}</span>
                  <span className={'dl ' + (Math.abs(d) < 1 ? 'flat' : d > 0 ? 'bad' : 'good')}>{Math.abs(d) < 1 ? '-' : <><i>{d > 0 ? '▲' : '▼'}</i>{won(Math.abs(d))}</>}</span>
                </div>); })}
              {byAcc.length > 8 && <div style={{ marginTop: 8 }}><button className="btn sm" onClick={() => setNAcc(nAcc > 8 ? 8 : byAcc.length)}>{nAcc > 8 ? '접기' : `나머지 ${byAcc.length - 8}개 계정 더 보기`}</button></div>}
            </> : <div className="empty">전표가 없습니다.</div>}
          </Card>
        </div>

        {!single && byDept.length > 1 && (
          <div className="g21">
            <Card title="부서 × 계정" help="cost.matrix" desc={`금액 큰 순 ${mx.ds.length}개 부서 · ${mx.as.length}개 계정 · 단위 만원 · 칸을 누르면 그 전표만`}>
              <div className="tbl-wrap"><table className="mx">
                <thead><tr><th>부서</th>{mx.as.map(a => <th key={a} title={a}>{accL(a)}</th>)}<th>합계</th></tr></thead>
                <tbody>{mx.ds.map(d => { const row = mx.m[d] || {}; const rt = byDept.find(x => x[0] === d)?.[1] || 0; return <tr key={d}><td title={d} onClick={() => setDepts([d])}>{d}</td>{mx.as.map(a => { const v = row[a] || 0; const k = v / mx.max; return <td key={a} style={{ background: v > 0 ? `rgba(240,106,26,${0.07 + k * 0.72})` : undefined, color: k > 0.62 ? '#fff' : undefined, fontWeight: k > 0.4 ? 700 : undefined }} title={`${d} · ${a} ${fmt(v)}원`} onClick={() => { setDepts([d]); setAcc(a); }}>{v ? fmt(v / 10000) : ''}</td>; })}<td className="tot" title={`${d} 합계 ${fmt(rt)}원`} onClick={() => setDepts([d])}>{fmt(rt / 10000)}</td></tr>; })}</tbody>
              </table></div>
            </Card>
            <Card title="부서별" help="cost.byDept" desc="누르면 그 부서만">
              <div className="al d h"><span>부서</span><span className="num">금액</span><span>비중</span></div>
              {byDept.slice(0, nDept).map(([d, v]) => (
                <div key={d} className="al d" onClick={() => setDepts([d])}>
                  <span className="nm"><span>{d}</span><div className="bar"><i style={{ width: Math.max(2, Math.round(v / maxD * 100)) + '%', background: 'var(--fg-4)' }} /></div></span><span className="num">{fmt(v)}</span><span className="mut">{total ? Math.round(v / total * 100) + '%' : ''}</span>
                </div>))}
              {byDept.length > 10 && <div style={{ marginTop: 8 }}><button className="btn sm" onClick={() => setNDept(nDept > 10 ? 10 : byDept.length)}>{nDept > 10 ? '접기' : `나머지 ${byDept.length - 10}개 부서 더 보기`}</button></div>}
            </Card>
          </div>
        )}

        <Card title="전표" help="voucher.table" desc={`${rangeL} · ${scopeL}`}>
          <VoucherTable filter={{ depts: effDepts ?? (allowed ? deptList : null), months, acc }} onAccPick={setAcc} />
        </Card>
      </>}
    </div>
  );
}
