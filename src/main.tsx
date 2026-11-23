import Ops from './pages/Ops';
import CostAllocSettings from './pages/CostAllocSettings';
import PlSettings from './pages/PlSettings';
import Guide from './pages/Guide';
import Home from './pages/Home';
import FixedCostSettings from './pages/FixedCostSettings';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles/app.css';
import { AuthProvider, useAuth } from './lib/auth';
import { UIProvider } from './components/ui';
import Layout, { homePath, canSee, screenOf } from './components/Layout';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Upload from './pages/Upload';
import Employees from './pages/Employees';
import History from './pages/History';
import Placeholder from './pages/Placeholder';
import BuDashboard from './pages/BuDashboard';
import DeptDashboard from './pages/DeptDashboard';
import DeptCost from './pages/DeptCost';
import Trade from './pages/Trade';
import MatInput from './pages/MatInput';
import LotStock from './pages/LotStock';
import DeptSupport from './pages/DeptSupport';
import AllocGroups from './pages/AllocGroups';
import AllocPrices from './pages/AllocPrices';
import SupportSettings from './pages/SupportSettings';
import Verify from './pages/Verify';
import { PATH_SCREEN } from './legacy/LegacyHost';
import { useLocation } from 'react-router-dom';

function Gate() {
  const { session, employee, loading } = useAuth();
  if (loading) return <div className="empty"><span className="spinner" /></div>;
  if (!session) return <Login />;
  if (!employee) return (
    <div className="page"><div className="card"><div className="empty">로그인은 됐지만 사원 정보가 없습니다. 관리자에게 사원 등록을 요청해 주세요.<br /><button className="btn" style={{ marginTop: 12 }} onClick={() => location.reload()}>다시 시도</button></div></div></div>
  );
  if (employee.must_change_pw) return <ChangePassword forced />;
  const isAdmin = employee.role === 'admin';
  const privileged = isAdmin || employee.role === 'all';
  // 화면마다 볼 수 있는지 확인합니다 (메뉴에 안 나오는 화면은 주소를 직접 쳐도 열리지 않게).
  const G = (path: string, el: React.ReactElement) => {
    const scr = screenOf(path);
    if (!scr || canSee(scr, employee)) return el;
    return <Navigate to={path === '/bu-unit' && privileged ? '/bu' : homePath(employee)} replace />;
  };
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to={homePath(employee)} replace />} />
        <Route path="/password" element={<ChangePassword />} />
        <Route path="/home" element={G('/home', <Home />)} />
        <Route path="/bu-real" element={G('/bu-real', <BuDashboard variant="-real" title="손익 현황" />)} />
        <Route path="/bu" element={G('/bu', <BuDashboard variant="" title="본부 성과" />)} />
        <Route path="/ops" element={G('/ops', <Ops />)} />
        <Route path="/bu-unit" element={G('/bu-unit', <BuDashboard variant="-my" title="본부 성과" />)} />
        <Route path="/dept" element={G('/dept', <DeptDashboard />)} />
        <Route path="/dept-cost" element={G('/dept-cost', <DeptCost />)} />
        <Route path="/dept-support" element={G('/dept-support', <DeptSupport />)} />
        <Route path="/trade" element={G('/trade', <Trade />)} />
        <Route path="/matinput" element={G('/matinput', <MatInput />)} />
        <Route path="/stock" element={G('/stock', <LotStock />)} />
        <Route path="/settings/upload" element={G('/settings/upload', <Upload />)} />
        <Route path="/settings/pl" element={G('/settings/pl', <PlSettings />)} />
        <Route path="/settings/verify" element={G('/settings/verify', <Verify />)} />
        <Route path="/settings/alloc" element={G('/settings/alloc', <AllocGroups />)} />
        <Route path="/settings/items" element={G('/settings/items', <AllocPrices kind="items" />)} />
        <Route path="/settings/materials" element={G('/settings/materials', <AllocPrices kind="mats" />)} />
        <Route path="/settings/support" element={G('/settings/support', <SupportSettings />)} />
        <Route path="/settings/cost-alloc" element={G('/settings/cost-alloc', <CostAllocSettings />)} />
        <Route path="/settings/fixed" element={G('/settings/fixed', <FixedCostSettings />)} />
        <Route path="/settings/employees" element={G('/settings/employees', <Employees />)} />
        <Route path="/settings/history" element={G('/settings/history', <History />)} />
        <Route path="/guide" element={<Guide />} />
        <Route path="*" element={<LegacyOrPlaceholder isAdmin={isAdmin} />} />
      </Route>
    </Routes>
  );
}

function LegacyOrPlaceholder({ isAdmin }: { isAdmin: boolean }) {
  const loc = useLocation();
  if (loc.pathname.startsWith('/settings') && !isAdmin) return <Navigate to="/" replace />;
  return PATH_SCREEN[loc.pathname] ? null : <Placeholder />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UIProvider><AuthProvider><HashRouter><Gate /></HashRouter></AuthProvider></UIProvider>
  </React.StrictMode>,
);

// 앱 설치(PWA)용 서비스 워커 — 배포 주소(/저장소이름/) 아래에서만
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js', { scope: import.meta.env.BASE_URL }).catch(() => { /* 설치 기능만 빠짐 */ }); });
}
