import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, pseudoEmail, logAccess, type Employee } from './supabase';

type AuthState = {
  session: Session | null;
  employee: Employee | null;
  closeMonth: string;              // 'YYYYMM'
  loading: boolean;
  login: (loginId: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (pw: string) => Promise<void>;
  refresh: () => Promise<void>;
  setCloseMonth: (ym: string) => void;
};

const Ctx = createContext<AuthState>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [closeMonth, setCloseMonth] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadEmployee(s: Session | null) {
    if (!s) { setEmployee(null); return; }
    const { data } = await supabase.from('employees').select('*').eq('auth_uid', s.user.id).maybeSingle();
    const emp = (data as Employee) ?? null;
    if (emp && !emp.active) { await supabase.auth.signOut(); setEmployee(null); throw new Error('비활성 처리된 계정입니다. 관리자에게 문의하세요.'); }
    setEmployee(emp);
    const { data: cm } = await supabase.from('config').select('value').eq('key', 'closeMonth').maybeSingle();
    setCloseMonth(typeof cm?.value === 'string' ? cm.value : '');
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => { setSession(data.session); try { await loadEmployee(data.session); } catch { setSession(null); } setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); if (!s) setEmployee(null); });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthState = {
    session, employee, closeMonth, loading,
    async login(loginId, password) {
      const id = loginId.trim();
      const { data: needsSignup } = await supabase.rpc('login_needs_signup', { p_login_id: id });
      let session: Session | null = null;
      if (needsSignup) {
        // 첫 로그인: 초기 비밀번호(= 사원 ID) 확인 후 계정을 만들고 바로 로그인
        if (password !== id) { await logAccess(id, 'login', false, { msg: 'initial password mismatch' }); throw new Error('첫 로그인입니다. 초기 비밀번호는 사원 ID와 같습니다.'); }
        const { data, error } = await supabase.auth.signUp({ email: pseudoEmail(id), password, options: { data: { login_id: id } } });
        if (error) throw new Error('계정 생성 실패: ' + error.message);
        session = data.session;
      }
      if (!session) {
        const { data, error } = await supabase.auth.signInWithPassword({ email: pseudoEmail(id), password });
        if (error) { await logAccess(id, 'login', false, { msg: error.message }); throw new Error('사원 ID 또는 비밀번호가 올바르지 않습니다.'); }
        session = data.session;
      }
      if (needsSignup) await supabase.rpc('link_my_account', { p_login_id: id });
      await loadEmployee(session);
      await logAccess(id, 'login', true);
    },
    async logout() { await logAccess(employee?.login_id ?? null, 'logout'); await supabase.auth.signOut(); setEmployee(null); },
    async changePassword(pw) {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw new Error(error.message);
      if (employee) {
        await supabase.rpc('clear_must_change_pw');
        setEmployee({ ...employee, must_change_pw: false });
        await logAccess(employee.login_id, 'change_password');
      }
    },
    async refresh() { await loadEmployee(session); },
    setCloseMonth,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
