// 회사 전체 손익 (회계 기준) — 마감 완료 월은 손익계산서 금액("확정"), 그 밖은 앱 계산("추정")
//   경영 요약 · 손익 현황 화면이 같은 값을 쓰도록 한곳에 둡니다.
import { plMonth, type PlCfg } from './plStmt';

export type AcctRow = { sales: number | null; gp: number; sga: number; op: number; oh: number; pool: number; disp: number; settle: number };
export type AcctModel = { hasDb: boolean; months: string[]; rows: Record<string, AcctRow> };
/** n = 더한 달 수, nOff = 그중 확정인 달 수 */
export type Pnl = { sales: number | null; cogs: number | null; gp: number; sga: number; op: number; net: number | null; n: number; nOff: number };

/** 한 달 손익. est=true 면 확정이 있어도 추정값 */
export function pnlOf(acct: AcctModel | null | undefined, pl: PlCfg | null | undefined, ym: string, est = false): Pnl | null {
  const o = est ? null : plMonth(pl, ym);
  if (o) return { sales: o.sales, cogs: o.cogs, gp: o.gp, sga: o.sga, op: o.op, net: o.net, n: 1, nOff: 1 };
  const r = acct?.rows[ym]; if (!r) return null;
  return { sales: r.sales, cogs: r.sales == null ? null : r.sales - r.gp, gp: r.gp, sga: r.sga, op: r.op, net: null, n: 1, nOff: 0 };
}
/** 여러 달 합계 (있는 달만) */
export function pnlSum(acct: AcctModel | null | undefined, pl: PlCfg | null | undefined, yms: string[]): Pnl | null {
  let out: Pnl | null = null;
  for (const m of yms) {
    const v = pnlOf(acct, pl, m); if (!v) continue;
    if (!out) { out = { ...v }; continue; }
    const o: Pnl = out;
    out = { sales: o.sales == null || v.sales == null ? null : o.sales + v.sales, cogs: o.cogs == null || v.cogs == null ? null : o.cogs + v.cogs, gp: o.gp + v.gp, sga: o.sga + v.sga, op: o.op + v.op, net: o.net == null || v.net == null ? null : o.net + v.net, n: o.n + 1, nOff: o.nOff + v.nOff };
  }
  return out;
}
const r1 = (a: number, b: number | null) => (b ? Math.round((a / b) * 1000) / 10 : null);
export const gpRate = (v: Pnl | null | undefined) => (v ? r1(v.gp, v.sales) : null);
export const opRate = (v: Pnl | null | undefined) => (v ? r1(v.op, v.sales) : null);
export const sgaRate = (v: Pnl | null | undefined) => (v ? r1(v.sga, v.sales) : null);
/** 영업이익이 달라진 이유: 매출 효과(전 기간 이익률로 매출만 변했다면) + 이익률 효과 + 판관비 효과 — 세 값의 합 = 영업이익 증감 */
export function opBridge(c: Pnl | null, p: Pnl | null) {
  if (!c || !p || c.sales == null || p.sales == null || !p.sales || !c.sales) return null;
  const pr = p.gp / p.sales, cr = c.gp / c.sales;
  return { sales: (c.sales - p.sales) * pr, rate: (cr - pr) * c.sales, sga: -(c.sga - p.sga) };
}
/** 그 해 1월 ~ 기준월 */
export const ytdMonths = (cur: string) => Array.from({ length: +cur.slice(4, 6) }, (_, i) => cur.slice(0, 4) + String(i + 1).padStart(2, '0'));
export const lastYear = (ym: string) => (+ym.slice(0, 4) - 1) + ym.slice(4);
