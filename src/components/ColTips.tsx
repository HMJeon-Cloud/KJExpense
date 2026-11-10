// 열 이름 설명 풍선 — 화면의 모든 표 머리글(th)과 목록 머리글(.lh span)에 lib/colTips.ts 의 설명을 붙입니다.
//   새 화면·기존(legacy) 화면 모두 한 곳에서 처리 (머리글 글자가 사전에 있으면 점선 밑줄 + 올리면 설명)
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { tipFor } from '../lib/colTips';

export function ColTips() {
  const loc = useLocation();
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);
  useEffect(() => {
    let timer = 0;
    const scan = () => {
      timer = 0;
      document.querySelectorAll<HTMLElement>('th:not([data-tc]), .lh > span:not([data-tc])').forEach(el => {
        el.setAttribute('data-tc', '1');
        const own = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent || '').join(' ').trim() || (el.textContent || '');
        const t = tipFor(loc.pathname, own);
        if (t) { el.setAttribute('data-tip', t); el.classList.add('has-tip'); }
      });
    };
    const queue = () => { if (!timer) timer = window.setTimeout(scan, 250); };
    // 화면이 바뀌면 다시 확인 (머리글 글자가 기준월에 따라 바뀜)
    document.querySelectorAll('[data-tc]').forEach(el => { el.removeAttribute('data-tc'); el.removeAttribute('data-tip'); el.classList.remove('has-tip'); });
    queue();
    const mo = new MutationObserver(queue);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    const show = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.('.has-tip') as HTMLElement | null;
      if (!el) { if (e.type !== 'mouseover') setTip(null); return; }
      const r = el.getBoundingClientRect(); const below = r.top < 90;
      setTip({ text: el.getAttribute('data-tip') || '', x: Math.min(Math.max(r.left + r.width / 2, 150), window.innerWidth - 150), y: below ? r.bottom + 6 : r.top - 6, below });
    };
    const hide = (e: Event) => { if ((e.target as HTMLElement | null)?.closest?.('.has-tip')) setTip(null); };
    const off = () => setTip(null);
    document.addEventListener('mouseover', show); document.addEventListener('mouseout', hide);
    document.addEventListener('click', show); window.addEventListener('scroll', off, true);
    return () => { mo.disconnect(); clearTimeout(timer); document.removeEventListener('mouseover', show); document.removeEventListener('mouseout', hide); document.removeEventListener('click', show); window.removeEventListener('scroll', off, true); };
  }, [loc.pathname]);
  return (
    <>
      <style>{`
        .has-tip{text-decoration:underline dotted var(--fg-3);text-underline-offset:3px;cursor:help}
        .coltip{position:fixed;z-index:300;max-width:290px;transform:translate(-50%,-100%);background:#1f2937;color:#fff;font-size:12px;line-height:1.5;padding:7px 10px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.25);pointer-events:none;white-space:normal;text-align:left;font-weight:400}
        .coltip.below{transform:translate(-50%,0)}
        @media print{.coltip{display:none}}
      `}</style>
      {tip && tip.text && <div className={'coltip' + (tip.below ? ' below' : '')} role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
    </>
  );
}
