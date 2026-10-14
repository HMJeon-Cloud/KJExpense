import { useEffect, useState } from 'react';
import { supabase } from './supabase';
// 본부 비용 배분 (실현 수익 화면 · 운영 지표)
//   수익이 없는 지원 조직(경영전략본부 등)과 연구소의 비용·인원을 수익이 있는 본부로 나눕니다.
//   설정: config.key = 'costAlloc'
//     { byMonth: { 'YYYYMM': { 'hq:<본부>' | 'dept:<부서>': { '<받는 본부>': 비율% } } } }
//   · 기준월별로 저장, 없는 달은 이전에 저장한 가장 가까운 달을 승계 (처음 저장한 달보다 앞선 달은 처음 설정)
//   · 부서 규칙이 있으면 부서 규칙, 없으면 그 부서가 속한 본부 규칙
//   · 비율 합이 100% 미만이면 나머지는 원래 본부에 남음
//   · 수익(실현 수익)은 옮기지 않음 — 비용과 인원만 옮김
export type Rules = Record<string, Record<string, number>>;
export type CostAllocCfg = { byMonth: Record<string, Rules> };

/** 설정을 한 번도 저장하지 않았을 때의 기본 규칙 (회사 기준) */
export const DEFAULT_RULES: Rules = {
  'hq:응용기술연구소': { '소재사업본부': 100 },
  'hq:이노베이션센터': { '소재사업본부': 100 },
  'hq:의약연구소': { 'API합성본부': 100 },
};

export function rulesAt(cfg: CostAllocCfg | null | undefined, ym: string): { rules: Rules; src: string | null } {
  const all = Object.keys(cfg?.byMonth || {}).sort();
  const keys = all.filter(k => k <= ym);
  // 이전에 저장한 달이 없으면(처음 저장한 달보다 앞선 달) 처음 저장한 설정을 그대로 씀
  const k = keys.length ? keys[keys.length - 1] : all[0];
  return k ? { rules: cfg!.byMonth[k], src: k } : { rules: DEFAULT_RULES, src: null };
}

export type DeptIn = { d: string; hq: string; margin: number[]; cost: number[]; empSer?: number[]; emp?: number };
export type HqOut = {
  hq: string; margin: number[]; cost: number[]; emp: number[];
  ownCost: number[]; ownEmp: number[];
  depts: { d: string; margin: number[]; cost: number[]; emp: number[]; gave: number[] }[];
  inFrom: { from: string; cost: number[]; emp: number[] }[];
};

export const ruleFor = (rules: Rules, d: string, hq: string) => rules['dept:' + d] || rules['hq:' + hq] || null;

/** 부서 행(실현 수익·전표 비용·월별 인원)에 배분 규칙을 적용해 본부 행을 만듭니다. */
export function applyHqAlloc(rows: DeptIn[], months: string[], cfg: CostAllocCfg | null | undefined) {
  const z = () => months.map(() => 0);
  const out = new Map<string, HqOut>();
  const get = (hq: string) => { let o = out.get(hq); if (!o) { o = { hq, margin: z(), cost: z(), emp: z(), ownCost: z(), ownEmp: z(), depts: [], inFrom: [] }; out.set(hq, o); } return o; };
  const inMap = new Map<string, { from: string; cost: number[]; emp: number[] }>(); // key = 받는본부|원천
  const away: Record<string, number[]> = {};   // 원천 본부별 내보낸 비용
  const ruleSrc = months.map(m => rulesAt(cfg, m));
  rows.forEach(r => {
    const o = get(r.hq);
    const dept = { d: r.d, margin: r.margin.slice(), cost: z(), emp: z(), gave: z() };
    months.forEach((_, i) => {
      const c = r.cost[i] || 0, e = (r.empSer || [])[i] || 0;
      const rule = ruleFor(ruleSrc[i].rules, r.d, r.hq);
      let gc = 0, ge = 0;
      if (rule) Object.entries(rule).forEach(([t, p]) => {
        if (!p || t === r.hq) return;
        const pc = c * p / 100, pe = e * p / 100; gc += pc; ge += pe;
        const tgt = get(t); tgt.cost[i] += pc; tgt.emp[i] += pe;
        const from = rules0Label(ruleSrc[i].rules, r.d, r.hq);
        const k = t + '|' + from; let f = inMap.get(k); if (!f) { f = { from, cost: z(), emp: z() }; inMap.set(k, f); tgt.inFrom.push(f); }
        f.cost[i] += pc; f.emp[i] += pe;
      });
      dept.cost[i] = c - gc; dept.emp[i] = e - ge; dept.gave[i] = gc;
      o.margin[i] += r.margin[i] || 0; o.cost[i] += c - gc; o.emp[i] += e - ge; o.ownCost[i] += c - gc; o.ownEmp[i] += e - ge;
      if (gc) (away[r.hq] = away[r.hq] || z())[i] += gc;
    });
    o.depts.push(dept);
  });
  const all = [...out.values()];
  const eps = (a: number[]) => a.some(v => Math.abs(v) > 0.5);
  const hqs = all.filter(h => eps(h.margin) || eps(h.cost) || h.emp.some(v => v > 0.01));
  const gone = all.filter(h => !hqs.includes(h)).map(h => h.hq);
  return { hqs, away, gone, ruleSrc: ruleSrc[ruleSrc.length - 1].src };
}
// 받는 본부 쪽에 보여줄 원천 이름: 부서 규칙이면 "본부 · 부서", 본부 규칙이면 본부
function rules0Label(rules: Rules, d: string, hq: string) { return rules['dept:' + d] ? `${hq} · ${d}` : hq; }

// ── 설정 읽기 (화면 공용, 저장하면 'kjhub:costallocsaved' 로 다시 읽음) ──
let _cfg: Promise<CostAllocCfg | null> | null = null;
export function loadCostAlloc(force = false) {
  if (!_cfg || force) _cfg = (async () => {
    const { data } = await supabase.from('config').select('value').eq('key', 'costAlloc').maybeSingle();
    const v = (data?.value as CostAllocCfg) || null;
    return v && v.byMonth ? v : null;
  })();
  return _cfg;
}
export function useCostAlloc() {
  const [cfg, setCfg] = useState<CostAllocCfg | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const load = (f: boolean) => loadCostAlloc(f).then(v => { if (alive) setCfg(v); });
    load(false);
    const h = () => load(true);
    window.addEventListener('kjhub:costallocsaved', h);
    return () => { alive = false; window.removeEventListener('kjhub:costallocsaved', h); };
  }, []);
  return cfg;
}
