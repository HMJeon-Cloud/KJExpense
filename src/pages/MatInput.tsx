// 실자재투입 내역 — 제품(품번·LOT)에 들어간 자재와, 자재 판매가(구매) 기준 수익
//   결론(수익 합계·부서별) → 자재별 순위 → 투입 상세 표. 계산 규칙은 기존 모듈(legacy/screens/matInput.js)과 동일합니다.
import { useEffect, useMemo, useState } from 'react';
import { fmt } from '../components/ui';
import { HelpDot } from '../components/Help';
import { kor } from '../components/charts';
import { KJ, nrm, num, pick, fmtD, type Raw } from '../lib/legacyData';

type MRow = { goodNo: string; goodNm: string; goodLot: string; matNo: string; matNm: string; asset: string; matLot: string; qty: number; inDate: string; inPrice: number; sell: number; profit: number; dept: string };
type Col = { key: keyof MRow; label: string; num?: boolean; date?: boolean; wide?: boolean; w?: number };
const COLS: Col[] = [
  { key: 'goodNo', label: '제품번호', w: 110 }, { key: 'goodNm', label: '제품명', wide: true }, { key: 'goodLot', label: '제품LotNo', w: 110 },
  { key: 'matNo', label: '자재번호', w: 110 }, { key: 'matNm', label: '자재명', wide: true }, { key: 'asset', label: '자산분류', w: 90 }, { key: 'matLot', label: '자재LotNo', w: 110 },
  { key: 'qty', label: '수량', num: true, w: 80 }, { key: 'inDate', label: '입고일', date: true, w: 96 }, { key: 'inPrice', label: '입고금액', num: true, w: 110 },
  { key: 'sell', label: '판매가(구매)', num: true, w: 110 }, { key: 'profit', label: '수익', num: true, w: 120 },
];
const ITEM_KEYS = ['GoodItemNo', '생산품번'], LOT_KEYS = ['RRealLotNo', '생산LotNo'];
const MA = () => (window as unknown as { __kjMatAlloc?: { ready: boolean; sellBuyOf: (code: string, ym: string) => number } }).__kjMatAlloc;

export default function MatInput() {
  const [tick, setTick] = useState(0);
  const [ctx, setCtx] = useState(() => KJ()?.matInputCtx ?? null);
  const [itemQ, setItemQ] = useState('');
  const [lotQ, setLotQ] = useState('');
  const [sort, setSort] = useState<{ k: keyof MRow; d: 1 | -1 }>({ k: 'inDate', d: -1 });
  const [matSel, setMatSel] = useState('');
  useEffect(() => {
    const bump = () => setTick(t => t + 1);
    const onCtx = () => { const c = KJ()?.matInputCtx ?? null; setCtx(c); setItemQ(c?.itemNo || ''); setLotQ(c?.lotNo || ''); setMatSel(''); };
    window.addEventListener('kjhub:data', bump); window.addEventListener('kjmatalloc:ready', bump); window.addEventListener('kjhub:matinput', onCtx);
    onCtx();
    return () => { window.removeEventListener('kjhub:data', bump); window.removeEventListener('kjmatalloc:ready', bump); window.removeEventListener('kjhub:matinput', onCtx); };
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
        qty, inDate: String(pick(r, ['DelvInDate', '입고일자', '입고일'], true) || ''), inPrice: inp, sell, profit: Math.round((sell - inp) * qty), dept: String(pick(r, ['DeptName', '부서명'], true) || '') };
    });
  }, [all, itemNo, lotQ, ctx?.ym, tick]); // eslint-disable-line

  const shown = useMemo(() => { const r = matSel ? rows.filter(x => x.matNm === matSel) : rows.slice(); const c = COLS.find(x => x.key === sort.k)!; r.sort((a, b) => (c.num ? (a[sort.k] as number) - (b[sort.k] as number) : String(a[sort.k]).localeCompare(String(b[sort.k]), 'ko')) * sort.d); return r; }, [rows, matSel, sort]);
  const total = rows.reduce((a, b) => a + b.profit, 0);
  const byDept = useMemo(() => { const m: Record<string, number> = {}; rows.forEach(r => { const d = r.dept || '(부서없음)'; m[d] = (m[d] || 0) + r.profit; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); }, [rows]);
  const byMat = useMemo(() => { const m: Record<string, { qty: number; inAmt: number; profit: number; n: number; unset: boolean }> = {}; rows.forEach(r => { const k = r.matNm || r.matNo; const o = m[k] || (m[k] = { qty: 0, inAmt: 0, profit: 0, n: 0, unset: false }); o.qty += r.qty; o.inAmt += r.inPrice * r.qty; o.profit += r.profit; o.n++; if (!r.sell) o.unset = true; }); return Object.entries(m).sort((a, b) => Math.abs(b[1].profit) - Math.abs(a[1].profit)); }, [rows]);
  const unsetCnt = rows.filter(r => !r.sell).length;
  const lots = useMemo(() => Array.from(new Set(rows.map(r => r.goodLot).filter(Boolean))), [rows]);
  const maxP = Math.max(1, ...byMat.map(x => Math.abs(x[1].profit)));

  return (
    <div className="page brief" style={{ gap: 16, maxWidth: 1500 }}>
      <style>{`
        .brief>*{min-width:0}
        .mi .ctx{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 14px;background:var(--surface);border:1px solid var(--line);border-radius:12px}
        .mi .ctx label{display:flex;gap:6px;align-items:center;font-size:12px;color:var(--fg-3)}
        .mi .verdict{display:grid;grid-template-columns:1fr 1.4fr;background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
        .mi .verdict>div{padding:16px 20px;min-width:0}.mi .verdict>div+div{border-left:1px solid var(--line)}
        .mi .l{font-size:12px;color:var(--fg-3)}
        .mi .big{font:800 34px/1.1 var(--font-num);letter-spacing:-.02em;margin-top:4px;font-variant-numeric:tabular-nums}
        .mi .dl{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px 16px;margin-top:8px}
        .mi .dl b{display:block;font:700 16px/1.2 var(--font-num)}
        .mi .rk{display:grid;gap:2px;padding:8px 10px 10px}
        .mi .r{display:grid;grid-template-columns:minmax(0,1.4fr) 70px 100px 100px 110px;gap:8px;align-items:center;padding:4px 6px;border-radius:6px;cursor:pointer;font-size:12.5px}
        .mi .r:hover{background:var(--surface-2)}.mi .r.on{background:var(--brand-soft)}
        .mi .r .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
        .mi .hb{height:6px;border-radius:999px;background:var(--surface-2);overflow:hidden;margin-top:3px}.mi .hb i{display:block;height:100%;border-radius:999px;background:#3aa63a}.mi .hb i.neg{background:#d93c3c}
        .mi .n{text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums}
        .mi table{width:100%;border-collapse:collapse;font-size:12.5px}
        .mi th{text-align:left;color:var(--fg-3);font-weight:500;font-size:11.5px;padding:7px 8px;border-bottom:2px solid var(--line);white-space:nowrap;cursor:pointer;user-select:none}
        .mi th:hover{background:var(--surface-2)}
        .mi td{padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
        .mi td.wide{max-width:220px;overflow:hidden;text-overflow:ellipsis}
        .mi td.n,.mi th.n{text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums}
        .mi td.pos{color:#2c7f2c;font-weight:700}.mi td.neg{color:var(--neg);font-weight:700}.mi td.unset{color:var(--fg-3)}
        @media(max-width:900px){.mi .verdict{grid-template-columns:1fr}.mi .verdict>div+div{border-left:0;border-top:1px solid var(--line)}}
      `}</style>
      <div className="mi" style={{ display: 'grid', gap: 16 }}>
        <div className="page-head" style={{ alignItems: 'flex-end' }}>
          <div><h1>실자재투입 내역</h1><div className="help">제품 한 품번에 어떤 자재가 얼마나 들어갔고, 자재 판매가(구매) 기준으로 얼마가 남는지 봅니다.</div></div>
          <span className="sp" />
          <button className="btn sm ghost" onClick={() => KJ()?.showScreen?.('purchase-sales')}>← 구매/판매로</button>
        </div>

        <div className="ctx">
          <label>제품 품번<input className="inp" list="mi-items" style={{ width: 180 }} value={itemQ} onChange={e => setItemQ(e.target.value)} placeholder="품번 입력 또는 선택" /></label>
          <datalist id="mi-items">{items.map(([no, nm]) => <option key={no} value={no}>{nm}</option>)}</datalist>
          {itemName && <span style={{ fontWeight: 700 }}>{itemName}</span>}
          <label>제품 LOT<select className="inp" value={lotQ} onChange={e => setLotQ(e.target.value)}><option value="">전체 LOT</option>{(lots.length ? lots : lotQ ? [lotQ] : []).map(l => <option key={l} value={l}>{l}</option>)}</select></label>
          <span className="sp" />
          <span className="help">{itemNo ? `${fmt(rows.length)}건 · LOT ${lots.length}개` : `등록된 제품 ${fmt(items.length)}개`}</span>
        </div>

        {!itemNo ? <div className="card"><div className="empty">구매/판매 내역에서 품목의 "실자재" 단추를 누르거나, 위에서 제품 품번을 고르세요.</div></div>
        : !rows.length ? <div className="card"><div className="empty">{all.length ? `해당 품목(${itemNo})의 실자재투입 내역이 없습니다.` : '실자재투입 데이터를 불러오는 중입니다.'}</div></div> : (
          <>
            <div className="verdict">
              <div>
                <div className="l">자재 수익 합계<HelpDot id="mat.verdict" /> <span>(판매가(구매) − 입고금액) × 수량</span></div>
                <div className="big" style={{ color: total >= 0 ? '#2c7f2c' : '#b32b2b' }}>{kor(total)}</div>
                <div className="help" style={{ marginTop: 4 }}>{fmt(total)}원 · 자재 {byMat.length}종 · 투입 {fmt(rows.length)}건</div>
                {unsetCnt > 0 && <div className="help" style={{ marginTop: 8, color: '#9a6f00' }}>판매가(구매)가 설정되지 않은 투입 {unsetCnt}건은 수익 0으로 계산됩니다 → 배분 비율 설정(원자재)에서 기준월 값을 저장하세요.</div>}
              </div>
              <div>
                <div className="l">부서별 수익<HelpDot id="mat.verdict" /></div>
                <div className="dl">{byDept.map(([d, v]) => <div key={d}><span className="help">{d}</span><b style={{ color: v >= 0 ? '#2c7f2c' : '#b32b2b' }}>{fmt(v)}</b></div>)}</div>
              </div>
            </div>

            <div className="card">
              <div className="hd">자재별 수익<HelpDot id="mat.byMat" /> <span className="help" style={{ fontWeight: 400 }}>수익 큰 순 · 누르면 그 자재만</span></div>
              <div className="rk">
                <div className="r" style={{ cursor: 'default', color: 'var(--fg-3)', fontSize: 11.5 }}><span>자재</span><span className="n">건수</span><span className="n">수량</span><span className="n">입고금액</span><span className="n">수익</span></div>
                {byMat.map(([k, v]) => <div key={k} className={'r' + (matSel === k ? ' on' : '')} onClick={() => setMatSel(matSel === k ? '' : k)}>
                  <div><div className="nm">{k}{v.unset && <span className="help" style={{ marginLeft: 6, color: '#9a6f00' }}>판매가 미설정</span>}</div><div className="hb"><i className={v.profit < 0 ? 'neg' : ''} style={{ width: Math.max(2, Math.round(Math.abs(v.profit) / maxP * 100)) + '%' }} /></div></div>
                  <span className="n">{v.n}</span><span className="n">{fmt(v.qty)}</span><span className="n">{fmt(v.inAmt)}</span><span className="n" style={{ fontWeight: 700, color: v.profit >= 0 ? '#2c7f2c' : '#b32b2b' }}>{fmt(v.profit)}</span>
                </div>)}
              </div>
            </div>

            <div className="card">
              <div className="hd">투입 상세<HelpDot id="mat.table" /> {matSel && <span className="chip on" style={{ marginLeft: 8 }}>{matSel} <span className="x" onClick={() => setMatSel('')}>×</span></span>}<span className="sp" /><span className="help">{fmt(shown.length)}건 · 열 제목을 누르면 정렬</span></div>
              <div className="tbl-wrap"><table>
                <thead><tr>{COLS.map(c => <th key={c.key} className={c.num ? 'n' : ''} style={{ width: c.w }} onClick={() => setSort(s => ({ k: c.key, d: s.k === c.key ? (s.d === 1 ? -1 : 1) : (c.num ? -1 : 1) }))}>{c.label}{sort.k === c.key ? (sort.d === 1 ? ' ▲' : ' ▼') : ''}</th>)}</tr></thead>
                <tbody>{shown.map((r, i) => <tr key={i}>{COLS.map(c => { const v = r[c.key]; const cls = (c.num ? 'n ' : '') + (c.wide ? 'wide ' : '') + (c.key === 'profit' ? (r.profit < 0 ? 'neg' : 'pos') : c.key === 'sell' && !r.sell ? 'unset' : ''); return <td key={c.key} className={cls} title={c.wide ? String(v) : undefined}>{c.date ? fmtD(v) : c.num ? fmt(v as number) : (String(v) || '-')}</td>; })}</tr>)}</tbody>
              </table></div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
