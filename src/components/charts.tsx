// 공용 SVG 차트 — 디자인 가이드 색 고정: 배분 수익(파랑) · 지원 수익(라임) · 비용(주황) · 지원 비용(노랑)
import { accL } from '../lib/acc';
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

export const C = { margin: '#1766e0', sup: '#a4cf1b', cost: '#f06a1a', supCost: '#f5b301', pos: '#1f9d4d', neg: '#d92d20', posT: '#167a3a', negT: '#b42318', ghost: '#cfd8e3', grid: 'var(--line)', text: 'var(--fg-3)' };
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
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="월별 이익과 비용">
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
            <rect x={cxx} y={y(cost[i])} width={bw} height={base - y(cost[i])} fill={over ? '#d92d20' : C.cost} rx={3} />
            {sc > 0 && <rect x={cxx} y={y(tc)} width={bw} height={y(cost[i]) - y(tc)} fill={C.supCost} rx={3} />}
            {labels && <text x={mx + bw / 2} y={y(tm) - 5} textAnchor="middle" fontSize={10} fontWeight={600} fill={C.margin} fontFamily="var(--font-num)">{short(tm)}</text>}
            {labels && <text x={cxx + bw / 2} y={y(tc) - 5} textAnchor="middle" fontSize={10} fontWeight={600} fill={over ? '#d92d20' : C.cost} fontFamily="var(--font-num)">{short(tc)}</text>}
            <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill={C.text}>{ymL(m)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Legend({ realized }: { realized?: boolean }) {
  const it = (c: string, t: string) => <span className="row" style={{ gap: 5, fontSize: 11.5, color: 'var(--fg-3)' }}><i style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />{t}</span>;
  return <div className="row" style={{ gap: 12 }}>{it(C.margin, realized ? '판매 이익' : '배분 이익')}{!realized && it(C.sup, '해 준 지원')}{it(C.cost, '비용')}{!realized && it(C.supCost, '받은 지원')}<span style={{ fontSize: 11, color: 'var(--neg)' }}>비용이 이익을 넘으면 빨강</span></div>;
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
export const PALETTE = ['#1766e0', '#f06a1a', '#1f9d4d', '#f5b301', '#7c5cff', '#12a5b5', '#a4cf1b', '#8492a6'];
export function Donut({ slices, total, centerLabel, head = '항목' }: { slices: { a: string; v: number; kws?: string[] }[]; total: number; centerLabel: string; head?: string }) {
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
        <div className="row lh" style={{ gap: 8 }}><i style={{ width: 10, flexShrink: 0 }} /><span style={{ flex: 1 }}>{head}</span><span>금액</span><span style={{ width: 42, textAlign: 'right' }}>비중</span></div>
        {arcs.map((a, i) => (
          <div key={i} className="row" style={{ gap: 8, fontSize: 12.5 }}>
            <i style={{ width: 10, height: 10, borderRadius: 2, background: a.color, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{accL(a.s.a)}{a.s.kws?.length ? <span className="help"> · {a.s.kws.join(', ')}</span> : null}</span>
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
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="월별 손익 추이">
      {ticks.map(t => <g key={t}><line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={C.grid} /><text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill={C.text} fontFamily="var(--font-num)">{kor(t)}</text></g>)}
      <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke="var(--fg-3)" strokeWidth={1.2} />
      {months.map((m, i) => {
        const v = net[i]; const pos = v >= 0;
        return (
          <g key={m}>
            <rect x={x(i) - bw / 2} y={pos ? y(v) : y0} width={bw} height={Math.max(1, Math.abs(y(v) - y0))} fill={pos ? '#1f9d4d' : '#d92d20'} opacity={0.85} rx={3}>
              <title>{ymL(m)} 손익 {fmt(v)}원 (이익 {fmt(margin[i])} − 비용 {fmt(cost[i])})</title>
            </rect>
            {(slot >= 46 || i === n - 1) && <text x={x(i)} y={pos ? y(v) - 5 : y(v) + 13} textAnchor="middle" fontSize={narrow ? 10 : 11} fontWeight={700} fill={pos ? '#167a3a' : '#b42318'} style={{ fontVariantNumeric: 'tabular-nums' }}>{(pos ? '+' : '') + kor(v)}</text>}
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

/** 비율 표시 — 999% 를 넘으면 줄여서 (수익이 아주 작을 때 10만% 같은 숫자가 나오는 것 방지) */
export const pctCap = (r: number | null | undefined) => (r == null ? '-' : r > 999 ? '999%+' : r + '%');
/** 비용/수익 비율 막대 (100% 기준선) */
export function RatioBar({ ratio }: { ratio: number | null }) {
  if (ratio == null) return <span className="help">-</span>;
  const w = Math.max(2, Math.min(100, ratio / 1.5)); // 150% 를 가득으로 (세로선 = 100%)
  const over = ratio > 100;
  return (
    <div className="row" style={{ gap: 8 }}>
      <div style={{ position: 'relative', flex: 1, height: 8, background: 'var(--surface-3)', borderRadius: 999, minWidth: 60 }}>
        <div style={{ width: w + '%', height: '100%', background: over ? '#d92d20' : ratio > 85 ? '#f5b301' : '#1f9d4d', borderRadius: 999 }} />
        <div style={{ position: 'absolute', left: (100 / 1.5) + '%', top: -3, width: 1, height: 14, background: 'var(--fg-3)' }} />
      </div>
      <span className="num" title={ratio > 999 ? '비용 ÷ 이익 = ' + ratio.toLocaleString('ko-KR') + '% (이익이 매우 작음)' : undefined} style={{ width: 50, fontSize: 12.5, color: over ? 'var(--neg)' : undefined }}>{pctCap(ratio)}</span>
    </div>
  );
}

/** 월별 막대 — 경영 요약용. 값 라벨 · 전년 같은 달(회색 얇은 막대) · 추정 월은 빗금
 *  mode 'sign' = 양수 초록·음수 빨강 (이익) / 'blue' = 파랑 (매출) / 'orange' = 주황 (비용) */
export function MonthBars({ items, mode = 'blue', height = 170, fmtV = kor, label = '', sel, onPick }: { items: { m: string; v: number | null; est?: boolean; ghost?: number | null }[]; mode?: 'sign' | 'blue' | 'orange'; height?: number; fmtV?: (v: number) => string; label?: string; sel?: string[]; onPick?: (m: string) => void }) {
  const [box, bw0] = useBoxWidth(640);
  const W = Math.max(280, bw0), H = height, padL = 6, padR = 6, top = 20, bottom = 34;
  const n = items.length; if (!n) return <div ref={box} />;
  const vals = items.flatMap(x => [x.v ?? 0, x.ghost ?? 0]);
  const maxV = Math.max(1, ...vals), minV = Math.min(0, ...vals);
  const span = (maxV - minV) || 1, labelPad = minV < 0 ? 14 : 0;
  const y = (v: number) => top + (H - top - bottom - labelPad) * (1 - (v - minV) / span);
  const slot = (W - padL - padR) / n, hasGhost = items.some(x => x.ghost != null), bw = Math.min(34, slot * (hasGhost ? 0.46 : 0.58)), gw = Math.min(10, slot * 0.16);
  const y0 = y(0), dense = slot < 44;
  const uid = 'h' + Math.round(W) + mode;
  return (
    <div ref={box} style={{ width: '100%', minWidth: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={label || '월별 막대 그래프'}>
        <defs>
          {(['#1766e0', '#1f9d4d', '#d92d20', '#f06a1a'] as const).map((c, i) => <pattern key={c} id={uid + i} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill={c} opacity=".22" /><line x1="0" y1="0" x2="0" y2="6" stroke={c} strokeWidth="2.4" opacity=".75" /></pattern>)}
        </defs>
        <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke="var(--line-2)" />
        {items.map((it, i) => {
          const cx = padL + slot * i + slot / 2, v = it.v, lastOne = sel ? sel.includes(it.m) : i === n - 1;
          const ci = mode === 'blue' ? 0 : mode === 'orange' ? 3 : (v ?? 0) >= 0 ? 1 : 2;
          const col = ['#1766e0', '#1f9d4d', '#d92d20', '#f06a1a'][ci];
          const bx = hasGhost ? cx - (bw + gw + 2) / 2 + gw + 2 : cx - bw / 2;
          return (
            <g key={it.m} onClick={onPick ? () => onPick(it.m) : undefined} style={onPick ? { cursor: 'pointer' } : undefined}>
              {onPick && <rect x={cx - slot / 2} y={0} width={slot} height={H} fill="transparent" />}
              {it.ghost != null && <rect x={cx - (bw + gw + 2) / 2} y={it.ghost >= 0 ? y(it.ghost) : y0} width={gw} height={Math.max(1, Math.abs(y(it.ghost) - y0))} fill={C.ghost} rx={2}><title>{`전년 같은 달 ${fmt(it.ghost)}`}</title></rect>}
              {v != null && <rect x={bx} y={v >= 0 ? y(v) : y0} width={bw} height={Math.max(1.5, Math.abs(y(v) - y0))} fill={it.est ? `url(#${uid + ci})` : col} opacity={lastOne || it.est ? 1 : sel ? 0.38 : 0.82} rx={3}><title>{`${ymL(it.m)} ${fmt(v)}${it.est ? ' (추정)' : ''}`}</title></rect>}
              {v != null && (!dense || lastOne || i % 2 === (n - 1) % 2) && <text x={bx + bw / 2} y={v >= 0 ? y(v) - 5 : y(v) + 12} textAnchor="middle" fontSize={dense ? 10 : 11} fontWeight={lastOne ? 800 : 600} fill={mode === 'sign' ? (v >= 0 ? C.posT : C.negT) : 'var(--fg-2)'} style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtV(v)}</text>}
              <text x={cx} y={H - 18} textAnchor="middle" fontSize={11} fill={lastOne ? 'var(--fg)' : C.text} fontWeight={lastOne ? 700 : 400}>{+it.m.slice(4, 6)}월</text>
              {(i === 0 || it.m.slice(4, 6) === '01') && <text x={cx} y={H - 5} textAnchor="middle" fontSize={10} fill="var(--fg-4)">{it.m.slice(0, 4)}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** 증감 다리(워터폴): 시작 → 요인들 → 끝.  steps[].v 는 영향 금액(+/−) */
export function Waterfall({ start, end, steps, height = 190 }: { start: { label: string; v: number }; end: { label: string; v: number }; steps: { label: string; v: number }[]; height?: number }) {
  const [box, bw0] = useBoxWidth(520);
  const W = Math.max(280, bw0), H = height, top = 22, bottom = 36, pad = 6;
  const cols: { label: string; a: number; b: number; kind: 'tot' | 'step' }[] = [{ label: start.label, a: 0, b: start.v, kind: 'tot' }];
  let acc = start.v; steps.forEach(s => { cols.push({ label: s.label, a: acc, b: acc + s.v, kind: 'step' }); acc += s.v; });
  cols.push({ label: end.label, a: 0, b: end.v, kind: 'tot' });
  const all = cols.flatMap(c => [c.a, c.b]); const maxV = Math.max(0, ...all), minV = Math.min(0, ...all), span = (maxV - minV) || 1;
  const y = (v: number) => top + (H - top - bottom) * (1 - (v - minV) / span);
  const slot = (W - pad * 2) / cols.length, bw = Math.min(54, slot * 0.56);
  return (
    <div ref={box} style={{ width: '100%', minWidth: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="증감 요인">
        <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} stroke="var(--line-2)" />
        {cols.map((c, i) => {
          const cx = pad + slot * i + slot / 2, d = c.b - c.a, up = d >= 0;
          const col = c.kind === 'tot' ? (c.b >= 0 ? '#1766e0' : C.neg) : up ? C.pos : C.neg;
          const yt = Math.min(y(c.a), y(c.b)), h = Math.max(2, Math.abs(y(c.a) - y(c.b)));
          return (
            <g key={i}>
              {i > 0 && <line x1={cx - slot + bw / 2} x2={cx - bw / 2} y1={y(c.a)} y2={y(c.a)} stroke="var(--line-2)" strokeDasharray="3 3" />}
              <rect x={cx - bw / 2} y={yt} width={bw} height={h} fill={col} opacity={c.kind === 'tot' ? 0.9 : 0.85} rx={3} />
              <text x={cx} y={(up || c.kind === 'tot' && c.b >= 0) ? yt - 6 : yt + h + 13} textAnchor="middle" fontSize={11.5} fontWeight={700} fill={c.kind === 'tot' ? 'var(--fg)' : up ? C.posT : C.negT} style={{ fontVariantNumeric: 'tabular-nums' }}>{c.kind === 'tot' ? kor(c.b) : (d > 0 ? '+' : d < 0 ? '−' : '') + kor(Math.abs(d))}</text>
              {c.label.split('\n').map((t, k) => <text key={k} x={cx} y={H - 20 + k * 13} textAnchor="middle" fontSize={11} fill={c.kind === 'tot' ? 'var(--fg)' : C.text} fontWeight={c.kind === 'tot' ? 700 : 400}>{t}</text>)}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** 작은 추이선 — 음수도 그림 (0 기준선 점선) */
export function TrendLine({ series, w = 110, h = 30, color }: { series: (number | null)[]; w?: number; h?: number; color?: string }) {
  const ok = series.map((v, i) => (v == null || !isFinite(v) ? null : { i, v })).filter(Boolean) as { i: number; v: number }[];
  if (ok.length < 2) return <span className="help">-</span>;
  const mn = Math.min(0, ...ok.map(p => p.v)), mx = Math.max(0, ...ok.map(p => p.v)), rg = (mx - mn) || 1;
  const x = (i: number) => 3 + (i / Math.max(1, series.length - 1)) * (w - 6), y = (v: number) => 3 + (1 - (v - mn) / rg) * (h - 6);
  const d = ok.map((p, k) => (k ? 'L' : 'M') + x(p.i).toFixed(1) + ',' + y(p.v).toFixed(1)).join(' ');
  const lp = ok[ok.length - 1], col = color || (lp.v >= 0 ? C.pos : C.neg);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'inline-block', verticalAlign: 'middle' }} aria-hidden="true">
      {mn < 0 && mx > 0 && <line x1={3} x2={w - 3} y1={y(0)} y2={y(0)} stroke="var(--line-2)" strokeDasharray="2 3" />}
      <path d={d} fill="none" stroke={col} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(lp.i)} cy={y(lp.v)} r={2.6} fill={col} />
    </svg>
  );
}
/** 좌우 막대: 가운데 0, 오른쪽 초록(남음) · 왼쪽 빨강(부족) */
export function DivBar({ v, max, w = 140 }: { v: number; max: number; w?: number }) {
  const p = Math.min(50, Math.round(Math.abs(v) / Math.max(1, max) * 50));
  return (
    <span style={{ position: 'relative', display: 'inline-block', width: w, height: 8, background: 'var(--surface-3)', borderRadius: 999, verticalAlign: 'middle' }} aria-hidden="true">
      <i style={{ position: 'absolute', top: -3, bottom: -3, left: '50%', width: 1, background: 'var(--line-2)' }} />
      <i style={{ position: 'absolute', top: 0, bottom: 0, ...(v >= 0 ? { left: '50%', borderRadius: '0 999px 999px 0' } : { right: '50%', borderRadius: '999px 0 0 999px' }), width: p + '%', background: v >= 0 ? C.pos : C.neg }} />
    </span>
  );
}
