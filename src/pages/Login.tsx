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
      if (error) throw new Error(error.message.includes('이메일') ? '최초 관리자로 지정된 이메일이 아닙니다.' : error.message);
      await login(bs.login_id.trim(), bs.login_id.trim());
    } catch (ex) { setErr((ex as Error).message); } finally { setBusy(false); }
  }
  const setB = (k: keyof typeof bs, v: string) => setBs(s => ({ ...s, [k]: v }));

  return (
    <div className="login">
      <div className="hero">
        <img src={import.meta.env.BASE_URL + 'logo.png'} alt="" />
        <h1>KJ Expense</h1>
        <p>부서별 수익·비용과 구매/판매, 지원 내역을 한 곳에서 봅니다.</p>
        {closeMonth && <p className="help" style={{ marginTop: 28 }}>마감월 {ymLabel(closeMonth)}</p>}
      </div>
      {bootstrap ? (
        <form className="form" onSubmit={setup}>
          <h2>최초 설정 <span className="tag o">관리자 등록</span></h2>
          <span className="help">아직 사원정보가 없습니다. 최초 관리자 본인 정보를 입력하면 계정이 만들어지고 바로 로그인됩니다. 이후 사원정보는 설정 &gt; 사원 관리에서 입력합니다.</span>
          <div className="field"><label htmlFor="bs-name">이름</label><input id="bs-name" className="inp" value={bs.name} onChange={e => setB('name', e.target.value)} autoFocus /></div>
          <div className="field"><label htmlFor="bs-id">사원 ID (로그인 ID · 초기 비밀번호)</label><input id="bs-id" className="inp" value={bs.login_id} onChange={e => setB('login_id', e.target.value)} /></div>
          <div className="field"><label htmlFor="bs-email">이메일 (최초 관리자로 지정된 주소)</label><input id="bs-email" className="inp" type="email" value={bs.email} onChange={e => setB('email', e.target.value)} /></div>
          <div className="field"><label htmlFor="bs-dept">부서</label><input id="bs-dept" className="inp" value={bs.dept} onChange={e => setB('dept', e.target.value)} /></div>
          {err && <div className="err">{err}</div>}
          <button className="btn acc" style={{ padding: 10, fontSize: 14, justifyContent: 'center' }} disabled={busy || !bs.name || !bs.login_id || !bs.email}>{busy ? <span className="spinner" /> : '등록하고 시작하기'}</button>
        </form>
      ) : (
        <form className="form" onSubmit={submit}>
          <h2>로그인</h2>
          <div className="field"><label htmlFor="login-id">사원 ID</label><input id="login-id" className="inp" value={id} onChange={e => setId(e.target.value)} autoComplete="username" autoFocus /></div>
          <div className="field"><label htmlFor="login-pw">비밀번호</label><input id="login-pw" className="inp" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" />
            <span className="help">처음 접속 시 비밀번호는 사원 ID와 같습니다. 로그인 후 바로 변경합니다.</span></div>
          {err && <div className="err">{err}</div>}
          <button className="btn pri" style={{ padding: 10, fontSize: 14, justifyContent: 'center' }} disabled={busy || !id || !pw}>{busy ? <span className="spinner" /> : '로그인'}</button>
        </form>
      )}
    </div>
  );
}
