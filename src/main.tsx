import Ops from './pages/Ops';
import CostAllocSettings from './pages/CostAllocSettings';
import FixedCostSettings from './pages/FixedCostSettings';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles/app.css';
import { AuthProvider, useAuth } from './lib/auth';
import { UIProvider } from './components/ui';
import Layout from './components/Layout';
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
    <div className="page"><div className="card"><div className="empty">로그인은 됐지만 사원 정보가 없습니다. 관리자에게 사원 등록을 요청하세요.<br /><button className="btn" style={{ marginTop: 12 }} onClick={() => location.reload()}>다시 시도</button></div></div></div>
  );
  if (employee.must_change_pw) return <ChangePassword forced />;
  const isAdmin = employee.role === 'admin';
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to={isAdmin ? '/bu' : '/dept'} replace />} />
        <Route path="/settings/upload" element={isAdmin ? <Upload /> : <Navigate to="/" />} />
        <Route path="/settings/employees" element={isAdmin ? <Employees /> : <Navigate to="/" />} />
        <Route path="/settings/history" element={isAdmin ? <History /> : <Navigate to="/" />} />
        <Route path="/settings/verify" element={isAdmin ? <Verify /> : <Navigate to="/" />} />
        <Route path="/password" element={<ChangePassword />} />
        <Route path="/bu" element={<BuDashboard variant="" title="국전 수익/비용" />} />
        <Route path="/bu-real" element={<BuDashboard variant="-real" title="국전 수익/비용 (실현 수익)" />} />
        <Route path="/bu-unit" element={<BuDashboard variant="-my" title="사업단위 수익/비용" />} />
        <Route path="/dept" element={<DeptDashboard />} />
        <Route path="/ops" element={<Ops />} />
        <Route path="/dept-cost" element={<DeptCost />} />
        <Route path="/trade" element={<Trade />} />
        <Route path="/matinput" element={<MatInput />} />
        <Route path="/stock" element={<LotStock />} />
        <Route path="/dept-support" element={<DeptSupport />} />
        <Route path="/settings/alloc" element={isAdmin ? <AllocGroups /> : <Navigate to="/" />} />
        <Route path="/settings/items" element={isAdmin ? <AllocPrices kind="items" /> : <Navigate to="/" />} />
        <Route path="/settings/materials" element={isAdmin ? <AllocPrices kind="mats" /> : <Navigate to="/" />} />
        <Route path="/settings/support" element={<SupportSettings />} />
        <Route path="/settings/fixed" element={isAdmin ? <FixedCostSettings /> : <Navigate to="/" />} />
        <Route path="/settings/cost-alloc" element={isAdmin ? <CostAllocSettings /> : <Navigate to="/" />} />
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
