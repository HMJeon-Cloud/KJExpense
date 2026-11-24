import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, pseudoEmail, logAccess, type Employee } from './supabase';
import { parseGroups, groupsOf, mergeScreenDepts, PERM_KEY } from './permGroups';

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
    let emp = (data as Employee) ?? null;
    if (emp && !emp.active) { await supabase.auth.signOut(); setEmployee(null); throw new Error('비활성 처리된 계정입니다. 관리자에게 문의해 주세요.'); }
    const { data: cfg } = await supabase.from('config').select('key,value').in('key', ['closeMonth', PERM_KEY]);
    const byKey: Record<string, unknown> = {}; (cfg ?? []).forEach(r => { byKey[r.key as string] = r.value; });
    // 실제 권한 = 개인 권한 ∪ 속한 권한 그룹 (화면 · 계산 모듈은 합친 값을 그대로 씀)
    if (emp) { const gs = groupsOf(parseGroups(byKey[PERM_KEY]), emp.login_id); emp = { ...emp, own_screen_depts: emp.screen_depts || {}, perm_groups: gs.map(g => g.name), screen_depts: mergeScreenDepts(emp.screen_depts, gs) }; }
    // 일반 권한: 본부 성과에서 몇 개 부서를 보는지 세어 둡니다 (여러 부서 = 본부장 → 첫 화면 본부 성과, 한 부서 = 팀장 → 부서 손익)
    if (emp && emp.role === 'user') {
      const toks = emp.screen_depts['/bu-unit'] || []; let n = toks.length;
      if (toks.length) {
        try {
          const { data: dm } = await supabase.from('rows').select('dept_name,data').eq('dataset', 'dept').limit(1000);
          const nz = (x: unknown) => String(x ?? '').replace(/\s+/g, '').toLowerCase(); const deptSet = new Set<string>(); const byHq: Record<string, Set<string>> = {};
          (dm ?? []).forEach(r => { const j = r.data as Record<string, unknown> | null; const d = nz(j?.DeptName ?? r.dept_name); if (!d) return; deptSet.add(d); const h = nz(j?.BizUnitName); if (h) (byHq[h] = byHq[h] || new Set()).add(d); });
          if (deptSet.size) { const seen = new Set<string>(); toks.forEach(t => { const k = nz(t); if (!deptSet.has(k) && byHq[k]) byHq[k].forEach(d => seen.add(d)); else seen.add(k); }); n = seen.size; }
        } catch { /* 못 읽으면 이름 개수로 */ }
      }
      emp = { ...emp, bu_scope: n };
    }
    setEmployee(emp);
    setCloseMonth(typeof byKey.closeMonth === 'string' ? byKey.closeMonth : '');
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
        // 첫 로그인: 첫 비밀번호(= k + 사번)를 서버에서 확인한 뒤 계정을 만들고 바로 로그인
        const { data: ok } = await supabase.rpc('check_initial_password', { p_login_id: id, p_password: password });
        if (!ok) { await logAccess(id, 'login', false, { msg: 'initial password mismatch' }); throw new Error('첫 로그인입니다. 첫 비밀번호는 k + 사번입니다. (예: 사번 23016 → k23016)'); }
        const { data, error } = await supabase.auth.signUp({ email: pseudoEmail(id), password, options: { data: { login_id: id } } });
        if (error) throw new Error('계정 생성 실패: ' + error.message);
        session = data.session;
      }
      if (!session) {
        const { data, error } = await supabase.auth.signInWithPassword({ email: pseudoEmail(id), password });
        if (error) { await logAccess(id, 'login', false, { msg: error.message }); throw new Error('사원 ID 또는 비밀번호가 올바르지 않습니다.'); }
        session = data.session;
      }
      if (needsSignup) {
        const { data: linked, error } = await supabase.rpc('link_my_account', { p_login_id: id, p_password: password });
        if (error || !linked) { await supabase.auth.signOut(); throw new Error('계정을 연결하지 못했습니다. 관리자에게 문의해 주세요.'); }
      }
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
