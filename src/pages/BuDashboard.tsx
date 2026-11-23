// 손익 현황(/bu-real) · 본부 성과(/bu) · 본부 손익(/bu-unit)
//   손익 현황 = 회사 전체 손익(회계 기준) + 본부별 판매 이익·비용
//   본부 성과 = 판매 이익을 배분 비율로 나눈 "배분 이익" 기준의 본부·부서 손익 (내부 평가용)
//   본부 손익 = 본부장용 — 권한 범위의 부서만
// 숫자는 계산 모듈(legacy/screens/profit.js)이 내보내는 모델(KJHub.models)을 그대로 씁니다.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { accL } from '../lib/acc';
import { fmt } from '../components/ui';
import { HELP } from '../lib/helpDocs';
import { type OpsDeptRow } from '../components/OpsMetrics';
import { applyHqAlloc, useCostAlloc } from '../lib/hqAlloc';
import AcctSummary from '../components/AcctSummary';
import { type AcctModel } from '../lib/pnl';
import { plMonth, usePl } from '../lib/plStmt';
import { useAuth } from '../lib/auth';
import { NetTrend, TrendLine, Donut, RatioBar, ymL, C } from '../components/charts';
import { PageHead, MonthNav, RangeSeg, Stat, Card, Delta, Loading, Empty, Legend, won, swon, ymText } from '../components/kit';

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
  acct?: AcctModel | null;
  settle?: { series: number[]; byHq: Record<string, number[]>; byDept: Record<string, number[]>; byAcc: Record<string, number[]> } | null;
  deptRows: OpsDeptRow[]; allow?: string[] | null; fixedRule?: string;
  revenue: { byGroup: { key: string; label: string; series: number[]; cur: number; prev: number; sum: number }[]; byBU: { bu: string; series: number[]; cur: number; prev: number; sum: number }[]; byDept: { d: string; hq: string; cur: number; prev: number; sum: number; groups: string[]; support: number }[]; supportCur: number };
};
type Actions = { setBaseMonth: (v: string) => void; setMonths: (n: number) => void; get: () => { baseMonth: string; months: number }; render: () => void };
const KJ = () => (window as unknown as { KJHub?: { models?: Record<string, Model>; actions?: Record<string, Actions> } }).KJHub;
const fmtEmp = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? fmt(v) : (Math.round(v * 10) / 10).toLocaleString('ko-KR'));
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const last = (a: number[]) => a[a.length - 1] || 0;
const prevOf = (a: number[]) => (a.length > 1 ? a[a.length - 2] : 0);
const ratio = (cost: number, margin: number) => (margin > 0 ? Math.round((cost / margin) * 1000) / 10 : null);

export default function BuDashboard({ variant, title }: { variant: '' | '-my' | '-real'; title: string }) {
  const id = 'bu-margin' + variant;
  const hid = (k: string) => (variant === '-real' && HELP['bu-real.' + k] ? 'bu-real.' : 'bu.') + k; // 손익 현황은 전용 설명
  const [model, setModel] = useState<Model | null>(() => KJ()?.models?.[id] ?? null);
  const [ctl, setCtl] = useState({ baseMonth: '', months: 6 });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [allOpen, setAllOpen] = useState(true); // 기본: 부서까지 펼침
  const nav = useNavigate();
  const allocCfg = useCostAlloc();
  const { employee } = useAuth();
  const isAdmin = employee?.role === 'admin';

  useEffect(() => {
    const onModel = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.id === id) { setModel({ ...KJ()!.models![id] }); const a = KJ()?.actions?.[id]; if (a) setCtl(a.get()); } };
    window.addEventListener('kjhub:model', onModel);
    const a = KJ()?.actions?.[id]; if (a) { setCtl(a.get()); const m = KJ()?.models?.[id]; if (m) setModel({ ...m }); }
    return () => window.removeEventListener('kjhub:model', onModel);
  }, [id]);

  const act = KJ()?.actions?.[id];
  const setBase = (v: string) => { setCtl(c => ({ ...c, baseMonth: v })); act?.setBaseMonth(v); };
  const setMonths = (n: number) => { setCtl(c => ({ ...c, months: n })); act?.setMonths(n); };
  const drill = (o: { dept?: string; unit?: string; acc?: string }) => {
    const fn = (window as unknown as { __kjDeptCostDrill?: (o: object) => void }).__kjDeptCostDrill;
    if (fn && model) { fn({ ...o, baseMonth: model.cur, months: model.months }); nav('/dept-cost'); }
  };
  const drillDepts = (depts: string[]) => { const fn = (window as unknown as { __kjMarginSelectDepts?: (l: string[]) => void }).__kjMarginSelectDepts; if (fn) fn(depts); nav('/dept'); };

  // ── 파생값: 요약 문장 · 평소와 다른 비용 · 본부 표 ──
  const d = useMemo(() => {
    if (!model || model.empty) return null;
    const { kpi, months, cur } = model;
    const net = kpi.curMargin - kpi.curCost;
    const r = ratio(kpi.curCost, kpi.curMargin);
    const allCh = [...model.alerts.ups.map(x => ({ ...x, up: true })), ...model.alerts.downs.map(x => ({ ...x, up: false }))];
    const notable = allCh.slice().sort((a, b) => b.v - a.v).slice(0, 8);
    // 같은 부서에서 한 계정은 늘고 다른 계정은 줄었으면 계정 재분류(예: 급여 → 경상시험연구비)일 수 있음 → 부서 순변동을 함께 보여줌
    const byDeptCh: Record<string, { net: number; up: number; down: number; items: typeof allCh }> = {};
    allCh.forEach(x => { const o = byDeptCh[x.d] || (byDeptCh[x.d] = { net: 0, up: 0, down: 0, items: [] }); o.net += x.up ? x.v : -x.v; if (x.up) o.up++; else o.down++; o.items.push(x); });
    const offset = (dn: string) => { const o = byDeptCh[dn]; return o && o.up > 0 && o.down > 0 ? o.net : null; };
    const topDept = Object.entries(byDeptCh).sort((a, b) => Math.abs(b[1].net) - Math.abs(a[1].net))[0];
    const top = notable[0];
    const Wd = model.realized ? '판매 이익' : '배분 이익';
    const s1 = net < 0 ? `비용이 ${Wd}보다 ${won(-net)} 많았습니다.` : `${Wd}이 비용보다 ${won(net)} 많았습니다.`;
    let s3 = '';
    if (topDept && topDept[1].up > 0 && topDept[1].down > 0) {
      const g = topDept[1], its = g.items.slice().sort((a, b) => b.v - a.v).slice(0, 2);
      s3 = `비용 변화가 가장 큰 곳은 ${topDept[0]}입니다 (순변동 ${swon(g.net)} · ${its.map(x => `${accL(x.a)} ${x.up ? '+' : '−'}${won(x.v)}`).join(', ')}).`;
    } else if (top) s3 = `비용 변화가 가장 큰 곳은 ${top.d} ${accL(top.a)}입니다 (${top.up ? '+' : '−'}${won(top.v)}).`;
    type Row = { key: string; name: string; emp: number; margin: number[]; cost: number[]; depts: { d: string; emp: number; margin: number[]; cost: number[]; alloc?: boolean }[] };
    let rows: Row[];
    let alloc: ReturnType<typeof applyHqAlloc> | null = null;
    if (model.realized && !model.deptLevel) {
      // 손익 현황: 경영전략본부·연구소 비용과 인원을 [본부 비용 배분] 비율로 이익이 나는 본부에 나눔
      alloc = applyHqAlloc(model.deptRows, months, allocCfg);
      const ci = months.length - 1, zeros = months.map(() => 0);
      const order = (h: string) => { const i = model.hqOrder.indexOf(h); return i < 0 ? 999 : i; };
      rows = alloc.hqs.slice().sort((a, b) => order(a.hq) - order(b.hq)).map(h => ({
        key: h.hq, name: h.hq, emp: h.emp[ci], margin: h.margin, cost: h.cost,
        depts: [...h.depts.filter(x => x.margin.some(v => v) || x.cost.some(v => Math.abs(v) > 0.5) || x.emp[ci] > 0.01).map(x => ({ d: x.d, emp: x.emp[ci], margin: x.margin, cost: x.cost })),
          ...h.inFrom.map(f => ({ d: '← ' + f.from + ' 배분', emp: f.emp[ci], margin: zeros, cost: f.cost, alloc: true }))],
      }));
    } else {
      rows = model.hqGroups.map(g => {
        const emp = model.headcount.find(h => h.hq === g.hq)?.emp ?? 0;
        return { key: g.hq, name: g.hq, emp, margin: g.margin, cost: g.cost, depts: model.deptRows.filter(x => x.hq === g.hq) }; // ※ 본부 이익은 이미 해 준 지원을 포함
      });
    }
    const total = { emp: rows.reduce((s, x) => s + x.emp, 0), margin: months.map((_, i) => rows.reduce((s, x) => s + x.margin[i], 0)), cost: months.map((_, i) => rows.reduce((s, x) => s + x.cost[i], 0)) };
    return { net, r, s1, s3, notable, offset, rows, total, alloc };
  }, [model, allocCfg]);

  // 확정(손익계산서) 영업이익과 본부별 손익의 연결 — 손익 현황, 전체 권한, 마감 완료 월만
  const pl = usePl();
  const bridge = useMemo(() => {
    if (!model || model.empty || !d || !model.realized || model.deptLevel || !model.acct) return null;
    const off = plMonth(pl, model.cur); if (!off) return null;
    const offs = model.months.map(m => plMonth(pl, m));
    const cumOff = offs.every(Boolean) ? offs.reduce((a, o) => a + o!.op, 0) : null;
    return { op: off.op, adj: off.op - d.net, cumOp: cumOff, cumNet: sum(d.total.margin) - sum(d.total.cost) };
  }, [model, d, pl]);

  const W = model?.realized ? '판매 이익' : '배분 이익';
  const unit = model?.deptLevel ? '부서' : '본부';
  const desc = variant === '-real' ? '회사 전체 손익과 본부별 판매 이익·비용입니다. 판매 이익 = 매출 − 원가, 비용 = 판관비.'
    : variant === '-my' ? '맡은 범위의 부서별 배분 이익과 비용입니다.'
    : '판매 이익을 기여 단계와 배분 비율로 나눈 "배분 이익" 기준입니다. 본부·부서의 기여를 비교할 때 봅니다.';
  const head = (
    <PageHead title={title} desc={desc}>
      {ctl.baseMonth && <MonthNav id="bu-base" value={ctl.baseMonth} onChange={setBase} />}
      <RangeSeg value={ctl.months} onChange={setMonths} />
    </PageHead>
  );
  if (!model) return <div className="page">{head}<Loading /></div>;
  if (model.empty || !d) return <div className="page">{head}<Empty>{model.reason === 'results' ? '판매 이익 계산이 아직 끝나지 않았거나 데이터가 없습니다. 잠시 뒤 자동으로 표시됩니다.' : '선택한 기간에 표시할 데이터가 없습니다. 기준월을 확인해 주세요.'}</Empty></div>;

  const mm = +model.cur.slice(4), nM = model.months.length;
  const cumNet = model.kpi.tMargin - model.kpi.tCost;
  const donutTotal = sum(model.donut.map(x => x.v)), supGap = model.kpi.curCost - donutTotal;
  const rkMax = (arr: number[]) => Math.max(1, ...arr.map(v => Math.abs(v)));

  return (
    <div className="page bud">
      <style>{`
        .bud .secttl{display:flex;align-items:baseline;gap:10px;margin:6px 0 -6px}
        .bud .secttl h2{font-size:17px;font-weight:800}
        .bud .secttl span{font-size:12.5px;color:var(--fg-3)}
        .bud .nt{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 6px;border-radius:8px;cursor:pointer}
        .bud .nt:hover{background:var(--surface-2)}
        .bud .nt .t{font-size:13.5px;line-height:1.35;font-weight:600}
        .bud .nt .t small{display:block;color:var(--fg-3);font-size:12px;font-weight:400}
        .bud .nt .t small em{font-style:normal;color:var(--amber-2)}
        .bud .nt .amt{font-weight:700;font-variant-numeric:tabular-nums}
        .bud .bridge{display:flex;gap:10px 14px;align-items:center;flex-wrap:wrap;font-size:12.5px;color:var(--fg-3);margin-top:8px}
        .bud .bridge b{display:block;font-size:16px;font-weight:800;color:var(--fg);font-variant-numeric:tabular-nums}
        .bud .bridge i{font-style:normal;font-weight:700;color:var(--fg-4);font-size:16px}
        .bud .acc{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,150px);gap:10px;font-size:13px;padding:5px 6px;cursor:pointer;align-items:center;border-radius:6px}
        .bud .acc:hover{background:var(--surface-2)}
        .bud .acc>:first-child{color:var(--fg-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .bud .acc>:last-child{display:flex;gap:4px;justify-content:flex-end;overflow:hidden}
        @media(max-width:820px){.bud .acc{grid-template-columns:minmax(0,1fr) auto}.bud .acc>:last-child{display:none}}
      `}</style>
      {head}

      {model.realized && model.acct && model.acct.rows[model.cur] && <AcctSummary acct={model.acct} cur={model.cur} isAdmin={isAdmin} />}

      {model.realized && <div className="secttl"><h2>{unit}별 판매 이익과 비용</h2><span>앱이 구매·판매·전표로 계산한 금액입니다.</span></div>}

      {/* 1. 이번 달 */}
      <div className="stats">
        <Stat label={`${mm}월 ${W}`} value={won(model.kpi.curMargin)} sub={<><Delta cur={model.kpi.curMargin} prev={model.prev ? model.kpi.prevMargin : null} label="전월" mode="pct" /><span>{nM}개월 누적 {won(model.kpi.tMargin)}</span></>} />
        <Stat label={`${mm}월 비용`} value={won(model.kpi.curCost)} sub={<><Delta cur={model.kpi.curCost} prev={model.prev ? model.kpi.prevCost : null} label="전월" mode="pct" invert /><span>{nM}개월 누적 {won(model.kpi.tCost)}</span></>} />
        <Stat label={`${mm}월 손익 (${W} − 비용)`} help={hid('verdict')} keyColor={d.net >= 0 ? 'var(--green)' : 'var(--red)'} tone={d.net >= 0 ? 'pos' : 'neg'} value={swon(d.net)}
          sub={<span>{nM}개월 누적 <b style={{ color: cumNet >= 0 ? 'var(--green-2)' : 'var(--red-2)' }}>{swon(cumNet)}</b></span>} />
        <Stat label="이익 대비 비용" value={d.r == null ? '-' : d.r > 999 ? '999%+' : d.r + '%'} sub={<span style={{ flex: 1 }}><RatioBar ratio={d.r} /></span>} title="비용 ÷ 이익 × 100. 100%를 넘으면 번 것보다 많이 쓴 것입니다." />
      </div>
      <div className={'note' + (d.net < 0 ? ' warn' : '')}>
        <div style={{ minWidth: 0 }}>
          <b>{ymText(model.cur)}에는 {d.s1}</b> {d.s3}
          {bridge && (
            <div className="bridge" title="회계 조정 = 재고 평가·분기 결산 조정처럼 ERP 원가계산에서만 나오는 매출원가 차이. 본부·부서로 나눌 수 없어 회사 전체에만 반영합니다.">
              <span>본부 손익 합계<b>{swon(d.net)}</b></span><i>{bridge.adj >= 0 ? '+' : '−'}</i>
              <span>회계 조정 (본부로 나눌 수 없음)<b>{won(Math.abs(bridge.adj))}</b></span><i>=</i>
              <span>영업이익 (손익계산서)<b style={{ color: bridge.op >= 0 ? 'var(--green-2)' : 'var(--red-2)' }}>{swon(bridge.op)}</b></span>
            </div>
          )}
        </div>
      </div>

      {/* 2. 추이 · 평소와 다른 비용 */}
      <div className="g21">
        <Card title="월별 손익 추이" help={hid('trend')} right={<Legend items={[{ c: C.pos, t: '손익 (흑자)' }, { c: C.neg, t: '손익 (적자)' }, { c: C.margin, t: W, kind: 'line' }, { c: C.cost, t: '비용', kind: 'dash' }]} />}>
          <NetTrend months={model.months} margin={model.series.margin} cost={model.series.cost} height={290} />
        </Card>
        <Card title="평소와 다른 비용" help={hid('alerts')} desc="최근 평균 대비 · 누르면 전표">
          {d.notable.length === 0 ? <div className="empty" style={{ padding: 24 }}>평소와 크게 다른 계정이 없습니다.</div> : d.notable.map((x, i) => (
            <div key={i} className="nt" onClick={() => drill({ dept: x.d, acc: x.a })}>
              <span className={'tag ' + (x.up ? 'n' : 'g')} style={{ padding: '2px 0', textAlign: 'center' }}>{x.up ? '▲' : '▼'}</span>
              <span className="t">{accL(x.a)}<small>{x.d}{model.deptLevel ? '' : ' · ' + x.hq}{d.offset(x.d) != null && <em title="같은 부서에서 늘어난 계정과 줄어든 계정이 함께 있습니다. 계정을 옮긴 것(대체 전표)일 수 있어 부서 순변동을 함께 봅니다."> · 부서 순변동 {swon(d.offset(x.d)!)}</em>}</small></span>
              <span className="amt" style={{ color: x.up ? 'var(--red-2)' : 'var(--green-2)' }}>{(x.up ? '+' : '−') + won(x.v)}</span>
            </div>
          ))}
        </Card>
      </div>

      {/* 3. 본부 표 */}
      <Card title={`${unit}별 현황`} help={hid('scoreboard')} desc={`${ymText(model.cur)} · 본부를 누르면 부서가 펼쳐집니다`} flush
        right={!model.deptLevel ? <span className="seg"><button className={!allOpen ? 'on' : ''} onClick={() => { setAllOpen(false); setOpen({}); }}>본부만</button><button className={allOpen ? 'on' : ''} onClick={() => { setAllOpen(true); setOpen({}); }}>부서까지</button></span> : undefined}>
        {d.alloc && <p className="help" style={{ padding: '0 20px 10px' }}>경영전략본부·연구소의 비용과 인원은 본부 비용 배분 비율로 나눴습니다 ({d.alloc.ruleSrc ? ymL(d.alloc.ruleSrc) + ' 설정' : '기본 규칙'}). "← … 배분" 줄이 받은 금액입니다.{isAdmin && <button className="btn sm ghost" style={{ marginLeft: 6, padding: '1px 8px' }} onClick={() => nav('/settings/cost-alloc')}>설정 →</button>}</p>}
        <div className="tbl-wrap">
          <table className="t wide">
            <thead><tr><th>{unit}</th><th>인원</th><th>{W}</th><th>비용</th><th>손익</th><th style={{ minWidth: 150 }}>이익 대비 비용</th><th>비용 전월 대비</th><th>{nM}개월 누적 손익</th><th style={{ width: 130 }}>손익 추이</th></tr></thead>
            <tbody>
              <tr className="total">
                <td>전체</td><td>{fmtEmp(d.total.emp)}</td><td>{fmt(last(d.total.margin))}</td><td>{fmt(last(d.total.cost))}</td>
                <td className={last(d.total.margin) - last(d.total.cost) >= 0 ? 'pos' : 'neg'}>{fmt(last(d.total.margin) - last(d.total.cost))}</td>
                <td><RatioBar ratio={ratio(last(d.total.cost), last(d.total.margin))} /></td>
                <td><Delta cur={last(d.total.cost)} prev={model.prev ? prevOf(d.total.cost) : null} mode="pct" invert /></td>
                <td className={sum(d.total.margin) - sum(d.total.cost) >= 0 ? 'pos' : 'neg'}>{fmt(sum(d.total.margin) - sum(d.total.cost))}</td>
                <td><TrendLine series={d.total.margin.map((v, i) => v - d.total.cost[i])} /></td>
              </tr>
              {bridge && <>
                <tr className="adj" title="재고 평가·분기 결산 조정 등 ERP 원가계산에서만 나오는 금액. 본부·부서로 나눌 수 없습니다."><td>회계 조정 (본부로 나눌 수 없음)</td><td /><td /><td /><td>{fmt(Math.round(bridge.adj))}</td><td /><td /><td>{bridge.cumOp == null ? '-' : fmt(Math.round(bridge.cumOp - bridge.cumNet))}</td><td /></tr>
                <tr className="total"><td>영업이익 (손익계산서)</td><td /><td /><td /><td className={bridge.op >= 0 ? 'pos' : 'neg'}>{fmt(Math.round(bridge.op))}</td><td /><td /><td className={bridge.cumOp == null ? '' : bridge.cumOp >= 0 ? 'pos' : 'neg'}>{bridge.cumOp == null ? '-' : fmt(Math.round(bridge.cumOp))}</td><td /></tr>
              </>}
              {d.rows.map(r => {
                const isOpen = open[r.key] ?? allOpen;
                const cells = (name: string, emp: number, margin: number[], cost: number[], cls: string, depts: string[], caret?: boolean) => (
                  <tr key={r.key + '|' + cls + '|' + name} className={cls} onClick={() => (cls.includes('hq') ? setOpen(o => ({ ...o, [name]: !(o[name] ?? allOpen) })) : cls.includes('alloc') ? undefined : drillDepts(depts))} title={cls.includes('hq') ? '누르면 부서를 펼치거나 접습니다' : cls.includes('alloc') ? undefined : '누르면 부서 손익 화면으로 이동합니다'}>
                    <td>{caret != null && <span className="caret">{caret ? '▾' : '▸'}</span>}{cls.includes('hq') ? <b>{name}</b> : name}</td>
                    <td>{emp ? fmtEmp(emp) : '-'}</td><td>{fmt(last(margin))}</td><td>{fmt(last(cost))}</td>
                    <td className={last(margin) - last(cost) >= 0 ? 'pos' : 'neg'} style={{ fontWeight: cls.includes('hq') ? 700 : undefined }}>{fmt(last(margin) - last(cost))}</td>
                    <td><RatioBar ratio={ratio(last(cost), last(margin))} /></td>
                    <td><Delta cur={last(cost)} prev={model.prev ? prevOf(cost) : null} mode="pct" invert /></td>
                    <td className={sum(margin) - sum(cost) >= 0 ? 'pos' : 'neg'}>{fmt(sum(margin) - sum(cost))}</td>
                    <td><TrendLine series={margin.map((v, i) => v - cost[i])} /></td>
                  </tr>
                );
                return [
                  cells(r.name, r.emp, r.margin, r.cost, model.deptLevel ? 'click' : 'click hq', r.depts.map(x => x.d), model.deptLevel ? undefined : isOpen),
                  ...(isOpen && !model.deptLevel ? r.depts.map(x => cells(x.d, x.emp, x.margin, x.cost, (x as { alloc?: boolean }).alloc ? 'sub adj alloc' : 'sub click', [x.d])) : []),
                ];
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* 4. 이익 구성 */}
      <Card title={`${mm}월 ${W}이 난 곳`} help={hid('revenue')}
        desc={model.realized ? (model.settle && last(model.settle.series) ? `결산 매출 ${won(last(model.settle.series))} 포함` : undefined) : (model.revenue?.supportCur ? `해 준 지원 ${won(model.revenue.supportCur)} 포함` : undefined)}>
        {model.revenue && (
          <div className="g2">
            <div>
              {!model.realized && model.revenue.byGroup.length > 0 && <>
                <div className="subh">이익이 생긴 단계 (배분 전)</div>
                <div className="rk lh"><span /><span>단계</span><span /><span style={{ textAlign: 'right' }}>{mm}월 금액</span><span>전월 대비</span></div>
                {model.revenue.byGroup.slice().sort((a, b) => b.cur - a.cur).map((g, i, arr) => (
                  <div key={g.key} className="rk" title={`${nM}개월 합계 ${fmt(g.sum)}`}>
                    <span className="no">{i + 1}</span><span className="nm" title={g.label}>{g.label}</span>
                    <div className="bar"><i style={{ width: Math.max(2, Math.round(Math.abs(g.cur) / rkMax(arr.map(x => x.cur)) * 100)) + '%', background: g.cur < 0 ? C.neg : C.margin }} /></div>
                    <span className="amt" style={{ color: g.cur < 0 ? 'var(--red-2)' : undefined }}>{fmt(g.cur)}</span>
                    <Delta cur={g.cur} prev={model.prev ? g.prev : null} mode="pct" />
                  </div>
                ))}
              </>}
              {model.revenue.byBU.length > 0 && (
                <div style={!model.realized && model.revenue.byGroup.length ? { marginTop: 16 } : undefined}>
                  <div className="subh">사업장별 판매 이익{model.realized ? '' : ' (참고 · 배분 전)'}</div>
                  <div className="rk lh"><span /><span>사업장</span><span /><span style={{ textAlign: 'right' }}>{mm}월 금액</span><span>전월 대비</span></div>
                  {model.revenue.byBU.slice().sort((a, b) => b.cur - a.cur).map((b, i, arr) => (
                    <div key={b.bu} className="rk">
                      <span className="no">{i + 1}</span><span className="nm">{b.bu}</span>
                      <div className="bar"><i style={{ width: Math.max(2, Math.round(Math.abs(b.cur) / rkMax(arr.map(x => x.cur)) * 100)) + '%', background: b.cur < 0 ? C.neg : C.margin }} /></div>
                      <span className="amt" style={{ color: b.cur < 0 ? 'var(--red-2)' : undefined }}>{fmt(b.cur)}</span>
                      <Delta cur={b.cur} prev={model.prev ? b.prev : null} mode="pct" />
                    </div>
                  ))}
                </div>
              )}
              {model.realized && !model.revenue.byBU.length && <span className="help">표시할 데이터가 없습니다.</span>}
              {model.realized && model.settle && model.settle.series.some(v => v !== 0) && (() => {
                const st = model.settle!; const ci = nM - 1;
                const hqs = Object.keys(st.byHq).filter(h => st.byHq[h].some(v => v !== 0));
                return (
                  <div style={{ marginTop: 16 }}>
                    <div className="subh">그중 결산 매출 <span className="help" style={{ fontWeight: 400 }}>전표의 상품·제품·수수료매출(결산)</span></div>
                    <div className="kv lh"><span>사업장 · 계정</span><span>{mm}월 · {nM}개월 합계</span></div>
                    {hqs.map(h => <div key={h} className="kv"><span>{h}</span><span className="row" style={{ gap: 14 }}><span className="num" style={{ color: st.byHq[h][ci] < 0 ? 'var(--red-2)' : undefined }}>{fmt(st.byHq[h][ci])}</span><span className="num mut" style={{ minWidth: 96 }}>{fmt(sum(st.byHq[h]))}</span></span></div>)}
                    {Object.keys(st.byAcc).map(a => <div key={a} className="kv help" style={{ paddingLeft: 12 }}><span>{a}</span><span className="row" style={{ gap: 14 }}><span className="num">{fmt(st.byAcc[a][ci])}</span><span className="num" style={{ minWidth: 96 }}>{fmt(sum(st.byAcc[a]))}</span></span></div>)}
                  </div>
                );
              })()}
            </div>
            <div>
              <div className="subh">부서별 {W} <span className="help" style={{ fontWeight: 400 }}>상위 10곳 · 누르면 부서 손익</span></div>
              {model.revenue.byDept.length > 0 && <div className="rk lh"><span /><span>부서</span><span /><span style={{ textAlign: 'right' }}>{mm}월 금액</span><span>전월 대비</span></div>}
              {model.revenue.byDept.slice(0, 10).map((x, i, arr) => (
                <div key={x.d} className="rk click" onClick={() => drillDepts([x.d])} title={(x.groups.length ? '받은 단계: ' + x.groups.join(', ') : '') + (x.support ? ` / 해 준 지원 ${fmt(x.support)}` : '')}>
                  <span className="no">{i + 1}</span>
                  <span className="nm">{x.d}{!model.deptLevel && <small>{x.hq}</small>}</span>
                  <div className="bar"><i style={{ width: Math.max(2, Math.round(Math.abs(x.cur) / rkMax(arr.map(t => t.cur)) * 100)) + '%', background: x.cur < 0 ? C.neg : C.margin }} /></div>
                  <span className="amt">{fmt(x.cur)}</span>
                  <Delta cur={x.cur} prev={model.prev ? x.prev : null} mode="pct" />
                </div>
              ))}
              {!model.revenue.byDept.length && <span className="help">{model.realized ? '표시할 데이터가 없습니다.' : '배분 이익이 없습니다. [배분 비율]을 확인해 주세요.'}</span>}
            </div>
          </div>
        )}
      </Card>

      {/* 5. 비용 구성 */}
      <Card title={`${mm}월 비용이 쓰인 곳`} help={hid('cost')} desc={!model.realized && Math.abs(supGap) >= 1 && donutTotal > 0 ? `전표 비용 기준 · 받은 지원 ${won(supGap)}은 포함하지 않음` : '누르면 전표를 봅니다'}>
        <div className="g2">
          <div>
            {model.donut.length ? <Donut slices={model.donut} total={donutTotal} centerLabel={`${mm}월`} head={unit + ' · 큰 계정'} /> : <span className="help">기준월 비용 데이터가 없습니다.</span>}
            <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
              {model.divDetail.map(u => (
                <div key={u.unit}>
                  <div className="kv" style={{ borderBottom: '1px solid var(--line)', marginBottom: 2 }}><b>{u.unit}</b><span className="num mut">{fmt(u.total)}</span></div>
                  {u.tops.map(t => (
                    <div key={t.acc} className="acc" onClick={() => drill(u.isDept ? { dept: u.unit, acc: t.acc } : { unit: u.unit, acc: t.acc })}>
                      <span>{accL(t.acc)}</span><span className="num">{fmt(t.v)}</span><span>{t.kws.map(k => <span key={k} className="tag gr">{k}</span>)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="subh">비용이 큰 부서 <span className="help" style={{ fontWeight: 400 }}>상위 10곳</span></div>
            {model.topDepts.length > 0 && <div className="rk lh"><span /><span>부서</span><span /><span style={{ textAlign: 'right' }}>{mm}월 전표 비용</span><span>전월 대비</span></div>}
            {model.topDepts.map((x, i) => (
              <div key={x.d} className="rk click" onClick={() => drill({ dept: x.d })} title={x.det.map(a => `${accL(a.acc)} ${fmt(a.v)}`).join(' / ')}>
                <span className="no">{i + 1}</span><span className="nm">{x.d}</span>
                <div className="bar"><i style={{ width: Math.max(2, Math.round(x.v / rkMax(model.topDepts.map(t => t.v)) * 100)) + '%', background: C.cost }} /></div>
                <span className="amt">{fmt(x.v)}</span>
                <span className={'dl ' + (x.mom == null || x.mom === 0 ? 'flat' : x.mom > 0 ? 'bad' : 'good')} style={{ justifyContent: 'flex-end' }}>{x.mom == null ? '-' : <><i>{x.mom > 0 ? '▲' : x.mom < 0 ? '▼' : ''}</i>{Math.abs(x.mom)}%</>}</span>
              </div>
            ))}
            {!model.topDepts.length && <span className="help">표시할 데이터가 없습니다.</span>}
          </div>
        </div>
      </Card>
    </div>
  );
}
