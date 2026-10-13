// 공용 SVG 차트 — 디자인 가이드 색 고정: 배분 수익(파랑) · 지원 수익(라임) · 비용(주황) · 지원 비용(노랑)
import { useEffect, useRef, useState } from 'react';
import { fmt } from './ui';

/** 차트가 놓인 칸의 실제 너비 — 휴대폰에서 글자가 작아지지 않도록 그 너비로 다시 그림 */
export function useBoxWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const set = () => { const v = Math.round(el.getBoundingClientRect().width); if (v > 0) setW(v); };
    set();
    const ro = new ResizeObserver(set); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export const C = { margin: '#1f6fe8', sup: '#9ccf2a', cost: '#f26a1b', supCost: '#f5b400', grid: 'var(--line)', text: 'var(--fg-3)' };
const short = (v: number) => { const a = Math.abs(v); if (a >= 1e8) return (v / 1e8).toFixed(1) + '억'; if (a >= 1e4) return Math.round(v / 1e4).toLocaleString('ko-KR') + '만'; return fmt(v); };
export const ymL = (m: string) => m.slice(0, 4) + '-' + m.slice(4, 6);

/** 월별 수익(배분+지원) vs 비용(전표+지원) 묶음 막대 */
export function PairBars({ months, margin, cost, supAlloc, supCost, height = 220, labels = true }: { months: string[]; margin: number[]; cost: number[]; supAlloc?: number[]; supCost?: number[]; height?: number; labels?: boolean }) {
  const W = 720, H = height, padL = 8, padR = 8, top = 22, bottom = 26;
  const n = months.length; if (!n) return null;
  const tot = (i: number) => [margin[i] + (supAlloc?.[i] || 0), cost[i] + (supCost?.[i] || 0)];
  const max = Math.max(1, ...months.map((_, i) => Math.max(...tot(i))));
  const slot = (W - padL - padR) / n, bw = Math.min(34, slot * 0.32), gap = 4;
  const y = (v: number) => top + (H - top - bottom) * (1 - Math.max(0, v) / max);
  const base = H - bottom;
  const ticks = [0.25, 0.5, 0.75, 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="월별 수익 대비 비용">
      {ticks.map(t => <line key={t} x1={padL} x2={W - padR} y1={y(max * t)} y2={y(max * t)} stroke={C.grid} strokeWidth={1} />)}
      <line x1={padL} x2={W - padR} y1={base} y2={base} stroke="var(--line-2)" />
      {months.map((m, i) => {
        const cx = padL + slot * i + slot / 2;
        const [tm, tc] = tot(i);
        const mx = cx - gap / 2 - bw, cxx = cx + gap / 2;
        const sa = supAlloc?.[i] || 0, sc = supCost?.[i] || 0;
        const over = tc > tm && tm > 0;
        return (
          <g key={m}>
            <rect x={mx} y={y(margin[i])} width={bw} height={base - y(margin[i])} fill={C.margin} rx={3} />
            {sa > 0 && <rect x={mx} y={y(tm)} width={bw} height={y(margin[i]) - y(tm)} fill={C.sup} rx={3} />}
            <rect x={cxx} y={y(cost[i])} width={bw} height={base - y(cost[i])} fill={over ? '#d93c3c' : C.cost} rx={3} />
            {sc > 0 && <rect x={cxx} y={y(tc)} width={bw} height={y(cost[i]) - y(tc)} fill={C.supCost} rx={3} />}
            {labels && <text x={mx + bw / 2} y={y(tm) - 5} textAnchor="middle" fontSize={10} fontWeight={600} fill={C.margin} fontFamily="var(--font-num)">{short(tm)}</text>}
            {labels && <text x={cxx + bw / 2} y={y(tc) - 5} textAnchor="middle" fontSize={10} fontWeight={600} fill={over ? '#d93c3c' : C.cost} fontFamily="var(--font-num)">{short(tc)}</text>}
            <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill={C.text}>{ymL(m)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Legend({ realized }: { realized?: boolean }) {
  const it = (c: string, t: string) => <span className="row" style={{ gap: 5, fontSize: 11.5, color: 'var(--fg-3)' }}><i style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />{t}</span>;
  return <div className="row" style={{ gap: 12 }}>{it(C.margin, realized ? '수익' : '배분 수익')}{!realized && it(C.sup, '지원 수익')}{it(C.cost, '비용')}{!realized && it(C.supCost, '지원 비용')}<span style={{ fontSize: 11, color: 'var(--neg)' }}>비용이 수익을 넘으면 빨강</span></div>;
}

/** 작은 영역형 스파크라인 */
export function Spark({ series, color = C.margin, h = 64 }: { series: number[]; color?: string; h?: number }) {
  const W = 260, padX = 4, top = 8, base = h - 14;
  const n = series.length; if (!n) return null;
  const max = Math.max(1, ...series.map(v => Math.abs(v)));
  const step = n > 1 ? (W - padX * 2) / (n - 1) : 0;
  const pts = series.map((v, i) => [padX + i * step, base - (Math.max(0, v) / max) * (base - top)] as const);
  const line = pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <polygon points={`${padX},${base} ${line} ${(padX + (n - 1) * step).toFixed(1)},${base}`} fill={color} opacity={0.12} />
      <line x1={padX} x2={W - padX} y1={base} y2={base} stroke={C.grid} />
      <polyline fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" points={line} />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={i === n - 1 ? 3 : 1.6} fill={color} />)}
    </svg>
  );
}

/** 도넛 + 범례 */
const PALETTE = ['#1f6fe8', '#f26a1b', '#3aa63a', '#f5b400', '#7c3aed', '#0891b2', '#9ccf2a', '#64748b'];
export function Donut({ slices, total, centerLabel }: { slices: { a: string; v: number; kws?: string[] }[]; total: number; centerLabel: string }) {
  const R = 64, r = 42, cx = 80, cy = 80;
  let acc = 0;
  const arcs = slices.map((s, i) => {
    const a0 = (acc / total) * Math.PI * 2 - Math.PI / 2; acc += s.v; const a1 = (acc / total) * Math.PI * 2 - Math.PI / 2;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (ang: number, rad: number) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
    const [x0, y0] = p(a0, R), [x1, y1] = p(a1, R), [x2, y2] = p(a1, r), [x3, y3] = p(a0, r);
    return { d: `M${x0},${y0} A${R},${R} 0 ${big} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${big} 0 ${x3},${y3} Z`, color: PALETTE[i % PALETTE.length], s };
  });
  return (
    <div className="row donut" style={{ gap: 18, alignItems: 'center' }}>
      <svg viewBox="0 0 160 160" style={{ width: 150, flexShrink: 0 }}>
        {arcs.map((a, i) => <path key={i} d={a.d} fill={a.color} stroke="var(--surface)" strokeWidth={1.5} />)}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize={11} fill="var(--fg-3)">{centerLabel}</text>
        <text x={cx} y={cy + 13} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--fg)" fontFamily="var(--font-num)">{short(total)}</text>
      </svg>
      <div style={{ display: 'grid', gap: 5, minWidth: 0, flex: 1 }}>
        {arcs.map((a, i) => (
          <div key={i} className="row" style={{ gap: 8, fontSize: 12.5 }}>
            <i style={{ width: 10, height: 10, borderRadius: 2, background: a.color, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.s.a}{a.s.kws?.length ? <span className="help"> · {a.s.kws.join(', ')}</span> : null}</span>
            <span className="num" style={{ fontSize: 12.5 }}>{fmt(a.s.v)}</span>
            <span className="help num" style={{ width: 42 }}>{total > 0 ? (a.s.v / total * 100).toFixed(1) + '%' : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Mom({ cur, prev, invert }: { cur: number; prev: number; invert?: boolean }) {
  if (!(prev > 0)) return <span className="help">-</span>;
  const v = Math.round(((cur - prev) / prev) * 1000) / 10;
  const good = invert ? v <= 0 : v >= 0;
  return <span className={'tag ' + (good ? 'g' : 'n')} style={{ fontFamily: 'var(--font-num)' }}>{v >= 0 ? '▲ +' : '▼ '}{v}%</span>;
}

/** 금액 요약: 1.2억 / 3,450만 / 12,000 */
export const kor = (v: number) => { const a = Math.abs(v), s = v < 0 ? '-' : ''; if (a >= 1e8) return s + (a / 1e8).toFixed(a >= 1e10 ? 0 : 1) + '억'; if (a >= 1e4) return s + Math.round(a / 1e4).toLocaleString('ko-KR') + '만'; return s + fmt(a); };

/** 순수익(수익-비용) 막대 + 수익·비용 선 — 한눈에 "남았나 넘었나" */
export function NetTrend({ months, margin, cost, height = 240 }: { months: string[]; margin: number[]; cost: number[]; height?: number }) {
  const [box, bw0] = useBoxWidth(760);
  const W = Math.max(300, bw0), narrow = W < 560, H = narrow ? Math.min(height, 230) : height, padL = narrow ? 40 : 54, padR = narrow ? 6 : 12, top = 16, bottom = 30;
  const n = months.length; if (!n) return <div ref={box} />;
  const net = months.map((_, i) => margin[i] - cost[i]);
  const maxV = Math.max(1, ...margin, ...cost) * 1.05;
  const minNet = Math.min(0, ...net);
  const minV = minNet < 0 ? minNet - (maxV - minNet) * 0.12 : 0; // 음수 막대 아래 라벨 자리
  const y = (v: number) => top + (H - top - bottom) * (1 - (v - minV) / (maxV - minV));
  const slot = (W - padL - padR) / n, bw = Math.min(40, slot * 0.42);
  const x = (i: number) => padL + slot * i + slot / 2;
  const y0 = y(0);
  const ticks: number[] = []; const step = niceStep((maxV - minV) / 4); for (let v = Math.ceil(minV / step) * step; v <= maxV; v += step) ticks.push(v);
  const path = (s: number[]) => s.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  return (
    <div ref={box} style={{ width: '100%', minWidth: 0 }}>
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="월별 순수익 추이">
      {ticks.map(t => <g key={t}><line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={C.grid} /><text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill={C.text} fontFamily="var(--font-num)">{kor(t)}</text></g>)}
      <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke="var(--fg-3)" strokeWidth={1.2} />
      {months.map((m, i) => {
        const v = net[i]; const pos = v >= 0;
        return (
          <g key={m}>
            <rect x={x(i) - bw / 2} y={pos ? y(v) : y0} width={bw} height={Math.max(1, Math.abs(y(v) - y0))} fill={pos ? '#3aa63a' : '#d93c3c'} opacity={0.85} rx={3}>
              <title>{ymL(m)} 순수익 {fmt(v)}원 (수익 {fmt(margin[i])} - 비용 {fmt(cost[i])})</title>
            </rect>
            {(slot >= 46 || i === n - 1) && <text x={x(i)} y={pos ? y(v) - 5 : y(v) + 13} textAnchor="middle" fontSize={narrow ? 10 : 11} fontWeight={700} fill={pos ? '#2c7f2c' : '#b32b2b'} fontFamily="var(--font-num)">{(pos ? '+' : '') + kor(v)}</text>}
            <text x={x(i)} y={H - 9} textAnchor="middle" fontSize={narrow ? 10 : 11} fill={i === n - 1 ? 'var(--fg)' : C.text} fontWeight={i === n - 1 ? 700 : 400}>{slot < 64 ? +m.slice(4, 6) + '월' : ymL(m)}</text>
          </g>
        );
      })}
      <path d={path(margin)} fill="none" stroke={C.margin} strokeWidth={2} strokeLinejoin="round" />
      <path d={path(cost)} fill="none" stroke={C.cost} strokeWidth={2} strokeLinejoin="round" strokeDasharray="5 3" />
      {months.map((_, i) => <g key={'d' + i}><circle cx={x(i)} cy={y(margin[i])} r={3} fill={C.margin} /><circle cx={x(i)} cy={y(cost[i])} r={3} fill={C.cost} /></g>)}
    </svg>
    </div>
  );
}
function niceStep(raw: number) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw)))); const r = raw / p; return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p; }

/** 비용/수익 비율 막대 (100% 기준선) */
export function RatioBar({ ratio }: { ratio: number | null }) {
  if (ratio == null) return <span className="help">-</span>;
  const w = Math.min(100, ratio / 1.5 * 100); // 150% 를 가득으로
  const over = ratio > 100;
  return (
    <div className="row" style={{ gap: 8 }}>
      <div style={{ position: 'relative', flex: 1, height: 8, background: 'var(--surface-2)', borderRadius: 999, minWidth: 60 }}>
        <div style={{ width: w + '%', height: '100%', background: over ? '#d93c3c' : ratio > 85 ? '#f5b400' : '#3aa63a', borderRadius: 999 }} />
        <div style={{ position: 'absolute', left: (100 / 1.5) + '%', top: -3, width: 1, height: 14, background: 'var(--fg-3)' }} />
      </div>
      <span className="num" style={{ width: 46, fontSize: 12.5, color: over ? 'var(--neg)' : undefined }}>{ratio}%</span>
    </div>
  );
}
