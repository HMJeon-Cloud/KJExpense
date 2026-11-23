// 거래·재고 › 재고 — 재고 금액 · 유효기간 → 사업장 · 품목 구성 → 사업장별 LOT 표
//   데이터 해석 규칙은 기존 모듈(legacy/screens/lotStock.js)과 동일합니다.
import { useMemo, useState, type ReactNode } from 'react';
import { fmt } from '../components/ui';
import { PALETTE } from '../components/charts';
import { PageHead, Stat, Card, Loading, Empty, won } from '../components/kit';
import { useData } from '../lib/useData';
import { KJ, nrm, num, pick, d8, fmtD, today8, daysBetween, type Raw } from '../lib/legacyData';

type SRow = { biz: string; itemNo: string; itemName: string; lotNo: string; regDate: string; createDate: string; valiDate: string; qty: number; unit: string; exRate: number; price: number; amt: number; left: number | null };
type Col = { k: keyof SRow; label: string; num?: boolean; float?: boolean; date?: boolean; w?: number; clip?: boolean; center?: boolean };
const COLS: Col[] = [
  { k: 'itemNo', label: '품번', w: 104 }, { k: 'itemName', label: '품명', clip: true }, { k: 'lotNo', label: 'LOT', w: 112, clip: true },
  { k: 'regDate', label: '입고일', w: 104, date: true, center: true }, { k: 'createDate', label: '제조일', w: 104, date: true, center: true }, { k: 'valiDate', label: '유효기간', w: 168, date: true, center: true },
  { k: 'qty', label: '수량', w: 84, num: true, float: true }, { k: 'unit', label: '단위', w: 48, center: true }, { k: 'exRate', label: '환율', w: 56, num: true, float: true }, { k: 'price', label: '단가', w: 92, num: true, float: true }, { k: 'amt', label: '재고 금액', w: 118, num: true },
];
const fmtF = (v: number) => (Math.round((Number(v) || 0) * 10000) / 10000).toLocaleString('ko-KR');

export default function LotStock() {
  const { ver: tick } = useData(['stock']);
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

  const expSum = sum(expired), soonSum = sum(soon), soon90Sum = sum(soon90);
  const filtered = !!(qItem || qLot || from || to || exp || bizSel || itemSel);

  return (
    <div className="page ls">
      <style>{`
        .ls .fbar{display:flex;gap:8px 12px;align-items:center;flex-wrap:wrap;padding:10px 14px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow-xs)}
        .ls .fbar label{display:flex;gap:7px;align-items:center;font-size:12.5px;color:var(--fg-3);font-weight:600}
        .ls .chip .x{cursor:pointer;font-weight:700;margin-left:2px}
        .ls .stack{display:flex;height:14px;border-radius:999px;overflow:hidden;background:var(--surface-3);gap:2px}.ls .stack i{display:block;height:100%}
        .ls .bl{display:grid;grid-template-columns:14px minmax(0,1fr) 64px 110px 44px;gap:10px;align-items:center;padding:7px 8px;border-radius:8px;cursor:pointer;font-size:13.5px}
        .ls .bl:hover{background:var(--surface-2)}.ls .bl.on{background:var(--blue-soft)}
        .ls .bl i{width:10px;height:10px;border-radius:3px;display:block}
        .ls .bl>:nth-child(n+3){text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .ls .il{display:grid;grid-template-columns:minmax(0,1fr) 112px;gap:10px;align-items:center;padding:7px 8px;border-radius:8px;cursor:pointer;font-size:13.5px}
        .ls .il:hover{background:var(--surface-2)}.ls .il.on{background:var(--blue-soft)}
        .ls .il .nm{font-weight:600;min-width:0;display:grid;gap:5px}.ls .il .nm>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ls .il .nm small{font-weight:400;color:var(--fg-3);margin-left:6px;font-size:12px}
        .ls .il .bar{height:5px}
        .ls .il>b{text-align:right;font-variant-numeric:tabular-nums}
        .ls .t{table-layout:fixed;min-width:1080px}.ls .t th,.ls .t td{padding-left:10px;padding-right:10px}
        .ls .t th{cursor:pointer;user-select:none;position:sticky;top:0;z-index:1}.ls .t th:hover{color:var(--blue-2)}
        .ls .t td{overflow:hidden;text-overflow:ellipsis}
        .ls .t td.txt,.ls .t th.txt{text-align:left}.ls .t td.c,.ls .t th.c{text-align:center}
        .ls .t td.amt{font-weight:700}
        .ls .exp{color:var(--red-2);font-weight:700}.ls .soon{color:var(--amber-2);font-weight:700}
        .ls .bizhd{display:flex;gap:10px;align-items:center;padding:13px 20px;cursor:pointer;font-weight:700;font-size:15px}
        .ls .bizhd small{font-weight:400;color:var(--fg-3);font-size:12.5px}
        @media(max-width:820px){.ls .fbar label{flex:1 1 100%;flex-wrap:wrap}.ls .fbar .inp{flex:1 1 110px;min-width:0;width:auto!important}.ls .bl{grid-template-columns:14px minmax(0,1fr) 100px}.ls .bl>:nth-child(3),.ls .bl>:nth-child(5){display:none}}
      `}</style>
      <PageHead title="재고" desc={`LOT별 재고와 유효기간입니다. 유효기간은 오늘(${fmtD(t0)}) 기준으로 계산합니다.`}>
        <span className="help">{loaded ? `전체 ${fmt(all.length)} LOT` : ''}</span>
      </PageHead>

      <div className="fbar">
        <label>품목<input className="inp" style={{ width: 170 }} value={qItem} onChange={e => setQItem(e.target.value)} placeholder="품번 또는 품명" /></label>
        <label>LOT<input className="inp" style={{ width: 130 }} value={qLot} onChange={e => setQLot(e.target.value)} placeholder="LOT 번호" /></label>
        <label>입고일<input type="date" className="inp" value={from} onChange={e => setFrom(e.target.value)} /><span className="help">~</span><input type="date" className="inp" value={to} onChange={e => setTo(e.target.value)} /></label>
        <label>유효기간<select className="inp" value={exp} onChange={e => setExp(e.target.value)}><option value="">전체</option><option value="0">지난 것</option><option value="30">30일 안에 끝남</option><option value="90">90일 안에 끝남</option><option value="180">180일 안에 끝남</option></select></label>
        {bizSel && <span className="chip on">{bizSel} <span className="x" onClick={() => setBizSel('')}>×</span></span>}
        {itemSel && <span className="chip on">{itemSel} <span className="x" onClick={() => setItemSel('')}>×</span></span>}
        <span className="sp" />
        <span className="help">{fmt(rows.length)} LOT</span>
        {filtered && <button className="btn sm ghost" onClick={reset}>조건 지우기</button>}
      </div>

      {!loaded ? <Loading text="재고 데이터를 불러오는 중입니다." /> : !rows.length ? <Empty>조건에 맞는 재고가 없습니다.</Empty> : (
        <>
          <div className="stats">
            <Stat label="재고 금액" help="stock.verdict" value={won(total)} keyColor="var(--blue)" sub={<>{fmt(rows.length)} LOT · 품목 {byItem.length}종</>} />
            <Stat label="유효기간 지남" help="stock.expiry" value={won(expSum)} tone={expired.length ? 'neg' : undefined} sub={<>{expired.length} LOT · 누르면 이 재고만</>} onClick={() => setExp(exp === '0' ? '' : '0')} />
            <Stat label="30일 안에 끝남" value={won(soonSum)} sub={<>{soon.length} LOT{total > 0 ? ` · 지난 것과 합쳐 전체의 ${Math.round((expSum + soonSum) / total * 1000) / 10}%` : ''}</>} onClick={() => setExp(exp === '30' ? '' : '30')} />
            <Stat label="31 ~ 90일 안에 끝남" value={won(soon90Sum)} sub={<>{soon90.length} LOT</>} onClick={() => setExp(exp === '90' ? '' : '90')} />
          </div>

          <div className="g2">
            <Card title="사업장별" desc="누르면 그 사업장만">
              <div className="stack">{byBiz.map(([b, v], i) => <i key={b} title={`${b} ${fmt(v.amt)}`} style={{ width: (total > 0 ? v.amt / total * 100 : 0) + '%', background: PALETTE[i % PALETTE.length] }} />)}</div>
              <div style={{ marginTop: 10 }}>
                {byBiz.map(([b, v], i) => (
                  <div key={b} className={'bl' + (bizSel === b ? ' on' : '')} onClick={() => setBizSel(bizSel === b ? '' : b)}>
                    <i style={{ background: PALETTE[i % PALETTE.length] }} /><b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b}</b><span className="mut">{fmt(v.n)} LOT</span><b>{fmt(v.amt)}</b><span className="mut">{total > 0 ? Math.round(v.amt / total * 100) : 0}%</span>
                  </div>))}
              </div>
            </Card>
            <Card title="품목 상위 10" help="stock.items" desc="재고 금액 큰 순 · 누르면 그 품목만">
              {byItem.slice(0, 10).map(([k, v]) => (
                <div key={k} className={'il' + (itemSel === k ? ' on' : '')} onClick={() => setItemSel(itemSel === k ? '' : k)}>
                  <span className="nm"><span>{k}<small>{fmtF(v.qty)}{v.unit} · {v.n} LOT</small></span><div className="bar"><i style={{ width: Math.max(2, Math.round(v.amt / maxI * 100)) + '%' }} /></div></span>
                  <b>{fmt(v.amt)}</b>
                </div>))}
            </Card>
          </div>

          {groups.map(([biz, list]) => {
            const isOpen = open[biz] ?? true;
            return (
              <section className="card" key={biz}>
                <div className="bizhd" onClick={() => setOpen(o => ({ ...o, [biz]: !isOpen }))}><span style={{ color: 'var(--fg-3)', fontSize: 11 }}>{isOpen ? '▾' : '▸'}</span>{biz}<small>{fmt(list.length)} LOT · 열 이름을 누르면 정렬</small><span className="sp" /><small>재고 금액</small><span className="num">{fmt(sum(list))}</span></div>
                {isOpen && <div className="tbl-wrap" style={{ maxHeight: 560, overflow: 'auto', borderTop: '1px solid var(--line)' }}><table className="t">
                  <thead><tr>{COLS.map(c => <th key={c.k} className={c.center ? 'c' : c.num ? '' : 'txt'} style={{ width: c.w, color: sort.k === c.k ? 'var(--blue-2)' : undefined }} onClick={() => setSort(s => ({ k: c.k, d: s.k === c.k ? (s.d === 1 ? -1 : 1) : (c.num ? -1 : 1) }))}>{c.label}{sort.k === c.k ? (sort.d === 1 ? ' ▴' : ' ▾') : ''}</th>)}</tr></thead>
                  <tbody>{list.map((r, i) => <tr key={i}>{COLS.map(c => { const v = r[c.k]; let cls = (c.center ? 'c' : c.num ? '' : 'txt') + (c.k === 'amt' ? ' amt' : ''); let txt: ReactNode = c.date ? fmtD(v) : c.num ? (c.float ? fmtF(v as number) : fmt(v as number)) : (String(v ?? '') || '-');
                    if (c.k === 'valiDate' && r.left != null) { const w = r.left < 0 ? 'exp' : r.left <= 30 ? 'soon' : ''; cls += ' ' + w; txt = <>{txt}<span style={{ fontSize: 11, color: w ? undefined : 'var(--fg-3)', fontWeight: 400 }}> {r.left < 0 ? `${-r.left}일 지남` : `${r.left}일 남음`}</span></>; }
                    return <td key={c.k} className={cls} title={c.clip ? String(v) : undefined}>{txt}</td>; })}</tr>)}</tbody>
                </table></div>}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
