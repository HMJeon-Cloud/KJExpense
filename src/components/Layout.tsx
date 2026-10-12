import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ymLabel } from './ui';

// 화면 레지스트리 — 3단계에서 기존 화면을 옮기며 채웁니다.
export const SCREENS: { group: string; items: { path: string; title: string; admin?: boolean; privileged?: boolean }[] }[] = [
  { group: '수익/비용', items: [
    { path: '/bu', title: '국전 수익/비용', privileged: true },
    { path: '/bu-real', title: '국전 수익/비용(실현 수익)', privileged: true },
    { path: '/bu-unit', title: '사업단위 수익/비용' },
    { path: '/dept', title: '부서별 수익/비용' },
    { path: '/dept-cost', title: '부서별 비용' },
    { path: '/dept-support', title: '부서별 지원 내역' },
  ]},
  { group: '구매/판매', items: [
    { path: '/trade', title: '구매/판매' },
    { path: '/matinput', title: '실자재투입 내역' },
    { path: '/stock', title: 'Lot별 재고조회' },
  ]},
  { group: '설정', items: [
    { path: '/settings/alloc', title: '배분 비율 설정(부서)', admin: true },
    { path: '/settings/items', title: '품목', admin: true },
    { path: '/settings/materials', title: '원자재', admin: true },
    { path: '/settings/support', title: '지원 내역 설정', admin: true },
    { path: '/settings/employees', title: '사원 관리', admin: true },
    { path: '/settings/upload', title: '데이터 업로드', admin: true },
    { path: '/settings/history', title: '변경 이력 · 복구', admin: true },
  ]},
];

export default function Layout() {
  const { employee, closeMonth, logout } = useAuth();
  const loc = useLocation();
  const isAdmin = employee?.role === 'admin';
  const privileged = isAdmin || employee?.role === 'all';
  return (
    <>
      <header className="topbar">
        <img src={import.meta.env.BASE_URL + 'logo.png'} alt="" />
        <span className="brand">국전 비용 현황<small>마감월 {ymLabel(closeMonth)}</small></span>
        <nav className="nav">
          {SCREENS.map(g => {
            const items = g.items.filter(i => (!i.admin || isAdmin) && (!i.privileged || privileged));
            if (!items.length) return null;
            const on = items.some(i => loc.pathname.startsWith(i.path));
            return (
              <div className="grp" key={g.group}>
                <button className={on ? 'on' : ''}>{g.group}</button>
                <div className="menu">{items.map(i => <NavLink key={i.path} to={i.path}>{i.title}</NavLink>)}</div>
              </div>
            );
          })}
        </nav>
        <span className="sp" />
        <span className="user">
          <span className="avatar">{employee?.name?.slice(0, 1) ?? '?'}</span>
          {employee?.name} · {employee?.dept} {employee?.grade}
          <button className="btn sm ghost" onClick={logout}>로그아웃</button>
        </span>
      </header>
      <Outlet />
    </>
  );
}
