// 전표 상세 표 — 부서별 비용 화면과 부서별 수익/비용 상세에서 함께 사용
//   계정별 묶음(접기/펼치기) · 키워드 칩 · 검색 · 정렬 · CSV 내보내기
import { useEffect, useMemo, useState } from 'react';
import { fmt } from './ui';
import { kor } from './charts';
import { parseVouchers, keywordsByAccount, rowKeywords, toCsv, type Voucher, type VRow } from '../lib/vouchers';

export type VoucherFilter = { depts?: string[] | null; months: string[]; acc?: string; q?: string };
const ymL = (m: string) => (m.length >= 6 ? m.slice(0, 4) + '-' + m.slice(4, 6) : m);
const dL = (d: string) => (d.length >= 8 ? d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8) : d);
const KJ = () => (window as unknown as { KJHub?: { data?: { voucher?: VRow[] } } }).KJHub;

export default function VoucherTable({ filter, compact, onAccPick }: { filter: VoucherFilter; compact?: boolean; onAccPick?: (acc: string) => void }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const h = () => setTick(t => t + 1); window.addEventListener('kjhub:data', h); return () => window.removeEventListener('kjhub:data', h); }, []);
  const all = useMemo(() => parseVouchers(KJ()?.data?.voucher), [tick]); // eslint-disable-line
  const [q, setQ] = useState(filter.q ?? '');
  const [acc, setAcc] = useState(filter.acc ?? '');
  const [kwSel, setKwSel] = useState('');
  const [sort, setSort] = useState<'date' | 'amt'>('date');
  const [openAcc, setOpenAcc] = useState<Record<string, boolean>>({});
  const [limit, setLimit] = useState(300);
  useEffect(() => { setAcc(filter.acc ?? ''); setQ(filter.q ?? ''); setKwSel(''); setLimit(300); }, [filter.acc, filter.q, filter.depts?.join('|'), filter.months.join('|')]); // eslint-disable-line

  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const base = useMemo(() => {
    const ms = new Set(filter.months);
    const ds = filter.depts ? new Set(filter.depts.map(norm)) : null;
    return all.filter(v => ms.has(v.ym) && (!ds || ds.has(norm(v.dept))));
  }, [all, filter.months, filter.depts]);
  const accKws = useMemo(() => keywordsByAccount(base, 3), [base]);
  const accTotals = useMemo(() => { const m: Record<string, number> = {}; base.forEach(v => { m[v.acc] = (m[v.acc] || 0) + v.amt; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); }, [base]);

  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let r = base.filter(v => (!acc || v.acc === acc) && (!qq || (v.desc + ' ' + v.acc + ' ' + v.dept + ' ' + v.costType).toLowerCase().includes(qq)));
    if (kwSel) r = r.filter(v => rowKeywords(v, accKws[v.acc] || []).includes(kwSel) || v.desc.includes(kwSel));
    r.sort(sort === 'date' ? (a, b) => b.date.localeCompare(a.date) : (a, b) => Math.abs(b.amt) - Math.abs(a.amt));
    return r;
  }, [base, q, acc, kwSel, sort, accKws]);
  const total = rows.reduce((s, v) => s + v.amt, 0);
  const groups = useMemo(() => { const m = new Map<string, Voucher[]>(); rows.forEach(v => { if (!m.has(v.acc)) m.set(v.acc, []); m.get(v.acc)!.push(v); }); return Array.from(m.entries()).sort((a, b) => b[1].reduce((s, v) => s + v.amt, 0) - a[1].reduce((s, v) => s + v.amt, 0)); }, [rows]);
  const kwAll = useMemo(() => { const m: Record<string, number> = {}; rows.forEach(v => rowKeywords(v, accKws[v.acc] || []).forEach(k => { m[k] = (m[k] || 0) + Math.abs(v.amt); })); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 14).map(e => e[0]); }, [rows, accKws]);

  function download() {
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `전표_${filter.months[0]}-${filter.months[filter.months.length - 1]}${filter.depts?.length === 1 ? '_' + filter.depts[0] : ''}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  let shown = 0;

  return (
    <div className="vt">
      <style>{`
        .vt .vtbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
        .vt .kws{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
        .vt table{width:100%;border-collapse:collapse;font-size:12.5px}
        .vt th{text-align:left;color:var(--fg-3);font-weight:500;font-size:11.5px;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
        .vt td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
        .vt td.num,.vt th.num{text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums;white-space:nowrap}
        .vt tr.grp td{background:var(--surface-2);font-weight:700;cursor:pointer;padding-block:7px}
        .vt tr.grp:hover td{background:color-mix(in srgb,var(--surface-2) 60%,var(--brand-soft))}
        .vt .desc{color:var(--fg-2);word-break:break-all}
        .vt .kw{display:inline-block;font-size:10.5px;padding:1px 6px;border-radius:4px;background:var(--brand-soft);color:var(--brand);margin-left:4px;cursor:pointer}
        .vt .kw.on{background:var(--brand);color:#fff}
        .vt .neg{color:var(--neg)}
      `}</style>
      <div className="vtbar">
        <input className="inp" style={{ width: 220 }} placeholder="적요·계정·부서 검색" value={q} onChange={e => setQ(e.target.value)} />
        <select className="inp" value={acc} onChange={e => { setAcc(e.target.value); onAccPick?.(e.target.value); }}>
          <option value="">계정 전체</option>{accTotals.map(([a, v]) => <option key={a} value={a}>{a} ({kor(v)})</option>)}
        </select>
        <span className="seg"><button className={sort === 'date' ? 'on' : ''} onClick={() => setSort('date')}>날짜순</button><button className={sort === 'amt' ? 'on' : ''} onClick={() => setSort('amt')}>금액순</button></span>
        <span className="sp" />
        <span className="help">{fmt(rows.length)}건 · 합계 <b className="num" style={{ color: 'var(--fg)' }}>{fmt(total)}</b>원</span>
        <button className="btn sm" onClick={download} disabled={!rows.length}>CSV 내려받기</button>
      </div>
      {kwAll.length > 0 && <div className="kws"><span className="help">키워드</span>{kwAll.map(k => <span key={k} className={'kw' + (kwSel === k ? ' on' : '')} style={{ fontSize: 11.5, padding: '3px 9px' }} onClick={() => setKwSel(s => (s === k ? '' : k))}>{k}</span>)}</div>}
      <div className="tbl-wrap" style={{ maxHeight: compact ? 480 : undefined, overflowY: compact ? 'auto' : undefined }}>
        <table>
          <thead><tr><th style={{ width: 92 }}>회계일</th>{!filter.depts || filter.depts.length !== 1 ? <th style={{ width: 120 }}>부서</th> : null}<th>적요</th><th style={{ width: 90 }}>구분</th><th className="num" style={{ width: 120 }}>금액</th></tr></thead>
          <tbody>
            {groups.map(([a, list]) => {
              const open = openAcc[a] ?? (rows.length <= 60 || !!acc);
              const sum = list.reduce((s, v) => s + v.amt, 0);
              const kws = accKws[a] || [];
              const vis = open ? list.slice(0, Math.max(0, limit - shown)) : [];
              shown += vis.length;
              return [
                <tr key={a} className="grp" onClick={() => setOpenAcc(o => ({ ...o, [a]: !open }))}>
                  <td colSpan={!filter.depts || filter.depts.length !== 1 ? 4 : 3}><span style={{ display: 'inline-block', width: 14, color: 'var(--fg-3)' }}>{open ? '▾' : '▸'}</span>{a.replace(/^\((판|제)\)/, '')} <span className="help" style={{ fontWeight: 400 }}>{list.length}건</span>{kws.map(k => <span key={k} className={'kw' + (kwSel === k ? ' on' : '')} onClick={e => { e.stopPropagation(); setKwSel(s => (s === k ? '' : k)); }}>{k}</span>)}</td>
                  <td className={'num' + (sum < 0 ? ' neg' : '')}>{fmt(sum)}</td>
                </tr>,
                ...vis.map((v, i) => (
                  <tr key={a + i}><td>{dL(v.date)}</td>{!filter.depts || filter.depts.length !== 1 ? <td>{v.dept}</td> : null}<td className="desc">{v.desc}</td><td className="help">{v.costType}</td><td className={'num' + (v.amt < 0 ? ' neg' : '')}>{fmt(v.amt)}</td></tr>
                )),
              ];
            })}
            {!rows.length && <tr><td colSpan={5} className="empty">조건에 맞는 전표가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      {shown >= limit && <div style={{ textAlign: 'center', padding: 8 }}><button className="btn sm" onClick={() => setLimit(l => l + 500)}>더 보기 ({fmt(rows.length - shown)}건 남음)</button></div>}
      <p className="help" style={{ marginTop: 6 }}>{filter.months.length === 1 ? ymL(filter.months[0]) : `${ymL(filter.months[0])} ~ ${ymL(filter.months[filter.months.length - 1])}`} 전표{filter.depts?.length ? ` · ${filter.depts.join(', ')}` : ''}. 계정 행을 누르면 접거나 펼칩니다. 키워드는 적요에서 자동으로 뽑은 말입니다.</p>
    </div>
  );
}
