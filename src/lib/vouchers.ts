// 전표(voucher) 행 읽기 · 집계 · 키워드 — 기존 화면과 같은 컬럼 별칭 규칙
export type VRow = Record<string, unknown>;
export type Voucher = { date: string; ym: string; dept: string; acc: string; desc: string; costType: string; amt: number; raw: VRow };

const pick = (r: VRow, ...keys: string[]) => { for (const k of keys) { const v = r[k]; if (v != null && v !== '') return v; } return ''; };
const num = (v: unknown) => (parseFloat(String(v ?? '').replace(/,/g, '')) || 0);

/** 비용 전표 규칙 — 국전·부서별 화면의 비용 합계(DB voucher_agg, profit.js aggregate)와 같은 기준
 *  제외: 부서 없음 · 계정에 '집합' · 적요에 '제조원가대체/손익대체/원가대체' · 부서에 '원가계산'
 *  포함: 계정에 '(판)' 또는 '(제)', 또는 비용구분에 '판관'/'제조' */
export function isCostVoucher(r: VRow): boolean {
  const acc = String(pick(r, '계정과목', 'AccName'));
  const desc = String(pick(r, '적요', 'Summary'));
  const dept = String(pick(r, '코스트센터', 'CostCCtrName') || r['부서'] || '').trim();
  const ct = String(pick(r, '비용구분', 'UMCostTypeName'));
  if (!dept) return false;
  if (acc.includes('집합') || desc.includes('제조원가대체') || desc.includes('손익대체') || desc.includes('원가대체') || dept.includes('원가계산')) return false;
  return acc.includes('(판)') || acc.includes('(제)') || ct.includes('판관') || ct.includes('제조');
}

export function parseVouchers(rows: VRow[] | null | undefined, opts?: { all?: boolean }): Voucher[] {
  if (!Array.isArray(rows)) return [];
  const out: Voucher[] = [];
  for (const r of rows) {
    if (!opts?.all && !isCostVoucher(r)) continue;
    const date = String(pick(r, '회계일', 'AccDate', '전표일자', 'Date', 'DATE')).replace(/[^0-9]/g, '').slice(0, 8);
    const amt = num(pick(r, '차변금액', 'DrAmt', 'DRAMT')) - num(pick(r, '대변금액', 'CrAmt', 'CRAMT'));
    out.push({
      date, ym: date.slice(0, 6),
      dept: String(pick(r, '코스트센터', 'CostCCtrName', '부서', 'DeptName', 'DEPTNAME')).trim(),
      acc: String(pick(r, '계정과목', 'AccName', 'ACCNAME')),
      desc: String(pick(r, '적요', 'Summary', 'SUMMARY')),
      costType: String(pick(r, '비용구분', 'UMCostTypeName')),
      amt, raw: r,
    });
  }
  return out;
}

/** 표시 후보 컬럼(원본 헤더) — 기본 컬럼 외에 사용자가 켤 수 있는 것 */
export function extraColumns(rows: VRow[]): string[] {
  const base = new Set(['회계일', 'AccDate', '전표일자', 'Date', 'DATE', '차변금액', 'DrAmt', 'DRAMT', '대변금액', 'CrAmt', 'CRAMT', '코스트센터', 'CostCCtrName', '부서', 'DeptName', 'DEPTNAME', '계정과목', 'AccName', 'ACCNAME', '적요', 'Summary', 'SUMMARY', '비용구분', 'UMCostTypeName']);
  const seen: string[] = [];
  for (const r of rows.slice(0, 50)) for (const k of Object.keys(r)) if (!base.has(k) && !seen.includes(k)) seen.push(k);
  return seen;
}

type KW = { kwTokens: (d: string) => string[]; buildKwIdf: (m: Record<string, Record<string, number>>) => unknown; topKeywords: (items: Record<string, number>, n: number, idf: unknown) => string[] };
const kw = () => (window as unknown as { KJHub?: { kw?: KW } }).KJHub?.kw;

/** 계정별 적요 키워드 (기존 화면과 같은 규칙) */
export function keywordsByAccount(list: Voucher[], n = 3): Record<string, string[]> {
  const k = kw(); if (!k) return {};
  const accMap: Record<string, Record<string, number>> = {};
  for (const v of list) { if (v.amt <= 0) continue; const t = accMap[v.acc] = accMap[v.acc] || {}; t[v.desc] = (t[v.desc] || 0) + v.amt; }
  const idf = k.buildKwIdf(accMap);
  const out: Record<string, string[]> = {};
  for (const a in accMap) out[a] = k.topKeywords(accMap[a], n, idf);
  return out;
}

/** 전표 한 건의 키워드 (적요 토큰 중 계정 키워드와 겹치는 것 우선) */
export function rowKeywords(v: Voucher, accKws: string[]): string[] {
  const k = kw(); if (!k) return [];
  const toks = k.kwTokens(v.desc);
  const hit = accKws.filter(x => toks.includes(x));
  return hit.length ? hit : toks.filter(t => !t.includes(' ')).slice(0, 2);
}

export function toCsv(list: Voucher[], extra: string[] = []): string {
  const esc = (s: unknown) => { const t = String(s ?? ''); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const head = ['회계일', '부서', '계정과목', '적요', '비용구분', '금액', ...extra];
  const lines = [head.join(',')];
  for (const v of list) lines.push([v.date, v.dept, v.acc, v.desc, v.costType, Math.round(v.amt), ...extra.map(c => v.raw[c])].map(esc).join(','));
  return '﻿' + lines.join('\n');
}
