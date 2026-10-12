// 시트에서 올라온 원본 행을 읽는 공통 도우미 — 헤더가 영문/한글 어느 쪽이어도 같은 규칙으로 인식 (기존 모듈과 동일)
export type Raw = Record<string, unknown>;
export const nrm = (v: unknown) => String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase();
export const num = (v: unknown) => { const n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isNaN(n) ? 0 : n; };
export const d8 = (v: unknown) => String(v == null ? '' : v).replace(/[^0-9]/g, '').slice(0, 8);
export const fmtD = (v: unknown) => { const d = d8(v); return d.length === 8 ? d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6) : (v ? String(v) : '-'); };
export const today8 = () => { const d = new Date(); return String(d.getFullYear()) + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); };
export const daysBetween = (a: string, b: string) => { const p = (t: string) => new Date(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8)); return Math.round((p(b).getTime() - p(a).getTime()) / 86400000); };
/** 정확히 일치하는 헤더 우선, 없으면 부분 일치(loose=true일 때) */
export function pick(row: Raw, cands: string[], loose = false): unknown {
  for (const k in row) { const n = nrm(k); for (const c of cands) if (n === nrm(c)) return row[k]; }
  if (loose) for (const k in row) { const n = nrm(k); for (const c of cands) if (n.indexOf(nrm(c)) >= 0) return row[k]; }
  return '';
}
export const KJ = () => (window as unknown as { KJHub?: { data?: Record<string, Raw[] | undefined>; closeMonth?: () => string; screenDepts?: (t: string) => string[] | null; showScreen?: (id: string) => void; openMatInput?: (c: unknown) => void; matInputCtx?: { itemNo: string; itemName: string; lotNo: string; ym: string } | null } }).KJHub;
export const ymLabel = (m: string) => (m && m.length >= 6 ? m.slice(0, 4) + '-' + m.slice(4, 6) : m || '');
