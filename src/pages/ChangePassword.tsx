import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { useUI } from '../components/ui';

export default function ChangePassword({ forced }: { forced?: boolean }) {
  const { changePassword, employee, logout } = useAuth();
  const { toast } = useUI();
  const [a, setA] = useState(''); const [b, setB] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const valid = a.length >= 8 && /[a-zA-Z]/.test(a) && /\d/.test(a);

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('');
    if (!valid) return setErr('8자 이상, 영문과 숫자를 모두 포함해야 합니다.');
    if (a !== b) return setErr('두 비밀번호가 다릅니다.');
    if (employee && a.toLowerCase() === employee.login_id.toLowerCase()) return setErr('사원 ID와 같은 비밀번호는 쓸 수 없습니다.');
    setBusy(true);
    try { await changePassword(a); toast('비밀번호를 변경했습니다.'); setA(''); setB(''); } catch (ex) { setErr((ex as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="login">
      <div className="hero">
        <img src={import.meta.env.BASE_URL + 'logo.png'} alt="" />
        <h1>{forced ? '첫 로그인입니다' : '비밀번호 변경'}</h1>
        <p>{forced ? '초기 비밀번호(사원 ID)를 새 비밀번호로 바꿔야 계속 쓸 수 있습니다.' : '새 비밀번호를 입력하세요.'}</p>
      </div>
      <form className="form" onSubmit={submit}>
        <h2>{employee?.name} <span className="tag y">비밀번호 변경 {forced ? '필수' : ''}</span></h2>
        <div className="field"><label htmlFor="pw1">새 비밀번호</label><input id="pw1" className="inp" type="password" value={a} onChange={e => setA(e.target.value)} placeholder="8자 이상, 영문+숫자" autoComplete="new-password" autoFocus /></div>
        <div className="field"><label htmlFor="pw2">새 비밀번호 확인</label><input id="pw2" className="inp" type="password" value={b} onChange={e => setB(e.target.value)} autoComplete="new-password" /></div>
        {err && <div className="err">{err}</div>}
        <button className="btn acc" style={{ padding: 10, fontSize: 14, justifyContent: 'center' }} disabled={busy}>{busy ? <span className="spinner" /> : '변경하고 시작하기'}</button>
        {forced && <button type="button" className="btn ghost" onClick={logout}>로그아웃</button>}
      </form>
    </div>
  );
}
