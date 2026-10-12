// Lot별 재고조회 — 결론(재고금액·유효기간 경고) → 사업장·품목 구성 → 사업장별 LOT 표
//   데이터 해석 규칙은 기존 모듈(legacy/screens/lotStock.js)과 동일합니다.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { fmt } from '../components/ui';
import { kor } from '../components/charts';
import { KJ, nrm, num, pick, d8, fmtD, today8, daysBetween, type Raw } from '../lib/legacyData';

type SRow = { biz: string; itemNo: string; itemName: string; lotNo: string; regDate: string; createDate: string; valiDate: string; qty: number; unit: string; exRate: number; price: number; amt: number; left: number | null };
type Col = { k: keyof SRow; label: string; num?: boolean; float?: boolean; date?: boolean; w?: number; clip?: boolean; center?: boolean };
const COLS: Col[] = [
  { k: 'itemNo', label: '품번', w: 110 }, { k: 'itemName', label: '품명', w: 200, clip: true }, { k: 'lotNo', label: '제조번호', w: 120, clip: true },
  { k: 'regDate', label: '입고일', w: 96, date: true, center: true }, { k: 'createDate', label: '제조일', w: 96, date: true, center: true }, { k: 'valiDate', label: '유효일자', w: 130, date: true, center: true },
  { k: 'qty', label: '수량', w: 92, num: true, float: true }, { k: 'unit', label: '단위', w: 56, center: true }, { k: 'exRate', label: '환율', w: 68, num: true, float: true }, { k: 'price', label: '단가', w: 104, num: true, float: true }, { k: 'amt', label: '재고금액', w: 124, num: true },
];
const fmtF = (v: number) => (Math.round((Number(v) || 0) * 10000) / 10000).toLocaleString('ko-KR');
const BIZ_COLORS = ['#1F6FE8', '#9CCF2A', '#F26A1B', '#F5B400', '#7C5CBF', '#3AA63A'];

export default function LotStock() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const h = () => setTick(t => t + 1); window.addEventListener('kjhub:data', h); return () => window.removeEventListener('kjhub:data', h); }, []);
  const [qItem, setQItem] = useState(''); const [qLot, setQLot] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [exp, setExp] = useState('');
  const [bizSel, setBizSel] = useState(''); const [itemSel, setItemSel] = useState('');
  const [sort, setSort] = useState<{ k: keyof SRow; d: 1 | -1 }>({ k: 'amt', d: -1 });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const t0 = today8();

  const loaded = !!KJ()?.data?.stock; // eslint-disable-line
  const all = useMemo<SRow[]>(() => ((KJ()?.data?.stock || []) as Raw[]).map(r => {
    const valiDate = d8(pick(r, ['ValiDate', '유효일자']));
    return { biz: String(pick(r, ['BizName', '사업장'])).trim() || '(미지정)', itemNo: String(pick(r, ['ItemNo', '품번'])).trim(), itemName: String(pick(r, ['ItemName', '품명'])).trim(), lotNo: String(pick(r, ['LotNo', '제조번호'])).trim(),
      regDate: d8(pick(r, ['RegDate', '입고일'])), createDate: d8(pick(r, ['CreateDate', '제조일'])), valiDate, qty: num(pick(r, ['StockQty', '수량'])), unit: String(pick(r, ['UnitName', '단위'])).trim(),
      exRate: num(pick(r, ['ExRate', '환율'])), price: num(pick(r, ['Price', '단가'])), amt: num(pick(r, ['StockAmt', '재고금액'])), left: valiDate.length === 8 ? daysBetween(t0, valiDate) : null };
  }), [tick]); // eslint-disable-line

  const rows = useMemo(() => { const qi = nrm(qItem), ql = nrm(qLot), f = from.replace(/-/g, ''), t = to.replace(/-/g, ''), e = exp === '' ? null : Number(exp);
    return all.filter(r => (!qi || nrm(r.itemNo).includes(qi) || nrm(r.itemName).includes(qi)) && (!ql || nrm(r.lotNo).includes(ql)) && (!f || (r.regDate && r.regDate >= f)) && (!t || (r.regDate && r.regDate <= t)) && (e == null || (r.left != null && r.left <= e)) && (!bizSel || r.biz === bizSel) && (!itemSel || r.itemName === itemSel)); }, [all, qItem, qLot, from, to, exp, bizSel, itemSel]);
  const total = rows.reduce((a, r) => a + r.amt, 0);
  const byBiz = useMemo(() => { const m: Record<string, { amt: number; n: number }> = {}; rows.forEach(r => { const o = m[r.biz] || (m[r.biz] = { amt: 0, n: 0 }); o.amt += r.amt; o.n++; }); return Object.entries(m).sort((a, b) => b[1].amt - a[1].amt); }, [rows]);
  const byItem = useMemo(() => { const m: Record<string, { amt: number; qty: number; n: number; unit: string }> = {}; rows.forEach(r => { const k = r.itemName || r.itemNo; const o = m[k] || (m[k] = { amt: 0, qty: 0, n: 0, unit: r.unit }); o.amt += r.amt; o.qty += r.qty; o.n++; }); return Object.entries(m).sort((a, b) => b[1].amt - a[1].amt); }, [rows]);
  const expired = rows.filter(r => r.left != null && r.left < 0), soon = rows.filter(r => r.left != null && r.left >= 0 && r.left <= 30), soon90 = rows.filter(r => r.left != null && r.left > 30 && r.left <= 90);
  const sum = (a: SRow[]) => a.reduce((s, r) => s + r.amt, 0);
  const groups = useMemo(() => { const g: Record<string, SRow[]> = {}; rows.forEach(r => (g[r.biz] = g[r.biz] || []).push(r)); const c = COLS.find(x => x.k === sort.k)!; Object.values(g).forEach(l => l.sort((a, b) => (c.num ? (a[sort.k] as number) - (b[sort.k] as number) : String(a[sort.k] || '').localeCompare(String(b[sort.k] || ''), 'ko')) * sort.d)); return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0], 'ko')); }, [rows, sort]);
  const maxI = Math.max(1, ...byItem.slice(0, 10).map(x => x[1].amt));
  const reset = () => { setQItem(''); setQLot(''); setFrom(''); setTo(''); setExp(''); setBizSel(''); setItemSel(''); };

  return (
    <div className="page brief" style={{ gap: 16, maxWidth: 1500 }}>
      <style>{`
        .brief>*{min-width:0}
        .ls .fbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 14px;background:var(--surface);border:1px solid var(--line);border-radius:12px}
        .ls .fbar label{display:flex;gap:6px;align-items:center;font-size:12px;color:var(--fg-3)}
        .ls .verdict{display:grid;grid-template-columns:1fr 1.3fr 1fr;background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
        .ls .verdict>div{padding:16px 20px;min-width:0}.ls .verdict>div+div{border-left:1px solid var(--line)}
        .ls .l{font-size:12px;color:var(--fg-3)}
        .ls .big{font:800 34px/1.1 var(--font-num);letter-spacing:-.02em;margin-top:4px;font-variant-numeric:tabular-nums}
        .ls .stack{display:flex;height:14px;border-radius:999px;overflow:hidden;margin-top:12px;background:var(--surface-2)}.ls .stack i{display:block;height:100%}
        .ls .lg{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;font-size:12px}.ls .lg span i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px}
        .ls .lg span{cursor:pointer}.ls .lg span.on{font-weight:700}
        .ls .warn{display:grid;gap:6px;margin-top:8px}
        .ls .warn .w{display:flex;justify-content:space-between;align-items:baseline;padding:7px 10px;border-radius:8px;cursor:pointer;font-size:12.5px}
        .ls .warn .w:hover{filter:brightness(.97)}
        .ls .warn b{font-family:var(--font-num);font-variant-numeric:tabular-nums}
        .ls .rk{display:grid;gap:2px;padding:8px 10px 10px}
        .ls .r{display:grid;grid-template-columns:minmax(0,1fr) 60px 110px 120px;gap:8px;align-items:center;padding:4px 6px;border-radius:6px;cursor:pointer;font-size:12.5px}
        .ls .r:hover{background:var(--surface-2)}.ls .r.on{background:var(--brand-soft)}
        .ls .r .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
        .ls .hb{height:6px;border-radius:999px;background:var(--surface-2);overflow:hidden;margin-top:3px}.ls .hb i{display:block;height:100%;border-radius:999px;background:#1f6fe8}
        .ls .n{text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums}
        .ls table{width:100%;border-collapse:collapse;font-size:12.5px;table-layout:fixed;min-width:1100px}
        .ls th{text-align:left;color:var(--fg-3);font-weight:500;font-size:11.5px;padding:7px 8px;border-bottom:2px solid var(--line);white-space:nowrap;cursor:pointer;user-select:none}
        .ls th:hover{background:var(--surface-2)}
        .ls td{padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .ls td.n,.ls th.n{text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums}
        .ls td.c,.ls th.c{text-align:center}
        .ls td.amt{font-weight:700}
        .ls .exp{color:var(--neg);font-weight:700}.ls .soon{color:#9a6f00;font-weight:700}
        .ls .bizhd{display:flex;gap:10px;align-items:center;padding:9px 12px;background:var(--surface-2);border-bottom:1px solid var(--line);cursor:pointer;font-weight:700;font-size:13px}
        @media(max-width:1000px){.ls .verdict{grid-template-columns:1fr}.ls .verdict>div+div{border-left:0;border-top:1px solid var(--line)}}
      `}</style>
      <div className="ls" style={{ display: 'grid', gap: 16 }}>
        <div className="page-head" style={{ alignItems: 'flex-end' }}>
          <div><h1>Lot별 재고조회</h1><div className="help">사업장별 LOT 재고와 유효기간을 봅니다. 유효기간이 가까운 재고부터 확인하세요.</div></div>
          <span className="sp" />
          <span className="help">{loaded ? `전체 ${fmt(all.length)}건` : '재고 데이터를 불러오는 중'}</span>
        </div>

        <div className="fbar">
          <label>품번·품명<input className="inp" style={{ width: 170 }} value={qItem} onChange={e => setQItem(e.target.value)} placeholder="검색" /></label>
          <label>제조번호<input className="inp" style={{ width: 120 }} value={qLot} onChange={e => setQLot(e.target.value)} placeholder="LOT" /></label>
          <label>입고일<input type="date" className="inp" value={from} onChange={e => setFrom(e.target.value)} /><span className="help">~</span><input type="date" className="inp" value={to} onChange={e => setTo(e.target.value)} /></label>
          <label>유효기간<select className="inp" value={exp} onChange={e => setExp(e.target.value)}><option value="">전체</option><option value="0">이미 만료</option><option value="30">30일 이내</option><option value="90">90일 이내</option><option value="180">180일 이내</option></select></label>
          {bizSel && <span className="chip on">{bizSel} <span className="x" onClick={() => setBizSel('')}>×</span></span>}
          {itemSel && <span className="chip on">{itemSel} <span className="x" onClick={() => setItemSel('')}>×</span></span>}
          <span className="sp" />
          <span className="help">{fmt(rows.length)}건</span>
          <button className="btn sm ghost" onClick={reset}>초기화</button>
        </div>

        {!loaded ? <div className="card"><div className="empty"><span className="spinner" /> 재고 데이터를 불러오는 중입니다.</div></div> : !rows.length ? <div className="card"><div className="empty">조회 조건에 해당하는 재고가 없습니다.</div></div> : (
          <>
            <div className="verdict">
              <div>
                <div className="l">재고금액 합계</div>
                <div className="big">{kor(total)}</div>
                <div className="help" style={{ marginTop: 4 }}>{fmt(total)}원 · {fmt(rows.length)} LOT · 품목 {byItem.length}종 · 사업장 {byBiz.length}곳</div>
                <div className="stack">{byBiz.map(([b, v], i) => <i key={b} title={`${b} ${fmt(v.amt)}원`} style={{ width: (total > 0 ? v.amt / total * 100 : 0) + '%', background: BIZ_COLORS[i % BIZ_COLORS.length] }} />)}</div>
                <div className="lg">{byBiz.map(([b, v], i) => <span key={b} className={bizSel === b ? 'on' : ''} onClick={() => setBizSel(bizSel === b ? '' : b)}><i style={{ background: BIZ_COLORS[i % BIZ_COLORS.length] }} />{b} {kor(v.amt)} · {v.n}건</span>)}</div>
              </div>
              <div>
                <div className="l">유효기간 점검 <span>오늘 {fmtD(t0)} 기준 · 누르면 해당 재고만</span></div>
                <div className="warn">
                  <div className="w" style={{ background: expired.length ? '#fdeaea' : 'var(--surface-2)' }} onClick={() => setExp(exp === '0' ? '' : '0')}><span>이미 만료 <b>{expired.length}</b> LOT</span><b className={expired.length ? 'exp' : ''}>{fmt(sum(expired))}원</b></div>
                  <div className="w" style={{ background: soon.length ? '#fff4d6' : 'var(--surface-2)' }} onClick={() => setExp(exp === '30' ? '' : '30')}><span>30일 이내 만료 <b>{soon.length}</b> LOT</span><b className={soon.length ? 'soon' : ''}>{fmt(sum(soon))}원</b></div>
                  <div className="w" style={{ background: 'var(--surface-2)' }} onClick={() => setExp(exp === '90' ? '' : '90')}><span>31~90일 이내 만료 <b>{soon90.length}</b> LOT</span><b>{fmt(sum(soon90))}원</b></div>
                </div>
                <div className="help" style={{ marginTop: 8 }}>만료·임박 재고 합계 {kor(sum(expired) + sum(soon))} — 전체의 {total > 0 ? Math.round((sum(expired) + sum(soon)) / total * 1000) / 10 : 0}%</div>
              </div>
              <div>
                <div className="l">품목별 재고 TOP 10 <span>누르면 그 품목만</span></div>
                <div className="rk" style={{ padding: '6px 0 0' }}>
                  {byItem.slice(0, 10).map(([k, v]) => <div key={k} className={'r' + (itemSel === k ? ' on' : '')} style={{ gridTemplateColumns: 'minmax(0,1fr) 100px' }} onClick={() => setItemSel(itemSel === k ? '' : k)}>
                    <div><div className="nm">{k}<span className="help" style={{ marginLeft: 6 }}>{fmtF(v.qty)}{v.unit} · {v.n}LOT</span></div><div className="hb"><i style={{ width: Math.max(2, Math.round(v.amt / maxI * 100)) + '%' }} /></div></div>
                    <span className="n" style={{ fontWeight: 700 }}>{fmt(v.amt)}</span>
                  </div>)}
                </div>
              </div>
            </div>

            {groups.map(([biz, list]) => {
              const isOpen = open[biz] ?? true;
              return (
                <div className="card" key={biz}>
                  <div className="bizhd" onClick={() => setOpen(o => ({ ...o, [biz]: !isOpen }))}><span style={{ color: 'var(--fg-3)', fontSize: 11 }}>{isOpen ? '▾' : '▸'}</span>{biz}<span className="help" style={{ fontWeight: 400 }}>{fmt(list.length)} LOT</span><span className="sp" /><span className="help">재고금액 <b className="num" style={{ color: 'var(--fg)' }}>{fmt(sum(list))}</b>원</span></div>
                  {isOpen && <div className="tbl-wrap" style={{ maxHeight: 560, overflow: 'auto' }}><table>
                    <thead><tr>{COLS.map(c => <th key={c.k} className={(c.num ? 'n' : '') + (c.center ? ' c' : '')} style={{ width: c.w }} onClick={() => setSort(s => ({ k: c.k, d: s.k === c.k ? (s.d === 1 ? -1 : 1) : (c.num ? -1 : 1) }))}>{c.label}{sort.k === c.k ? (sort.d === 1 ? ' ▲' : ' ▼') : ''}</th>)}</tr></thead>
                    <tbody>{list.map((r, i) => <tr key={i}>{COLS.map(c => { const v = r[c.k]; let cls = (c.num ? 'n' : '') + (c.center ? ' c' : '') + (c.k === 'amt' ? ' amt' : ''); let txt: ReactNode = c.date ? fmtD(v) : c.num ? (c.float ? fmtF(v as number) : fmt(v as number)) : (String(v ?? '') || '-');
                      if (c.k === 'valiDate' && r.left != null) { const w = r.left < 0 ? 'exp' : r.left <= 30 ? 'soon' : ''; cls += ' ' + w; txt = <>{txt}<span style={{ fontSize: 10, color: 'var(--fg-3)', fontWeight: 400 }}> ({r.left < 0 ? `만료 ${-r.left}일` : `D-${r.left}`})</span></>; }
                      return <td key={c.k} className={cls} title={c.clip ? String(v) : undefined}>{txt}</td>; })}</tr>)}</tbody>
                  </table></div>}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
