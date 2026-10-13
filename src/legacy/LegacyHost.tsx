// 기존(Apps Script 판) 화면들을 새 앱 안에서 그대로 띄우는 호스트.
// 3-A 단계: 데이터·설정·로그인은 Supabase, 화면 코드는 기존 그대로. 3-B 에서 화면별로 새 디자인으로 교체합니다.
import { useEffect, useRef, useState } from 'react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import * as lucide from 'lucide';
import { useLocation, useNavigate } from 'react-router-dom';
import sectionsHtml from './sections.html?raw';
import './legacy.css';
import './legacy-skin.css';
import { KJHub, setNavHook, setUser, loadAll, loadForScreen, loadCloseMonth, onMeta, cacheClear, beginModule, endModule } from './hub';
import { installGsShim } from './gsShim';
import { useAuth } from '../lib/auth';
import { DATASETS } from '../lib/supabase';
import { registerDrill } from '../pages/DeptCost';

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
/** 새 디자인(React)으로 교체된 화면 — 기존 화면은 계산만 하고 보이지 않음 */
export const REACT_SCREENS = new Set(['bu-margin', 'bu-margin-my', 'bu-margin-real', 'margin-alloc', 'dept-cost', 'purchase-sales', 'mat-input', 'lot-stock', 'dept-support', 'alloc-settings', 'alloc-items', 'alloc-mats', 'support']);

let booted = false;
function bootOnce(container: HTMLElement) {
  if (booted) return;
  booted = true;
  (window as unknown as { React: unknown }).React = React;
  (window as unknown as { ReactDOM: unknown }).ReactDOM = ReactDOM;
  const lucideShim = { ...lucide, createIcons: (o?: object) => lucide.createIcons({ icons: lucide.icons, ...(o || {}) }) };
  (window as unknown as { lucide: unknown }).lucide = lucideShim;
  installGsShim();
  (KJHub as unknown as { isReactScreen: (id: string) => boolean }).isReactScreen = (id: string) => REACT_SCREENS.has(id);
  container.innerHTML = sectionsHtml;
  // 기존 화면 모듈 초기화 (DOM 주입 후)
  const mods: [string, () => void][] = [['deptCost', initDeptCost], ['matInput', initMatInput], ['profit', initProfit], ['trade', initTrade], ['mats', initMats], ['support', initSupport], ['deptSupport', initDeptSupport], ['lotStock', initLotStock]];
  for (const [name, init] of mods) {
    beginModule(name);
    try { init(); } catch (e) { console.error('legacy init error', name, e); }
    endModule();
  }
  try { lucideShim.createIcons(); } catch { /* noop */ }
  registerDrill(); // 기존 모듈이 덮어쓴 전표 드릴 함수를 새 화면 것으로 되돌림
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

  useEffect(() => { if (employee) { setUser(employee); loadCloseMonth(); } }, [employee?.login_id]); // eslint-disable-line

  useEffect(() => {
    if (screen) { KJHub.showScreen(screen, { fromRouter: true }); if (employee) loadForScreen(screen); }
  }, [screen, employee?.login_id]); // eslint-disable-line

  return (
    <div style={{ display: screen ? 'block' : 'none' }}>
      {!REACT_SCREENS.has(screen || '') && <LoadingStrip />}
      <div ref={ref} className="legacy-scope max-w-[1600px] mx-auto" style={{ display: REACT_SCREENS.has(screen || '') ? 'none' : 'block' }} />
    </div>
  );
}

/** 상단 바용 데이터 상태: 점 + 상태 글자, 누르면 데이터셋별 상세와 "다시 불러오기" */
export function DataStatus() {
  const [meta, setMeta] = useState<Record<string, { state: string; note: string }>>(() => ({ ...(KJHub.meta || {}) }));
  const [open, setOpen] = useState(false);
  useEffect(() => { setMeta({ ...(KJHub.meta || {}) }); return onMeta(m => setMeta({ ...m })); }, []);
  useEffect(() => { if (!open) return; const h = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.dstat')) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);
  const keys = Object.keys(DATASETS);
  const loading = keys.filter(k => meta[k]?.state === 'loading');
  const errors = keys.filter(k => meta[k]?.state === 'error');
  const ready = keys.filter(k => meta[k]?.state === 'ready');
  const color = errors.length ? 'var(--neg)' : loading.length ? '#f5b400' : ready.length === keys.length ? '#3aa63a' : 'var(--fg-3)';
  const label = errors.length ? `오류 ${errors.length}` : loading.length ? '불러오는 중' : `데이터 ${ready.length}/${keys.length}`;
  return (
    <span className="dstat" style={{ position: 'relative', marginRight: 10 }}>
      <button className="btn sm ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }} onClick={() => setOpen(o => !o)} title="데이터 상태 · 다시 불러오기">
        {loading.length > 0 ? <span className="spinner" style={{ width: 10, height: 10 }} /> : <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 99, background: color }} />}
        <span>{label}</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 50, width: 300, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.08)', padding: 10, display: 'grid', gap: 6, fontSize: 12 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}><b>데이터 상태</b><span className="sp" /><button className="btn sm" onClick={async () => { setOpen(false); await cacheClear(); await loadAll(true); }} title="브라우저 캐시를 지우고 서버에서 다시 받습니다">다시 불러오기</button></div>
          {keys.map(k => { const m = meta[k] || { state: 'idle', note: '' }; const c = m.state === 'ready' ? '#3aa63a' : m.state === 'error' ? 'var(--neg)' : m.state === 'loading' ? '#f5b400' : 'var(--line-2)';
            return <div key={k} className="row" style={{ gap: 8, alignItems: 'center' }}><i style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 99, background: c, flex: 'none' }} /><span style={{ width: 110, flex: 'none' }}>{DATASETS[k].label}</span><span className="help" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.state === 'ready' ? m.note : m.state === 'error' ? '오류: ' + m.note : m.state === 'loading' ? '불러오는 중' : '아직 안 받음'}</span></div>; })}
        </div>
      )}
    </span>
  );
}

/** 데이터 상태 패널: 데이터셋별 건수·상태, 다시 불러오기 */
function LoadingStrip() {
  const [meta, setMeta] = useState<Record<string, { state: string; note: string }>>(() => ({ ...(KJHub.meta || {}) }));
  const [open, setOpen] = useState(false);
  useEffect(() => { setMeta({ ...(KJHub.meta || {}) }); return onMeta(m => setMeta({ ...m })); }, []);
  const keys = Object.keys(DATASETS);
  const loading = keys.filter(k => meta[k]?.state === 'loading');
  const errors = keys.filter(k => meta[k]?.state === 'error');
  const ready = keys.filter(k => meta[k]?.state === 'ready');
  const summary = errors.length ? `데이터 오류 ${errors.length}건` : loading.length ? `불러오는 중… ${loading.map(k => DATASETS[k].label).join(', ')}` : `데이터 ${ready.length}/${keys.length}종 준비됨`;
  return (
    <div style={{ fontSize: 12, padding: '4px 20px', background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
      <div className="row" style={{ gap: 10 }}>
        {loading.length > 0 && <span className="spinner" />}
        <span style={{ color: errors.length ? 'var(--neg)' : 'var(--fg-3)' }}>{summary}</span>
        <button className="btn sm ghost" onClick={() => setOpen(o => !o)}>{open ? '접기' : '상세'}</button>
        <button className="btn sm ghost" onClick={async () => { await cacheClear(); await loadAll(true); }} title="브라우저 캐시를 지우고 서버에서 다시 받습니다">다시 불러오기</button>
      </div>
      {open && (
        <div className="row" style={{ gap: 6, paddingBlock: 6 }}>
          {keys.map(k => { const m = meta[k] || { state: 'idle', note: '' }; const cls = m.state === 'ready' ? 'g' : m.state === 'error' ? 'n' : m.state === 'loading' ? 'y' : 'gr';
            return <span key={k} className={'tag ' + cls} title={m.note}>{DATASETS[k].label} · {m.state === 'ready' ? m.note : m.state === 'error' ? '오류: ' + m.note : m.state === 'loading' ? '로딩' : '대기'}</span>; })}
        </div>
      )}
    </div>
  );
}
