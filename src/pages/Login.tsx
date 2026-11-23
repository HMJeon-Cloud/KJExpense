import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { ymLabel } from '../components/ui';

export default function Login() {
  const { login, closeMonth } = useAuth();
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [bootstrap, setBootstrap] = useState(false);
  const [bs, setBs] = useState({ login_id: '', name: '', email: '', dept: '' });

  useEffect(() => { supabase.rpc('needs_bootstrap').then(({ data }) => setBootstrap(data === true)); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await login(id, pw); } catch (ex) { setErr((ex as Error).message); } finally { setBusy(false); }
  }
  async function setup(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const { error } = await supabase.rpc('bootstrap_admin', { p_login_id: bs.login_id.trim(), p_name: bs.name.trim(), p_email: bs.email.trim(), p_dept: bs.dept.trim() || null });
      if (error) throw new Error(error.message.includes('이메일') ? '처음 관리자로 정해 둔 이메일이 아닙니다.' : error.message);
      await login(bs.login_id.trim(), bs.login_id.trim());
    } catch (ex) { setErr((ex as Error).message); } finally { setBusy(false); }
  }
  const setB = (k: keyof typeof bs, v: string) => setBs(s => ({ ...s, [k]: v }));

  return (
    <div className="login">
      <div className="hero">
        <img src={import.meta.env.BASE_URL + 'logo.png'} alt="" />
        <i className="blob" aria-hidden="true" />
        <h1>KJ Expense</h1>
        <p>회사 손익부터 부서 비용, LOT별 구매 · 판매까지 한곳에서 봅니다.</p>
        <ul>
          <li><i style={{ background: 'var(--blue)' }} />경영 — 영업이익 · 본부 성과 · 운영 지표</li>
          <li><i style={{ background: 'var(--green)' }} />부서 — 배분 이익 · 비용 · 전표</li>
          <li><i style={{ background: 'var(--orange)' }} />거래 · 재고 — 구매 · 판매 · 자재 · 재고</li>
        </ul>
        {closeMonth && <p className="help" style={{ marginTop: 26 }}>지금 마감월은 {ymLabel(closeMonth)}입니다.</p>}
      </div>
      {bootstrap ? (
        <form className="form" onSubmit={setup}>
          <h2>처음 설정 <span className="tag o">관리자 등록</span></h2>
          <span className="help">아직 등록된 사원이 없습니다. 관리자 본인 정보를 넣으면 계정이 만들어지고 바로 로그인됩니다. 다른 사원은 [사원 · 권한]에서 등록합니다.</span>
          <div className="field"><label htmlFor="bs-name">이름</label><input id="bs-name" className="inp" value={bs.name} onChange={e => setB('name', e.target.value)} autoFocus /></div>
          <div className="field"><label htmlFor="bs-id">사원 ID (로그인할 때 쓰고, 첫 비밀번호도 같습니다)</label><input id="bs-id" className="inp" value={bs.login_id} onChange={e => setB('login_id', e.target.value)} /></div>
          <div className="field"><label htmlFor="bs-email">이메일 (처음 관리자로 정해 둔 주소)</label><input id="bs-email" className="inp" type="email" value={bs.email} onChange={e => setB('email', e.target.value)} /></div>
          <div className="field"><label htmlFor="bs-dept">부서</label><input id="bs-dept" className="inp" value={bs.dept} onChange={e => setB('dept', e.target.value)} /></div>
          {err && <div className="err">{err}</div>}
          <button className="btn pri" disabled={busy || !bs.name || !bs.login_id || !bs.email}>{busy ? <span className="spinner" /> : '등록하고 시작하기'}</button>
        </form>
      ) : (
        <form className="form" onSubmit={submit}>
          <h2>로그인</h2>
          <div className="field"><label htmlFor="login-id">사원 ID</label><input id="login-id" className="inp" value={id} onChange={e => setId(e.target.value)} autoComplete="username" autoFocus /></div>
          <div className="field"><label htmlFor="login-pw">비밀번호</label><input id="login-pw" className="inp" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" />
            <span className="help">처음에는 비밀번호가 사원 ID와 같습니다. 로그인하면 바로 새 비밀번호를 정합니다.</span></div>
          {err && <div className="err">{err}</div>}
          <button className="btn pri" disabled={busy || !id || !pw}>{busy ? <span className="spinner" /> : '로그인'}</button>
        </form>
      )}
    </div>
  );
}
