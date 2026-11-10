import { useEffect, useState } from 'react';
import { supabase } from './supabase';
// 손익계산서(회계 확정 금액) — 국전 수익/비용(실현 수익) 화면의 '손익 요약'이 확정 금액으로 쓰는 값
//   설정: config.key = 'plStmt'
//     { rows: { '<키>': { lv: 1|2, label: '매출액', v: { 'YYYYMM': 금액 } } }, order: ['<키>', …], closedThrough: 'YYYYMM' }
//   · ERP 손익계산서(월별) 엑셀을 [설정 › 손익계산서 올리기] 에서 올리면 저장됩니다. 같은 달을 다시 올리면 덮어씁니다.
//   · closedThrough(마감 완료 월) 이후 달은 올라와 있어도 확정으로 쓰지 않습니다 (마감 전 숫자는 틀릴 수 있음).
export type PlRow = { lv: number; label: string; v: Record<string, number> };
export type PlCfg = { rows: Record<string, PlRow>; order: string[]; closedThrough: string };
export type PlMonth = { sales: number; cogs: number; gp: number; sga: number; op: number; net: number | null };

const KEYS: [keyof PlMonth, RegExp][] = [
  ['sales', /^매출액/], ['cogs', /^매출원가/], ['gp', /^매출총(이익|손)/], ['sga', /^판매비/], ['op', /^영업(이익|손)/], ['net', /^당기순/],
];
/** 그 달의 확정 손익 (마감 완료 월까지만, 영업이익 줄이 있어야 함) */
export function plMonth(cfg: PlCfg | null | undefined, ym: string): PlMonth | null {
  if (!cfg || !cfg.rows || !ym || (cfg.closedThrough && ym > cfg.closedThrough)) return null;
  const out: Record<string, number | null> = {};
  for (const [k, re] of KEYS) {
    const key = cfg.order.find(o => cfg.rows[o] && cfg.rows[o].lv === 1 && re.test(cfg.rows[o].label));
    const v = key ? cfg.rows[key].v[ym] : undefined;
    out[k] = typeof v === 'number' ? v : null;
  }
  if (out.sales == null || out.op == null || out.gp == null || out.sga == null) return null;
  return { sales: out.sales, cogs: out.cogs ?? out.sales - out.gp, gp: out.gp, sga: out.sga, op: out.op, net: out.net };
}
export const plMonths = (cfg: PlCfg | null | undefined) => {
  const s = new Set<string>(); Object.values(cfg?.rows || {}).forEach(r => Object.keys(r.v).forEach(m => s.add(m))); return [...s].sort();
};

let _cfg: Promise<PlCfg | null> | null = null;
export function loadPl(force = false) {
  if (!_cfg || force) _cfg = (async () => {
    const { data } = await supabase.from('config').select('value').eq('key', 'plStmt').maybeSingle();
    const v = (data?.value as PlCfg) || null;
    return v && v.rows && Array.isArray(v.order) ? v : null;
  })();
  return _cfg;
}
export function usePl() {
  const [cfg, setCfg] = useState<PlCfg | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const load = (f: boolean) => loadPl(f).then(v => { if (alive) setCfg(v); });
    load(false);
    const h = () => load(true);
    window.addEventListener('kjhub:plsaved', h);
    return () => { alive = false; window.removeEventListener('kjhub:plsaved', h); };
  }, []);
  return cfg;
}
