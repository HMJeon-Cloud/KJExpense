// 운영 지표 계산 (DB 함수 ops_metrics 결과 → 화면에 쓰는 값)
//   운영 지표 화면과 경영 요약 화면이 같은 계산을 쓰도록 한곳에 둡니다.
import { supabase } from './supabase';

export type InvLot = [string, string, string, string, string, string, number, number, number | null]; // 부서, 사업단위, 품목, LOT, 입고일, 최근판매일, 수량, 금액, 경과일
export type Ops = {
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
export type Fixed = { configured: boolean; rows: [string, string, string, number][] };   // 부서, 년월, 계정, 금액
export type FxBase = { rates: Record<string, Record<string, number>> };               // { '2026': { USD: 1400 } }


// ── DB 결과 캐시 ──
const cache = new Map<string, Promise<Ops | { error: string }>>();
const fcache = new Map<string, Promise<Fixed | { error: string }>>();
if (typeof window !== 'undefined') {
  window.addEventListener('kjhub:uploaded', () => { cache.clear(); fcache.clear(); });
  window.addEventListener('kjhub:fixedsaved', () => fcache.clear());
}
const noFn = (e: { message: string; code?: string }, name: string) => (new RegExp(name + '|PGRST202|function', 'i').test(e.message + (e.code || '')) ? 'NOFN' : e.message);
export function loadOps(from: string, to: string) {
  const k = from + '|' + to;
  if (!cache.has(k)) cache.set(k, (async () => {
    const { data, error } = await supabase.rpc('ops_metrics', { p_from: from, p_to: to });
    if (error) { cache.delete(k); return { error: noFn(error, 'ops_metrics') }; }
    return data as Ops;
  })());
  return cache.get(k)!;
}
export function loadFixed(from: string, to: string) {
  const k = from + '|' + to;
  if (!fcache.has(k)) fcache.set(k, (async () => {
    const { data, error } = await supabase.rpc('fixed_cost_agg', { p_from: from, p_to: to });
    if (error) { fcache.delete(k); return { error: noFn(error, 'fixed_cost_agg') }; }
    return data as Fixed;
  })());
  return fcache.get(k)!;
}


const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
/** 수입업체 = 수입처 코드가 3 으로 시작 ("이름 (코드)" 의 괄호 안) */
export const isImportVendor = (v: string) => /\(\s*3[^()]*\)\s*$/.test(String(v || ''));

/** ② 재고 ③ 이익률 ④ 거래처 집중도 ⑤ 부대비용률 ⑦ 환율 */
export function computeOps(ops: Ops, months: string[], cur: string, fxBase: FxBase, unitOf: (dept: string) => string) {
  const ci = months.length - 1, year = cur.slice(0, 4);
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

    // ③ 품목 · 거래처 이익률
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
        return { k, sCur: o.s[ci], mCur: o.s[ci] - o.c[ci], curR, base, diff, share, alert, rate, sAll: sum(o.s), s: o.s, c: o.c };
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
    // 통화별 × 월별 합계 (월별 상세용 — 조회 기간 + 올해 1월부터)
    const fxByYm: Record<string, Record<string, { f: number; w: number }>> = {};
    ops.fx.forEach(r => { if (r[1] > cur) return; const o = fxByYm[r[2]] || (fxByYm[r[2]] = {}); const e = o[r[1]] || (o[r[1]] = { f: 0, w: 0 }); e.f += r[3]; e.w += r[4]; });
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
      // 월별 상세: 월 평균 환율 · 회사 기준 대비 · 직전 3개월 평균 대비 (그 달 기준)
      const yms = Object.keys(fxByYm[c] || {}).sort();
      let cumAcc = 0;
      const monthly = yms.map(ym => {
        const e = fxByYm[c][ym]; const r2 = e.f > 0 ? e.w / e.f : null;
        const coImp = r2 != null && co ? e.f * (r2 - co) : null;   // = Σ외화×(환율 − 기준)
        if (ym.slice(0, 4) === year && coImp != null) cumAcc += coImp;
        return { ym, f: e.f, w: e.w, r: r2, coImp, cum: co ? cumAcc : null };
      }).reverse(); // 최근 달이 위
      return { c, fCur: o.f[ci], wCur: o.w[ci], rc, base, impact, co, coImpact, coYtd, yAvg, rate, monthly, fAll: sum(o.f) + o.yf };
    }).filter(x => x.fAll > 0).sort((a, b) => b.wCur - a.wCur || b.fAll - a.fAll);
    const fxImpact = sum(fxList.map(x => x.impact || 0));
    const coImpact = sum(fxList.map(x => x.coImpact || 0));
    const coYtd = sum(fxList.map(x => x.coYtd || 0));

    return { invTotal, byBk, invHq, cogsM, salesM, avgCogs, turnDays, old180, byItem, byCust, custCur, custCurTot, top5, top1, top5Line, pM, aM, rateM, vendors, otherVendors, payeeList, fxList, fxImpact, coImpact, coYtd, ymsYear };
}
export type OpsCalc = ReturnType<typeof computeOps>;
