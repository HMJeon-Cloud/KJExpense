import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { useUI } from '../components/ui';
import { initialPassword } from '../lib/supabase';

export default function ChangePassword({ forced }: { forced?: boolean }) {
  const { changePassword, employee, logout } = useAuth();
  const { toast } = useUI();
  const [a, setA] = useState(''); const [b, setB] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const valid = a.length >= 8 && /[a-zA-Z]/.test(a) && /\d/.test(a);

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('');
    if (!valid) return setErr('8자 이상으로, 영문과 숫자를 모두 넣어 주세요.');
    if (a !== b) return setErr('두 칸의 비밀번호가 서로 다릅니다.');
    if (employee && a.toLowerCase() === employee.login_id.toLowerCase()) return setErr('사원 ID와 같은 비밀번호는 쓸 수 없습니다.');
    if (employee && a.toLowerCase() === initialPassword(employee.login_id, employee.emp_no).toLowerCase()) return setErr('첫 비밀번호(k + 사번)와 다른 비밀번호를 정해 주세요.');
    setBusy(true);
    try { await changePassword(a); toast('비밀번호를 바꿨습니다.'); setA(''); setB(''); } catch (ex) { setErr((ex as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="login">
      <div className="hero">
        <img src={import.meta.env.BASE_URL + 'logo.png'} alt="" />
        <i className="blob" aria-hidden="true" />
        <h1>{forced ? '처음 오셨네요' : '비밀번호 바꾸기'}</h1>
        <p>{forced ? '첫 비밀번호(k + 사번)를 새 비밀번호로 바꾸면 바로 쓸 수 있습니다.' : '새 비밀번호를 넣어 주세요.'}</p>
      </div>
      <form className="form" onSubmit={submit}>
        <h2>{employee?.name} <span className="tag y">{forced ? '새 비밀번호를 정해 주세요' : '비밀번호 바꾸기'}</span></h2>
        <div className="field"><label htmlFor="pw1">새 비밀번호</label><input id="pw1" className="inp" type="password" value={a} onChange={e => setA(e.target.value)} placeholder="8자 이상, 영문과 숫자" autoComplete="new-password" autoFocus /></div>
        <div className="field"><label htmlFor="pw2">한 번 더 입력</label><input id="pw2" className="inp" type="password" value={b} onChange={e => setB(e.target.value)} autoComplete="new-password" /></div>
        {err && <div className="err">{err}</div>}
        <button className="btn pri" disabled={busy}>{busy ? <span className="spinner" /> : '바꾸고 시작하기'}</button>
        {forced && <button type="button" className="btn ghost" onClick={logout}>로그아웃</button>}
      </form>
    </div>
  );
}
