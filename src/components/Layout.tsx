import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ChartNoAxesCombined, Building2, Gauge, Users, ReceiptText, Handshake, ArrowLeftRight, FlaskConical, Boxes,
  Upload, FileSpreadsheet, ShieldCheck, Percent, Tags, HandCoins, Split, Landmark, UserCog, History, BookOpen, Menu, LogOut, ChevronDown, Network,
} from 'lucide';
import { useAuth } from '../lib/auth';
import { ymLabel, useUI } from './ui';
import { supabase, type Employee } from '../lib/supabase';
import LegacyHost, { DataStatus } from '../legacy/LegacyHost';
import { HelpHost } from './Help';
import { InstallButton } from './Install';
import { ColTips } from './ColTips';
import { Icon, type IconNode } from './Icon';

// 메뉴 — 보는 사람 기준으로 묶음: 경영(대표·임원) · 부서(팀장) · 거래·재고 · 관리(관리자)
//   path 는 바꾸지 않습니다 (사원별 화면 권한이 path 로 저장돼 있음).
//   perm = 부서 범위 권한으로 보는 화면 · privileged = 전체 권한(관리자·전체) 전용 · admin = 관리자 전용 · userOnly = 전체 권한 사용자에게는 숨김(같은 내용이 경영 메뉴에 있음)
export type Screen = { path: string; title: string; icon: IconNode; admin?: boolean; privileged?: boolean; perm?: boolean; userOnly?: boolean };
const I = (n: unknown) => n as IconNode;
export const SCREENS: { group: string; fold?: boolean; items: Screen[] }[] = [
  { group: '경영', items: [
    { path: '/home', title: '경영 요약', icon: I(LayoutDashboard), privileged: true },
    { path: '/bu-real', title: '손익 현황', icon: I(ChartNoAxesCombined), privileged: true },
    { path: '/bu', title: '본부 성과', icon: I(Building2), privileged: true },
    { path: '/ops', title: '운영 지표', icon: I(Gauge), privileged: true },
  ]},
  { group: '부서', items: [
    { path: '/dept', title: '부서 손익', icon: I(Users), perm: true },
    { path: '/bu-unit', title: '본부 손익', icon: I(Network), perm: true, userOnly: true },
    { path: '/dept-cost', title: '비용 내역', icon: I(ReceiptText), perm: true },
    { path: '/dept-support', title: '지원 내역', icon: I(Handshake), perm: true },
  ]},
  { group: '거래 · 재고', items: [
    { path: '/trade', title: '구매 · 판매', icon: I(ArrowLeftRight), perm: true },
    { path: '/matinput', title: '자재 투입', icon: I(FlaskConical) },
    { path: '/stock', title: '재고', icon: I(Boxes) },
  ]},
  { group: '관리 · 데이터', fold: true, items: [
    { path: '/settings/upload', title: '데이터 올리기', icon: I(Upload), admin: true },
    { path: '/settings/pl', title: '손익계산서 올리기', icon: I(FileSpreadsheet), admin: true },
    { path: '/settings/verify', title: '데이터 점검', icon: I(ShieldCheck), admin: true },
  ]},
  { group: '관리 · 기준 설정', fold: true, items: [
    { path: '/settings/alloc', title: '배분 비율', icon: I(Percent), admin: true },
    { path: '/settings/items', title: '품목 판매가', icon: I(Tags), admin: true },
    { path: '/settings/materials', title: '자재 판매가', icon: I(FlaskConical), admin: true },
    { path: '/settings/support', title: '지원 내역 설정', icon: I(HandCoins), admin: true },
    { path: '/settings/cost-alloc', title: '본부 비용 배분', icon: I(Split), admin: true },
    { path: '/settings/fixed', title: '고정비 기준', icon: I(Landmark), admin: true },
  ]},
  { group: '관리 · 사원', fold: true, items: [
    { path: '/settings/employees', title: '사원 · 권한', icon: I(UserCog), admin: true },
    { path: '/settings/history', title: '변경 이력', icon: I(History), admin: true },
  ]},
  { group: '도움말', items: [
    { path: '/guide', title: '계산 기준', icon: I(BookOpen) },
  ]},
];
const ALL = SCREENS.flatMap(g => g.items);
/** 이 사원이 볼 수 있는 화면인가 */
export function canSee(s: Screen, emp: Employee | null | undefined) {
  if (!emp) return false;
  const isAdmin = emp.role === 'admin', privileged = isAdmin || emp.role === 'all';
  if (s.admin) return isAdmin;
  if (s.privileged) return privileged;
  if (s.userOnly && privileged) return false;
  if (s.perm && !privileged) return ((emp.screen_depts || {})[s.path] || []).length > 0;
  return true;
}
/** 처음 들어갈 화면 */
export const homePath = (emp: Employee | null | undefined) => (ALL.find(s => canSee(s, emp))?.path ?? '/guide');

export default function Layout() {
  const { employee, closeMonth, logout, setCloseMonth } = useAuth();
  const { toast } = useUI();
  const loc = useLocation();
  const isAdmin = employee?.role === 'admin';
  const [drawer, setDrawer] = useState(false);
  const [fold, setFold] = useState<Record<string, boolean>>({});
  useEffect(() => { setDrawer(false); }, [loc.pathname]); // 화면을 고르면 메뉴 닫기
  useEffect(() => { document.body.style.overflow = drawer ? 'hidden' : ''; return () => { document.body.style.overflow = ''; }; }, [drawer]);
  const groups = useMemo(() => SCREENS.map(g => ({ ...g, items: g.items.filter(i => canSee(i, employee)) })).filter(g => g.items.length), [employee]);
  const current = ALL.find(i => loc.pathname === i.path || loc.pathname.startsWith(i.path + '/'));
  const curGroup = SCREENS.find(g => g.items.some(i => i === current))?.group;
  const saveClose = async (val: string) => {
    const v = val.replace('-', ''); if (!/^\d{6}$/.test(v)) return;
    const { error } = await supabase.rpc('save_config', { p_key: 'closeMonth', p_value: v, p_summary: '마감월 ' + ymLabel(v) });
    if (error) return toast(error.message, 'err');
    setCloseMonth(v); (window as unknown as { KJHub?: { setCloseMonth: (m: string) => void } }).KJHub?.setCloseMonth(v);
    toast('마감월을 ' + ymLabel(v) + '로 저장했습니다.');
  };
  return (
    <div className={'shell' + (drawer ? ' open' : '')}>
      <div className="side-ov" onClick={() => setDrawer(false)} />
      <aside className="side" aria-label="메뉴">
        <NavLink to="/" className="side-brand" end>
          <img src={import.meta.env.BASE_URL + 'logo.png'} alt="" />
          <span><b>KJ Expense</b><small>국전 경영 현황</small></span>
        </NavLink>
        <nav className="side-nav">
          {groups.map(g => {
            const active = g.items.some(i => loc.pathname.startsWith(i.path));
            const closed = g.fold ? (fold[g.group] ?? !active) : false;
            return (
              <div key={g.group}>
                {g.fold
                  ? <button className="side-gt" style={{ display: 'flex', width: '100%', alignItems: 'center', border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'left' }} onClick={() => setFold(f => ({ ...f, [g.group]: !closed }))} aria-expanded={!closed}>{g.group}<span className="sp" /><Icon i={I(ChevronDown)} size={14} style={{ transform: closed ? 'rotate(-90deg)' : undefined, transition: 'transform .15s' }} /></button>
                  : <div className="side-gt">{g.group}</div>}
                {!closed && g.items.map(i => <NavLink key={i.path} to={i.path}><Icon i={i.icon} />{i.title}</NavLink>)}
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          <div className="side-user">
            <span className="avatar">{employee?.name?.slice(0, 1) ?? '?'}</span>
            <div><b>{employee?.name}</b><small>{[employee?.dept, employee?.grade].filter(Boolean).join(' · ')}</small></div>
            <button className="btn sm ghost" onClick={logout} title="로그아웃" aria-label="로그아웃" style={{ padding: 6 }}><Icon i={I(LogOut)} size={16} /></button>
          </div>
          <InstallButton block />
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="hamb" aria-label="메뉴 열기" onClick={() => setDrawer(true)}><Icon i={I(Menu)} size={22} /></button>
          <img className="mlogo" src={import.meta.env.BASE_URL + 'logo.png'} alt="" />
          <div className="crumb">{curGroup && <span className="d-only">{curGroup.replace(/ · .*/, '')}</span>}{curGroup && <span className="d-only">›</span>}<b>{current?.title ?? 'KJ Expense'}</b></div>
          <span className="sp" />
          <span className="closing" title="데이터 마감이 끝난 가장 최근 달. 화면의 기준월은 이 달로 시작합니다.">
            <span className="cl-l">마감월</span>
            {isAdmin
              ? <input id="close-month" type="month" value={closeMonth ? closeMonth.slice(0, 4) + '-' + closeMonth.slice(4, 6) : ''} onChange={e => saveClose(e.target.value)} aria-label="마감월 (관리자)" />
              : <b>{ymLabel(closeMonth)}</b>}
          </span>
          <DataStatus />
        </header>
        <div className="content">
          <LegacyHost />
          <Outlet />
        </div>
        {!loc.pathname.startsWith('/settings') && loc.pathname !== '/guide' && (
          <footer className="pagefoot">
            금액 단위는 원입니다. 큰 글씨의 억·만은 반올림한 값입니다. 제목 옆 (?)와 점선 밑줄 열 이름을 누르면 계산 방법이 나옵니다. <NavLink to="/guide">계산 기준 보기 →</NavLink>
          </footer>
        )}
      </div>
      <HelpHost />
      <ColTips />
    </div>
  );
}
