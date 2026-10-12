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
        <Route path="/password" element={<ChangePassword />} />
        <Route path="*" element={<Placeholder />} />
      </Route>
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UIProvider><AuthProvider><HashRouter><Gate /></HashRouter></AuthProvider></UIProvider>
  </React.StrictMode>,
);
