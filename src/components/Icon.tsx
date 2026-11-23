// 아이콘 — lucide 아이콘 정의([태그, 속성][])를 SVG 로 그림.  <Icon i={House} />
import { createElement } from 'react';
export type IconNode = [string, Record<string, string | number>][];
export function Icon({ i, size = 18, stroke = 1.9, className, style }: { i: IconNode; size?: number; stroke?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={{ flex: 'none', ...style }}>
      {i.map(([tag, attrs], k) => createElement(tag, { key: k, ...attrs }))}
    </svg>
  );
}
