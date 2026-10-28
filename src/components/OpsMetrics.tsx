// 운영 지표 (별도 화면 /ops) — 7가지
//   ① 인당 수익·비용·순수익   ② 재고 회전일수·오래된 재고   ③ 품목·청구처 마진율   ④ 거래처 집중도
//   ⑤ 수입 부대비용률          ⑥ 고정비 대비 수익           ⑦ 환율 영향
//   수익 = 구매/판매의 실현 수익. 경영전략본부·연구소의 비용·인원은 [비용 배분 설정] 비율로 수익 본부에 나눕니다(①).
//   ①·⑥ 은 실현 수익 화면의 계산 결과로, ②~⑤·⑦ 은 DB 함수 ops_metrics(0008) 결과로 계산합니다.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { accL } from '../lib/acc';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { applyHqAlloc, type CostAllocCfg } from '../lib/hqAlloc';
import { fmt } from './ui';
import { HelpDot } from './Help';
import { ListHead } from './ListHead';
import { kor, ymL, C } from './charts';

export type OpsDeptRow = {
  d: string; hq: string; margin: number[]; cost: number[]; emp: number;
  empSer?: number[]; inSer?: number[]; outSer?: number[]; vCost?: number[];
};
export type OpsModel = {
  months: string[]; cur: string; realized: boolean; deptLevel: boolean; allow?: string[] | null;
  series: { margin: number[]; marginTrade?: number[] }; deptRows: (OpsDeptRow & { marginTrade?: number[] })[]; hqOrder?: string[];
};

type InvLot = [string, string, string, string, string, string, number, number, number | null]; // 부서, 사업단위, 품목, LOT, 입고일, 최근판매일, 수량, 금액, 경과일
type Ops = {
  from: string; to: string; today: string;
  inv: [string, string, string, number, number][];                     // 부서, 사업단위, 구간, 금액, LOT수
  invLots?: InvLot[]; invTop?: InvLot[];
  invSrc?: 'erp' | 'calc';
  invGap?: [string, string, string, number, number, number, number][];   // 부서, 품목, LOT, 계산 수량, ERP 수량, 계산 금액, ERP 금액
  invGapN?: number; invGapAmt?: number;
  sales: [string, string, string, string, number, number][];           // 부서, 년월, 품목, 청구처, 매출, 원가
  pur: [string, string, string, number, number][];                     // 부서, 년월, 수입처, 구매금액, 부대비용
  payee: [string, string, string, number][];                           // 부서, 년월, 지급처, 금액
  fx: [string, string, string, number, number][];                      // 부서, 년월, 통화, 외화금액, 원화환산
};
type Fixed = { configured: boolean; rows: [string, string, string, number][] };   // 부서, 년월, 계정, 금액
type FxBase = { rates: Record<string, Record<string, number>> };               // { '2026': { USD: 1400 } }

// ── DB 결과 캐시 ──
const cache = new Map<string, Promise<Ops | { error: string }>>();
const fcache = new Map<string, Promise<Fixed | { error: string }>>();
if (typeof window !== 'undefined') {
  window.addEventListener('kjhub:uploaded', () => { cache.clear(); fcache.clear(); });
  window.addEventListener('kjhub:fixedsaved', () => fcache.clear());
}
const noFn = (e: { message: string; code?: string }, name: string) => (new RegExp(name + '|PGRST202|function', 'i').test(e.message + (e.code || '')) ? 'NOFN' : e.message);
function loadOps(from: string, to: string) {
  const k = from + '|' + to;
  if (!cache.has(k)) cache.set(k, (async () => {
    const { data, error } = await supabase.rpc('ops_metrics', { p_from: from, p_to: to });
    if (error) { cache.delete(k); return { error: noFn(error, 'ops_metrics') }; }
    return data as Ops;
  })());
  return cache.get(k)!;
}
function loadFixed(from: string, to: string) {
  const k = from + '|' + to;
  if (!fcache.has(k)) fcache.set(k, (async () => {
    const { data, error } = await supabase.rpc('fixed_cost_agg', { p_from: from, p_to: to });
    if (error) { fcache.delete(k); return { error: noFn(error, 'fixed_cost_agg') }; }
    return data as Fixed;
  })());
  return fcache.get(k)!;
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const pct1 = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
const sgn = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '');
const fmtEmp = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? fmt(v) : (Math.round(v * 10) / 10).toLocaleString('ko-KR'));
const BK = ['0-90', '91-180', '181-365', '365+', '미상'] as const;
const BK_L: Record<string, string> = { '0-90': '90일 이하', '91-180': '91~180일', '181-365': '181~365일', '365+': '1년 넘음', '미상': '입고일 없음' };
const BK_C: Record<string, string> = { '0-90': '#9cc3f5', '91-180': '#f5c26b', '181-365': '#f08a4b', '365+': '#d93c3c', '미상': '#cbd5e1' };
const bkOf = (age: number | null) => (age == null ? '미상' : age <= 90 ? '0-90' : age <= 180 ? '91-180' : age <= 365 ? '181-365' : '365+');
const fmtDate = (s: string) => { const d = String(s || '').replace(/[^0-9]/g, ''); return d.length >= 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '-'; };
/** 수입업체 = 수입처 코드가 3 으로 시작 ("이름 (코드)" 의 괄호 안) */
export const isImportVendor = (v: string) => /\(\s*3[^()]*\)\s*$/.test(String(v || ''));

/** 값이 없는 달(null)은 건너뛰는 작은 꺾은선 */
function Line({ vals, color = C.margin, h = 30, w = 120 }: { vals: (number | null)[]; color?: string; h?: number; w?: number }) {
  const ok = vals.map((v, i) => (v == null || !isFinite(v) ? null : { i, v })).filter(Boolean) as { i: number; v: number }[];
  if (ok.length < 2) return <span className="help">-</span>;
  const mn = Math.min(...ok.map(p => p.v)), mx = Math.max(...ok.map(p => p.v)), rg = mx - mn || 1;
  const x = (i: number) => 3 + (i / Math.max(1, vals.length - 1)) * (w - 6), y = (v: number) => 3 + (1 - (v - mn) / rg) * (h - 6);
  const d = ok.map((p, k) => (k ? 'L' : 'M') + x(p.i).toFixed(1) + ',' + y(p.v).toFixed(1)).join(' ');
  const lp = ok[ok.length - 1];
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', marginLeft: 'auto' }}><path d={d} fill="none" stroke={color} strokeWidth={1.6} /><circle cx={x(lp.i)} cy={y(lp.v)} r={2.4} fill={color} /></svg>;
}

/** 월별 막대 */
function MonthBars({ months, a, b, aLbl, bLbl, fmtV = kor, colorA = C.margin, colorB = C.cost }: { months: string[]; a: (number | null)[]; b?: (number | null)[]; aLbl: string; bLbl?: string; fmtV?: (v: number) => string; colorA?: string; colorB?: string }) {
  const all = [...a, ...(b || [])].filter((v): v is number => v != null && isFinite(v));
  const mx = Math.max(1, ...all.map(v => Math.abs(v)));
  return (
    <div className="ops-mb">
      <div className="ops-mb-lg"><span><i style={{ background: colorA }} />{aLbl}</span>{bLbl && <span><i style={{ background: colorB }} />{bLbl}</span>}</div>
      <div className="ops-mb-row">
        {months.map((m, i) => (
          <div key={m} className="ops-mb-col" title={`${ymL(m)} · ${aLbl} ${a[i] == null ? '-' : fmt(a[i])}${b ? ` · ${bLbl} ${b[i] == null ? '-' : fmt(b[i])}` : ''}`}>
            <div className="ops-mb-bars">
              <i style={{ height: Math.max(1, Math.abs(a[i] || 0) / mx * 100) + '%', background: (a[i] || 0) < 0 ? '#d93c3c' : colorA }} />
              {b && <i style={{ height: Math.max(1, Math.abs(b[i] || 0) / mx * 100) + '%', background: colorB }} />}
            </div>
            <small className={i === months.length - 1 ? 'on' : ''}>{Number(m.slice(4))}월</small>
            <b>{a[i] == null ? '-' : fmtV(a[i] as number)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function Kpi({ l, v, s, tone }: { l: string; v: string; s?: string; tone?: 'neg' | 'pos' }) {
  return <div className="ops-kpi"><span>{l}</span><b className={tone || ''}>{v}</b>{s && <small>{s}</small>}</div>;
}
/** "더보기 / 접기" 버튼 — n: 지금 보이는 수, total: 전체 */
function More({ n, total, step, set, unit = '개' }: { n: number; total: number; step: number; set: (n: number) => void; unit?: string }) {
  if (total <= step) return null;
  return (
    <div className="ops-more">
      {n < total && <button className="btn sm" onClick={() => set(Math.min(total, n + step))}>더보기 (+{Math.min(step, total - n)}{unit}) · {n}/{total}</button>}
      {n < total && <button className="btn sm ghost" onClick={() => set(total)}>전체 보기</button>}
      {n > step && <button className="btn sm ghost" onClick={() => set(step)}>접기</button>}
    </div>
  );
}
function Loading({ err }: { err: string | null }) {
  return <div className="ops-msg">{err ? 'DB 함수가 준비되면 표시됩니다.' : '불러오는 중…'}</div>;
}

export function OpsMetrics({ model, allocCfg }: { model: OpsModel; allocCfg: CostAllocCfg | null | undefined }) {
  const { months, cur } = model;
  const year = cur.slice(0, 4);
  const from = months[0], to = cur;
  const opsFrom = from < year + '01' ? from : year + '01';   // 환율 올해 누적용: 1월부터 받음
  const [ops, setOps] = useState<Ops | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fxd, setFxd] = useState<Fixed | null>(null);
  const [fxErr, setFxErr] = useState<string | null>(null);
  const [fxBase, setFxBase] = useState<FxBase>({ rates: {} });
  const [tick, setTick] = useState(0);
  const { employee } = useAuth();
  const isAdmin = employee?.role === 'admin';
  const nav = useNavigate();
  useEffect(() => { const h = () => setTick(t => t + 1); window.addEventListener('kjhub:uploaded', h); window.addEventListener('kjhub:fixedsaved', h); return () => { window.removeEventListener('kjhub:uploaded', h); window.removeEventListener('kjhub:fixedsaved', h); }; }, []);
  useEffect(() => {
    let alive = true; setErr(null);
    loadOps(opsFrom, to).then(r => { if (!alive) return; if (!r || 'error' in r) { setErr(r ? r.error : '빈 응답'); setOps(null); } else setOps(r); });
    return () => { alive = false; };
  }, [opsFrom, to, tick]);
  useEffect(() => {
    let alive = true; setFxErr(null);
    loadFixed(from, to).then(r => { if (!alive) return; if (!r || 'error' in r) { setFxErr(r ? r.error : '빈 응답'); setFxd(null); } else setFxd(r); });
    return () => { alive = false; };
  }, [from, to, tick]);
  useEffect(() => { supabase.from('config').select('value').eq('key', 'fxBase').maybeSingle().then(({ data }) => { const v = data?.value as FxBase | undefined; if (v?.rates) setFxBase(v); }); }, [tick]);

  const hqOf = useMemo(() => { const m: Record<string, string> = {}; model.deptRows.forEach(r => { m[r.d] = r.hq; }); return m; }, [model.deptRows]);
  const unitOf = (d: string) => hqOf[d] || '기타';
  const ci = months.length - 1;
  const prevMonths = months.slice(0, -1);
  const curL = ymL(cur);

  // ── ① 인당 (실현 수익 · 배분 후 비용 · 배분 후 인원) ──
  const perCap = useMemo(() => {
    // 운영 지표는 구매/판매 실현 수익 기준 — 결산 매출(실현 수익 화면에만 더함)은 제외
    const al = applyHqAlloc(model.deptRows.map(r => (r.marginTrade ? { ...r, margin: r.marginTrade } : r)), months, allocCfg);
    const order = (h: string) => { const i = (model.hqOrder || []).indexOf(h); return i < 0 ? 999 : i; };
    const per = (m: number[], c: number[], e: number[]) => ({
      emp: e[ci], pm: e[ci] ? m[ci] / e[ci] : null, pc: e[ci] ? c[ci] / e[ci] : null, pn: e[ci] ? (m[ci] - c[ci]) / e[ci] : null,
      avgN: (() => { const v = months.map((_, i) => (e[i] ? (m[i] - c[i]) / e[i] : null)).filter((z): z is number => z != null); return v.length ? sum(v) / v.length : null; })(),
      line: months.map((_, i) => (e[i] ? (m[i] - c[i]) / e[i] : null)),
    });
    const inOut = (ds: string[]) => { const set = new Set(ds); const rs = model.deptRows.filter(r => set.has(r.d)); return { inn: sum(rs.map(r => sum(r.inSer || []))), out: sum(rs.map(r => sum(r.outSer || []))) }; };
    const rows = al.hqs.slice().sort((a, b) => order(a.hq) - order(b.hq)).map(h => ({
      name: h.hq, ...per(h.margin, h.cost, h.emp), ...inOut(h.depts.map(x => x.d)), mCur: h.margin[ci] || 0, cCur: h.cost[ci] || 0,
      inCost: h.inFrom.reduce((s, f) => s + f.cost[ci], 0), inEmp: h.inFrom.reduce((s, f) => s + f.emp[ci], 0),
      inFrom: h.inFrom.map(f => ({ from: f.from, cost: f.cost[ci], emp: f.emp[ci] })).filter(f => f.cost || f.emp),
    })).filter(r => r.emp > 0.01 || r.pm != null || r.pc != null || r.mCur !== 0);
    const tm = months.map((_, i) => sum(al.hqs.map(h => h.margin[i]))), tc = months.map((_, i) => sum(al.hqs.map(h => h.cost[i]))), te = months.map((_, i) => sum(al.hqs.map(h => h.emp[i])));
    const total = { name: '전체', ...per(tm, tc, te), ...inOut(model.deptRows.map(r => r.d)), empStart: te[0] };
    return { rows, total, hasEmp: te.some(v => v > 0), gone: al.gone, ruleSrc: al.ruleSrc };
  }, [model.deptRows, model.hqOrder, months, ci, allocCfg]);

  // ── ⑥ 고정비 대비 수익 ──
  const fixed = useMemo(() => {
    const rev = (model.series.marginTrade || model.series.margin).slice();   // 회사 전체 실현 수익 (구매/판매, 결산 매출 제외)
    const vc = months.map((_, i) => sum(model.deptRows.map(r => (r.vCost || [])[i] || 0)));
    const inRows = new Set(model.deptRows.map(r => r.d));
    const mi: Record<string, number> = {}; months.forEach((m, i) => { mi[m] = i; });
    const fx = months.map(() => 0);
    const accs: Record<string, number> = {};
    (fxd?.rows || []).forEach(([d, ym, a, v]) => { const i = mi[ym]; if (i == null || !inRows.has(d)) return; fx[i] += +v; if (i === ci) accs[a] = (accs[a] || 0) + +v; });
    const accList = Object.entries(accs).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]);
    return { rev, fx, vc, accList, cover: months.map((_, i) => (fx[i] > 0 ? Math.round(rev[i] / fx[i] * 1000) / 10 : null)) };
  }, [model.deptRows, model.series.margin, model.series.marginTrade, months, ci, fxd]);

  // ── DB 묶음 (②③④⑤⑦) ──
  const db = useMemo(() => {
    if (!ops) return null;
    const mIdx: Record<string, number> = {}; months.forEach((m, i) => { mIdx[m] = i; });

    // ② 재고 — 본부 › 품목 › LOT
    const lots = (ops.invLots || ops.invTop || []);
    const invTotal = sum(ops.inv.map(r => r[3]));
    const byBk: Record<string, { amt: number; n: number }> = {}; ops.inv.forEach(r => { const o = byBk[r[2]] || (byBk[r[2]] = { amt: 0, n: 0 }); o.amt += r[3]; o.n += r[4]; });
    type ItemG = { item: string; amt: number; old: number; n: number; maxAge: number; lots: InvLot[] };
    type HqG = { hq: string; amt: number; bk: Record<string, number>; n: number; items: ItemG[] };
    const hqMap: Record<string, HqG> = {};
    ops.inv.forEach(r => { const u = unitOf(r[0]); const o = hqMap[u] || (hqMap[u] = { hq: u, amt: 0, bk: {}, n: 0, items: [] }); o.amt += r[3]; o.n += r[4]; o.bk[r[2]] = (o.bk[r[2]] || 0) + r[3]; });
    const itemIdx: Record<string, ItemG> = {};
    lots.forEach(l => { const u = unitOf(l[0]); const o = hqMap[u] || (hqMap[u] = { hq: u, amt: 0, bk: {}, n: 0, items: [] }); const k = u + '|' + l[2]; let it = itemIdx[k]; if (!it) { it = itemIdx[k] = { item: l[2], amt: 0, old: 0, n: 0, maxAge: 0, lots: [] }; o.items.push(it); } it.amt += l[7]; it.n++; if ((l[8] ?? 0) > 180) it.old += l[7]; it.maxAge = Math.max(it.maxAge, l[8] ?? 0); it.lots.push(l); });
    const invHq = Object.values(hqMap).sort((a, b) => b.amt - a.amt);
    invHq.forEach(h => { h.items.sort((a, b) => b.amt - a.amt); h.items.forEach(it => it.lots.sort((a, b) => b[7] - a[7])); });
    const cogsM = months.map(() => 0), salesM = months.map(() => 0);
    ops.sales.forEach(r => { const i = mIdx[r[1]]; if (i == null) return; cogsM[i] += r[5]; salesM[i] += r[4]; });
    const last3 = cogsM.slice(-3); const avgCogs = last3.length ? sum(last3) / last3.length : 0;
    const turnDays = avgCogs > 0 ? Math.round(invTotal / avgCogs * 30) : null;
    const old180 = (byBk['181-365']?.amt || 0) + (byBk['365+']?.amt || 0);

    // ③ 품목 · 청구처 마진율
    const marginBy = (key: 2 | 3) => {
      const g: Record<string, { s: number[]; c: number[] }> = {};
      ops.sales.forEach(r => { const i = mIdx[r[1]]; if (i == null) return; const o = g[r[key]] || (g[r[key]] = { s: months.map(() => 0), c: months.map(() => 0) }); o.s[i] += r[4]; o.c[i] += r[5]; });
      const totCur = sum(Object.values(g).map(o => o.s[ci]));
      return Object.entries(g).map(([k, o]) => {
        const rate = months.map((_, i) => (o.s[i] > 0 ? (o.s[i] - o.c[i]) / o.s[i] * 100 : null));
        const ps = sum(o.s.slice(0, -1)), pc = sum(o.c.slice(0, -1));
        const base = ps > 0 ? (ps - pc) / ps * 100 : null;
        const curR = rate[ci];
        const diff = curR != null && base != null ? curR - base : null;
        const share = totCur > 0 ? o.s[ci] / totCur * 100 : 0;
        const alert = diff != null && diff <= -5 && share >= 1;
        return { k, sCur: o.s[ci], mCur: o.s[ci] - o.c[ci], curR, base, diff, share, alert, rate, sAll: sum(o.s) };
      }).filter(x => x.sAll !== 0);
    };
    const byItem = marginBy(2), byCust = marginBy(3);

    // ④ 거래처 집중도
    const custCur = byCust.filter(x => x.sCur > 0).sort((a, b) => b.sCur - a.sCur);
    const custCurTot = sum(custCur.map(x => x.sCur));
    const top5 = custCurTot > 0 ? sum(custCur.slice(0, 5).map(x => x.sCur)) / custCurTot * 100 : null;
    const top1 = custCurTot > 0 && custCur[0] ? custCur[0].sCur / custCurTot * 100 : null;
    const top5Line = months.map((_, i) => {
      const v: Record<string, number> = {}; ops.sales.forEach(r => { if (mIdx[r[1]] === i) v[r[3]] = (v[r[3]] || 0) + r[4]; });
      const arr = Object.values(v).filter(x => x > 0).sort((a, b) => b - a); const t = sum(arr);
      return t > 0 ? sum(arr.slice(0, 5)) / t * 100 : null;
    });

    // ⑤ 부대비용률 — 수입업체(코드 3…)만
    const pur = ops.pur.filter(r => isImportVendor(r[2]));
    const pM = months.map(() => 0), aM = months.map(() => 0);
    const byVendor: Record<string, { p: number; a: number }> = {};
    pur.forEach(r => { const i = mIdx[r[1]]; if (i == null) return; pM[i] += r[3]; aM[i] += r[4]; const o = byVendor[r[2]] || (byVendor[r[2]] = { p: 0, a: 0 }); o.p += r[3]; o.a += r[4]; });
    const rateM = months.map((_, i) => (pM[i] > 0 ? Math.round(aM[i] / pM[i] * 1000) / 10 : null));
    const vendors = Object.entries(byVendor).map(([k, o]) => ({ k, p: o.p, a: o.a, r: o.p > 0 ? o.a / o.p * 100 : null })).filter(x => x.p > 0).sort((a, b) => b.p - a.p);
    const otherVendors = new Set(ops.pur.filter(r => !isImportVendor(r[2]) && mIdx[r[1]] != null).map(r => r[2])).size;
    const payees: Record<string, number[]> = {};
    ops.payee.forEach(r => { const i = mIdx[r[1]]; if (i == null) return; (payees[r[2]] = payees[r[2]] || months.map(() => 0))[i] += r[3]; });
    const payeeList = Object.entries(payees).map(([k, s]) => ({ k, sum: sum(s), cur: s[ci], prev: ci > 0 ? s[ci - 1] : 0 })).sort((a, b) => b.sum - a.sum);

    // ⑦ 환율 — 직전 3개월 평균 · 회사 기준 환율(올해)
    const ymsYear = Array.from(new Set(ops.fx.map(r => r[1]).filter(m => m.slice(0, 4) === year && m <= cur))).sort();
    const curs: Record<string, { f: number[]; w: number[]; yf: number; yw: number }> = {};
    ops.fx.forEach(r => {
      const o = curs[r[2]] || (curs[r[2]] = { f: months.map(() => 0), w: months.map(() => 0), yf: 0, yw: 0 });
      const i = mIdx[r[1]]; if (i != null) { o.f[i] += r[3]; o.w[i] += r[4]; }
      if (r[1].slice(0, 4) === year && r[1] <= cur) { o.yf += r[3]; o.yw += r[4]; }
    });
    const rates = fxBase.rates[year] || {};
    const fxList = Object.entries(curs).map(([c, o]) => {
      const rate = months.map((_, i) => (o.f[i] > 0 ? o.w[i] / o.f[i] : null));
      const bi = [ci - 3, ci - 2, ci - 1].filter(i => i >= 0);
      const bf = sum(bi.map(i => o.f[i])), bw = sum(bi.map(i => o.w[i]));
      const base = bf > 0 ? bw / bf : null;
      const rc = rate[ci];
      const impact = rc != null && base != null ? o.f[ci] * (rc - base) : null;
      const co = rates[c] || null;
      const coImpact = rc != null && co ? o.f[ci] * (rc - co) : null;           // 기준월: 회사 기준 대비
      const coYtd = co && o.yf > 0 ? o.yw - o.yf * co : null;                      // 올해 누적: Σ외화×(환율 − 회사 기준)
      const yAvg = o.yf > 0 ? o.yw / o.yf : null;
      return { c, fCur: o.f[ci], wCur: o.w[ci], rc, base, impact, co, coImpact, coYtd, yAvg, rate, fAll: sum(o.f) + o.yf };
    }).filter(x => x.fAll > 0).sort((a, b) => b.wCur - a.wCur || b.fAll - a.fAll);
    const fxImpact = sum(fxList.map(x => x.impact || 0));
    const coImpact = sum(fxList.map(x => x.coImpact || 0));
    const coYtd = sum(fxList.map(x => x.coYtd || 0));

    return { invTotal, byBk, invHq, cogsM, salesM, avgCogs, turnDays, old180, byItem, byCust, custCur, custCurTot, top5, top1, top5Line, pM, aM, rateM, vendors, otherVendors, payeeList, fxList, fxImpact, coImpact, coYtd, ymsYear };
  }, [ops, months, ci, cur, year, fxBase, hqOf]); // eslint-disable-line react-hooks/exhaustive-deps

  // 펼치기 · 더보기 상태
  const [mTab, setMTab] = useState<'item' | 'cust'>('item');
  const [nMargin, setNMargin] = useState(15);
  const [nCust, setNCust] = useState(10);
  const [nVendor, setNVendor] = useState(8);
  const [nPayee, setNPayee] = useState(8);
  const [nFixed, setNFixed] = useState(8);
  const [openHq, setOpenHq] = useState<Record<string, boolean>>({});
  const [openItem, setOpenItem] = useState<Record<string, boolean>>({});
  const [nItems, setNItems] = useState<Record<string, number>>({});
  const [nLots, setNLots] = useState<Record<string, number>>({});
  const [openCap, setOpenCap] = useState<Record<string, boolean>>({});
  const [showGap, setShowGap] = useState(false);
  const [nGap, setNGap] = useState(15);
  // 회사 기준 환율 편집 (관리자)
  const [fxEdit, setFxEdit] = useState<Record<string, string> | null>(null);
  const saveFx = async () => {
    if (!fxEdit) return;
    const next: FxBase = { rates: { ...fxBase.rates, [year]: Object.fromEntries(Object.entries(fxEdit).map(([k, v]) => [k.trim().toUpperCase(), Number(String(v).replace(/,/g, ''))]).filter(([k, v]) => k && (v as number) > 0)) } };
    const { error } = await supabase.rpc('save_config', { p_key: 'fxBase', p_value: next, p_summary: `${year}년 기준 환율` });
    if (error) { alert(error.message); return; }
    setFxBase(next); setFxEdit(null);
  };

  return (
    <div className="ops">
      <style>{`
        .ops{display:grid;gap:16px}
        .ops .ops-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        .ops .ops-card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 18px;min-width:0;display:grid;gap:12px;align-content:start}
        .ops .ops-card.wide{grid-column:1 / -1}
        .ops .ops-card h3{margin:0;font-size:15px;font-weight:700;display:flex;align-items:center;gap:4px}
        .ops .ops-card h3 .no{display:inline-flex;width:20px;height:20px;border-radius:6px;background:var(--brand-soft);color:var(--brand);font:700 12px var(--font-num);align-items:center;justify-content:center;margin-right:4px}
        .ops .ops-card .lead{margin:-6px 0 0;font-size:12.5px;color:var(--fg-3)}
        .ops .ops-kpis{display:flex;flex-wrap:wrap;gap:8px 22px}
        .ops .ops-kpi{display:grid;gap:1px;min-width:0}
        .ops .ops-kpi span{font-size:11.5px;color:var(--fg-3)}
        .ops .ops-kpi b{font:800 20px/1.15 var(--font-num);font-variant-numeric:tabular-nums}
        .ops .ops-kpi b.neg{color:var(--neg)}.ops .ops-kpi b.pos{color:#2c7f2c}
        .ops .ops-kpi small{font-size:11.5px;color:var(--fg-3)}
        .ops table{width:100%;border-collapse:collapse;font-size:12.5px}
        .ops th{font-weight:500;color:var(--fg-3);font-size:11.5px;text-align:right;padding:5px 6px;border-bottom:1px solid var(--line);white-space:nowrap}
        .ops th:first-child,.ops td:first-child{text-align:left}
        .ops td{padding:6px;border-bottom:1px solid var(--line);text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums;white-space:nowrap}
        .ops td:first-child{font-family:var(--font-body);font-weight:600;max-width:260px;overflow:hidden;text-overflow:ellipsis}
        .ops tr.tot td{font-weight:800;background:var(--surface-2)}
        .ops tr.clk{cursor:pointer}.ops tr.clk:hover td{background:var(--surface-2)}
        .ops tr.l2 td{background:#fafbfd}.ops tr.l2 td:first-child{padding-left:22px;font-weight:600}
        .ops tr.l3 td{background:#f5f7fb;color:var(--fg-2)}.ops tr.l3 td:first-child{padding-left:40px;font-weight:400}
        .ops tr.l2m td,.ops tr.l3m td{background:#fafbfd;text-align:left;padding:4px 6px 8px 22px}.ops tr.l3m td{padding-left:40px;background:#f5f7fb}
        .ops tr.inrow td{color:#7c5a00;background:#fffbea;font-style:italic;font-weight:400}.ops tr.inrow td:first-child{padding-left:22px;font-weight:400}
        .ops .caret{display:inline-block;width:14px;color:var(--fg-3);font-size:11px}
        .ops tr.warn td{background:#fff5f5}
        .ops .neg{color:var(--neg)}.ops .pos{color:#2c7f2c}.ops .mut{color:var(--fg-3)}
        .ops .ops-stack{display:flex;height:16px;border-radius:999px;overflow:hidden;background:var(--surface-2)}
        .ops .ops-stack i{display:block;height:100%}
        .ops .ops-lg{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px}
        .ops .ops-lg span i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px}
        .ops .ops-mb-lg{display:flex;gap:14px;font-size:11.5px;color:var(--fg-3);margin-bottom:4px}.ops .ops-mb-lg i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;vertical-align:-1px}
        .ops .ops-mb-row{display:flex;gap:4px;align-items:flex-end}
        .ops .ops-mb-col{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center}
        .ops .ops-mb-bars{height:64px;width:100%;display:flex;gap:2px;align-items:flex-end;justify-content:center}
        .ops .ops-mb-bars i{display:block;flex:1;max-width:18px;border-radius:3px 3px 0 0}
        .ops .ops-mb-col small{font-size:10.5px;color:var(--fg-3);margin-top:3px}.ops .ops-mb-col small.on{color:var(--fg);font-weight:700}
        .ops .ops-mb-col b{font:600 10.5px var(--font-num);color:var(--fg-2);white-space:nowrap}
        .ops .ops-note{font-size:11.5px;color:var(--fg-3);line-height:1.5}
        .ops .ops-alert{display:flex;flex-wrap:wrap;gap:6px}
        .ops .ops-alert span{font-size:12px;background:#fdeaea;color:var(--neg);border-radius:999px;padding:2px 9px}
        .ops .ops-rk{display:grid;grid-template-columns:22px minmax(0,1fr) 100px 56px 56px;gap:8px;align-items:center;font-size:12.5px;padding:3px 0}
        .ops .ops-rk .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
        .ops .ops-rk>span:nth-child(n+3){text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums}
        .ops .ops-msg{padding:14px;border:1px dashed var(--line-2);border-radius:10px;font-size:13px;color:var(--fg-2);background:var(--surface-2)}
        .ops .ops-more{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
        .ops .ops-gap{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;border-top:1px dashed var(--line-2);padding-top:10px}.ops .ops-gap>.btn{white-space:normal;text-align:left;justify-content:flex-start;height:auto}
        .ops .fxin{width:90px;padding:3px 6px;font-size:12.5px;text-align:right}
        @media (max-width:1000px){.ops .ops-grid{grid-template-columns:1fr}}
        @media (max-width:820px){.ops .ops-card{padding:14px 12px}.ops .ops-kpi b{font-size:18px}.ops .ops-mb-col b{display:none}.ops .ops-rk{grid-template-columns:18px minmax(0,1fr) 84px 46px}.ops .ops-rk>:nth-child(5){display:none}.ops .tbl-wrap td:first-child,.ops .tbl-wrap th:first-child{position:sticky;left:0;z-index:1;background:var(--surface);max-width:140px;box-shadow:1px 0 0 var(--line)}.ops tr.tot td:first-child{background:var(--surface-2)}.ops tr.warn td:first-child{background:#fff5f5}.ops tr.l2 td:first-child,.ops tr.inrow td:first-child{background:#fafbfd}.ops tr.l3 td:first-child{background:#f5f7fb}}
      `}</style>
      {err && <div className="ops-msg">{err === 'NOFN' ? '② ~ ⑤ · ⑦ 은 DB 함수가 필요합니다. 관리자가 Supabase SQL Editor 에서 0006 → 0008 파일을 실행하면 표시됩니다.' : '운영 지표를 불러오지 못했습니다: ' + err}</div>}
      <div className="ops-grid">

        {/* ① 인당 */}
        <div className="ops-card wide">
          <h3><span className="no">1</span>인당 수익·비용·순수익<HelpDot id="ops.percap" /></h3>
          <p className="lead">본부 크기 차이를 빼고 1명이 얼마를 벌고 쓰는지 봅니다. 수익 = 구매/판매 실현 수익, 비용 = 전표 비용. 경영전략본부·연구소의 비용과 인원은 [비용 배분 설정] 비율로 수익 본부에 나눴습니다{perCap.ruleSrc ? ` (${ymL(perCap.ruleSrc)} 설정)` : ' (기본 규칙)'}. 본부를 누르면 받은 배분이 보입니다.</p>
          {!perCap.hasEmp ? <div className="ops-msg">기간 안에 [월/부서별 인원] 데이터가 없습니다.</div> : <>
            <div className="ops-kpis">
              <Kpi l={`${curL} 인원`} v={fmtEmp(perCap.total.emp) + '명'} s={`기간 입사 ${perCap.total.inn} · 퇴사 ${perCap.total.out} · 기간 초 ${fmtEmp(perCap.total.empStart)}명`} />
              <Kpi l="인당 실현 수익" v={perCap.total.pm == null ? '-' : kor(perCap.total.pm)} />
              <Kpi l="인당 비용" v={perCap.total.pc == null ? '-' : kor(perCap.total.pc)} />
              <Kpi l="인당 순수익" v={perCap.total.pn == null ? '-' : sgn(perCap.total.pn) + kor(Math.abs(perCap.total.pn))} tone={perCap.total.pn == null ? undefined : perCap.total.pn >= 0 ? 'pos' : 'neg'} s={perCap.total.avgN == null ? undefined : `기간 월평균 ${sgn(perCap.total.avgN)}${kor(Math.abs(perCap.total.avgN))}`} />
            </div>
            <div className="tbl-wrap"><table>
              <thead><tr><th>본부</th><th>인원 (배분 포함)</th><th>입사·퇴사(기간)</th><th>인당 실현 수익</th><th>인당 비용</th><th>인당 순수익</th><th>기간 월평균 인당 순수익</th><th style={{ width: 130 }}>인당 순수익 추이</th></tr></thead>
              <tbody>
                {perCap.rows.map(r => {
                  const op = !!openCap[r.name];
                  return [
                    <tr key={r.name} className={r.inFrom.length ? 'clk' : ''} onClick={() => r.inFrom.length && setOpenCap(o => ({ ...o, [r.name]: !o[r.name] }))}>
                      <td>{r.inFrom.length ? <span className="caret">{op ? '▾' : '▸'}</span> : <span className="caret" />}{r.name}</td><td>{fmtEmp(r.emp)}</td><td className="mut">{r.inn || r.out ? `+${r.inn} / −${r.out}` : '-'}</td>
                      <td title={r.emp ? undefined : `인원 없음 · 실현 수익 ${fmt(r.mCur)}원`}>{r.pm == null ? (r.mCur ? <span className="mut">인원 없음 ({kor(r.mCur)})</span> : '-') : fmt(r.pm)}</td><td>{r.pc == null ? '-' : fmt(r.pc)}</td>
                      <td className={r.pn == null ? '' : r.pn >= 0 ? 'pos' : 'neg'}>{r.pn == null ? '-' : fmt(r.pn)}</td>
                      <td className={r.avgN == null ? '' : r.avgN >= 0 ? 'pos' : 'neg'}>{r.avgN == null ? '-' : fmt(r.avgN)}</td>
                      <td><Line vals={r.line} color={(r.pn ?? 0) >= 0 ? '#2c7f2c' : '#d93c3c'} /></td>
                    </tr>,
                    ...(op ? r.inFrom.map(f => <tr key={r.name + '|' + f.from} className="inrow"><td>← {f.from} 배분</td><td>{fmtEmp(f.emp)}</td><td /><td>-</td><td className="mut" title="이 본부가 받은 비용 (기준월)">{fmt(f.cost)}원</td><td colSpan={3} className="mut" style={{ textAlign: 'left' }}>위 인원·인당 비용에 포함됨</td></tr>) : []),
                  ];
                })}
                <tr className="tot"><td>전체</td><td>{fmtEmp(perCap.total.emp)}</td><td className="mut">{perCap.total.inn || perCap.total.out ? `+${perCap.total.inn} / −${perCap.total.out}` : '-'}</td><td>{perCap.total.pm == null ? '-' : fmt(perCap.total.pm)}</td><td>{perCap.total.pc == null ? '-' : fmt(perCap.total.pc)}</td><td className={(perCap.total.pn ?? 0) >= 0 ? 'pos' : 'neg'}>{perCap.total.pn == null ? '-' : fmt(perCap.total.pn)}</td><td>{perCap.total.avgN == null ? '-' : fmt(perCap.total.avgN)}</td><td><Line vals={perCap.total.line} color="#64748b" /></td></tr>
              </tbody>
            </table></div>
            {perCap.gone.length > 0 && <div className="ops-note">배분으로 비용·인원이 모두 넘어가 표에서 빠진 조직: {perCap.gone.join(', ')}{isAdmin && <button className="btn sm ghost" style={{ marginLeft: 6, padding: '1px 8px' }} onClick={() => nav('/settings/cost-alloc')}>비용 배분 설정 →</button>}</div>}
          </>}
        </div>

        {/* ② 재고 */}
        <div className="ops-card wide">
          <h3><span className="no">2</span>재고 회전일수 · 오래된 재고<HelpDot id="ops.stock" /></h3>
          {!db ? <Loading err={err} /> : <>
            <p className="lead">{db.turnDays == null ? '최근 3개월 매출원가가 없어 회전일수를 계산할 수 없습니다.' : `지금 재고는 약 ${db.turnDays}일 치 판매량입니다.`} {db.invTotal > 0 ? `입고 후 180일 넘은 재고가 ${kor(db.old180)}(${pct1(db.old180, db.invTotal)}%) 입니다.` : ''} {ops?.invSrc === 'erp' ? '재고는 [LOT별 재고] 업로드(ERP 재고) 기준입니다.' : '[LOT별 재고] 업로드가 없어 구매 − 판매 − 폐기 − 생산 투입으로 계산한 재고입니다.'} 본부 → 품목 → LOT 순서로 눌러서 펼칩니다.</p>
            <div className="ops-kpis">
              <Kpi l={ops?.invSrc === 'erp' ? '재고금액 (ERP · LOT별 재고)' : '재고금액 (계산값)'} v={kor(db.invTotal)} />
              <Kpi l="월평균 매출원가 (최근 3개월)" v={kor(db.avgCogs)} />
              <Kpi l="재고 회전일수" v={db.turnDays == null ? '-' : db.turnDays + '일'} tone={db.turnDays != null && db.turnDays > 180 ? 'neg' : undefined} />
            </div>
            {db.invTotal > 0 && <>
              <div className="ops-stack">{BK.map(k => db.byBk[k]?.amt ? <i key={k} title={`${BK_L[k]} ${fmt(db.byBk[k].amt)}원`} style={{ width: db.byBk[k].amt / db.invTotal * 100 + '%', background: BK_C[k] }} /> : null)}</div>
              <div className="ops-lg">{BK.map(k => db.byBk[k]?.amt ? <span key={k}><i style={{ background: BK_C[k] }} />{BK_L[k]} {kor(db.byBk[k].amt)} · {db.byBk[k].n} LOT</span> : null)}</div>
              <div className="tbl-wrap"><table>
                <thead><tr><th>본부 › 품목 › LOT</th><th>LOT 수 · 수량</th><th>재고금액</th><th>90일 이하</th><th>91~180일</th><th>181일 이상</th><th>가장 오래된 경과일 · 입고일</th><th>마지막 판매</th></tr></thead>
                <tbody>{db.invHq.map(h => {
                  const oh = !!openHq[h.hq]; const ni = nItems[h.hq] || 10;
                  const old = (h.bk['181-365'] || 0) + (h.bk['365+'] || 0);
                  return [
                    <tr key={h.hq} className="clk" onClick={() => setOpenHq(o => ({ ...o, [h.hq]: !o[h.hq] }))}>
                      <td><span className="caret">{oh ? '▾' : '▸'}</span>{h.hq}</td><td>{fmt(h.n)}</td><td>{fmt(h.amt)}</td><td>{fmt(h.bk['0-90'] || 0)}</td><td>{fmt(h.bk['91-180'] || 0)}</td><td className={old > 0 ? 'neg' : ''}>{fmt(old)}</td><td className="mut">{h.items.length ? Math.max(...h.items.map(i => i.maxAge)) + '일' : '-'}</td><td />
                    </tr>,
                    ...(oh ? h.items.slice(0, ni).flatMap(it => {
                      const k = h.hq + '|' + it.item; const oi = !!openItem[k]; const nl = nLots[k] || 10;
                      return [
                        <tr key={k} className="l2 clk" onClick={() => setOpenItem(o => ({ ...o, [k]: !o[k] }))}>
                          <td title={it.item}><span className="caret">{oi ? '▾' : '▸'}</span>{it.item}</td><td>{it.n}</td><td>{fmt(it.amt)}</td>
                          <td>{fmt(sum(it.lots.filter(l => bkOf(l[8]) === '0-90').map(l => l[7])))}</td><td>{fmt(sum(it.lots.filter(l => bkOf(l[8]) === '91-180').map(l => l[7])))}</td>
                          <td className={it.old > 0 ? 'neg' : ''}>{fmt(it.old)}</td><td className="mut">{it.maxAge}일</td><td />
                        </tr>,
                        ...(oi ? it.lots.slice(0, nl).map((l, i) => (
                          <tr key={k + '|' + l[3] + '|' + i} className="l3"><td>LOT {l[3]}</td><td className="mut">수량 {fmt(l[6])}</td><td>{fmt(l[7])}</td><td colSpan={3} style={{ textAlign: 'center' }}><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: BK_C[bkOf(l[8])], marginRight: 5 }} />{BK_L[bkOf(l[8])]}</td><td className={(l[8] ?? 0) > 180 ? 'neg' : ''}>{l[8] == null ? '-' : l[8] + '일'} · {fmtDate(l[4])}</td><td className="mut">{fmtDate(l[5])}</td></tr>
                        )) : []),
                        ...(oi && it.lots.length > 10 ? [<tr key={k + '-m'} className="l3m"><td colSpan={8}><More n={nl} total={it.lots.length} step={10} set={n => setNLots(o => ({ ...o, [k]: n }))} unit=" LOT" /></td></tr>] : []),
                      ];
                    }) : []),
                    ...(oh && h.items.length > 10 ? [<tr key={h.hq + '-m'} className="l2m"><td colSpan={8}><More n={ni} total={h.items.length} step={10} set={n => setNItems(o => ({ ...o, [h.hq]: n }))} unit="개 품목" /></td></tr>] : []),
                  ];
                })}</tbody>
              </table></div>
            </>}
            {ops?.invSrc === 'erp' && (ops.invGapN || 0) > 0 && (
              <div className="ops-gap">
                <button className="btn sm ghost" onClick={() => setShowGap(v => !v)}>{showGap ? '▾' : '▸'} 점검: 구매/판매 계산 재고와 ERP 재고가 다른 LOT {fmt(ops.invGapN || 0)}건 (계산이 {kor(Math.abs(ops.invGapAmt || 0))} {(ops.invGapAmt || 0) >= 0 ? '많음' : '적음'})</button>
                {showGap && <>
                  <div className="ops-note">구매/판매 화면의 재고 평가액은 계산값이라 아래 LOT 들 때문에 ERP 재고와 달라집니다. 대개 판매·폐기·생산 투입이 다른 품번이나 다른 LOT 번호로 적혀 있거나, 해당 데이터가 업로드되지 않은 경우입니다. LOT 을 누르면 [집계 검증 › LOT 추적]에서 관련 행을 모두 봅니다.</div>
                  <div className="tbl-wrap"><table>
                    <thead><tr><th>LOT</th><th>품목</th><th>{'본부'}</th><th>계산 수량</th><th>ERP 수량</th><th>차이 수량</th><th>계산 금액</th><th>ERP 금액</th></tr></thead>
                    <tbody>{(ops.invGap || []).slice(0, nGap).map((g, i) => (
                      <tr key={g[2] + g[1] + i} className={isAdmin ? 'clk' : ''} onClick={() => isAdmin && nav('/settings/verify?lot=' + encodeURIComponent(g[2]))}>
                        <td>{g[2]}</td><td className="mut" style={{ fontFamily: 'var(--font-body)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={g[1]}>{g[1]}</td><td className="mut" style={{ fontFamily: 'var(--font-body)' }}>{unitOf(g[0])}</td>
                        <td>{fmt(g[3])}</td><td>{fmt(g[4])}</td><td className={g[3] - g[4] > 0 ? 'neg' : 'pos'}>{sgn(g[3] - g[4])}{fmt(Math.abs(g[3] - g[4]))}</td><td>{fmt(g[5])}</td><td className="mut">{fmt(g[6])}</td>
                      </tr>))}</tbody>
                  </table></div>
                  <More n={Math.min(nGap, (ops.invGap || []).length)} total={(ops.invGap || []).length} step={15} set={setNGap} unit=" LOT" />
                  {(ops.invGapN || 0) > (ops.invGap || []).length && <div className="ops-note">차이가 큰 순서로 {(ops.invGap || []).length}건만 보입니다.</div>}
                </>}
              </div>
            )}
          </>}
        </div>

        {/* ③ 마진율 */}
        <div className="ops-card wide">
          <h3><span className="no">3</span>품목 · 청구처별 마진율<HelpDot id="ops.margin" /></h3>
          {!db ? <Loading err={err} /> : (() => {
            const list = (mTab === 'item' ? db.byItem : db.byCust).filter(x => x.sCur !== 0 || x.alert).sort((a, b) => Number(b.alert) - Number(a.alert) || b.sCur - a.sCur);
            const alerts = list.filter(x => x.alert);
            const totS = db.salesM[ci], totC = db.cogsM[ci];
            const pS = sum(db.salesM.slice(0, -1)), pC = sum(db.cogsM.slice(0, -1));
            const rNow = totS > 0 ? (totS - totC) / totS * 100 : null, rPrev = pS > 0 ? (pS - pC) / pS * 100 : null;
            return <>
              <p className="lead">{rNow == null ? `${curL} 판매가 없습니다.` : `${curL} 전체 마진율 ${rNow.toFixed(1)}%${rPrev != null ? ` (이전 ${prevMonths.length}개월 ${rPrev.toFixed(1)}%, ${sgn(rNow - rPrev)}${Math.abs(rNow - rPrev).toFixed(1)}%p)` : ''}.`} {alerts.length ? `마진율이 평소보다 5%p 넘게 떨어진 ${mTab === 'item' ? '품목' : '청구처'} ${alerts.length}곳을 맨 위에 표시했습니다.` : '평소보다 크게 떨어진 곳은 없습니다.'}</p>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="seg"><button className={mTab === 'item' ? 'on' : ''} onClick={() => { setMTab('item'); setNMargin(15); }}>품목별</button><button className={mTab === 'cust' ? 'on' : ''} onClick={() => { setMTab('cust'); setNMargin(15); }}>청구처별</button></span>
                {alerts.length > 0 && <div className="ops-alert">{alerts.slice(0, 6).map(a => <span key={a.k}>▼ {a.k.replace(/ \([^)]*\)$/, '')} {a.diff!.toFixed(1)}%p</span>)}</div>}
              </div>
              <div className="tbl-wrap"><table>
                <thead><tr><th>{mTab === 'item' ? '품목' : '청구처'}</th><th>{curL} 매출</th><th>매출 비중</th><th>{curL} 마진</th><th>{curL} 마진율</th><th>이전 {prevMonths.length}개월 마진율</th><th>변화</th><th style={{ width: 130 }}>월별 마진율</th></tr></thead>
                <tbody>{list.slice(0, nMargin).map(x => (
                  <tr key={x.k} className={x.alert ? 'warn' : ''}>
                    <td title={x.k}>{x.k}</td><td>{fmt(x.sCur)}</td><td className="mut">{x.share.toFixed(1)}%</td><td className={x.mCur < 0 ? 'neg' : ''}>{fmt(x.mCur)}</td>
                    <td>{x.curR == null ? '-' : x.curR.toFixed(1) + '%'}</td><td className="mut">{x.base == null ? '-' : x.base.toFixed(1) + '%'}</td>
                    <td className={x.diff == null ? '' : x.diff < 0 ? 'neg' : 'pos'}>{x.diff == null ? '-' : sgn(x.diff) + Math.abs(x.diff).toFixed(1) + '%p'}</td>
                    <td><Line vals={x.rate} color={x.alert ? '#d93c3c' : C.margin} /></td>
                  </tr>
                ))}</tbody>
              </table></div>
              <More n={Math.min(nMargin, list.length)} total={list.length} step={15} set={setNMargin} />
            </>;
          })()}
        </div>

        {/* ④ 거래처 집중도 */}
        <div className="ops-card">
          <h3><span className="no">4</span>거래처 집중도<HelpDot id="ops.conc" /></h3>
          {!db ? <Loading err={err} /> : <>
            <p className="lead">{db.top5 == null ? `${curL} 판매가 없습니다.` : `${curL} 매출의 ${db.top5.toFixed(1)}%가 상위 5개 청구처에서 나왔습니다. 가장 큰 한 곳이 ${db.top1!.toFixed(1)}% 입니다.`}</p>
            <div className="ops-kpis">
              <Kpi l="상위 5곳 비중" v={db.top5 == null ? '-' : db.top5.toFixed(1) + '%'} tone={db.top5 != null && db.top5 >= 70 ? 'neg' : undefined} />
              <Kpi l="1위 비중" v={db.top1 == null ? '-' : db.top1.toFixed(1) + '%'} tone={db.top1 != null && db.top1 >= 30 ? 'neg' : undefined} />
              <Kpi l={`${curL} 거래 청구처`} v={db.custCur.length + '곳'} />
              <div className="ops-kpi"><span>상위 5곳 비중 추이</span><Line vals={db.top5Line} color="#7c3aed" w={140} h={34} /></div>
            </div>
            <div>
              <ListHead cls="ops-rk" cols={['', '청구처', `>${curL} 매출`, '>비중', '>누적']} />
              {(() => { let acc = 0; return db.custCur.slice(0, nCust).map((x, i) => { acc += x.sCur; return <div key={x.k} className="ops-rk"><span className="help">{i + 1}</span><span className="nm" title={x.k}>{x.k}</span><span>{fmt(x.sCur)}</span><span>{(x.sCur / db.custCurTot * 100).toFixed(1)}%</span><span className="mut">{(acc / db.custCurTot * 100).toFixed(0)}%</span></div>; }); })()}
              <More n={Math.min(nCust, db.custCur.length)} total={db.custCur.length} step={10} set={setNCust} unit="곳" />
            </div>
          </>}
        </div>

        {/* ⑤ 부대비용률 */}
        <div className="ops-card">
          <h3><span className="no">5</span>수입 부대비용률<HelpDot id="ops.landed" /></h3>
          {!db ? <Loading err={err} /> : (() => {
            const rc = db.rateM[ci]; const ps = sum(db.pM), as = sum(db.aM); const avg = ps > 0 ? Math.round(as / ps * 1000) / 10 : null;
            return <>
              <p className="lead">{rc == null ? `${curL} 수입업체 입고분이 없습니다.` : `${curL} 수입 입고분의 부대비용은 구매금액의 ${rc}% 입니다${avg != null ? ` (기간 평균 ${avg}%)` : ''}.`} 수입처 코드가 3으로 시작하는 업체만 봅니다{db.otherVendors ? ` (국내 업체 ${db.otherVendors}곳 제외)` : ''}.</p>
              <div className="ops-kpis">
                <Kpi l={`${curL} 부대비용률`} v={rc == null ? '-' : rc + '%'} tone={rc != null && avg != null && rc > avg * 1.2 ? 'neg' : undefined} />
                <Kpi l={`${curL} 부대비용`} v={kor(db.aM[ci])} s={`수입 구매 ${kor(db.pM[ci])}`} />
                <Kpi l="기간 평균" v={avg == null ? '-' : avg + '%'} />
              </div>
              <MonthBars months={months} a={db.rateM} aLbl="부대비용률(%)" fmtV={v => v.toFixed(1)} colorA="#0ea5e9" />
              <div className="tbl-wrap"><table>
                <thead><tr><th>수입처 (기간)</th><th>구매금액</th><th>부대비용</th><th>비율</th></tr></thead>
                <tbody>{db.vendors.slice(0, nVendor).map(v => <tr key={v.k}><td title={v.k}>{v.k}</td><td>{fmt(v.p)}</td><td>{fmt(v.a)}</td><td className={v.r != null && avg != null && v.r > avg * 1.2 ? 'neg' : ''}>{v.r == null ? '-' : v.r.toFixed(1) + '%'}</td></tr>)}</tbody>
              </table></div>
              <More n={Math.min(nVendor, db.vendors.length)} total={db.vendors.length} step={8} set={setNVendor} unit="곳" />
              {db.payeeList.length > 0 && <div>
                <ListHead cls="ops-rk" cols={['', '지급처 (청구월 기준)', '>기간 합계', `>${Number(cur.slice(4))}월`, '>전월']} />
                {db.payeeList.slice(0, nPayee).map((x, i) => <div key={x.k} className="ops-rk"><span className="help">{i + 1}</span><span className="nm" title={x.k}>{x.k}</span><span>{fmt(x.sum)}</span><span>{kor(x.cur)}</span><span className="mut">{kor(x.prev)}</span></div>)}
                <More n={Math.min(nPayee, db.payeeList.length)} total={db.payeeList.length} step={8} set={setNPayee} unit="곳" />
              </div>}
            </>;
          })()}
        </div>

        {/* ⑥ 고정비 대비 수익 */}
        <div className="ops-card wide">
          <h3><span className="no">6</span>고정비 대비 수익<HelpDot id="ops.fixed" /></h3>
          {fxErr ? <div className="ops-msg">{fxErr === 'NOFN' ? '고정비 계산 DB 함수가 필요합니다. 관리자가 Supabase SQL Editor 에서 0009_fixed_cost.sql 을 실행하면 표시됩니다.' : '고정비를 불러오지 못했습니다: ' + fxErr}</div>
            : !fxd ? <Loading err={null} />
            : !fxd.configured ? <div className="ops-msg">아직 고정비 기준이 정해지지 않았습니다. {isAdmin ? <>관리자가 <button className="btn sm" onClick={() => nav('/settings/fixed')}>고정비 설정 →</button> 에서 계정·적요를 고르면 표시됩니다.</> : '관리자에게 [설정 › 고정비 설정]을 요청하세요.'}</div>
            : (() => {
              const c = fixed.cover[ci], gap = fixed.rev[ci] - fixed.fx[ci];
              return <>
                <p className="lead">{fixed.fx[ci] > 0 ? (gap >= 0 ? `${curL} 실현 수익이 고정비를 ${c}% 덮었습니다. 고정비를 내고 ${kor(gap)} 남았습니다.` : `${curL} 실현 수익이 고정비의 ${c}% 입니다. 고정비만으로 ${kor(-gap)} 모자랍니다.`) : '기준월 고정비가 없습니다.'}</p>
                <div className="ops-kpis">
                  <Kpi l="고정비 커버율" v={c == null ? '-' : c + '%'} tone={c == null ? undefined : c >= 100 ? 'pos' : 'neg'} s="실현 수익 ÷ 고정비" />
                  <Kpi l={`${curL} 고정비`} v={kor(fixed.fx[ci])} s={`전표 비용의 ${pct1(fixed.fx[ci], fixed.vc[ci]) ?? '-'}%`} />
                  <Kpi l="수익 − 고정비" v={sgn(gap) + kor(Math.abs(gap))} tone={gap >= 0 ? 'pos' : 'neg'} />
                </div>
                <MonthBars months={months} a={fixed.rev} b={fixed.fx} aLbl="실현 수익" bLbl="고정비" />
                {fixed.accList.length > 0 && <div>
                  <ListHead cls="ops-rk" cols={['', `${curL} 고정비 계정`, '>금액', '>비중', '']} />
                  {fixed.accList.slice(0, nFixed).map(([a, v], i) => <div key={a} className="ops-rk"><span className="help">{i + 1}</span><span className="nm" title={a}>{accL(a)}</span><span>{fmt(v)}</span><span className="mut">{pct1(v, fixed.fx[ci]) ?? '-'}%</span><span /></div>)}
                  <More n={Math.min(nFixed, fixed.accList.length)} total={fixed.accList.length} step={8} set={setNFixed} />
                </div>}
                {isAdmin && <div className="ops-note">고정비 기준: [설정 › 고정비 설정] <button className="btn sm ghost" style={{ padding: '1px 8px' }} onClick={() => nav('/settings/fixed')}>바꾸기 →</button></div>}
              </>;
            })()}
        </div>

        {/* ⑦ 환율 */}
        <div className="ops-card wide">
          <h3><span className="no">7</span>환율 영향<HelpDot id="ops.fx" /></h3>
          {!db ? <Loading err={err} /> : !db.fxList.length ? <div className="ops-msg">기간 안에 외화 구매가 없거나, 구매 데이터에 통화(CURRNAME)·단가(PRICE)·환율(EXRATE) 열이 없습니다.</div> : <>
            <p className="lead">{db.fxList.some(x => x.co) ? `${year}년 회사 기준 환율과 비교하면 ${curL} 외화 구매 원가가 ${kor(Math.abs(db.coImpact))} ${db.coImpact >= 0 ? '더 들었고' : '덜 들었고'}, 올해 누적으로는 ${kor(Math.abs(db.coYtd))} ${db.coYtd >= 0 ? '더 들었습니다' : '덜 들었습니다'}.` : `${year}년 회사 기준 환율이 아직 없습니다. ${isAdmin ? '아래 "기준 환율 입력"에서 넣어 주세요.' : ''}`} {db.fxList.some(x => x.impact != null) ? `직전 3개월 평균 환율과 비교하면 ${sgn(db.fxImpact)}${kor(Math.abs(db.fxImpact))} 입니다.` : ''}</p>
            <div className="ops-kpis">
              <Kpi l={`회사 기준 대비 (${curL})`} v={db.fxList.some(x => x.co) ? sgn(db.coImpact) + kor(Math.abs(db.coImpact)) : '-'} tone={db.coImpact > 0 ? 'neg' : db.coImpact < 0 ? 'pos' : undefined} s="+ 는 원가 상승" />
              <Kpi l={`회사 기준 대비 (${year}년 누적)`} v={db.fxList.some(x => x.co) ? sgn(db.coYtd) + kor(Math.abs(db.coYtd)) : '-'} tone={db.coYtd > 0 ? 'neg' : db.coYtd < 0 ? 'pos' : undefined} s={db.ymsYear.length ? `${ymL(db.ymsYear[0])} ~ ${curL}` : undefined} />
              <Kpi l="직전 3개월 평균 대비" v={sgn(db.fxImpact) + kor(Math.abs(db.fxImpact))} tone={db.fxImpact > 0 ? 'neg' : db.fxImpact < 0 ? 'pos' : undefined} />
            </div>
            <div className="tbl-wrap"><table>
              <thead><tr><th>통화</th><th>{curL} 외화 구매</th><th>{curL} 평균 환율</th><th>회사 기준 ({year})</th><th>기준 대비 영향</th><th>{year} 평균 · 누적 영향</th><th>직전 3개월 평균</th><th>3개월 대비 영향</th><th style={{ width: 110 }}>월별 평균 환율</th></tr></thead>
              <tbody>{db.fxList.map(x => <tr key={x.c}>
                <td>{x.c}</td><td>{fmt(x.fCur)}</td><td>{x.rc == null ? '-' : x.rc.toFixed(2)}</td>
                <td>{x.co ? fmt(x.co) : <span className="mut">미입력</span>}</td>
                <td className={x.coImpact == null ? '' : x.coImpact > 0 ? 'neg' : 'pos'}>{x.coImpact == null ? '-' : sgn(x.coImpact) + fmt(Math.abs(x.coImpact))}</td>
                <td className={x.coYtd == null ? 'mut' : x.coYtd > 0 ? 'neg' : 'pos'}>{x.yAvg == null ? '-' : x.yAvg.toFixed(2)}{x.coYtd != null ? ' · ' + sgn(x.coYtd) + kor(Math.abs(x.coYtd)) : ''}</td>
                <td className="mut">{x.base == null ? '-' : x.base.toFixed(2)}</td>
                <td className={x.impact == null ? '' : x.impact > 0 ? 'neg' : 'pos'}>{x.impact == null ? '-' : sgn(x.impact) + fmt(Math.abs(x.impact))}</td>
                <td><Line vals={x.rate} color="#0ea5e9" w={100} /></td>
              </tr>)}</tbody>
            </table></div>
            {isAdmin && (fxEdit ? (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="help">{year}년 회사 기준 환율</span>
                {Object.keys(fxEdit).map(c => <label key={c} className="row" style={{ gap: 4 }}><b style={{ fontSize: 12.5 }}>{c}</b><input className="inp fxin" value={fxEdit[c]} onChange={e => setFxEdit(o => ({ ...o!, [c]: e.target.value }))} placeholder="예: 1400" /></label>)}
                <button className="btn sm pri" onClick={saveFx}>저장</button><button className="btn sm ghost" onClick={() => setFxEdit(null)}>취소</button>
              </div>
            ) : <div className="ops-note">회사 기준 환율: {Object.entries(fxBase.rates[year] || {}).map(([c, v]) => `${c} ${fmt(v)}`).join(' · ') || '없음'} <button className="btn sm ghost" style={{ padding: '1px 8px' }} onClick={() => setFxEdit(Object.fromEntries(db.fxList.map(x => [x.c, x.co ? String(x.co) : ''])))}>기준 환율 입력 →</button></div>)}
          </>}
        </div>
      </div>
    </div>
  );
}
