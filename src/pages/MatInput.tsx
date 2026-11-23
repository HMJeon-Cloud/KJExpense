// 거래·재고 › 자재 투입 — 제품(품번·LOT)에 들어간 자재와, 설정 판매가 기준 구매 이익
//   합계 → 자재별 → 투입 내역 표. 계산 규칙은 기존 모듈(legacy/screens/matInput.js)과 동일합니다.
import { useEffect, useMemo, useState } from 'react';
import { fmt } from '../components/ui';
import { PageHead, Stat, Card, Empty, won } from '../components/kit';
import { useData } from '../lib/useData';
import { KJ, nrm, num, pick, fmtD, type Raw } from '../lib/legacyData';

type MRow = { goodNo: string; goodNm: string; goodLot: string; matNo: string; matNm: string; asset: string; matLot: string; qty: number; inDate: string; inPrice: number; sell: number; profit: number; dept: string };
type Col = { key: keyof MRow; label: string; num?: boolean; date?: boolean; wide?: boolean; w?: number };
const COLS: Col[] = [
  { key: 'goodNo', label: '제품 품번', w: 110 }, { key: 'goodNm', label: '제품명', wide: true }, { key: 'goodLot', label: '제품 LOT', w: 110 },
  { key: 'matNo', label: '자재 품번', w: 110 }, { key: 'matNm', label: '자재명', wide: true }, { key: 'asset', label: '자산 분류', w: 90 }, { key: 'matLot', label: '자재 LOT', w: 110 },
  { key: 'qty', label: '수량', num: true, w: 80 }, { key: 'inDate', label: '입고일', date: true, w: 96 }, { key: 'inPrice', label: '입고 단가', num: true, w: 110 },
  { key: 'sell', label: '설정 판매가', num: true, w: 110 }, { key: 'profit', label: '구매 이익', num: true, w: 120 },
];
const ITEM_KEYS = ['GoodItemNo', '생산품번'], LOT_KEYS = ['RRealLotNo', '생산LotNo'];
const MA = () => (window as unknown as { __kjMatAlloc?: { ready: boolean; sellBuyOf: (code: string, ym: string) => number } }).__kjMatAlloc;

export default function MatInput() {
  const [t0, setTick] = useState(0);
  const { ver, ready } = useData(['matinput']);
  const tick = t0 + '|' + ver;
  const [ctx, setCtx] = useState(() => KJ()?.matInputCtx ?? null);
  const [itemQ, setItemQ] = useState('');
  const [lotQ, setLotQ] = useState('');
  const [sort, setSort] = useState<{ k: keyof MRow; d: 1 | -1 }>({ k: 'inDate', d: -1 });
  const [matSel, setMatSel] = useState('');
  useEffect(() => {
    const bump = () => setTick(t => t + 1);
    const onCtx = () => { const c = KJ()?.matInputCtx ?? null; setCtx(c); setItemQ(c?.itemNo || ''); setLotQ(c?.lotNo || ''); setMatSel(''); };
    window.addEventListener('kjmatalloc:ready', bump); window.addEventListener('kjhub:matinput', onCtx);
    onCtx();
    return () => { window.removeEventListener('kjmatalloc:ready', bump); window.removeEventListener('kjhub:matinput', onCtx); };
  }, []);

  const all = useMemo(() => (KJ()?.data?.matinput || []) as Raw[], [tick]); // eslint-disable-line
  const items = useMemo(() => { const m = new Map<string, string>(); all.forEach(r => { const no = String(pick(r, ITEM_KEYS, true) || '').trim(); if (no && !m.has(no)) m.set(no, String(pick(r, ['GoodItemName', '제품명'], true) || '')); }); return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0])); }, [all]);
  const itemNo = itemQ.trim();
  const itemName = ctx && ctx.itemNo === itemNo ? ctx.itemName : (items.find(i => i[0] === itemNo)?.[1] || '');

  const rows = useMemo<MRow[]>(() => {
    if (!itemNo) return [];
    const it = nrm(itemNo), lot = nrm(lotQ);
    const ma = MA();
    return all.filter(r => nrm(pick(r, ITEM_KEYS, true)) === it && (!lot || !nrm(pick(r, LOT_KEYS, true)) || nrm(pick(r, LOT_KEYS, true)) === lot)).map(r => {
      const code = nrm(pick(r, ['MatItemNo', '자재코드', '원료코드'], true) || pick(r, ['MatItemName', '자재명', '원료명'], true));
      const mym = String(pick(r, ['DelvInDate', '입고일자', '입고일'], true)).replace(/[^0-9]/g, '').slice(0, 6) || (ctx?.ym || '');
      const sell = ma && ma.ready ? ma.sellBuyOf(code, mym) : 0;
      const inp = num(pick(r, ['InPrice', '입고단가'], true)); const qty = num(pick(r, ['Qty', '투입수량'], true));
      return { goodNo: String(pick(r, ['GoodItemNo', '생산품번'], true) || ''), goodNm: String(pick(r, ['GoodItemName', '제품명'], true) || ''), goodLot: String(pick(r, ['RRealLotNo', '생산LotNo'], true) || ''),
        matNo: String(pick(r, ['MatItemNo', '자재코드'], true) || ''), matNm: String(pick(r, ['MatItemName', '자재명'], true) || ''), asset: String(pick(r, ['AssetName', '자산분류'], true) || ''), matLot: String(pick(r, ['RealLotNo', '자재LotNo'], true) || ''),
        qty, inDate: String(pick(r, ['DelvInDate', '입고일자', '입고일'], true) || ''), inPrice: inp, sell, profit: sell ? Math.round((sell - inp) * qty) : 0 /* 판매가 미설정 = 계산하지 않음 (배분 수익 계산과 같은 규칙) */, dept: String(pick(r, ['DeptName', '부서명'], true) || '') };
    });
  }, [all, itemNo, lotQ, ctx?.ym, tick]); // eslint-disable-line

  const shown = useMemo(() => { const r = matSel ? rows.filter(x => x.matNm === matSel) : rows.slice(); const c = COLS.find(x => x.key === sort.k)!; r.sort((a, b) => (c.num ? (a[sort.k] as number) - (b[sort.k] as number) : String(a[sort.k]).localeCompare(String(b[sort.k]), 'ko')) * sort.d); return r; }, [rows, matSel, sort]);
  const total = rows.reduce((a, b) => a + b.profit, 0);
  const byDept = useMemo(() => { const m: Record<string, number> = {}; rows.forEach(r => { const d = r.dept || '(부서없음)'; m[d] = (m[d] || 0) + r.profit; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); }, [rows]);
  const byMat = useMemo(() => { const m: Record<string, { qty: number; inAmt: number; profit: number; n: number; unset: boolean }> = {}; rows.forEach(r => { const k = r.matNm || r.matNo; const o = m[k] || (m[k] = { qty: 0, inAmt: 0, profit: 0, n: 0, unset: false }); o.qty += r.qty; o.inAmt += r.inPrice * r.qty; o.profit += r.profit; o.n++; if (!r.sell) o.unset = true; }); return Object.entries(m).sort((a, b) => Math.abs(b[1].profit) - Math.abs(a[1].profit)); }, [rows]);
  const unsetCnt = rows.filter(r => !r.sell).length;
  const lots = useMemo(() => Array.from(new Set(rows.map(r => r.goodLot).filter(Boolean))), [rows]);
  const maxP = Math.max(1, ...byMat.map(x => Math.abs(x[1].profit)));

  const inTotal = rows.reduce((a, r) => a + r.inPrice * r.qty, 0);

  return (
    <div className="page mi">
      <style>{`
        .mi .ctx{display:flex;gap:10px 14px;align-items:center;flex-wrap:wrap;padding:10px 14px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow-xs)}
        .mi .ctx label{display:flex;gap:7px;align-items:center;font-size:12.5px;color:var(--fg-3);font-weight:600}
        .mi .ml{display:grid;grid-template-columns:minmax(0,1.5fr) 56px 96px 116px 116px;gap:10px;align-items:center;padding:7px 8px;border-radius:8px;cursor:pointer;font-size:13.5px}
        .mi .ml:hover{background:var(--surface-2)}.mi .ml.on{background:var(--blue-soft)}
        .mi .ml .nm{font-weight:600;min-width:0;display:grid;gap:5px}.mi .ml .nm>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .mi .ml .bar{height:5px}.mi .ml .bar i{background:var(--green)}.mi .ml .bar i.neg{background:var(--red)}
        .mi .ml>:nth-child(n+2){text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .mi .ml.h{cursor:default;font-size:12px;color:var(--fg-3);font-weight:600;border-bottom:1px solid var(--line);border-radius:0;padding-bottom:6px}.mi .ml.h:hover{background:none}
        .mi .t th{cursor:pointer;user-select:none}.mi .t th:hover{color:var(--blue-2)}
        .mi .t td.wide{max-width:220px;overflow:hidden;text-overflow:ellipsis}
        .mi .t td.txt,.mi .t th.txt{text-align:left}
        .mi .t td.unset{color:var(--fg-4)}
        .mi .chip .x{cursor:pointer;font-weight:700;margin-left:2px}
        @media(max-width:820px){.mi .ml{grid-template-columns:minmax(0,1fr) 100px}.mi .ml>:nth-child(2),.mi .ml>:nth-child(3),.mi .ml>:nth-child(4){display:none}.mi .ctx .inp{flex:1;min-width:0;width:auto!important}}
      `}</style>
      <PageHead title="자재 투입" desc="제품 하나에 어떤 자재가 얼마나 들어갔는지, 설정 판매가로 계산한 구매 이익이 얼마인지 봅니다.">
        <button className="btn sm ghost" onClick={() => KJ()?.showScreen?.('purchase-sales')}>← 구매 · 판매</button>
      </PageHead>

      <div className="ctx">
        <label>제품 품번<input className="inp" list="mi-items" style={{ width: 190 }} value={itemQ} onChange={e => setItemQ(e.target.value)} placeholder="품번을 입력하거나 골라 주세요" /></label>
        <datalist id="mi-items">{items.map(([no, nm]) => <option key={no} value={no}>{nm}</option>)}</datalist>
        {itemName && <b>{itemName}</b>}
        <label>제품 LOT<select className="inp" value={lotQ} onChange={e => setLotQ(e.target.value)}><option value="">전체</option>{(lots.length ? lots : lotQ ? [lotQ] : []).map(l => <option key={l} value={l}>{l}</option>)}</select></label>
        <span className="sp" />
        <span className="help">{itemNo ? `투입 ${fmt(rows.length)}건 · LOT ${lots.length}개` : `제품 ${fmt(items.length)}개`}</span>
      </div>

      {!itemNo ? <Empty>{ready ? '위에서 제품 품번을 고르거나, 구매 · 판매 화면의 품목에서 "실자재"를 누르면 표시됩니다.' : <><span className="spinner" />자재 투입 데이터를 불러오는 중입니다.</>}</Empty>
        : !rows.length ? <Empty>{ready ? `${itemNo}의 자재 투입 내역이 없습니다.` : <><span className="spinner" />자재 투입 데이터를 불러오는 중입니다.</>}</Empty> : (
        <>
          {unsetCnt > 0 && <div className="note warn"><div><b>판매가가 없는 투입 {unsetCnt}건</b>은 구매 이익을 계산하지 않았습니다. [자재 판매가]에서 해당 월 값을 저장하면 계산됩니다.</div></div>}
          <div className="stats">
            <Stat label="구매 이익" help="mat.verdict" value={won(total)} tone={total >= 0 ? 'pos' : 'neg'} keyColor={total >= 0 ? 'var(--green)' : 'var(--red)'} sub="(설정 판매가 − 입고 단가) × 수량" />
            <Stat label="입고 금액" value={won(inTotal)} sub="입고 단가 × 수량" />
            <Stat label="자재" value={byMat.length} unit="종" sub={`투입 ${fmt(rows.length)}건`} />
            <Stat label="부서별 구매 이익" value={<span style={{ fontSize: 15, fontWeight: 600, letterSpacing: 0, display: 'grid', gap: 3 }}>{byDept.slice(0, 3).map(([d, v]) => <span key={d} className="kv" style={{ padding: 0 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d}</span><b className="num" style={{ color: v >= 0 ? 'var(--green-2)' : 'var(--red-2)' }}>{won(v)}</b></span>)}</span>} sub={byDept.length > 3 ? `외 ${byDept.length - 3}개 부서` : undefined} />
          </div>

          <Card title="자재별" help="mat.byMat" desc="구매 이익 큰 순 · 누르면 그 자재만">
            <div className="ml h"><span>자재</span><span>건수</span><span>수량</span><span>입고 금액</span><span>구매 이익</span></div>
            {byMat.map(([k, v]) => (
              <div key={k} className={'ml' + (matSel === k ? ' on' : '')} onClick={() => setMatSel(matSel === k ? '' : k)}>
                <span className="nm"><span>{k}{v.unset && <span className="tag y" style={{ marginLeft: 8 }}>판매가 없음</span>}</span><div className="bar"><i className={v.profit < 0 ? 'neg' : ''} style={{ width: Math.max(2, Math.round(Math.abs(v.profit) / maxP * 100)) + '%' }} /></div></span>
                <span className="mut">{v.n}</span><span>{fmt(v.qty)}</span><span>{fmt(v.inAmt)}</span><b style={{ color: v.profit >= 0 ? 'var(--green-2)' : 'var(--red-2)' }}>{fmt(v.profit)}</b>
              </div>))}
          </Card>

          <Card title="투입 내역" help="mat.table" desc={`${fmt(shown.length)}건 · 열 이름을 누르면 정렬`} right={matSel ? <span className="chip on">{matSel} <span className="x" onClick={() => setMatSel('')}>×</span></span> : undefined} flush>
            <div className="tbl-wrap"><table className="t">
              <thead><tr>{COLS.map(c => <th key={c.key} className={c.num ? '' : 'txt'} style={{ width: c.w, color: sort.k === c.key ? 'var(--blue-2)' : undefined }} onClick={() => setSort(s => ({ k: c.key, d: s.k === c.key ? (s.d === 1 ? -1 : 1) : (c.num ? -1 : 1) }))}>{c.label}{sort.k === c.key ? (sort.d === 1 ? ' ▴' : ' ▾') : ''}</th>)}</tr></thead>
              <tbody>{shown.map((r, i) => <tr key={i}>{COLS.map(c => { const v = r[c.key]; const cls = (c.num ? '' : 'txt ') + (c.wide ? 'wide ' : '') + (c.key === 'profit' ? (!r.sell ? 'unset' : r.profit < 0 ? 'neg' : 'pos') : c.key === 'sell' && !r.sell ? 'unset' : ''); return <td key={c.key} className={cls} style={c.key === 'profit' && r.sell ? { fontWeight: 700 } : undefined} title={c.wide ? String(v) : undefined}>{c.key === 'sell' && !r.sell ? '없음' : c.key === 'profit' && !r.sell ? '-' : c.date ? fmtD(v) : c.num ? fmt(v as number) : (String(v) || '-')}</td>; })}</tr>)}</tbody>
            </table></div>
          </Card>
        </>
      )}
    </div>
  );
}
