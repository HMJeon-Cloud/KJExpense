import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
export const SUPABASE_URL = url || 'https://placeholder.supabase.co';
export const SUPABASE_ANON = anon || 'placeholder';
export const LOGIN_EMAIL_DOMAIN = (import.meta.env.VITE_LOGIN_EMAIL_DOMAIN as string) || 'kjhub.internal';

if (!url || !anon) console.warn('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 설정되지 않았습니다 (.env)');

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

/** 사원 ID → 로그인용 가짜 이메일 */
export const pseudoEmail = (loginId: string) => `${loginId.trim().toLowerCase()}@${LOGIN_EMAIL_DOMAIN}`;

export type Employee = {
  id: number; login_id: string; auth_uid: string | null; name: string; email: string | null;
  emp_no: string | null; dept: string | null; title: string | null; grade: string | null;
  role: 'admin' | 'all' | 'user'; screen_depts: Record<string, string[]>; active: boolean;
  must_change_pw: boolean; created_at: string; updated_at: string;
};

export const DATASETS: Record<string, { label: string; monthField: string[]; snapshot?: boolean }> = {
  purchase:  { label: '구매',              monthField: ['PermitDate', 'PERMITDATE', '수입면장일자', 'InDate', 'P_INDATE', '입고일자'] },
  expense:   { label: '부대비용',          monthField: ['CostDate', 'COSTDATE', '비용일자', 'Date', 'DATE'] },
  sale:      { label: '판매',              monthField: ['BillDate', 'BILLDATE', '청구일자', '판매일자', '발행일자'] },
  voucher:   { label: '전표',              monthField: ['Date', 'DATE', '전표일자', '일자'] },
  dept:      { label: '부서',              monthField: [], snapshot: true },
  headcount: { label: '월/부서별 인원',    monthField: ['WorkDate', 'WORKDATE', '년월'] },
  synth:     { label: '생산계획',          monthField: [], snapshot: true },
  mfgcost:   { label: '월/품목별 제조원가', monthField: ['Date', 'DATE', 'YYYYMM'] },
  matinput:  { label: '실자재투입 내역',   monthField: ['InDate', 'INDATE', 'WorkDate', 'Date', 'DATE', '투입일자'] },
  etcio:     { label: '기타입출고 내역',   monthField: ['IoDate', 'IODATE', 'Date', 'DATE', '입출고일자'] },
  stock:     { label: 'LOT별 재고',        monthField: [], snapshot: true },
};

export async function logAccess(actor: string | null, action: string, ok = true, detail?: unknown) {
  try { await supabase.from('logs').insert({ kind: 'access', actor, action, ok, detail: detail ?? null }); } catch { /* best effort */ }
}
