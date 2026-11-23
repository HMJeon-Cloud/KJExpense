// 공통 화면 부품 — 화면 머리글 · 기준월 · 숫자 타일 · 증감 표시 · 카드
//   모든 화면이 같은 모양·같은 말투를 쓰도록 여기서만 정합니다.
import type { ReactNode } from 'react';
import { HelpDot } from './Help';
import { fmt } from './ui';

/** 금액 줄임: 12.3억 / 3,450만 / 12,000 (1,000억 이상은 소수점 없이) */
export const won = (v: number | null | undefined) => {
  if (v == null || !isFinite(v)) return '-';
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e8) return s + (a / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: a >= 1e11 ? 0 : 1, minimumFractionDigits: a >= 1e11 ? 0 : 1 }) + '억';
  if (a >= 1e4) return s + Math.round(a / 1e4).toLocaleString('ko-KR') + '만';
  return s + fmt(a);
};
/** 부호 붙인 금액: +1.2억 / −3,400만 */
export const swon = (v: number | null | undefined) => (v == null || !isFinite(v) ? '-' : (v > 0 ? '+' : '') + won(v));
export const pct = (a: number, b: number | null | undefined, digits = 1) => (b ? Math.round((a / b) * 100 * 10 ** digits) / 10 ** digits : null);
export const ymText = (ym: string) => (ym && ym.length >= 6 ? `${ym.slice(0, 4)}년 ${+ym.slice(4, 6)}월` : ym || '-');
export const ymShort = (ym: string) => (ym && ym.length >= 6 ? `${ym.slice(0, 4)}-${ym.slice(4, 6)}` : ym || '-');
export const shiftYm = (ym: string, d: number) => { const y = +ym.slice(0, 4), m = +ym.slice(4, 6) - 1 + d; return (y + Math.floor(m / 12)) + String((((m % 12) + 12) % 12) + 1).padStart(2, '0'); };
const shiftDash = (v: string, d: number) => { const s = shiftYm(v.replace('-', ''), d); return s.slice(0, 4) + '-' + s.slice(4); };

/** 화면 머리글: 제목 · 한 줄 설명 · 오른쪽 조작부 */
export function PageHead({ title, desc, children, help }: { title: ReactNode; desc?: ReactNode; children?: ReactNode; help?: string }) {
  return (
    <div className="ph">
      <div style={{ minWidth: 0 }}><h1>{title}{help && <HelpDot id={help} />}</h1>{desc && <div className="desc">{desc}</div>}</div>
      <span className="sp" />
      {children && <div className="ctl">{children}</div>}
    </div>
  );
}

/** 기준월 고르기 (‹ 월 ›).  value = 'YYYY-MM' */
export function MonthNav({ value, onChange, min = '2025-01', max, id }: { value: string; onChange: (v: string) => void; min?: string; max?: string; id?: string }) {
  return (
    <span className="monthnav" title="기준월">
      <button onClick={() => onChange(shiftDash(value, -1))} disabled={!value || value <= min} aria-label="이전 달">‹</button>
      <input id={id} type="month" min={min} max={max} value={value} onChange={e => e.target.value && onChange(e.target.value)} aria-label="기준월" />
      <button onClick={() => onChange(shiftDash(value, 1))} disabled={!value || (!!max && value >= max)} aria-label="다음 달">›</button>
    </span>
  );
}
/** 조회 기간 (3·6·12개월) */
export function RangeSeg({ value, onChange, options = [3, 6, 12] }: { value: number; onChange: (n: number) => void; options?: number[] }) {
  return <span className="seg" title="조회 기간">{options.map(n => <button key={n} className={value === n ? 'on' : ''} onClick={() => onChange(n)}>{n}개월</button>)}</span>;
}

/** 증감: 금액(또는 %) 차이를 방향·색으로.  invert = 줄어야 좋은 값(비용) */
export function Delta({ cur, prev, invert, mode = 'won', label }: { cur: number | null | undefined; prev: number | null | undefined; invert?: boolean; mode?: 'won' | 'pct' | 'pp' | 'both'; label?: string }) {
  if (cur == null || prev == null || !isFinite(cur) || !isFinite(prev)) return <span className="dl flat">{label ? label + ' ' : ''}-</span>;
  const d = cur - prev;
  const cls = d === 0 ? 'flat' : (invert ? d < 0 : d > 0) ? 'good' : 'bad';
  const p = prev !== 0 ? Math.round((d / Math.abs(prev)) * 1000) / 10 : null;
  const ab = Math.abs(d), pa = p == null ? null : Math.abs(p);
  // 방향은 ▲▼ 로, 크기는 부호 없이
  const txt = mode === 'pp' ? ab.toFixed(1) + '%p'
    : mode === 'pct' ? (pa == null ? won(ab) : pa + '%')
    : mode === 'both' ? won(ab) + (pa == null ? '' : ` (${pa}%)`)
    : won(ab);
  return <span className={'dl ' + cls} title={label}>{label && <span style={{ color: 'var(--fg-3)', fontWeight: 400 }}>{label}</span>}<i>{d > 0 ? '▲' : d < 0 ? '▼' : ''}</i>{d === 0 ? '변동 없음' : txt}</span>;
}

/** 숫자 타일 */
export function Stat({ label, value, unit, sub, tone, keyColor, help, children, onClick, title }: { label: ReactNode; value: ReactNode; unit?: string; sub?: ReactNode; tone?: 'pos' | 'neg'; keyColor?: string; help?: string; children?: ReactNode; onClick?: () => void; title?: string }) {
  return (
    <div className={'stat' + (keyColor ? ' key' : '')} style={{ ...(keyColor ? ({ '--k': keyColor } as React.CSSProperties) : {}), cursor: onClick ? 'pointer' : undefined }} onClick={onClick} title={title}>
      <div className="l">{label}{help && <HelpDot id={help} />}</div>
      <div className="v" style={{ color: tone === 'pos' ? 'var(--green-2)' : tone === 'neg' ? 'var(--red-2)' : undefined }}>{value}{unit && <small>{unit}</small>}</div>
      {sub != null && <div className="s">{sub}</div>}
      {children}
    </div>
  );
}

/** 카드 (제목 줄 + 본문) */
export function Card({ title, desc, help, right, children, flush, className, style }: { title?: ReactNode; desc?: ReactNode; help?: string; right?: ReactNode; children: ReactNode; flush?: boolean; className?: string; style?: React.CSSProperties }) {
  return (
    <section className={'card ' + (className || '')} style={style}>
      {(title || right) && <div className="card-h"><h2>{title}{help && <HelpDot id={help} />}</h2>{desc && <span className="d">{desc}</span>}<span className="sp" />{right}</div>}
      <div className={'card-b' + (flush ? ' flush' : '')}>{children}</div>
    </section>
  );
}

/** 불러오는 중 · 데이터 없음 */
export function Loading({ text = '계산하는 중입니다. 처음 접속은 수십 초 걸릴 수 있습니다.' }: { text?: string }) {
  return <div className="card"><div className="empty"><span className="spinner" />{text}</div></div>;
}
export function Empty({ children }: { children: ReactNode }) { return <div className="card"><div className="empty">{children}</div></div>; }

/** 범례 한 줄 */
export function Legend({ items }: { items: { c: string; t: string; kind?: 'box' | 'line' | 'dash' }[] }) {
  return <div className="lg">{items.map(x => <span key={x.t} style={x.kind && x.kind !== 'box' ? { color: x.c } : undefined}><i className={x.kind === 'line' ? 'ln' : x.kind === 'dash' ? 'dash' : ''} style={!x.kind || x.kind === 'box' ? { background: x.c } : undefined} /><span style={{ color: 'var(--fg-3)' }}>{x.t}</span></span>)}</div>;
}
