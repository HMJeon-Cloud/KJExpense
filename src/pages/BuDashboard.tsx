// 국전 수익/비용 — 경영진용 한 장 보고서
//   1) 이번 달 결론(순수익·비용/수익·한 줄 설명)  2) 추이 + 주목할 변화  3) 본부 스코어보드(펼치면 부서)  4) 비용이 어디서 나갔나
// 숫자는 기존 계산 모듈(legacy/screens/profit.js)이 내보내는 모델(KJHub.models)을 그대로 씁니다.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmt } from '../components/ui';
import { HelpDot } from '../components/Help';
import { NetTrend, Spark, Donut, RatioBar, kor, ymL, C } from '../components/charts';

type Model = {
  id: string; empty?: boolean; reason?: string; realized: boolean; deptLevel: boolean; months: string[]; cur: string; prev: string | null;
  kpi: { tMargin: number; curMargin: number; prevMargin: number; tCost: number; curCost: number; prevCost: number; usage: number | null; allocTotal: number };
  series: { margin: number[]; cost: number[]; supAlloc: number[]; supCost: number[] };
  hqGroups: { hq: string; margin: number[]; cost: number[]; supAlloc: number[]; supCost: number[]; deptCount: number; depts: string[] }[];
  donut: { a: string; v: number; kws: string[] }[];
  divDetail: { unit: string; isDept: boolean; total: number; tops: { acc: string; v: number; kws: string[] }[] }[];
  topDepts: { d: string; v: number; mom: number | null; det: { acc: string; v: number; kw: string }[] }[];
  alerts: { ups: { d: string; a: string; v: number; hq: string }[]; downs: { d: string; a: string; v: number; hq: string }[] };
  headcount: { hq: string; emp: number; cost: number; per: number | null; depts: string[] }[];
  hqOrder: string[];
  deptRows: { d: string; hq: string; margin: number[]; cost: number[]; emp: number }[];
  revenue: { byGroup: { key: string; label: string; series: number[]; cur: number; prev: number; sum: number }[]; byBU: { bu: string; series: number[]; cur: number; prev: number; sum: number }[]; byDept: { d: string; hq: string; cur: number; prev: number; sum: number; groups: string[]; support: number }[]; supportCur: number };
};
type Actions = { setBaseMonth: (v: string) => void; setMonths: (n: number) => void; get: () => { baseMonth: string; months: number }; render: () => void };
const KJ = () => (window as unknown as { KJHub?: { models?: Record<string, Model>; actions?: Record<string, Actions> } }).KJHub;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const last = (a: number[]) => a[a.length - 1] || 0;
const prevOf = (a: number[]) => (a.length > 1 ? a[a.length - 2] : 0);
const pctChange = (c: number, p: number) => (p > 0 ? Math.round(((c - p) / p) * 1000) / 10 : null);
const ratio = (cost: number, margin: number) => (margin > 0 ? Math.round((cost / margin) * 1000) / 10 : null);
const shiftMonth = (ym: string, d: number) => { const y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + d; const dt = new Date(y, m, 1); return dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2); };

export default function BuDashboard({ variant, title }: { variant: '' | '-my' | '-real'; title: string }) {
  const id = 'bu-margin' + variant;
  const [model, setModel] = useState<Model | null>(() => KJ()?.models?.[id] ?? null);
  const [ctl, setCtl] = useState({ baseMonth: '', months: 6 });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [allOpen, setAllOpen] = useState(true); // 기본: 부서까지 펼침
  const [showCost, setShowCost] = useState(true);
  const [showRev, setShowRev] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    const onModel = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.id === id) { setModel({ ...KJ()!.models![id] }); const a = KJ()?.actions?.[id]; if (a) setCtl(a.get()); } };
    window.addEventListener('kjhub:model', onModel);
    const a = KJ()?.actions?.[id]; if (a) { setCtl(a.get()); const m = KJ()?.models?.[id]; if (m) setModel({ ...m }); }
    return () => window.removeEventListener('kjhub:model', onModel);
  }, [id]);

  const act = KJ()?.actions?.[id];
  const setBase = (v: string) => { setCtl(c => ({ ...c, baseMonth: v })); act?.setBaseMonth(v); };
  const drill = (o: { dept?: string; unit?: string; acc?: string }) => {
    const fn = (window as unknown as { __kjDeptCostDrill?: (o: object) => void }).__kjDeptCostDrill;
    if (fn && model) { fn({ ...o, baseMonth: model.cur, months: model.months }); nav('/dept-cost'); }
  };
  const drillDepts = (depts: string[]) => { const fn = (window as unknown as { __kjMarginSelectDepts?: (l: string[]) => void }).__kjMarginSelectDepts; if (fn) fn(depts); nav('/dept'); };

  // ── 파생값: 결론 문장, 주목할 변화, 스코어보드 행 ──
  const d = useMemo(() => {
    if (!model || model.empty) return null;
    const { kpi, months, cur } = model;
    const net = kpi.curMargin - kpi.curCost;
    const rMargin = pctChange(kpi.curMargin, kpi.prevMargin), rCost = pctChange(kpi.curCost, kpi.prevCost);
    const r = ratio(kpi.curCost, kpi.curMargin);
    const notable = [...model.alerts.ups.map(x => ({ ...x, up: true })), ...model.alerts.downs.map(x => ({ ...x, up: false }))].sort((a, b) => b.v - a.v).slice(0, 8);
    const top = notable[0];
    const m = +cur.slice(4, 6) + '월';
    const s1 = net < 0 ? `${m}에는 비용이 수익보다 ${kor(-net)} 많았습니다.` : `${m}에는 수익이 비용보다 ${kor(net)} 많았습니다.`;
    const s2 = model.prev ? `전월보다 수익은 ${rMargin == null ? '비교 불가' : (rMargin >= 0 ? '+' : '') + rMargin + '%'}, 비용은 ${rCost == null ? '비교 불가' : (rCost >= 0 ? '+' : '') + rCost + '%'} 입니다.` : '';
    const s3 = top ? `가장 큰 변화는 ${top.d} ${top.a} ${top.up ? '증가' : '감소'}(${top.up ? '+' : '-'}${kor(top.v)})입니다.` : '';
    const rows = model.hqGroups.map(g => {
      const mg = g.margin; // ※ 본부 수익(hqAllocSeries)은 이미 지원 수취액을 포함 — 다시 더하지 않음
      const emp = model.headcount.find(h => h.hq === g.hq)?.emp ?? 0;
      return { key: g.hq, name: g.hq, emp, margin: mg, cost: g.cost, depts: model.deptRows.filter(x => x.hq === g.hq) };
    });
    const total = { emp: rows.reduce((s, x) => s + x.emp, 0), margin: months.map((_, i) => rows.reduce((s, x) => s + x.margin[i], 0)), cost: months.map((_, i) => rows.reduce((s, x) => s + x.cost[i], 0)) };
    return { net, r, s1, s2, s3, notable, rows, total, period: `${ymL(months[0])}부터 ${ymL(cur)}까지 ${months.length}개월` };
  }, [model]);

  const hasPrev = ctl.baseMonth > '2025-01';
  return (
    <div className="page brief">
      <style>{`
        .brief{gap:26px;max-width:1360px}
        .brief>*,.duo>*,.costgrid>*{min-width:0}
        .brief .ttl{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap}
        .brief .ttl h1{font-size:22px;font-weight:700;letter-spacing:-.01em}
        .brief .ttl .sub{color:var(--fg-3);font-size:13px}
        .brief .monthnav{display:inline-flex;align-items:center;border:1px solid var(--line-2);border-radius:9px;overflow:hidden;background:var(--surface)}
        .brief .monthnav button{border:0;background:transparent;padding:6px 10px;cursor:pointer;color:var(--fg-2);font-size:14px}
        .brief .monthnav button:disabled{opacity:.3;cursor:default}
        .brief .monthnav input{border:0;border-left:1px solid var(--line);border-right:1px solid var(--line);padding:6px 8px;font:600 13.5px var(--font-num);color:var(--fg);background:transparent}
        .verdict{display:grid;grid-template-columns:minmax(260px,1.1fr) 2fr;gap:0;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--surface)}
        .verdict .big{padding:22px 26px;border-right:1px solid var(--line);display:flex;flex-direction:column;justify-content:center;gap:4px}
        .verdict .big .lbl{font-size:13px;color:var(--fg-2)}
        .verdict .big .bignum{font:800 40px/1.1 var(--font-num);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
        .verdict .big .ratio{font-size:13px;color:var(--fg-2);display:flex;gap:8px;align-items:center;margin-top:6px}
        .verdict .text{padding:22px 26px;display:flex;flex-direction:column;justify-content:center;gap:10px}
        .verdict .text p{margin:0;font-size:15.5px;line-height:1.7;color:var(--fg);max-width:60ch}
        .verdict .text p.first{font-size:18px;font-weight:700}
        .verdict .facts{display:flex;gap:22px;flex-wrap:wrap;margin-top:4px}
        .verdict .facts div{font-size:12.5px;color:var(--fg-3)}
        .verdict .facts b{display:block;font:700 16px var(--font-num);color:var(--fg);font-variant-numeric:tabular-nums}
        .sec h2{font-size:16px;font-weight:700;margin:0}
        .sec .lead{color:var(--fg-3);font-size:13px;margin:2px 0 12px}
        .duo{display:grid;grid-template-columns:1.7fr 1fr;gap:22px;align-items:start}
        .notable{display:grid;gap:4px}
        .notable .it{display:grid;grid-template-columns:22px 1fr auto;gap:10px;align-items:center;padding:8px 10px;border-radius:8px;cursor:pointer;border:1px solid transparent}
        .notable .it:hover{background:var(--surface-2);border-color:var(--line)}
        .notable .it .t{font-size:13.5px;line-height:1.3}
        .notable .it .t small{display:block;color:var(--fg-3);font-size:11.5px}
        .notable .amt{font:700 13.5px var(--font-num);font-variant-numeric:tabular-nums}
        .score{width:100%;border-collapse:separate;border-spacing:0;font-size:13.5px}
        .score th{text-align:right;font-weight:500;color:var(--fg-3);font-size:12px;padding:8px 10px;border-bottom:2px solid var(--line);white-space:nowrap}
        .score th:first-child,.score td:first-child{text-align:left}
        .score td{padding:9px 10px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums;font-family:var(--font-num);white-space:nowrap}
        .score td:first-child{font-family:var(--font-body)}
        .score tr.hq td{font-weight:600;cursor:pointer}
        .score tr.hq:hover td{background:var(--surface-2)}
        .score tr.dept td{color:var(--fg-2);font-weight:400;background:color-mix(in srgb,var(--surface-2) 55%,var(--surface));font-size:13px;padding-block:7px}
        .score tr.dept td:first-child{padding-left:34px}
        .score tr.total td{font-weight:800;border-bottom:2px solid var(--line-2);background:var(--surface)}
        .score .caret{display:inline-block;width:16px;color:var(--fg-3);font-size:11px}
        .score .neg{color:var(--neg)}
        .score .pos{color:#2c7f2c}
        .costgrid{display:grid;grid-template-columns:1fr 1fr;gap:22px}
        .acc{display:grid;grid-template-columns:1fr 110px 150px;gap:8px;font-size:12.5px;padding:4px 0;cursor:pointer;align-items:center}
        .acc:hover{background:var(--surface-2)}
        .toprow{display:grid;grid-template-columns:20px 130px 1fr 120px 60px;gap:10px;align-items:center;padding:7px 0;cursor:pointer}
        .toprow:hover{background:var(--surface-2)}
        .bar{height:10px;background:var(--surface-2);border-radius:999px;overflow:hidden}
        .bar i{display:block;height:100%;background:${C.cost};border-radius:999px}
        @media (max-width:900px){.verdict{grid-template-columns:1fr}.verdict .big{border-right:0;border-bottom:1px solid var(--line)}.duo,.costgrid{grid-template-columns:1fr}.toprow{grid-template-columns:20px 100px 1fr 90px 50px}}
      `}</style>

      <div className="ttl">
        <div><h1>{title}</h1>{d && <div className="sub">{d.period} 기준. 수익은 {model!.realized ? '판매 실현 수익' : '구매/판매 이윤을 부서 배분 비율로 나눈 값'}, 비용은 전표 합계입니다.</div>}</div>
        <span className="sp" />
        <span className="monthnav" title="기준월">
          <button onClick={() => setBase(shiftMonth(ctl.baseMonth, -1))} disabled={!hasPrev} aria-label="이전 달">‹</button>
          <input id="bu-base" type="month" min="2025-01" value={ctl.baseMonth} onChange={e => setBase(e.target.value)} />
          <button onClick={() => setBase(shiftMonth(ctl.baseMonth, 1))} aria-label="다음 달">›</button>
        </span>
        <span className="seg">{[3, 6, 12].map(n => <button key={n} className={ctl.months === n ? 'on' : ''} onClick={() => { setCtl(c => ({ ...c, months: n })); act?.setMonths(n); }}>{n}개월</button>)}</span>
      </div>

      {!model ? (
        <div className="card"><div className="empty"><span className="spinner" /> 데이터를 계산하는 중입니다. 처음 접속은 수십 초 걸릴 수 있습니다.</div></div>
      ) : model.empty || !d ? (
        <div className="card"><div className="empty">{model.reason === 'results' ? '구매/판매 데이터의 수익 계산이 아직 끝나지 않았거나 데이터가 없습니다. 잠시 뒤 자동으로 표시됩니다.' : '선택한 기간에 표시할 데이터가 없습니다. 기준월을 확인하세요.'}</div></div>
      ) : (
        <>
          {/* 1. 결론 */}
          <section className="verdict">
            <div className="big" style={{ borderTop: `4px solid ${d.net >= 0 ? '#3aa63a' : '#d93c3c'}` }}>
              <span className="lbl">{ymL(model.cur)} 순수익 (수익 − 비용)<HelpDot id={variant === '-real' ? 'bu-real.verdict' : 'bu.verdict'} /></span>
              <span className="bignum" style={{ color: d.net >= 0 ? '#2c7f2c' : '#b32b2b' }}>{d.net >= 0 ? '+' : '−'}{kor(Math.abs(d.net))}</span>
              <span className="help num" style={{ textAlign: 'left' }}>{fmt(d.net)}원</span>
              <span className="ratio">비용/수익 <RatioBar ratio={d.r} /></span>
            </div>
            <div className="text">
              <p className="first">{d.s1}</p>
              <p>{d.s2} {d.s3}</p>
              <div className="facts">
                <div>{ymL(model.cur)} 수익<b>{kor(model.kpi.curMargin)}</b></div>
                <div>{ymL(model.cur)} 비용<b>{kor(model.kpi.curCost)}</b></div>
                <div>{model.months.length}개월 누적 수익<b>{kor(model.kpi.tMargin)}</b></div>
                <div>{model.months.length}개월 누적 비용<b>{kor(model.kpi.tCost)}</b></div>
                <div>누적 순수익<b style={{ color: model.kpi.tMargin - model.kpi.tCost >= 0 ? '#2c7f2c' : '#b32b2b' }}>{(model.kpi.tMargin - model.kpi.tCost >= 0 ? '+' : '−') + kor(Math.abs(model.kpi.tMargin - model.kpi.tCost))}</b></div>
              </div>
            </div>
          </section>

          {/* 2. 추이 + 주목할 변화 */}
          <div className="duo">
            <section className="sec">
              <h2>월별 순수익 추이<HelpDot id={variant === '-real' ? 'bu-real.verdict' : 'bu.trend'} /></h2>
              <p className="lead">막대는 그 달의 순수익(초록 남음, 빨강 초과). 실선은 수익, 점선은 비용입니다.</p>
              <NetTrend months={model.months} margin={model.series.margin} cost={model.series.cost} height={300} />
            </section>
            <section className="sec">
              <h2>이번 달 주목할 변화<HelpDot id="bu.alerts" /></h2>
              <p className="lead">최근 평균보다 크게 늘거나 줄어든 부서 계정. 클릭하면 전표를 봅니다.</p>
              <div className="notable">
                {d.notable.length === 0 && <span className="help">눈에 띄는 변화가 없습니다.</span>}
                {d.notable.map((x, i) => (
                  <div key={i} className="it" onClick={() => drill({ dept: x.d, acc: x.a })}>
                    <span className={'tag ' + (x.up ? 'n' : 'b')} style={{ padding: '2px 0', textAlign: 'center' }}>{x.up ? '▲' : '▼'}</span>
                    <span className="t">{x.a.replace(/^\((판|제)\)/, '')}<small>{x.d}{model.deptLevel ? '' : ' · ' + x.hq}</small></span>
                    <span className="amt" style={{ color: x.up ? 'var(--neg)' : 'var(--brand)' }}>{(x.up ? '+' : '−') + kor(x.v)}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* 3. 스코어보드 */}
          <section className="sec">
            <h2>{model.deptLevel ? '부서별' : '본부별'} 현황<HelpDot id={variant === '-real' ? 'bu-real.scoreboard' : 'bu.scoreboard'} /></h2>
            <p className="lead" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><span>{ymL(model.cur)} 기준. 비용/수익은 100%를 넘으면 수익보다 비용이 많다는 뜻입니다.</span>{!model.deptLevel && <span className="seg" style={{ marginLeft: 'auto' }}><button className={!allOpen ? 'on' : ''} onClick={() => { setAllOpen(false); setOpen({}); }}>본부만</button><button className={allOpen ? 'on' : ''} onClick={() => { setAllOpen(true); setOpen({}); }}>부서까지</button></span>}</p>
            <div className="tbl-wrap">
              <table className="score">
                <thead><tr><th>{model.deptLevel ? '부서' : '본부'}</th><th>인원</th><th>수익</th><th>비용</th><th>순수익</th><th style={{ minWidth: 150 }}>비용/수익</th><th>비용 전월비</th><th>누적 순수익</th><th style={{ width: 140 }}>순수익 추이</th></tr></thead>
                <tbody>
                  <tr className="total">
                    <td>전체</td><td>{fmt(d.total.emp)}</td><td>{fmt(last(d.total.margin))}</td><td>{fmt(last(d.total.cost))}</td>
                    <td className={last(d.total.margin) - last(d.total.cost) >= 0 ? 'pos' : 'neg'}>{fmt(last(d.total.margin) - last(d.total.cost))}</td>
                    <td><RatioBar ratio={ratio(last(d.total.cost), last(d.total.margin))} /></td>
                    <td><Delta c={last(d.total.cost)} p={prevOf(d.total.cost)} invert /></td>
                    <td className={sum(d.total.margin) - sum(d.total.cost) >= 0 ? 'pos' : 'neg'}>{fmt(sum(d.total.margin) - sum(d.total.cost))}</td>
                    <td><Spark series={d.total.margin.map((v, i) => v - d.total.cost[i])} color="#64748b" h={34} /></td>
                  </tr>
                  {d.rows.map(r => {
                    const isOpen = open[r.key] ?? allOpen;
                    const rowCells = (name: string, emp: number, margin: number[], cost: number[], cls: string, depts: string[], caret?: boolean) => (
                      <tr key={name} className={cls} onClick={() => cls === 'hq' ? setOpen(o => ({ ...o, [name]: !(o[name] ?? allOpen) })) : undefined} onDoubleClick={() => drillDepts(depts)} title={cls === 'hq' ? '클릭: 부서 펼치기 · 더블클릭: 부서별 수익/비용' : '더블클릭: 부서별 수익/비용'}>
                        <td>{caret != null && <span className="caret">{caret ? '▾' : '▸'}</span>}{name}</td>
                        <td>{emp ? fmt(emp) : '-'}</td><td>{fmt(last(margin))}</td><td>{fmt(last(cost))}</td>
                        <td className={last(margin) - last(cost) >= 0 ? 'pos' : 'neg'}>{fmt(last(margin) - last(cost))}</td>
                        <td><RatioBar ratio={ratio(last(cost), last(margin))} /></td>
                        <td><Delta c={last(cost)} p={prevOf(cost)} invert /></td>
                        <td className={sum(margin) - sum(cost) >= 0 ? 'pos' : 'neg'}>{fmt(sum(margin) - sum(cost))}</td>
                        <td><Spark series={margin.map((v, i) => v - cost[i])} color={cls === 'hq' ? '#64748b' : '#94a3b8'} h={34} /></td>
                      </tr>
                    );
                    return [
                      rowCells(r.name, r.emp, r.margin, r.cost, model.deptLevel ? 'dept' : 'hq', r.depts.map(x => x.d), model.deptLevel ? undefined : isOpen),
                      ...(isOpen ? r.depts.map(x => rowCells(x.d, x.emp, x.margin, x.cost, 'dept', [x.d])) : []),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* 4. 수익 구성 */}
          <section className="sec">
            <div className="row" style={{ gap: 12 }}><h2>{ymL(model.cur)} 수익은 어디서 났나<HelpDot id="bu.revenue" /></h2><button className="btn sm ghost" onClick={() => setShowRev(s => !s)}>{showRev ? '접기' : '펼치기'}</button></div>
            <p className="lead">{model.realized ? '사업장별 실현 수익과 부서별 수익입니다.' : '왼쪽은 구매/판매 이윤이 어느 팀 기준으로 발생했는지, 오른쪽은 배분 비율을 거쳐 부서에 돌아간 수익입니다.'}{model.revenue?.supportCur ? ` 지원 내역으로 받은 수익 ${kor(model.revenue.supportCur)}이 부서 수익에 포함돼 있습니다.` : ''}</p>
            {showRev && model.revenue && (
              <div className="costgrid">
                <div>
                  {(model.realized ? [] : model.revenue.byGroup).slice().sort((a, b) => b.cur - a.cur).map((g, i, arr) => {
                    const max = Math.max(1, ...arr.map(x => Math.abs(x.cur)));
                    return (
                      <div key={g.key} className="toprow" style={{ cursor: 'default', gridTemplateColumns: '20px 190px 1fr 120px 60px' }} title={`${model.months.length}개월 합계 ${fmt(g.sum)}`}>
                        <span className="help num">{i + 1}</span>
                        <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.label}>{g.label}</span>
                        <div className="bar"><i style={{ width: Math.max(2, Math.round(Math.abs(g.cur) / max * 100)) + '%', background: g.cur < 0 ? '#d93c3c' : C.margin }} /></div>
                        <span className="num" style={{ fontSize: 13, color: g.cur < 0 ? 'var(--neg)' : undefined }}>{fmt(g.cur)}</span>
                        <Delta c={g.cur} p={g.prev} />
                      </div>
                    );
                  })}
                  {model.revenue.byBU.length > 0 && (
                    <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                      <div className="help" style={{ marginBottom: 6 }}>사업장별 {model.realized ? '실현 수익' : '실현 수익 (참고)'}</div>
                      {model.revenue.byBU.slice().sort((a, b) => b.cur - a.cur).map(b => (
                        <div key={b.bu} className="row" style={{ justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}><span>{b.bu}</span><span className="row" style={{ gap: 10 }}><span className="num">{fmt(b.cur)}</span><Delta c={b.cur} p={b.prev} /></span></div>
                      ))}
                    </div>
                  )}
                  {model.realized && !model.revenue.byBU.length && <span className="help">표시할 데이터가 없습니다.</span>}
                </div>
                <div>
                  {model.revenue.byDept.slice(0, 10).map((x, i, arr) => {
                    const max = Math.max(1, ...arr.map(t => Math.abs(t.cur)));
                    return (
                      <div key={x.d} className="toprow" onClick={() => drillDepts([x.d])} title={(x.groups.length ? '배분 원천: ' + x.groups.join(', ') : '') + (x.support ? ` / 지원 수익 ${fmt(x.support)}` : '')}>
                        <span className="help num">{i + 1}</span>
                        <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.d}<small className="help" style={{ display: 'block', fontWeight: 400 }}>{model.deptLevel ? '' : x.hq}</small></span>
                        <div className="bar"><i style={{ width: Math.max(2, Math.round(Math.abs(x.cur) / max * 100)) + '%', background: C.margin }} /></div>
                        <span className="num" style={{ fontSize: 13 }}>{fmt(x.cur)}</span>
                        <Delta c={x.cur} p={x.prev} />
                      </div>
                    );
                  })}
                  {!model.revenue.byDept.length && <span className="help">배분된 수익이 없습니다. 배분 비율 설정을 확인하세요.</span>}
                </div>
              </div>
            )}
          </section>

          {/* 5. 비용 구성 */}
          <section className="sec">
            <div className="row" style={{ gap: 12 }}><h2>{ymL(model.cur)} 비용은 어디서 나갔나<HelpDot id="bu.cost" /></h2><button className="btn sm ghost" onClick={() => setShowCost(s => !s)}>{showCost ? '접기' : '펼치기'}</button></div>
            <p className="lead">왼쪽은 {model.deptLevel ? '부서' : '본부'}별 구성과 주요 계정, 오른쪽은 비용이 큰 부서 10곳입니다. 항목을 클릭하면 전표를 봅니다.</p>
            {showCost && (
              <div className="costgrid">
                <div>
                  {model.donut.length ? <Donut slices={model.donut} total={sum(model.donut.map(x => x.v))} centerLabel={ymL(model.cur)} /> : <span className="help">기준월 비용 데이터가 없습니다.</span>}
                  <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
                    {model.divDetail.map(u => (
                      <div key={u.unit}>
                        <div className="row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: 4, marginBottom: 2 }}><b style={{ fontSize: 13 }}>{u.unit}</b><span className="num help">{fmt(u.total)}</span></div>
                        {u.tops.map(t => (
                          <div key={t.acc} className="acc" onClick={() => drill(u.isDept ? { dept: u.unit, acc: t.acc } : { unit: u.unit, acc: t.acc })}>
                            <span style={{ color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.acc.replace(/^\((판|제)\)/, '')}</span>
                            <span className="num">{fmt(t.v)}</span>
                            <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>{t.kws.map(k => <span key={k} className="tag gr">{k}</span>)}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  {model.topDepts.map((x, i) => {
                    const max = Math.max(1, ...model.topDepts.map(t => t.v));
                    return (
                      <div key={x.d} className="toprow" onClick={() => drill({ dept: x.d })} title={x.det.map(a => `${a.acc} ${fmt(a.v)}`).join(' / ')}>
                        <span className="help num">{i + 1}</span>
                        <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.d}</span>
                        <div className="bar"><i style={{ width: Math.max(2, Math.round(x.v / max * 100)) + '%' }} /></div>
                        <span className="num" style={{ fontSize: 13 }}>{fmt(x.v)}</span>
                        <span className="num" style={{ fontSize: 11.5, color: x.mom == null ? 'var(--fg-3)' : x.mom > 0 ? 'var(--neg)' : 'var(--brand)' }}>{x.mom == null ? '' : (x.mom >= 0 ? '+' : '') + x.mom + '%'}</span>
                      </div>
                    );
                  })}
                  {!model.topDepts.length && <span className="help">표시할 데이터가 없습니다.</span>}
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Delta({ c, p, invert }: { c: number; p: number; invert?: boolean }) {
  const v = pctChange(c, p);
  if (v == null) return <span className="help">-</span>;
  const bad = invert ? v > 0 : v < 0;
  return <span style={{ color: bad ? 'var(--neg)' : v === 0 ? 'var(--fg-3)' : '#2c7f2c' }}>{(v > 0 ? '+' : '') + v}%</span>;
}
