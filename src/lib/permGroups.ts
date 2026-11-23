// 권한 그룹 — 여러 사원에게 같은 "화면별 볼 수 있는 부서"를 한 번에 주는 묶음
//   저장: config 의 'permGroups' 키 (관리자만 저장 · 변경 이력에 남고 되돌릴 수 있음)
//   실제 권한 = 개인 권한 ∪ 속한 그룹들의 권한 (화면마다 부서를 합침). 역할(관리자 · 전체 보기 · 일반)은 사원마다 따로 정합니다.
import { supabase } from './supabase';

export type ScreenDepts = Record<string, string[]>;
export type PermGroup = { id: string; name: string; note?: string; screen_depts: ScreenDepts; members: string[] };
export const PERM_KEY = 'permGroups';

const lc = (s: unknown) => String(s ?? '').trim().toLowerCase();
const nrm = (s: unknown) => String(s ?? '').replace(/\s+/g, '').toLowerCase();
const strs = (v: unknown) => (Array.isArray(v) ? v.map(x => String(x ?? '').trim()).filter(Boolean) : []);

/** 저장된 값을 안전하게 읽기 (모양이 달라도 빈 목록으로) */
export function parseGroups(v: unknown): PermGroup[] {
  const arr = (v && typeof v === 'object' && Array.isArray((v as { groups?: unknown }).groups)) ? (v as { groups: unknown[] }).groups : [];
  return arr.filter(g => g && typeof g === 'object').map(g0 => {
    const g = g0 as Record<string, unknown>; const sd: ScreenDepts = {};
    if (g.screen_depts && typeof g.screen_depts === 'object') for (const [p, l] of Object.entries(g.screen_depts as Record<string, unknown>)) { const list = strs(l); if (list.length) sd[p] = list; }
    return { id: String(g.id || ''), name: String(g.name || '').trim(), note: g.note ? String(g.note) : '', screen_depts: sd, members: strs(g.members) };
  }).filter(g => g.id && g.name);
}
export async function loadPermGroups(): Promise<PermGroup[]> {
  const { data } = await supabase.from('config').select('value').eq('key', PERM_KEY).maybeSingle();
  return parseGroups(data?.value);
}
export async function savePermGroups(groups: PermGroup[], summary: string) {
  const { error } = await supabase.rpc('save_config', { p_key: PERM_KEY, p_value: { groups }, p_summary: summary });
  if (error) throw new Error(error.message);
}
/** 이 사원이 속한 그룹 */
export const groupsOf = (groups: PermGroup[], loginId: string | null | undefined) => (loginId ? groups.filter(g => g.members.some(m => lc(m) === lc(loginId))) : []);
/** 실제 권한 = 개인 ∪ 그룹 (화면마다 부서 합집합, 같은 이름은 한 번만) */
export function mergeScreenDepts(own: ScreenDepts | null | undefined, gs: PermGroup[]): ScreenDepts {
  const out: ScreenDepts = {};
  const add = (p: string, list: string[]) => { if (!list.length) return; const cur = out[p] || (out[p] = []); const seen = new Set(cur.map(nrm)); list.forEach(d => { const k = nrm(d); if (k && !seen.has(k)) { seen.add(k); cur.push(d); } }); };
  Object.entries(own || {}).forEach(([p, l]) => add(p, strs(l)));
  gs.forEach(g => Object.entries(g.screen_depts || {}).forEach(([p, l]) => add(p, strs(l))));
  return out;
}
export const newGroupId = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
