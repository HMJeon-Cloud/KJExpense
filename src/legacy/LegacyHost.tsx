// 기존(Apps Script 판) 화면들을 새 앱 안에서 그대로 띄우는 호스트.
// 3-A 단계: 데이터·설정·로그인은 Supabase, 화면 코드는 기존 그대로. 3-B 에서 화면별로 새 디자인으로 교체합니다.
import { useEffect, useRef } from 'react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import * as lucide from 'lucide';
import { useLocation, useNavigate } from 'react-router-dom';
import sectionsHtml from './sections.html?raw';
import './legacy.css';
import { KJHub, setNavHook, setUser, loadAll, loadCloseMonth, onMeta } from './hub';
import { installGsShim } from './gsShim';
import { useAuth } from '../lib/auth';
import { DATASETS } from '../lib/supabase';

import initDeptCost from './screens/deptCost';
import initMatInput from './screens/matInput';
import initProfit from './screens/profit';
import initTrade from './screens/trade';
import initMats from './screens/mats';
import initSupport from './screens/support';
import initDeptSupport from './screens/deptSupport';
import initLotStock from './screens/lotStock';

/** 경로 ↔ 기존 화면 id */
export const PATH_SCREEN: Record<string, string> = {
  '/bu': 'bu-margin', '/bu-real': 'bu-margin-real', '/bu-unit': 'bu-margin-my', '/dept': 'margin-alloc',
  '/dept-cost': 'dept-cost', '/dept-support': 'dept-support', '/trade': 'purchase-sales', '/matinput': 'mat-input', '/stock': 'lot-stock',
  '/settings/alloc': 'alloc-settings', '/settings/items': 'alloc-items', '/settings/materials': 'alloc-mats', '/settings/support': 'support',
};
const SCREEN_PATH: Record<string, string> = Object.fromEntries(Object.entries(PATH_SCREEN).map(([p, s]) => [s, p]));

let booted = false;
function bootOnce(container: HTMLElement) {
  if (booted) return;
  booted = true;
  (window as unknown as { React: unknown }).React = React;
  (window as unknown as { ReactDOM: unknown }).ReactDOM = ReactDOM;
  const lucideShim = { ...lucide, createIcons: (o?: object) => lucide.createIcons({ icons: lucide.icons, ...(o || {}) }) };
  (window as unknown as { lucide: unknown }).lucide = lucideShim;
  installGsShim();
  container.innerHTML = sectionsHtml;
  // 기존 화면 모듈 초기화 (DOM 주입 후)
  for (const init of [initDeptCost, initMatInput, initProfit, initTrade, initMats, initSupport, initDeptSupport, initLotStock]) {
    try { init(); } catch (e) { console.error('legacy init error', e); }
  }
  try { lucideShim.createIcons(); } catch { /* noop */ }
}

export default function LegacyHost() {
  const ref = useRef<HTMLDivElement>(null);
  const loc = useLocation();
  const nav = useNavigate();
  const { employee } = useAuth();
  const screen = PATH_SCREEN[loc.pathname];

  useEffect(() => {
    if (!ref.current) return;
    bootOnce(ref.current);
    setNavHook(id => { const p = SCREEN_PATH[id]; if (p && p !== location.hash.slice(1)) nav(p); });
  }, [nav]);

  useEffect(() => { if (employee) { setUser(employee); loadCloseMonth(); loadAll(); } }, [employee?.login_id]); // eslint-disable-line

  useEffect(() => {
    if (screen) KJHub.showScreen(screen, { fromRouter: true });
    try { (window as unknown as { lucide?: { createIcons: () => void } }).lucide?.createIcons(); } catch { /* noop */ }
  }, [screen]);

  return (
    <div style={{ display: screen ? 'block' : 'none' }}>
      <LoadingStrip />
      <div ref={ref} className="legacy-scope max-w-[1600px] mx-auto" />
    </div>
  );
}

/** 데이터 로딩 상태 한 줄 */
function LoadingStrip() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => onMeta(meta => {
    const el = ref.current; if (!el) return;
    const loading = Object.keys(meta).filter(k => meta[k].state === 'loading').map(k => DATASETS[k]?.label ?? k);
    const errors = Object.keys(meta).filter(k => meta[k].state === 'error').map(k => `${DATASETS[k]?.label ?? k}: ${meta[k].note}`);
    el.textContent = errors.length ? '데이터 오류 · ' + errors.join(' / ') : loading.length ? '데이터 불러오는 중… ' + loading.join(', ') : '';
    el.style.display = el.textContent ? 'block' : 'none';
    el.style.color = errors.length ? 'var(--neg)' : 'var(--fg-3)';
  }), []);
  return <div ref={ref} style={{ display: 'none', fontSize: 12, padding: '6px 20px', background: 'var(--surface)', borderBottom: '1px solid var(--line)' }} />;
}
