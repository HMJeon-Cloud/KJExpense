// 운영 지표 (별도 화면 /ops) — 7가지
//   ① 1인당 판매 이익·비용·손익   ② 재고 회전일수·오래된 재고   ③ 품목·거래처 이익률   ④ 거래처 집중도
//   ⑤ 수입 부대비용률          ⑥ 고정비 대비 수익           ⑦ 환율 영향
//   판매 이익 = 구매·판매의 판매금액 − 원가. 경영전략본부·연구소의 비용·인원은 [본부 비용 배분] 비율로 사업 본부에 나눕니다(①).
//   ①·⑥ 은 판매 이익 화면의 계산 결과로, ②~⑤·⑦ 은 DB 함수 ops_metrics(0008) 결과로 계산합니다.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { accL } from '../lib/acc';
import { supabase } from '../lib/supabase';
import { computeOps, loadOps, loadFixed, isImportVendor, type Ops, type Fixed, type FxBase, type InvLot } from '../lib/opsCalc';
export { isImportVendor };
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

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const pct1 = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
const sgn = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '');
const fmtEmp = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? fmt(v) : (Math.round(v * 10) / 10).toLocaleString('ko-KR'));
const BK = ['0-90', '91-180', '181-365', '365+', '미상'] as const;
const BK_L: Record<string, string> = { '0-90': '90일 이하', '91-180': '91~180일', '181-365': '181~365일', '365+': '1년 넘음', '미상': '입고일 없음' };
const BK_C: Record<string, string> = { '0-90': '#9cc3f5', '91-180': '#f5c26b', '181-365': '#f08a4b', '365+': '#d92d20', '미상': '#cbd5e1' };
const bkOf = (age: number | null) => (age == null ? '미상' : age <= 90 ? '0-90' : age <= 180 ? '91-180' : age <= 365 ? '181-365' : '365+');
// 수량: 소수점 이하 최대 4자리까지 (0.1·0.0005 같은 값이 0 으로 보이지 않게)
const fmtQ = (n: number | null | undefined) => (n == null || isNaN(n) ? '-' : (Math.round(n * 10000) / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 4 }));
const fmtDate = (s: string) => { const d = String(s || '').replace(/[^0-9]/g, ''); return d.length >= 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '-'; };

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
              <i style={{ height: Math.max(1, Math.abs(a[i] || 0) / mx * 100) + '%', background: (a[i] || 0) < 0 ? '#d92d20' : colorA }} />
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

/** 환율 영향 금액 표현: + = 원가 더 듦(손해, 빨강) · − = 덜 듦(이익, 파랑) */
const fxWord = (v: number | null | undefined, f: (n: number) => string = kor) =>
  v == null ? '-' : v > 0 ? f(v) + ' 부담' : v < 0 ? f(-v) + ' 절감' : '0';
function FxAmt({ v, f = fmt }: { v: number | null; f?: (n: number) => string }) {
  return v == null ? <>-</> : <span className={v > 0 ? 'neg' : v < 0 ? 'pos' : 'mut'}>{fxWord(v, f)}</span>;
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
  return <div className="ops-msg">{err ? 'DB 함수가 준비되면 표시됩니다.' : '불러오는 중입니다.'}</div>;
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
  const curL = Number(cur.slice(4)) + '월';

  // ── ① 인당 (판매 이익 · 배분 후 비용 · 배분 후 인원) ──
  const perCap = useMemo(() => {
    // 운영 지표는 구매 · 판매 이익 기준 — 결산 매출(판매 이익 화면에만 더함)은 제외
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
    const rev = (model.series.marginTrade || model.series.margin).slice();   // 회사 전체 판매 이익 (구매 · 판매, 결산 매출 제외)
    const vc = months.map((_, i) => sum(model.deptRows.map(r => (r.vCost || [])[i] || 0)));
    const inRows = new Set(model.deptRows.map(r => r.d));
    const mi: Record<string, number> = {}; months.forEach((m, i) => { mi[m] = i; });
    const fx = months.map(() => 0);
    const accs: Record<string, number> = {};
    (fxd?.rows || []).forEach(([d, ym, a, v]) => { const i = mi[ym]; if (i == null || !inRows.has(d)) return; fx[i] += +v; if (i === ci) accs[a] = (accs[a] || 0) + +v; });
    const accList = Object.entries(accs).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]);
    return { rev, fx, vc, accList, cover: months.map((_, i) => (fx[i] > 0 ? Math.round(rev[i] / fx[i] * 1000) / 10 : null)) };
  }, [model.deptRows, model.series.margin, model.series.marginTrade, months, ci, fxd]);

  // ── DB 묶음 (②③④⑤⑦) — 계산은 lib/opsCalc.ts ──
  const db = useMemo(() => (ops ? computeOps(ops, months, cur, fxBase, unitOf) : null), [ops, months, ci, cur, year, fxBase, hqOf]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const [openMargin, setOpenMargin] = useState<Record<string, boolean>>({});   // ③ 행 펼침 (월별 상세)
  const [openFx, setOpenFx] = useState<Record<string, boolean>>({});           // ⑦ 통화 펼침 (월별 상세)
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
        .ops{display:grid;gap:18px}
        .ops .ops-jump{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px}
        .ops .ops-jump a{display:grid;gap:3px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:11px 12px 10px;color:inherit;text-decoration:none;box-shadow:var(--shadow-xs);min-width:0;transition:border-color .12s}
        .ops .ops-jump a:hover{border-color:var(--blue)}
        .ops .ops-jump span{font-size:11.5px;color:var(--fg-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .ops .ops-jump span i{font-style:normal;font-weight:700;color:var(--blue);margin-right:4px}
        .ops .ops-jump b{font-size:17px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .ops .ops-jump b.neg{color:var(--red-2)}.ops .ops-jump b.pos{color:var(--green-2)}
        .ops .ops-jump small{font-size:11.5px;color:var(--fg-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .ops .ops-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
        .ops .ops-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow-xs);padding:18px 20px;min-width:0;display:grid;gap:14px;align-content:start;scroll-margin-top:calc(var(--top-h) + 12px)}
        .ops .ops-card.wide{grid-column:1 / -1}
        .ops .ops-card h3{margin:0;font-size:15.5px;font-weight:700;display:flex;align-items:center;gap:4px}
        .ops .ops-card h3 .no{display:inline-flex;width:22px;height:22px;border-radius:7px;background:var(--blue-soft);color:var(--blue-2);font-weight:800;font-size:12.5px;align-items:center;justify-content:center;margin-right:5px;font-variant-numeric:tabular-nums}
        .ops .ops-card .lead{margin:-4px 0 0;font-size:13.5px;line-height:1.65;color:var(--fg-2);background:var(--surface-2);border-radius:9px;padding:10px 13px}
        .ops .ops-card .lead b{color:var(--fg)}
        .ops .ops-kpis{display:flex;flex-wrap:wrap;gap:10px 28px}
        .ops .ops-kpi{display:grid;gap:2px;min-width:0}
        .ops .ops-kpi span{font-size:12px;color:var(--fg-3)}
        .ops .ops-kpi b{font-size:21px;font-weight:800;line-height:1.2;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
        .ops .ops-kpi b.neg{color:var(--red-2)}.ops .ops-kpi b.pos{color:var(--green-2)}
        .ops .ops-kpi small{font-size:12px;color:var(--fg-3)}
        .ops table{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
        .ops th{font-weight:600;color:var(--fg-3);font-size:12px;text-align:right;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap;background:var(--surface-2)}
        .ops th:first-child,.ops td:first-child{text-align:left}
        .ops td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .ops td:first-child{font-weight:600;max-width:260px;overflow:hidden;text-overflow:ellipsis}
        .ops tr.tot td{font-weight:700;background:var(--surface-2)}
        .ops tr.clk{cursor:pointer}.ops tr.clk:hover td{background:var(--surface-2)}
        .ops tr.l2 td{background:#fafbfd}.ops tr.l2 td:first-child{padding-left:26px;font-weight:600}
        .ops tr.l3 td{background:#f5f7fb;color:var(--fg-2)}.ops tr.l3 td:first-child{padding-left:44px;font-weight:400}
        .ops tr.l2m td,.ops tr.l3m td{background:#fafbfd;text-align:left;padding:4px 6px 8px 26px}.ops tr.l3m td{padding-left:44px;background:#f5f7fb}
        .ops tr.inrow td{color:var(--amber-2);background:#fffbea;font-weight:400;font-size:12.5px}.ops tr.inrow td:first-child{padding-left:26px;font-weight:400}
        .ops .caret{display:inline-block;width:16px;color:var(--fg-3);font-size:11px}
        .ops tr.warn td{background:#fff6f5}
        .ops .neg{color:var(--red-2)}.ops .pos{color:var(--green-2)}.ops .mut{color:var(--fg-3)}
        .ops .ops-stack{display:flex;height:14px;border-radius:999px;overflow:hidden;background:var(--surface-3);gap:2px}
        .ops .ops-stack i{display:block;height:100%}
        .ops .ops-lg{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px;color:var(--fg-2)}
        .ops .ops-lg span i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
        .ops .ops-mb-lg{display:flex;gap:14px;font-size:12px;color:var(--fg-3);margin-bottom:6px;flex-wrap:wrap}.ops .ops-mb-lg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
        .ops .ops-mb-row{display:flex;gap:4px;align-items:flex-end}
        .ops .ops-mb-col{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center}
        .ops .ops-mb-bars{height:72px;width:100%;display:flex;gap:2px;align-items:flex-end;justify-content:center;border-bottom:1px solid var(--line-2)}
        .ops .ops-mb-bars i{display:block;flex:1;max-width:20px;border-radius:4px 4px 0 0}
        .ops .ops-mb-col small{font-size:11px;color:var(--fg-3);margin-top:4px}.ops .ops-mb-col small.on{color:var(--fg);font-weight:700}
        .ops .ops-mb-col b{font-size:11px;font-weight:600;color:var(--fg-2);white-space:nowrap;font-variant-numeric:tabular-nums}
        .ops .ops-note{font-size:12.5px;color:var(--fg-3);line-height:1.6}
        .ops .ops-alert{display:flex;flex-wrap:wrap;gap:6px}
        .ops .ops-alert span{font-size:12px;font-weight:600;background:var(--red-soft);color:var(--red-2);border-radius:999px;padding:2px 10px}
        .ops .ops-rk{display:grid;grid-template-columns:22px minmax(0,1fr) 108px 58px 58px;gap:8px;align-items:center;font-size:13px;padding:5px 0}
        .ops .ops-rk .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
        .ops .ops-rk>span:nth-child(n+3){text-align:right;font-variant-numeric:tabular-nums}
        .ops .ops-msg{padding:16px;border:1px dashed var(--line-2);border-radius:10px;font-size:13.5px;color:var(--fg-2);background:var(--surface-2)}
        .ops .ops-more{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
        .ops .ops-gap{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;border-top:1px dashed var(--line-2);padding-top:12px}.ops .ops-gap>.btn{white-space:normal;text-align:left;justify-content:flex-start;height:auto}
        .ops .fxin{width:90px;padding:4px 7px;font-size:13px;text-align:right}
        @media (max-width:1280px){.ops .ops-jump{grid-template-columns:repeat(4,minmax(0,1fr))}}
        @media (max-width:1000px){.ops .ops-grid{grid-template-columns:1fr}}
        @media (max-width:820px){.ops .ops-jump{grid-template-columns:repeat(2,minmax(0,1fr))}.ops .ops-card{padding:15px 13px}.ops .ops-kpi b{font-size:18px}.ops .ops-mb-col b{display:none}.ops .ops-rk{grid-template-columns:18px minmax(0,1fr) 88px 48px}.ops .ops-rk>:nth-child(5){display:none}.ops .tbl-wrap td:first-child,.ops .tbl-wrap th:first-child{position:sticky;left:0;z-index:1;background:var(--surface);max-width:140px;box-shadow:1px 0 0 var(--line)}.ops .tbl-wrap th:first-child{background:var(--surface-2)}.ops tr.tot td:first-child{background:var(--surface-2)}.ops tr.warn td:first-child{background:#fff6f5}.ops tr.l2 td:first-child,.ops tr.inrow td:first-child{background:#fafbfd}.ops tr.l3 td:first-child{background:#f5f7fb}}
      `}</style>
      {err && <div className="ops-msg">{err === 'NOFN' ? '② ~ ⑤ · ⑦ 은 DB 함수가 필요합니다. 관리자가 Supabase SQL Editor 에서 0006 → 0008 파일을 실행하면 표시됩니다.' : '운영 지표를 불러오지 못했습니다: ' + err}</div>}
      {(() => {
        const totS = db ? db.salesM[ci] : 0, totC = db ? db.cogsM[ci] : 0;
        const rNow = db && totS > 0 ? (totS - totC) / totS * 100 : null;
        const nAlert = db ? db.byItem.filter(x => x.alert).length : 0;
        const oldShare = db && db.invTotal > 0 ? pct1(db.old180, db.invTotal) : null;
        const hasCo = !!db && db.fxList.some(x => x.co);
        const cv = fxd?.configured ? fixed.cover[ci] : null;
        const J = ({ n, l, v, s, tone }: { n: number; l: string; v: string; s?: string; tone?: 'neg' | 'pos' }) => (
          <a href={'#ops-' + n} onClick={e => { e.preventDefault(); document.getElementById('ops-' + n)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
            <span><i>{n}</i>{l}</span><b className={tone || ''}>{v}</b><small>{s || '\u00a0'}</small>
          </a>);
        return (
          <nav className="ops-jump" aria-label="지표 바로가기">
            <J n={1} l="1인당 손익" v={perCap.total.pn == null ? '-' : sgn(perCap.total.pn) + kor(Math.abs(perCap.total.pn))} tone={perCap.total.pn == null ? undefined : perCap.total.pn >= 0 ? 'pos' : 'neg'} s={perCap.hasEmp ? `인원 ${fmtEmp(perCap.total.emp)}명` : '인원 데이터 없음'} />
            <J n={2} l="재고 회전일수" v={db?.turnDays == null ? '-' : db.turnDays + '일'} tone={db?.turnDays != null && db.turnDays > 180 ? 'neg' : undefined} s={oldShare == null ? undefined : `6개월 넘은 재고 ${oldShare}%`} />
            <J n={3} l="이익률" v={rNow == null ? '-' : rNow.toFixed(1) + '%'} s={db ? (nAlert ? `떨어진 품목 ${nAlert}개` : '크게 떨어진 품목 없음') : undefined} />
            <J n={4} l="상위 5곳 매출 비중" v={db?.top5 == null ? '-' : db.top5.toFixed(1) + '%'} tone={db?.top5 != null && db.top5 >= 70 ? 'neg' : undefined} s={db?.top1 == null ? undefined : `1위 ${db.top1.toFixed(1)}%`} />
            <J n={5} l="수입 부대비용률" v={db?.rateM[ci] == null ? '-' : db.rateM[ci] + '%'} s="구매 금액 대비" />
            <J n={6} l="고정비 대비 판매 이익" v={cv == null ? '-' : cv + '%'} tone={cv == null ? undefined : cv >= 100 ? 'pos' : 'neg'} s={fxd && !fxd.configured ? '기준 없음' : '100% 넘으면 고정비 충당'} />
            <J n={7} l={`환율 영향 (${year} 누적)`} v={hasCo ? fxWord(db!.coYtd) : '-'} tone={hasCo ? (db!.coYtd > 0 ? 'neg' : db!.coYtd < 0 ? 'pos' : undefined) : undefined} s={hasCo ? '회사 기준 환율 대비' : '기준 환율 미입력'} />
          </nav>);
      })()}
      <div className="ops-grid">

        {/* ① 인당 */}
        <div id="ops-1" className="ops-card wide">
          <h3><span className="no">1</span>1인당 판매 이익 · 비용 · 손익<HelpDot id="ops.percap" /></h3>
          <p className="lead">{perCap.total.pn == null ? '' : <><b>{curL} 1명당 {kor(perCap.total.pm || 0)}을 벌고 {kor(perCap.total.pc || 0)}을 썼습니다.</b> </>}경영전략본부·연구소의 비용과 인원은 [본부 비용 배분] 비율로 사업 본부에 나눴습니다{perCap.ruleSrc ? ` (${ymL(perCap.ruleSrc)} 설정)` : ' (기본 규칙)'}. 본부를 누르면 받은 몫이 보입니다.</p>
          {!perCap.hasEmp ? <div className="ops-msg">기간 안에 [월/부서별 인원] 데이터가 없습니다.</div> : <>
            <div className="ops-kpis">
              <Kpi l={`${curL} 인원`} v={fmtEmp(perCap.total.emp) + '명'} s={`기간 입사 ${perCap.total.inn} · 퇴사 ${perCap.total.out} · 기간 초 ${fmtEmp(perCap.total.empStart)}명`} />
              <Kpi l="1인당 판매 이익" v={perCap.total.pm == null ? '-' : kor(perCap.total.pm)} />
              <Kpi l="1인당 비용" v={perCap.total.pc == null ? '-' : kor(perCap.total.pc)} />
              <Kpi l="1인당 손익" v={perCap.total.pn == null ? '-' : sgn(perCap.total.pn) + kor(Math.abs(perCap.total.pn))} tone={perCap.total.pn == null ? undefined : perCap.total.pn >= 0 ? 'pos' : 'neg'} s={perCap.total.avgN == null ? undefined : `기간 월평균 ${sgn(perCap.total.avgN)}${kor(Math.abs(perCap.total.avgN))}`} />
            </div>
            <div className="tbl-wrap"><table>
              <thead><tr><th>본부</th><th>인원 (배분 포함)</th><th>입사 · 퇴사</th><th>1인당 판매 이익</th><th>1인당 비용</th><th>1인당 손익</th><th>기간 월평균 손익</th><th style={{ width: 130 }}>1인당 손익 추이</th></tr></thead>
              <tbody>
                {perCap.rows.map(r => {
                  const op = !!openCap[r.name];
                  return [
                    <tr key={r.name} className={r.inFrom.length ? 'clk' : ''} onClick={() => r.inFrom.length && setOpenCap(o => ({ ...o, [r.name]: !o[r.name] }))}>
                      <td>{r.inFrom.length ? <span className="caret">{op ? '▾' : '▸'}</span> : <span className="caret" />}{r.name}</td><td>{fmtEmp(r.emp)}</td><td className="mut">{r.inn || r.out ? `+${r.inn} / −${r.out}` : '-'}</td>
                      <td title={r.emp ? undefined : `인원 없음 · 판매 이익 ${fmt(r.mCur)}원`}>{r.pm == null ? (r.mCur ? <span className="mut">인원 없음 ({kor(r.mCur)})</span> : '-') : fmt(r.pm)}</td><td>{r.pc == null ? '-' : fmt(r.pc)}</td>
                      <td className={r.pn == null ? '' : r.pn >= 0 ? 'pos' : 'neg'}>{r.pn == null ? '-' : fmt(r.pn)}</td>
                      <td className={r.avgN == null ? '' : r.avgN >= 0 ? 'pos' : 'neg'}>{r.avgN == null ? '-' : fmt(r.avgN)}</td>
                      <td><Line vals={r.line} color={(r.pn ?? 0) >= 0 ? '#167a3a' : '#d92d20'} /></td>
                    </tr>,
                    ...(op ? r.inFrom.map(f => <tr key={r.name + '|' + f.from} className="inrow"><td>← {f.from}에서 받음</td><td>{fmtEmp(f.emp)}</td><td /><td>-</td><td className="mut" title="이 본부가 받은 비용 (기준월)">{fmt(f.cost)}원</td><td colSpan={3} className="mut" style={{ textAlign: 'left' }}>위 인원·인당 비용에 포함됨</td></tr>) : []),
                  ];
                })}
                <tr className="tot"><td>전체</td><td>{fmtEmp(perCap.total.emp)}</td><td className="mut">{perCap.total.inn || perCap.total.out ? `+${perCap.total.inn} / −${perCap.total.out}` : '-'}</td><td>{perCap.total.pm == null ? '-' : fmt(perCap.total.pm)}</td><td>{perCap.total.pc == null ? '-' : fmt(perCap.total.pc)}</td><td className={(perCap.total.pn ?? 0) >= 0 ? 'pos' : 'neg'}>{perCap.total.pn == null ? '-' : fmt(perCap.total.pn)}</td><td>{perCap.total.avgN == null ? '-' : fmt(perCap.total.avgN)}</td><td><Line vals={perCap.total.line} color="#64748b" /></td></tr>
              </tbody>
            </table></div>
            {perCap.gone.length > 0 && <div className="ops-note">배분으로 비용·인원이 모두 넘어가 표에서 빠진 조직: {perCap.gone.join(', ')}{isAdmin && <button className="btn sm ghost" style={{ marginLeft: 6, padding: '1px 8px' }} onClick={() => nav('/settings/cost-alloc')}>본부 비용 배분 →</button>}</div>}
          </>}
        </div>

        {/* ② 재고 */}
        <div id="ops-2" className="ops-card wide">
          <h3><span className="no">2</span>재고 회전일수 · 오래된 재고<HelpDot id="ops.stock" /></h3>
          {!db ? <Loading err={err} /> : <>
            <p className="lead">{db.turnDays == null ? '최근 3개월 매출원가가 없어 회전일수를 계산할 수 없습니다.' : `지금 재고는 약 ${db.turnDays}일 치 판매량입니다.`} {db.invTotal > 0 ? `입고 후 180일 넘은 재고가 ${kor(db.old180)}(${pct1(db.old180, db.invTotal)}%) 입니다.` : ''} {ops?.invSrc === 'erp' ? '재고는 [LOT별 재고] 업로드(ERP 재고) 기준입니다.' : '[LOT별 재고] 업로드가 없어 구매 − 판매 − 폐기 − 생산 투입으로 계산한 재고입니다.'} 본부 → 품목 → LOT 순서로 눌러서 펼칩니다.</p>
            <div className="ops-kpis">
              <Kpi l={ops?.invSrc === 'erp' ? '재고 금액 (ERP · LOT별 재고)' : '재고 금액 (계산값)'} v={kor(db.invTotal)} />
              <Kpi l="월평균 매출원가 (최근 3개월)" v={kor(db.avgCogs)} />
              <Kpi l="재고 회전일수" v={db.turnDays == null ? '-' : db.turnDays + '일'} tone={db.turnDays != null && db.turnDays > 180 ? 'neg' : undefined} />
            </div>
            {db.invTotal > 0 && <>
              <div className="ops-stack">{BK.map(k => db.byBk[k]?.amt ? <i key={k} title={`${BK_L[k]} ${fmt(db.byBk[k].amt)}원`} style={{ width: db.byBk[k].amt / db.invTotal * 100 + '%', background: BK_C[k] }} /> : null)}</div>
              <div className="ops-lg">{BK.map(k => db.byBk[k]?.amt ? <span key={k}><i style={{ background: BK_C[k] }} />{BK_L[k]} {kor(db.byBk[k].amt)} · {db.byBk[k].n} LOT</span> : null)}</div>
              <div className="tbl-wrap"><table>
                <thead><tr><th>본부 › 품목 › LOT</th><th>LOT 수 · 수량</th><th>재고 금액</th><th>90일 이하</th><th>91~180일</th><th>181일 이상</th><th>가장 오래된 경과일 · 입고일</th><th>마지막 판매</th></tr></thead>
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
                          <tr key={k + '|' + l[3] + '|' + i} className="l3"><td>LOT {l[3]}</td><td className="mut">수량 {fmtQ(l[6])}</td><td>{fmt(l[7])}</td><td colSpan={3} style={{ textAlign: 'center' }}><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: BK_C[bkOf(l[8])], marginRight: 5 }} />{BK_L[bkOf(l[8])]}</td><td className={(l[8] ?? 0) > 180 ? 'neg' : ''}>{l[8] == null ? '-' : l[8] + '일'} · {fmtDate(l[4])}</td><td className="mut">{l[5] ? fmtDate(l[5]) : <span title="이 LOT 은 판매 내역이 아직 없습니다 (구매·생산입고만 있는 재고)">판매 없음</span>}</td></tr>
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
                <button className="btn sm ghost" onClick={() => setShowGap(v => !v)}>{showGap ? '▾' : '▸'} 점검: 구매 · 판매 계산 재고와 ERP 재고가 다른 LOT {fmt(ops.invGapN || 0)}건 (계산이 {kor(Math.abs(ops.invGapAmt || 0))} {(ops.invGapAmt || 0) >= 0 ? '많음' : '적음'})</button>
                {showGap && <>
                  <div className="ops-note">구매 · 판매 화면의 재고 평가액은 계산값이라 아래 LOT 들 때문에 ERP 재고와 달라집니다. 대개 판매·폐기·생산 투입이 다른 품번이나 다른 LOT 번호로 적혀 있거나, 해당 데이터가 업로드되지 않은 경우입니다. LOT 을 누르면 [데이터 점검 › LOT 추적]에서 관련 행을 모두 봅니다.</div>
                  <div className="tbl-wrap"><table>
                    <thead><tr><th>LOT</th><th>품목</th><th>{'본부'}</th><th>계산 수량</th><th>ERP 수량</th><th>차이 수량</th><th>계산 금액</th><th>ERP 금액</th></tr></thead>
                    <tbody>{(ops.invGap || []).slice(0, nGap).map((g, i) => (
                      <tr key={g[2] + g[1] + i} className={isAdmin ? 'clk' : ''} onClick={() => isAdmin && nav('/settings/verify?lot=' + encodeURIComponent(g[2]))}>
                        <td>{g[2]}</td><td className="mut" style={{ fontFamily: 'var(--font-body)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={g[1]}>{g[1]}</td><td className="mut" style={{ fontFamily: 'var(--font-body)' }}>{unitOf(g[0])}</td>
                        <td>{fmtQ(g[3])}</td><td>{fmtQ(g[4])}</td><td className={g[3] - g[4] > 0 ? 'neg' : 'pos'}>{sgn(g[3] - g[4])}{fmtQ(Math.abs(g[3] - g[4]))}</td><td>{fmt(g[5])}</td><td className="mut">{fmt(g[6])}</td>
                      </tr>))}</tbody>
                  </table></div>
                  <More n={Math.min(nGap, (ops.invGap || []).length)} total={(ops.invGap || []).length} step={15} set={setNGap} unit=" LOT" />
                  {(ops.invGapN || 0) > (ops.invGap || []).length && <div className="ops-note">차이가 큰 순서로 {(ops.invGap || []).length}건만 보입니다.</div>}
                </>}
              </div>
            )}
          </>}
        </div>

        {/* ③ 이익률 */}
        <div id="ops-3" className="ops-card wide">
          <h3><span className="no">3</span>품목 · 거래처별 이익률<HelpDot id="ops.margin" /></h3>
          {!db ? <Loading err={err} /> : (() => {
            const list = (mTab === 'item' ? db.byItem : db.byCust).filter(x => x.sCur !== 0 || x.alert).sort((a, b) => Number(b.alert) - Number(a.alert) || b.sCur - a.sCur);
            const alerts = list.filter(x => x.alert);
            const totS = db.salesM[ci], totC = db.cogsM[ci];
            const pS = sum(db.salesM.slice(0, -1)), pC = sum(db.cogsM.slice(0, -1));
            const rNow = totS > 0 ? (totS - totC) / totS * 100 : null, rPrev = pS > 0 ? (pS - pC) / pS * 100 : null;
            return <>
              <p className="lead">{rNow == null ? `${curL} 판매가 없습니다.` : `${curL} 전체 이익률 ${rNow.toFixed(1)}%${rPrev != null ? ` (이전 ${prevMonths.length}개월 ${rPrev.toFixed(1)}%, ${sgn(rNow - rPrev)}${Math.abs(rNow - rPrev).toFixed(1)}%p)` : ''}.`} {alerts.length ? `이익률이 평소보다 5%p 넘게 떨어진 ${mTab === 'item' ? '품목' : '거래처'} ${alerts.length}곳을 맨 위에 표시했습니다.` : '평소보다 크게 떨어진 곳은 없습니다.'}</p>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="seg"><button className={mTab === 'item' ? 'on' : ''} onClick={() => { setMTab('item'); setNMargin(15); setOpenMargin({}); }}>품목별</button><button className={mTab === 'cust' ? 'on' : ''} onClick={() => { setMTab('cust'); setNMargin(15); setOpenMargin({}); }}>거래처별</button></span>
                {alerts.length > 0 && <div className="ops-alert">{alerts.slice(0, 6).map(a => <span key={a.k}>▼ {a.k.replace(/ \([^)]*\)$/, '')} {a.diff!.toFixed(1)}%p</span>)}</div>}
              </div>
              <div className="tbl-wrap"><table>
                <thead><tr><th>{mTab === 'item' ? '품목' : '거래처'}</th><th>{curL} 매출</th><th>매출 비중</th><th>{curL} 판매 이익</th><th>{curL} 이익률</th><th>이전 {prevMonths.length}개월 이익률</th><th>변화</th><th style={{ width: 130 }}>월별 이익률</th></tr></thead>
                <tbody>{list.slice(0, nMargin).flatMap(x => {
                  const open = !!openMargin[x.k];
                  const rows = [
                    <tr key={x.k} className={(x.alert ? 'warn ' : '') + 'clk'} onClick={() => setOpenMargin(o => ({ ...o, [x.k]: !o[x.k] }))} title="누르면 월별 상세가 펼쳐집니다">
                      <td title={x.k}><span className="caret">{open ? '▾' : '▸'}</span>{x.k}</td><td>{fmt(x.sCur)}</td><td className="mut">{x.share.toFixed(1)}%</td><td className={x.mCur < 0 ? 'neg' : ''}>{fmt(x.mCur)}</td>
                      <td>{x.curR == null ? '-' : x.curR.toFixed(1) + '%'}</td><td className="mut">{x.base == null ? '-' : x.base.toFixed(1) + '%'}</td>
                      <td className={x.diff == null ? '' : x.diff < 0 ? 'neg' : 'pos'}>{x.diff == null ? '-' : sgn(x.diff) + Math.abs(x.diff).toFixed(1) + '%p'}</td>
                      <td><Line vals={x.rate} color={x.alert ? '#d92d20' : C.margin} /></td>
                    </tr>,
                  ];
                  if (open) rows.push(
                    <tr key={x.k + '|d'} className="l3"><td colSpan={8} style={{ padding: '8px 10px' }}>
                      <div className="ops-note" style={{ marginBottom: 4 }}>{x.k} — 월별 매출·원가·이익률 (판매 발행월 기준)</div>
                      <MonthBars months={months} a={x.s.map(v => v || null)} b={x.c.map(v => v || null)} aLbl="매출" bLbl="원가" />
                      <div className="tbl-wrap" style={{ marginTop: 6 }}><table>
                        <thead><tr><th></th>{months.map(m => <th key={m} style={{ textAlign: 'right' }}>{ymL(m)}</th>)}</tr></thead>
                        <tbody>
                          <tr><td className="mut">매출</td>{months.map((m, i) => <td key={m} style={{ textAlign: 'right' }}>{x.s[i] ? fmt(x.s[i]) : '-'}</td>)}</tr>
                          <tr><td className="mut">원가</td>{months.map((m, i) => <td key={m} style={{ textAlign: 'right' }}>{x.c[i] ? fmt(x.c[i]) : '-'}</td>)}</tr>
                          <tr><td className="mut">판매 이익</td>{months.map((m, i) => <td key={m} style={{ textAlign: 'right' }} className={x.s[i] - x.c[i] < 0 ? 'neg' : ''}>{x.s[i] || x.c[i] ? fmt(x.s[i] - x.c[i]) : '-'}</td>)}</tr>
                          <tr><td className="mut">이익률</td>{months.map((m, i) => <td key={m} style={{ textAlign: 'right' }} className={x.rate[i] != null && x.rate[i]! < 0 ? 'neg' : ''}>{x.rate[i] == null ? '-' : x.rate[i]!.toFixed(1) + '%'}</td>)}</tr>
                        </tbody>
                      </table></div>
                    </td></tr>
                  );
                  return rows;
                })}</tbody>
              </table></div>
              <More n={Math.min(nMargin, list.length)} total={list.length} step={15} set={setNMargin} />
            </>;
          })()}
        </div>

        {/* ④ 거래처 집중도 */}
        <div id="ops-4" className="ops-card">
          <h3><span className="no">4</span>거래처 집중도<HelpDot id="ops.conc" /></h3>
          {!db ? <Loading err={err} /> : <>
            <p className="lead">{db.top5 == null ? `${curL} 판매가 없습니다.` : `${curL} 매출의 ${db.top5.toFixed(1)}%가 상위 5개 거래처에서 나왔습니다. 가장 큰 한 곳이 ${db.top1!.toFixed(1)}% 입니다.`}</p>
            <div className="ops-kpis">
              <Kpi l="상위 5곳 비중" v={db.top5 == null ? '-' : db.top5.toFixed(1) + '%'} tone={db.top5 != null && db.top5 >= 70 ? 'neg' : undefined} />
              <Kpi l="1위 비중" v={db.top1 == null ? '-' : db.top1.toFixed(1) + '%'} tone={db.top1 != null && db.top1 >= 30 ? 'neg' : undefined} />
              <Kpi l={`${curL} 거래한 곳`} v={db.custCur.length + '곳'} />
              <div className="ops-kpi"><span>상위 5곳 비중 추이</span><Line vals={db.top5Line} color={C.margin} w={140} h={34} /></div>
            </div>
            <div>
              <ListHead cls="ops-rk" cols={['', '거래처', `>${curL} 매출`, '>비중', '>누적']} />
              {(() => { let acc = 0; return db.custCur.slice(0, nCust).map((x, i) => { acc += x.sCur; return <div key={x.k} className="ops-rk"><span className="help">{i + 1}</span><span className="nm" title={x.k}>{x.k}</span><span>{fmt(x.sCur)}</span><span>{(x.sCur / db.custCurTot * 100).toFixed(1)}%</span><span className="mut">{(acc / db.custCurTot * 100).toFixed(0)}%</span></div>; }); })()}
              <More n={Math.min(nCust, db.custCur.length)} total={db.custCur.length} step={10} set={setNCust} unit="곳" />
            </div>
          </>}
        </div>

        {/* ⑤ 부대비용률 */}
        <div id="ops-5" className="ops-card">
          <h3><span className="no">5</span>수입 부대비용률<HelpDot id="ops.landed" /></h3>
          {!db ? <Loading err={err} /> : (() => {
            const rc = db.rateM[ci]; const ps = sum(db.pM), as = sum(db.aM); const avg = ps > 0 ? Math.round(as / ps * 1000) / 10 : null;
            return <>
              <p className="lead">{rc == null ? `${curL} 수입업체 입고분이 없습니다.` : `${curL} 수입 입고분의 부대비용은 구매 금액의 ${rc}% 입니다${avg != null ? ` (기간 평균 ${avg}%)` : ''}.`} 수입처 코드가 3으로 시작하는 업체만 봅니다{db.otherVendors ? ` (국내 업체 ${db.otherVendors}곳 제외)` : ''}.</p>
              <div className="ops-kpis">
                <Kpi l={`${curL} 부대비용률`} v={rc == null ? '-' : rc + '%'} tone={rc != null && avg != null && rc > avg * 1.2 ? 'neg' : undefined} />
                <Kpi l={`${curL} 부대비용`} v={kor(db.aM[ci])} s={`수입 구매 ${kor(db.pM[ci])}`} />
                <Kpi l="기간 평균" v={avg == null ? '-' : avg + '%'} />
              </div>
              <MonthBars months={months} a={db.rateM} aLbl="부대비용률(%)" fmtV={v => v.toFixed(1)} colorA={C.margin} />
              <div className="tbl-wrap"><table>
                <thead><tr><th>수입처 (기간)</th><th>구매 금액</th><th>부대비용</th><th>비율</th></tr></thead>
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
        <div id="ops-6" className="ops-card wide">
          <h3><span className="no">6</span>고정비 대비 판매 이익<HelpDot id="ops.fixed" /></h3>
          {fxErr ? <div className="ops-msg">{fxErr === 'NOFN' ? '고정비 계산 DB 함수가 필요합니다. 관리자가 Supabase SQL Editor 에서 0009_fixed_cost.sql 을 실행하면 표시됩니다.' : '고정비를 불러오지 못했습니다: ' + fxErr}</div>
            : !fxd ? <Loading err={null} />
            : !fxd.configured ? <div className="ops-msg">아직 고정비 기준이 정해지지 않았습니다. {isAdmin ? <>관리자가 <button className="btn sm" onClick={() => nav('/settings/fixed')}>고정비 기준 →</button> 에서 계정·적요를 고르면 표시됩니다.</> : '관리자가 [고정비 기준]을 정하면 표시됩니다.'}</div>
            : (() => {
              const c = fixed.cover[ci], gap = fixed.rev[ci] - fixed.fx[ci];
              return <>
                <p className="lead">{fixed.fx[ci] > 0 ? (gap >= 0 ? `${curL} 판매 이익이 고정비를 ${c}% 덮었습니다. 고정비를 내고 ${kor(gap)} 남았습니다.` : `${curL} 판매 이익이 고정비의 ${c}% 입니다. 고정비만으로 ${kor(-gap)} 모자랍니다.`) : '기준월 고정비가 없습니다.'}</p>
                <div className="ops-kpis">
                  <Kpi l="고정비 커버율" v={c == null ? '-' : c + '%'} tone={c == null ? undefined : c >= 100 ? 'pos' : 'neg'} s="판매 이익 ÷ 고정비" />
                  <Kpi l={`${curL} 고정비`} v={kor(fixed.fx[ci])} s={`전표 비용의 ${pct1(fixed.fx[ci], fixed.vc[ci]) ?? '-'}%`} />
                  <Kpi l="판매 이익 − 고정비" v={sgn(gap) + kor(Math.abs(gap))} tone={gap >= 0 ? 'pos' : 'neg'} />
                </div>
                <MonthBars months={months} a={fixed.rev} b={fixed.fx} aLbl="판매 이익" bLbl="고정비" />
                {fixed.accList.length > 0 && <div>
                  <ListHead cls="ops-rk" cols={['', `${curL} 고정비 계정`, '>금액', '>비중', '']} />
                  {fixed.accList.slice(0, nFixed).map(([a, v], i) => <div key={a} className="ops-rk"><span className="help">{i + 1}</span><span className="nm" title={a}>{accL(a)}</span><span>{fmt(v)}</span><span className="mut">{pct1(v, fixed.fx[ci]) ?? '-'}%</span><span /></div>)}
                  <More n={Math.min(nFixed, fixed.accList.length)} total={fixed.accList.length} step={8} set={setNFixed} />
                </div>}
                {isAdmin && <div className="ops-note">고정비로 보는 계정은 [고정비 기준]에서 정합니다. <button className="btn sm ghost" style={{ padding: '1px 8px' }} onClick={() => nav('/settings/fixed')}>바꾸기 →</button></div>}
              </>;
            })()}
        </div>

        {/* ⑦ 환율 */}
        <div id="ops-7" className="ops-card wide">
          <h3><span className="no">7</span>환율 영향<HelpDot id="ops.fx" /></h3>
          {!db ? <Loading err={err} /> : !db.fxList.length ? <div className="ops-msg">기간 안에 외화 구매가 없거나, 구매 데이터에 통화(CURRNAME)·단가(PRICE)·환율(EXRATE) 열이 없습니다.</div> : <>
            <p className="lead">{db.fxList.some(x => x.co) ? `${year}년 회사 기준 환율과 비교하면 ${curL} 외화 구매 원가를 ${kor(Math.abs(db.coImpact))} ${db.coImpact > 0 ? '더 부담해 손해' : db.coImpact < 0 ? '아껴 이익' : '차이 없이'}, 올해 누적으로는 ${kor(Math.abs(db.coYtd))} ${db.coYtd > 0 ? '손해' : '이익'}입니다.` : `${year}년 회사 기준 환율이 아직 없습니다. ${isAdmin ? '아래 "기준 환율 입력"에서 넣어 주세요.' : ''}`} 부담(빨강) = 기준보다 비싸게 사서 손해, 절감(초록) = 싸게 사서 이익. 통화 행을 누르면 월별 상세가 펼쳐집니다.</p>
            <div className="ops-kpis">
              <Kpi l={`회사 기준 대비 (${curL})`} v={db.fxList.some(x => x.co) ? fxWord(db.coImpact) : '-'} tone={db.coImpact > 0 ? 'neg' : db.coImpact < 0 ? 'pos' : undefined} s={db.coImpact > 0 ? '기준보다 비싸게 삼 → 손해' : db.coImpact < 0 ? '기준보다 싸게 삼 → 이익' : undefined} />
              <Kpi l={`회사 기준 대비 (${year}년 누적)`} v={db.fxList.some(x => x.co) ? fxWord(db.coYtd) : '-'} tone={db.coYtd > 0 ? 'neg' : db.coYtd < 0 ? 'pos' : undefined} s={(db.coYtd > 0 ? '손해' : db.coYtd < 0 ? '이익' : '') + (db.ymsYear.length ? ` · ${ymL(db.ymsYear[0])} ~ ${curL}` : '')} />
            </div>
            <div className="tbl-wrap"><table>
              <thead><tr><th>통화</th><th>{curL} 외화 구매</th><th>{curL} 평균 환율</th><th>회사 기준 ({year})</th><th>기준 대비 영향</th><th>{year} 평균 · 누적 영향</th><th style={{ width: 110 }}>월별 평균 환율</th></tr></thead>
              <tbody>{db.fxList.flatMap(x => {
                const open = !!openFx[x.c];
                const rows = [
                  <tr key={x.c} className="clk" onClick={() => setOpenFx(o => ({ ...o, [x.c]: !o[x.c] }))} title="누르면 월별 상세가 펼쳐집니다">
                    <td><span className="caret">{open ? '▾' : '▸'}</span>{x.c}</td><td>{fmt(x.fCur)}</td><td>{x.rc == null ? '-' : x.rc.toFixed(2)}</td>
                    <td>{x.co ? fmt(x.co) : <span className="mut">미입력</span>}</td>
                    <td><FxAmt v={x.coImpact} /></td>
                    <td><span className="mut">{x.yAvg == null ? '-' : x.yAvg.toFixed(2)}</span>{x.coYtd != null ? <> · <FxAmt v={x.coYtd} f={kor} /></> : null}</td>
                    <td><Line vals={x.rate} color={C.margin} w={100} /></td>
                  </tr>,
                ];
                if (open) rows.push(
                  <tr key={x.c + '|d'} className="l3"><td colSpan={7} style={{ padding: '8px 10px' }}>
                    <div className="ops-mb-lg"><span>{x.c} 월별 상세 — 입고월 기준 · 올해는 1월부터, 지난해는 조회 기간만</span><span><i style={{ background: '#d92d20' }} />부담 = 손해</span><span><i style={{ background: '#167a3a' }} />절감 = 이익</span></div>
                    <div className="tbl-wrap"><table>
                      <thead><tr><th>월</th><th>외화 구매</th><th>원화 금액</th><th>평균 환율</th><th>회사 기준 {x.co ? `(${fmt(x.co)})` : ''} 대비</th><th>올해 누적 (1월~그 달)</th></tr></thead>
                      <tbody>{x.monthly.map(m => (
                        <tr key={m.ym} className={m.ym === cur ? 'tot' : ''}>
                          <td>{ymL(m.ym)}</td><td>{fmt(m.f)}</td><td>{fmt(m.w)}</td><td>{m.r == null ? '-' : m.r.toFixed(2)}</td>
                          <td><FxAmt v={m.coImp} /></td>
                          <td>{m.ym.slice(0, 4) === year ? <FxAmt v={m.cum} /> : <span className="mut">-</span>}</td>
                        </tr>
                      ))}</tbody>
                    </table></div>
                  </td></tr>
                );
                return rows;
              })}</tbody>
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
