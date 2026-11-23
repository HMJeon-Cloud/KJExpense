// 경영 요약 — 대표·임원이 매달 가장 먼저 보는 한 장
//   ① 이번 달 실적 (매출 · 영업이익 · 이익률 · 판관비)   ② 12개월 추이와 올해 누적   ③ 영업이익이 달라진 이유
//   ④ 살펴볼 것 (자동 점검)   ⑤ 본부별 성과   ⑥ 운영 지표 요약
//   회사 전체 금액은 손익 현황과 같은 값(lib/pnl.ts), 본부·운영 지표는 각 화면과 같은 계산(lib/hqAlloc.ts · lib/opsCalc.ts)을 씁니다.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TriangleAlert, CircleAlert, Info, CircleCheck, ArrowRight } from 'lucide';
import { useLegacyModel } from '../lib/useLegacyModel';
import { usePl } from '../lib/plStmt';
import { applyHqAlloc, useCostAlloc } from '../lib/hqAlloc';
import { pnlOf, pnlSum, gpRate, opRate, sgaRate, opBridge, ytdMonths, lastYear, type AcctModel, type Pnl } from '../lib/pnl';
import { computeOps, loadOps, loadFixed, type Ops, type Fixed, type FxBase } from '../lib/opsCalc';
import { supabase } from '../lib/supabase';
import { KJ, pick, num, d8, today8, daysBetween } from '../lib/legacyData';
import { loadKeys, onMeta } from '../legacy/hub';
import { type OpsDeptRow } from '../components/OpsMetrics';
import { PageHead, MonthNav, Stat, Card, Delta, Loading, Empty, Legend, won, swon, ymText, shiftYm } from '../components/kit';
import { MonthBars, Waterfall, TrendLine, DivBar, C } from '../components/charts';
import { Icon, type IconNode } from '../components/Icon';
import { fmt } from '../components/ui';
import { accL } from '../lib/acc';

type Alert = { d: string; a: string; v: number; hq: string };
type Model = {
  empty?: boolean; reason?: string; months: string[]; cur: string; hqOrder: string[]; acct?: AcctModel | null;
  series: { margin: number[]; cost: number[]; marginTrade?: number[] };
  deptRows: (OpsDeptRow & { marginTrade?: number[] })[]; alerts: { ups: Alert[]; downs: Alert[] };
};
type Sig = { tone: 'bad' | 'warn' | 'info' | 'good'; title: string; text: string; to?: () => void };
const TONE: Record<Sig['tone'], { c: string; bg: string; i: unknown }> = {
  bad: { c: 'var(--red-2)', bg: 'var(--red-soft)', i: CircleAlert }, warn: { c: 'var(--orange-2)', bg: 'var(--orange-soft)', i: TriangleAlert },
  info: { c: 'var(--blue-2)', bg: 'var(--blue-soft)', i: Info }, good: { c: 'var(--green-2)', bg: 'var(--green-soft)', i: CircleCheck },
};
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const p1 = (v: number | null) => (v == null ? '-' : v.toFixed(1) + '%');

export default function Home() {
  const { model, ctl, setBase } = useLegacyModel<Model>('bu-margin-real');
  const pl = usePl();
  const allocCfg = useCostAlloc();
  const nav = useNavigate();
  const [ops, setOps] = useState<Ops | null>(null);
  const [fxd, setFxd] = useState<Fixed | null>(null);
  const [fxBase, setFxBase] = useState<FxBase>({ rates: {} });
  const [tick, setTick] = useState(0);
  const ready = !!model && !model.empty && !!model.acct && !!model.acct.rows[model.cur];
  const cur = model?.cur || '', months = model?.months || [];

  // 운영 지표(DB) · 고정비 · 기준 환율 · 재고(유효기간)
  useEffect(() => {
    if (!ready) return; let alive = true;
    const year = cur.slice(0, 4), from = months[0], opsFrom = from < year + '01' ? from : year + '01';
    loadOps(opsFrom, cur).then(r => { if (alive) setOps(r && !('error' in r) ? r : null); });
    loadFixed(from, cur).then(r => { if (alive) setFxd(r && !('error' in r) ? r : null); });
    return () => { alive = false; };
  }, [ready, cur, months.join('|')]); // eslint-disable-line
  useEffect(() => { supabase.from('config').select('value').eq('key', 'fxBase').maybeSingle().then(({ data }) => { const v = data?.value as FxBase | undefined; if (v?.rates) setFxBase(v); }); }, []);
  useEffect(() => { loadKeys(['stock']); return onMeta(() => setTick(t => t + 1)); }, []);

  const d = useMemo(() => {
    if (!ready || !model) return null;
    const acct = model.acct!, ci = months.length - 1;
    const c = pnlOf(acct, pl, cur)!; const est = c.nOff === 0;
    const p = pnlOf(acct, pl, shiftYm(cur, -1), est), ly = pnlOf(acct, pl, lastYear(cur), est);
    const ytdM = ytdMonths(cur), ytd = pnlSum(acct, pl, ytdM), lyAll = pnlSum(acct, pl, ytdM.map(lastYear)), lytd = lyAll && lyAll.n === ytdM.length ? lyAll : null;
    const trend = Array.from({ length: 12 }, (_, i) => { const m = shiftYm(cur, i - 11); const v = pnlOf(acct, pl, m); const g = pnlOf(acct, pl, lastYear(m)); return { m, v, g }; }).filter(x => x.v);
    const why = opBridge(c, p);
    const last3 = ytdM.slice(-3).map(m => pnlOf(acct, pl, m)).filter(Boolean) as Pnl[];
    const run3 = last3.length === 3 && ytd ? ytd.op + (sum(last3.map(x => x.op)) / 3) * (12 - ytd.n) : null;
    const runAvg = ytd ? (ytd.op / ytd.n) * 12 : null;
    const quarters = [0, 1, 2, 3].map(k => { const ms = ytdM.filter(m => Math.floor((+m.slice(4) - 1) / 3) === k); const v = ms.length ? pnlSum(acct, pl, ms) : null; return v ? { q: k + 1, op: v.op, full: ms.length === 3 } : null; }).filter(Boolean) as { q: number; op: number; full: boolean }[];
    // 본부별 (지원 조직 비용·인원을 비용 배분 설정대로 나눈 뒤)
    const al = applyHqAlloc(model.deptRows, months, allocCfg);
    const order = (h: string) => { const i = model.hqOrder.indexOf(h); return i < 0 ? 999 : i; };
    const hqs = al.hqs.slice().sort((a, b) => order(a.hq) - order(b.hq)).map(h => ({ hq: h.hq, emp: h.emp[ci], margin: h.margin[ci] || 0, cost: h.cost[ci] || 0, net: (h.margin[ci] || 0) - (h.cost[ci] || 0), prevNet: ci > 0 ? (h.margin[ci - 1] || 0) - (h.cost[ci - 1] || 0) : null, line: months.map((_, i) => (h.margin[i] || 0) - (h.cost[i] || 0)) }))
      .filter(h => Math.abs(h.margin) > 0.5 || Math.abs(h.cost) > 0.5 || h.emp > 0.01);
    const hqNet = sum(hqs.map(h => h.net));
    const adj = est ? null : c.op - hqNet;
    // 인당 (운영 지표 ①과 같은 기준: 결산 매출 제외)
    const al2 = applyHqAlloc(model.deptRows.map(r => (r.marginTrade ? { ...r, margin: r.marginTrade } : r)), months, allocCfg);
    const tm = sum(al2.hqs.map(h => h.margin[ci] || 0)), tc = sum(al2.hqs.map(h => h.cost[ci] || 0)), te = sum(al2.hqs.map(h => h.emp[ci] || 0));
    const perCap = te > 0 ? { n: te, net: (tm - tc) / te } : null;
    // 비용이 평소와 다른 부서 (같은 부서의 증가·감소는 합쳐서 순변동으로)
    const byDept: Record<string, { net: number; items: (Alert & { up: boolean })[] }> = {};
    [...model.alerts.ups.map(x => ({ ...x, up: true })), ...model.alerts.downs.map(x => ({ ...x, up: false }))].forEach(x => { const o = byDept[x.d] || (byDept[x.d] = { net: 0, items: [] }); o.net += x.up ? x.v : -x.v; o.items.push(x); });
    const costUp = Object.entries(byDept).filter(([, o]) => o.net > 0).sort((a, b) => b[1].net - a[1].net);
    return { c, p, ly, est, ytd, lytd, trend, why, run3, runAvg, quarters, hqs, hqNet, adj, perCap, costUp, ci };
  }, [ready, model, pl, allocCfg, cur]); // eslint-disable-line

  const o = useMemo(() => {
    if (!ops || !model || !ready) return null;
    const hqOf: Record<string, string> = {}; model.deptRows.forEach(r => { hqOf[r.d] = r.hq; });
    return computeOps(ops, months, cur, fxBase, dd => hqOf[dd] || '기타');
  }, [ops, model, ready, fxBase, cur]); // eslint-disable-line

  // 유효기간 (재고 데이터)
  const exp = useMemo(() => {
    const rows = KJ()?.data?.stock; if (!Array.isArray(rows) || !rows.length) return null;
    const t0 = today8(); let over = 0, soon = 0, nOver = 0, nSoon = 0, total = 0;
    rows.forEach(r => { const amt = num(pick(r, ['StockAmt', '재고금액'])); total += amt; const v = d8(pick(r, ['ValiDate', '유효일자'])); if (v.length !== 8) return; const left = daysBetween(t0, v); if (left < 0) { over += amt; nOver++; } else if (left <= 90) { soon += amt; nSoon++; } });
    return { over, soon, nOver, nSoon, total };
  }, [tick, ready]); // eslint-disable-line

  const fixedCover = useMemo(() => {
    if (!fxd || !fxd.configured || !model || !d) return null;
    const inRows = new Set(model.deptRows.map(r => r.d)); let f = 0;
    fxd.rows.forEach(([dp, ym, , v]) => { if (ym === cur && inRows.has(dp)) f += +v; });
    const rev = (model.series.marginTrade || model.series.margin)[d.ci] || 0;
    return f > 0 ? { f, cover: Math.round(rev / f * 1000) / 10 } : null;
  }, [fxd, model, d, cur]);

  const sigs = useMemo<Sig[]>(() => {
    if (!d) return [];
    const { c, ytd, lytd, hqs, costUp } = d; const out: Sig[] = [];
    const lossHq = hqs.filter(h => h.net < 0);
    if (c.op < 0) out.push({ tone: 'bad', title: '이번 달 영업적자', text: `영업이익이 ${won(c.op)}입니다. 아래 "달라진 이유"에서 원인을 확인해 주세요.`, to: () => nav('/bu-real') });
    if (lossHq.length) out.push({ tone: lossHq.length >= 2 ? 'bad' : 'warn', title: `손익이 적자인 본부 ${lossHq.length}곳`, text: lossHq.map(h => `${h.hq} ${won(h.net)}`).join(' · '), to: () => nav('/bu-real') });
    const g = gpRate(c), gy = gpRate(ytd);
    if (g != null && gy != null && g - gy <= -1.5) out.push({ tone: 'warn', title: '매출총이익률 하락', text: `${p1(g)}로 올해 평균(${p1(gy)})보다 ${(gy - g).toFixed(1)}%p 낮습니다. 품목 구성·판매 단가·원가를 확인할 달입니다.`, to: () => nav('/ops') });
    if (costUp[0] && costUp[0][1].net >= 3e7) { const [dn, x] = costUp[0]; const top = x.items.slice().sort((a, b) => b.v - a.v)[0]; out.push({ tone: 'warn', title: `${dn} 비용이 평소보다 ${swon(x.net)}`, text: `가장 큰 변화는 ${accL(top.a)} ${top.up ? '+' : '−'}${won(top.v)}입니다.${costUp.length > 1 ? ` 그 밖에 ${costUp.slice(1, 3).map(([n2, y]) => `${n2} ${swon(y.net)}`).join(', ')}.` : ''}`, to: () => { const fn = (window as unknown as { __kjDeptCostDrill?: (o: object) => void }).__kjDeptCostDrill; if (fn) fn({ dept: dn, baseMonth: cur, months }); nav('/dept-cost'); } }); }
    if (o) {
      const drops = o.byItem.filter(x => x.alert).sort((a, b) => b.sCur - a.sCur);
      if (drops.length) out.push({ tone: 'warn', title: `이익률이 5%p 넘게 떨어진 품목 ${drops.length}개`, text: `매출이 가장 큰 것은 ${drops[0].k} (${p1(drops[0].base)} → ${p1(drops[0].curR)}).`, to: () => nav('/ops') });
      if (o.top5 != null) out.push({ tone: o.top5 >= 60 ? 'warn' : 'info', title: `상위 5개 거래처가 매출의 ${o.top5.toFixed(0)}%`, text: o.custCur[0] ? `1위 ${o.custCur[0].k} ${p1(o.top1)}. ${o.top5 >= 60 ? '소수 거래처 의존도가 높습니다.' : '특정 거래처 쏠림은 크지 않습니다.'}` : '', to: () => nav('/ops') });
      const oldShare = o.invTotal > 0 ? o.old180 / o.invTotal * 100 : 0;
      if (o.old180 > 0) out.push({ tone: oldShare >= 20 ? 'warn' : 'info', title: `6개월 넘은 재고 ${won(o.old180)}`, text: `전체 재고 ${won(o.invTotal)}의 ${oldShare.toFixed(0)}%입니다.${o.turnDays != null ? ` 재고는 약 ${o.turnDays}일치 판매 분량입니다.` : ''}`, to: () => nav('/ops') });
      if (o.fxList.some(x => x.co) && Math.abs(o.coYtd) >= 1e7) out.push({ tone: o.coYtd > 0 ? 'warn' : 'good', title: `환율로 올해 ${won(Math.abs(o.coYtd))} ${o.coYtd > 0 ? '더 부담' : '절감'}`, text: `회사 기준 환율보다 ${o.coYtd > 0 ? '비싸게' : '싸게'} 구매했습니다. 이번 달은 ${won(Math.abs(o.coImpact))} ${o.coImpact > 0 ? '부담' : '절감'}.`, to: () => nav('/ops') });
    }
    if (exp && (exp.over > 0 || exp.soon > 0)) out.push({ tone: exp.over > 0 ? 'bad' : 'warn', title: exp.over > 0 ? `유효기간 지난 재고 ${won(exp.over)}` : `90일 안에 유효기간이 끝나는 재고 ${won(exp.soon)}`, text: `${exp.over > 0 ? `${exp.nOver} LOT 경과` : ''}${exp.over > 0 && exp.soon > 0 ? ' · ' : ''}${exp.soon > 0 ? `90일 안 만료 ${exp.nSoon} LOT (${won(exp.soon)})` : ''}. 처분·판매 계획이 필요합니다.`, to: () => nav('/stock') });
    if (ytd && lytd && ytd.op > lytd.op) out.push({ tone: 'good', title: `올해 누적 영업이익이 전년보다 ${swon(ytd.op - lytd.op)}`, text: `${won(lytd.op)} → ${won(ytd.op)} (1~${+cur.slice(4)}월).`, to: () => nav('/bu-real') });
    const rank = { bad: 0, warn: 1, info: 2, good: 3 } as const;
    return out.sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, 7);
  }, [d, o, exp, cur]); // eslint-disable-line

  const head = (
    <PageHead title="경영 요약" desc={d ? <>{ymText(cur)} 실적입니다. <span className={'badge ' + (d.est ? 'est' : 'ok')} title={d.est ? '아직 마감 전이라 앱이 구매·판매·전표로 계산한 값입니다. 손익계산서를 올리면 확정 금액으로 바뀝니다.' : 'ERP 손익계산서 금액 그대로입니다.'}>{d.est ? '추정 · 마감 전' : '확정 · 손익계산서'}</span></> : '이번 달 회사 실적을 한 장으로 봅니다.'}>
      {ctl.baseMonth && <MonthNav id="home-base" value={ctl.baseMonth} onChange={setBase} />}
    </PageHead>
  );
  if (!model) return <div className="page">{head}<Loading /></div>;
  if (!d) return <div className="page">{head}<Empty>{model.empty && model.reason !== 'results' ? '선택한 달에 표시할 데이터가 없습니다. 기준월을 확인해 주세요.' : '손익 계산이 아직 끝나지 않았습니다. 잠시 뒤 자동으로 표시됩니다.'}</Empty></div>;
  const { c, p, ly, ytd, lytd } = d;
  const mm = +cur.slice(4), hqMax = Math.max(1, ...d.hqs.map(h => Math.abs(h.net)));

  return (
    <div className="page home">
      <style>{`
        .home .ytd{display:grid;gap:0}
        .home .ytd .r{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 12px;padding:11px 0;border-bottom:1px solid var(--line);align-items:baseline}
        .home .ytd .r:last-of-type{border-bottom:0}
        .home .ytd .l{font-size:12.5px;color:var(--fg-3)}
        .home .ytd .v{font-size:21px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
        .home .ytd .c{grid-column:1/-1;font-size:12.5px;color:var(--fg-3);display:flex;gap:8px;flex-wrap:wrap}
        .home .fc{background:var(--surface-2);border-radius:10px;padding:11px 13px;font-size:13px;color:var(--fg-2);line-height:1.6;margin-top:6px}
        .home .fc b{color:var(--fg);font-variant-numeric:tabular-nums}
        .home .qs{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
        .home .sig{display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:11px;align-items:start;padding:11px 8px;border-bottom:1px solid var(--line);cursor:pointer;border-radius:8px;margin:0 -8px}
        .home .sig:last-child{border-bottom:0}
        .home .sig:hover{background:var(--surface-2)}
        .home .sig .ic{width:30px;height:30px;border-radius:9px;display:grid;place-items:center}
        .home .sig b{display:block;font-size:13.5px;line-height:1.4}
        .home .sig span{font-size:12.5px;color:var(--fg-3);line-height:1.5}
        .home .sig .go{color:var(--fg-4);align-self:center}
        .home .chartttl{display:flex;gap:10px;align-items:baseline;font-size:12.5px;font-weight:700;color:var(--fg-2);margin:2px 0 4px}
        .home .chartttl small{font-weight:400;color:var(--fg-3)}
        .home .why{font-size:13.5px;color:var(--fg-2);line-height:1.65;margin-top:8px}
        .home .ops{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0}
        .home .ops>div{padding:13px 20px;border-right:1px solid var(--line);border-top:1px solid var(--line);cursor:pointer;min-width:0}
        .home .ops>div:hover{background:var(--surface-2)}
        .home .ops>div:nth-child(3n){border-right:0}
        .home .ops .l{font-size:12.5px;color:var(--fg-3)}
        .home .ops .v{font-size:19px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;margin-top:1px}
        .home .ops .s{font-size:12px;color:var(--fg-3);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        @media(max-width:820px){.home .ops{grid-template-columns:repeat(2,minmax(0,1fr))}.home .ops>div:nth-child(3n){border-right:1px solid var(--line)}.home .ops>div:nth-child(2n){border-right:0}.home .ops>div{padding:12px 14px}}
      `}</style>
      {head}

      {/* ① 이번 달 실적 */}
      <div className="stats">
        <Stat label="매출액" value={won(c.sales)} sub={<><Delta cur={c.sales} prev={p?.sales} label="전월" mode="pct" /><Delta cur={c.sales} prev={ly?.sales} label="전년 동월" mode="pct" /></>} />
        <Stat label="영업이익" keyColor={c.op >= 0 ? 'var(--green)' : 'var(--red)'} tone={c.op >= 0 ? 'pos' : 'neg'} value={swon(c.op)} unit={opRate(c) != null ? `이익률 ${p1(opRate(c))}` : undefined}
          sub={<><Delta cur={c.op} prev={p?.op} label="전월" /><Delta cur={c.op} prev={ly?.op} label="전년 동월" /></>} help="bu-real.acct" />
        <Stat label="매출총이익률" value={p1(gpRate(c))} unit={`매출총이익 ${won(c.gp)}`} sub={<><Delta cur={gpRate(c)} prev={gpRate(p)} label="전월" mode="pp" />{gpRate(ytd) != null && <span>올해 평균 {p1(gpRate(ytd))}</span>}</>} />
        <Stat label="판매비와 관리비" value={won(c.sga)} unit={sgaRate(c) != null ? `매출의 ${p1(sgaRate(c))}` : undefined} sub={<><Delta cur={c.sga} prev={p?.sga} label="전월" invert /><Delta cur={c.sga} prev={ly?.sga} label="전년 동월" invert mode="pct" /></>} />
      </div>

      {/* ② 추이 · 올해 누적 */}
      <div className="g21">
        <Card title="최근 12개월" right={<Legend items={[{ c: C.margin, t: '확정' }, { c: 'repeating-linear-gradient(45deg,#1766e0 0 2px,#c9dcfa 2px 5px)', t: '추정(마감 전)' }, { c: C.ghost, t: '전년 같은 달' }]} />}>
          <div className="chartttl">매출액</div>
          <MonthBars mode="blue" height={150} label="월별 매출액" items={d.trend.map(x => ({ m: x.m, v: x.v!.sales, est: x.v!.nOff === 0, ghost: x.g?.sales ?? null }))} />
          <div className="chartttl" style={{ marginTop: 10 }}>영업이익 <small>초록 = 흑자 · 빨강 = 적자</small></div>
          <MonthBars mode="sign" height={150} label="월별 영업이익" items={d.trend.map(x => ({ m: x.m, v: x.v!.op, est: x.v!.nOff === 0, ghost: x.g?.op ?? null }))} />
        </Card>
        <Card title={`올해 누적 (1~${mm}월)`} desc={ytd && ytd.nOff < ytd.n ? `확정 ${ytd.nOff}개월 + 추정 ${ytd.n - ytd.nOff}개월` : undefined}>
          {ytd && (
            <div className="ytd">
              <div className="r"><span className="l">매출액</span><span className="v">{won(ytd.sales)}</span><span className="c">{lytd ? <>전년 같은 기간 {won(lytd.sales)} <Delta cur={ytd.sales} prev={lytd.sales} mode="pct" /></> : '전년 같은 기간 데이터 없음'}</span></div>
              <div className="r"><span className="l">영업이익</span><span className="v" style={{ color: ytd.op >= 0 ? 'var(--green-2)' : 'var(--red-2)' }}>{swon(ytd.op)}</span><span className="c">{lytd ? <>전년 같은 기간 {won(lytd.op)} <Delta cur={ytd.op} prev={lytd.op} /></> : `월평균 ${won(ytd.op / ytd.n)}`}</span></div>
              <div className="r"><span className="l">영업이익률</span><span className="v">{p1(opRate(ytd))}</span><span className="c">{lytd ? <>전년 같은 기간 {p1(opRate(lytd))} <Delta cur={opRate(ytd)} prev={opRate(lytd)} mode="pp" /></> : `매출총이익률 ${p1(gpRate(ytd))}`}</span></div>
            </div>
          )}
          {d.runAvg != null && mm < 12 && (
            <div className="fc" title="연간 전망 = 올해 누적 영업이익 + 남은 달 × 월 속도. 단순 환산이며 계절성·결산 조정은 반영하지 않습니다.">
              <b>연간 전망</b> — 올해 평균 속도면 약 <b>{won(d.runAvg)}</b>{d.run3 != null && <>, 최근 3개월 속도면 약 <b>{won(d.run3)}</b></>}입니다.
            </div>
          )}
          {d.quarters.length > 0 && <div className="qs">{d.quarters.map(q => <span key={q.q} className="chip" title="분기 영업이익">{q.q}분기{q.full ? '' : '(진행 중)'} <b className="num" style={{ color: q.op >= 0 ? 'var(--green-2)' : 'var(--red-2)' }}>{swon(q.op)}</b></span>)}</div>}
        </Card>
      </div>

      {/* ③ 달라진 이유 · ④ 살펴볼 것 */}
      <div className="g2">
        <Card title="영업이익이 전월과 달라진 이유" help="bu-real.acct" desc={d.est && plHas(pl, shiftYm(cur, -1)) ? '추정값끼리 비교' : undefined}>
          {d.why && p ? (
            <>
              <Waterfall start={{ label: `${+shiftYm(cur, -1).slice(4)}월`, v: p.op }} end={{ label: `${mm}월`, v: c.op }}
                steps={[{ label: '매출', v: d.why.sales }, { label: '이익률', v: d.why.rate }, { label: '판관비', v: d.why.sga }]} />
              <p className="why">{whyText(c, p, d.why)}</p>
            </>
          ) : <div className="empty" style={{ padding: 24 }}>비교할 전월 데이터가 없습니다.</div>}
        </Card>
        <Card title="살펴볼 것" desc="자동 점검 · 누르면 해당 화면으로">
          {sigs.length ? sigs.map((s, i) => (
            <div key={i} className="sig" onClick={s.to} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') s.to?.(); }}>
              <span className="ic" style={{ background: TONE[s.tone].bg, color: TONE[s.tone].c }}><Icon i={TONE[s.tone].i as IconNode} size={17} /></span>
              <div><b>{s.title}</b><span>{s.text}</span></div>
              <Icon i={ArrowRight as unknown as IconNode} size={16} className="go" />
            </div>
          )) : <div className="empty" style={{ padding: 24 }}>특별히 살펴볼 항목이 없습니다.</div>}
        </Card>
      </div>

      {/* ⑤ 본부별 성과 */}
      <Card title="본부별 성과" help="bu-real.scoreboard" desc={`${ymText(cur)} · 손익 = 판매 이익 − 비용`} right={<button className="btn sm ghost" onClick={() => nav('/bu-real')}>부서까지 보기 →</button>} flush>
        <div className="tbl-wrap">
          <table className="t wide">
            <thead><tr><th>본부</th><th>인원</th><th>판매 이익</th><th>비용</th><th>손익</th><th className="l" style={{ width: 170 }}>적자 ◀ · ▶ 흑자</th><th>전월 대비</th><th style={{ width: 130 }}>최근 {months.length}개월</th></tr></thead>
            <tbody>
              {d.hqs.map(h => (
                <tr key={h.hq} className="click" onClick={() => nav('/bu-real')}>
                  <td><b>{h.hq}</b></td><td>{h.emp ? (Math.round(h.emp * 10) / 10).toLocaleString('ko-KR') : '-'}</td>
                  <td>{fmt(h.margin)}</td><td>{fmt(h.cost)}</td>
                  <td style={{ fontWeight: 700 }} className={h.net >= 0 ? 'pos' : 'neg'}>{fmt(h.net)}</td>
                  <td className="l"><DivBar v={h.net} max={hqMax} w={150} /></td>
                  <td>{h.prevNet == null ? '-' : <Delta cur={h.net} prev={h.prevNet} />}</td>
                  <td><TrendLine series={h.line} /></td>
                </tr>
              ))}
              <tr className="total"><td>본부 합계</td><td>{(Math.round(sum(d.hqs.map(h => h.emp)) * 10) / 10).toLocaleString('ko-KR')}</td><td>{fmt(sum(d.hqs.map(h => h.margin)))}</td><td>{fmt(sum(d.hqs.map(h => h.cost)))}</td><td className={d.hqNet >= 0 ? 'pos' : 'neg'}>{fmt(d.hqNet)}</td><td /><td /><td /></tr>
              {d.adj != null && <>
                <tr className="adj" title="재고 평가·분기 결산 조정처럼 ERP 원가계산에서만 나오는 금액입니다. 본부로 나눌 수 없어 회사 전체에만 반영합니다."><td>회계 조정 (본부로 나눌 수 없음)</td><td /><td /><td /><td>{fmt(Math.round(d.adj))}</td><td /><td /><td /></tr>
                <tr className="total"><td>영업이익 (손익계산서)</td><td /><td /><td /><td className={c.op >= 0 ? 'pos' : 'neg'}>{fmt(Math.round(c.op))}</td><td /><td /><td /></tr>
              </>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ⑥ 운영 지표 요약 */}
      <Card title="운영 지표" desc="누르면 자세한 화면으로" right={<button className="btn sm ghost" onClick={() => nav('/ops')}>운영 지표 전체 →</button>} flush>
        <div className="ops">
          <div onClick={() => nav('/ops')}><div className="l">1인당 손익</div><div className="v" style={{ color: d.perCap && d.perCap.net < 0 ? 'var(--red-2)' : undefined }}>{d.perCap ? swon(d.perCap.net) : '-'}</div><div className="s">{d.perCap ? `인원 ${(Math.round(d.perCap.n * 10) / 10).toLocaleString('ko-KR')}명 · 결산 매출 제외` : '인원 데이터 없음'}</div></div>
          <div onClick={() => nav('/ops')}><div className="l">재고</div><div className="v">{o ? won(o.invTotal) : '…'}</div><div className="s">{o ? (o.turnDays != null ? `약 ${o.turnDays}일치 판매 분량` : '판매 원가 데이터 없음') : '불러오는 중'}</div></div>
          <div onClick={() => nav('/ops')}><div className="l">상위 5개 거래처 매출 비중</div><div className="v">{o ? p1(o.top5) : '…'}</div><div className="s">{o && o.custCur[0] ? `1위 ${o.custCur[0].k}` : ''}</div></div>
          <div onClick={() => nav('/ops')}><div className="l">수입 부대비용률</div><div className="v">{o ? p1(o.rateM[d.ci]) : '…'}</div><div className="s">구매 금액 대비 관세 · 운임 등</div></div>
          <div onClick={() => nav('/ops')}><div className="l">고정비 대비 판매 이익</div><div className="v">{fixedCover ? p1(fixedCover.cover) : '-'}</div><div className="s">{fixedCover ? `고정비 ${won(fixedCover.f)}` : '고정비 계정을 아직 정하지 않았습니다'}</div></div>
          <div onClick={() => nav('/ops')}><div className="l">환율 영향 (올해 누적)</div><div className="v" style={{ color: o && o.fxList.some(x => x.co) ? (o.coYtd > 0 ? 'var(--red-2)' : o.coYtd < 0 ? 'var(--green-2)' : undefined) : undefined }}>{o ? (o.fxList.some(x => x.co) ? `${won(Math.abs(o.coYtd))} ${o.coYtd > 0 ? '부담' : '절감'}` : '-') : '…'}</div><div className="s">{o && !o.fxList.some(x => x.co) ? '기준 환율을 아직 정하지 않았습니다' : '회사 기준 환율 대비'}</div></div>
        </div>
      </Card>
    </div>
  );
}

const plHas = (pl: ReturnType<typeof usePl>, ym: string) => !!pl && !!pl.closedThrough && ym <= pl.closedThrough;
function whyText(c: Pnl, p: Pnl, w: { sales: number; rate: number; sga: number }) {
  const parts: [string, number][] = [[w.sales >= 0 ? '매출 증가' : '매출 감소', w.sales], [w.rate >= 0 ? '이익률 상승' : '이익률 하락', w.rate], [w.sga >= 0 ? '판관비 감소' : '판관비 증가', w.sga]];
  const chg = c.op - p.op;
  const lst = (pos: boolean) => parts.filter(x => x[1] !== 0 && (x[1] > 0) === pos).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(x => `${x[0]}(${swon(x[1])})`).join(', ');
  const up = lst(true), dn = lst(false);
  return `영업이익이 전월보다 ${won(Math.abs(chg))} ${chg >= 0 ? '늘었습니다' : '줄었습니다'}.${up ? ` 늘린 요인은 ${up}` : ''}${up && dn ? ',' : up ? '입니다.' : ''}${dn ? ` 줄인 요인은 ${dn}입니다.` : ''}`;
}
