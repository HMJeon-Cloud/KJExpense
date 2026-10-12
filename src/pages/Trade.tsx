// 구매/판매 내역 — 한눈에: 결론 띠(매출→원가→수익) → 월별 수익 → 부서·품목·수입처 순위 → 구조별 표(부서까지 펼침)
//   필터·집계·LOT 상세 계산은 기존 모듈(legacy/screens/trade.js)이 그대로 수행하고, 이 화면은 그 상태를 받아 그립니다.
//   LOT 상세(BL 단위) 표는 기존 컴포넌트(TreeNode)를 그대로 끼워 넣어 숫자가 달라지지 않게 했습니다.
import { useEffect, useMemo, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react';
import { fmt } from '../components/ui';
import { kor } from '../components/charts';

type Node = { name: string; type: string; children: Record<string, Node>; sales: number; cogs: number; margin: number; inventory: number; inventoryQty: number; estMargin: number; estSynth: number; estSales: number; lotGroups?: unknown[] };
type Filters = Record<string, string>;
type Bridge = {
  TreeNode: ComponentType<{ node: Node; depth: number; collapseSignal: number; extra?: (n: Node) => ReactNode; extraCount?: number }>;
  treeData: Record<string, Node> | null; summary: { sales: number; cogs: number; margin: number; inventory: number; estMargin: number; estSynth: number; estSales: number; monthly: Record<string, number> } | null;
  allRows: unknown[] | null; filteredRows: unknown[] | null; filterOptions: { bizUnits: string[]; depts: string[]; buyers: string[] };
  draftFilters: Filters; appliedFilters: Filters; isProcessing: boolean; errorMsg: string; lastLoadedAt: Date | null; collapseSignal: number; isFilterActive: boolean;
  setDraft: (p: Filters) => void; search: () => void; reset: () => void; collapse: () => void;
};
const KJ = () => (window as unknown as { KJHub?: { trade?: Bridge } }).KJHub;
const LEVELS = ['bizUnit', 'dept', 'buyer', 'item', 'vendor', 'blNo'];
const LEVEL: Record<string, string> = { bizUnit: '사업단위', dept: '부서', buyer: '담당자', item: '품목', vendor: '수입처', blNo: 'BL' };
const pct = (a: number, b: number) => (b > 0 ? Math.round(a / b * 1000) / 10 : null);
const pctS = (a: number, b: number) => { const p = pct(a, b); return p == null ? '-' : p + '%'; };
const dL = (d: string) => (d ? d.replace(/-/g, '.').slice(2) : '');

/** 트리를 돌며 특정 단계(type)의 노드를 이름별로 합산 */
function rankBy(tree: Record<string, Node> | null, type: string) {
  const m = new Map<string, { name: string; sales: number; cogs: number; margin: number; inventory: number; n: number }>();
  const walk = (n: Node) => {
    if (n.type === type) { const r = m.get(n.name) || { name: n.name, sales: 0, cogs: 0, margin: 0, inventory: 0, n: 0 }; r.sales += n.sales; r.cogs += n.cogs; r.margin += n.margin; r.inventory += n.inventory; r.n++; m.set(n.name, r); return; }
    Object.values(n.children || {}).forEach(walk);
  };
  Object.values(tree || {}).forEach(walk);
  return Array.from(m.values()).sort((a, b) => b.sales - a.sales);
}

export default function Trade() {
  const [b, setB] = useState<Bridge | null>(() => KJ()?.trade ?? null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [lvl, setLvl] = useState(1); // 기본: 부서까지 펼침
  useEffect(() => {
    const h = () => setB(KJ()?.trade ?? null);
    window.addEventListener('kjhub:trade', h); h();
    return () => window.removeEventListener('kjhub:trade', h);
  }, []);

  const f = b?.draftFilters ?? {};
  const a = b?.appliedFilters ?? {};
  const set = (k: string) => (e: { target: { value: string } }) => b?.setDraft({ [k]: e.target.value });
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { b?.search(); setShowFilter(false); } };
  const roots = useMemo(() => Object.entries(b?.treeData ?? {}).sort((x, y) => y[1].sales - x[1].sales), [b?.treeData]);
  const s = b?.summary;
  const rate = s ? pct(s.margin, s.sales) : null;
  const qq = q.trim().toLowerCase();
  const matches = (n: Node): boolean => !qq || n.name.toLowerCase().includes(qq) || Object.values(n.children || {}).some(matches);

  // 단계까지 한 번에 펼치기
  const expandTo = (level: number, tree = b?.treeData) => {
    const o: Record<string, boolean> = {};
    const walk = (n: Node, path: string, d: number) => { if (d < level) { o[path] = true; Object.entries(n.children || {}).forEach(([k, c]) => walk(c, path + '/' + k, d + 1)); } };
    Object.entries(tree || {}).forEach(([k, n]) => walk(n, k, 0));
    setOpen(o); setLvl(level);
  };
  useEffect(() => { expandTo(1); }, [b?.treeData, b?.collapseSignal]); // eslint-disable-line

  const byDept = useMemo(() => rankBy(b?.treeData ?? null, 'dept'), [b?.treeData]);
  const byItem = useMemo(() => rankBy(b?.treeData ?? null, 'item'), [b?.treeData]);
  const byVendor = useMemo(() => rankBy(b?.treeData ?? null, 'vendor'), [b?.treeData]);
  const months = useMemo(() => Object.entries(s?.monthly || {}).sort((x, y) => x[0].localeCompare(y[0])).slice(-12), [s?.monthly]);
  const mMax = Math.max(1, ...months.map(m => Math.abs(m[1])));
  const costShare = s && s.sales > 0 ? Math.min(100, Math.max(0, s.cogs / s.sales * 100)) : 0;

  // 적용 중인 조건 요약 칩
  const chips: [string, string][] = [];
  if (a.bizUnit) chips.push(['사업단위', a.bizUnit]); if (a.dept) chips.push(['부서', a.dept]); if (a.buyer) chips.push(['담당자', a.buyer]);
  if (a.itemQuery) chips.push(['품목', a.itemQuery]); if (a.lotNoQuery) chips.push(['LOT', a.lotNoQuery]); if (a.vendorQuery) chips.push(['수입처', a.vendorQuery]); if (a.custQuery) chips.push(['청구처', a.custQuery]); if (a.blNoQuery) chips.push(['BL', a.blNoQuery]);
  if (a.inDateFrom || a.inDateTo) chips.push(['입고일', `${dL(a.inDateFrom)} ~ ${dL(a.inDateTo)}`]);
  if (a.billDateFrom || a.billDateTo) chips.push(['발행일', `${dL(a.billDateFrom)} ~ ${dL(a.billDateTo)}`]);
  if (a.unsetPrice) chips.push(['판매가', '미설정만']);
  const quick = (patch: Filters) => { b?.setDraft(patch); setTimeout(() => b?.search(), 0); };

  return (
    <div className="page brief" style={{ gap: 16, maxWidth: 1500 }}>
      <style>{`
        .brief>*{min-width:0}
        .tbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 14px;background:var(--surface);border:1px solid var(--line);border-radius:12px}
        .tbar .chipk{font-size:12px;padding:3px 9px;border-radius:999px;background:var(--surface-2);color:var(--fg-2);white-space:nowrap}
        .tbar .chipk b{color:var(--fg);font-weight:600;margin-left:4px}
        .tf{display:grid;grid-template-columns:repeat(4,1fr);gap:10px 14px;padding:14px 16px;background:var(--surface);border:1px solid var(--brand);border-radius:12px}
        .tf label{display:grid;gap:4px;font-size:12px;color:var(--fg-3)}
        .tf .inp{width:100%}
        .tf .dates{display:flex;gap:6px;align-items:center}
        .tf .dates .inp{flex:1;min-width:0}
        .tf .actions{grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end;align-items:center}
        .verdict{display:grid;grid-template-columns:1.1fr 1.6fr 1fr;gap:0;background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
        .verdict>div{padding:16px 20px;min-width:0}
        .verdict>div+div{border-left:1px solid var(--line)}
        .verdict .l{font-size:12px;color:var(--fg-3)}
        .verdict .big{font:800 34px/1.1 var(--font-num);letter-spacing:-.02em;margin-top:4px;font-variant-numeric:tabular-nums}
        .verdict .rate{font:700 18px/1 var(--font-num);margin-left:8px}
        .flow{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;gap:10px;align-items:center;margin-top:6px}
        .flow .n{font:700 20px/1.2 var(--font-num);font-variant-numeric:tabular-nums}
        .flow .op{color:var(--fg-3);font-size:18px}
        .stack{display:flex;height:14px;border-radius:999px;overflow:hidden;margin-top:12px;background:var(--surface-2)}
        .stack i{display:block;height:100%}
        .stack-lg{display:flex;justify-content:space-between;font-size:11.5px;color:var(--fg-3);margin-top:4px}
        .mini{display:flex;align-items:flex-end;gap:4px;height:64px;margin-top:8px}
        .mini .col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;min-width:0}
        .mini .col i{display:block;width:100%;border-radius:3px 3px 0 0;background:#3aa63a}
        .mini .col i.neg{background:#d93c3c}
        .mini .col small{font-size:10px;color:var(--fg-3);margin-top:3px;white-space:nowrap}
        .trio{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
        .rk{display:grid;gap:2px;padding:8px 10px 10px}
        .rk .r{display:grid;grid-template-columns:minmax(0,1fr) 92px 52px;gap:8px;align-items:center;padding:4px 6px;border-radius:6px;cursor:pointer;font-size:12.5px}
        .rk .r:hover{background:var(--surface-2)}
        .rk .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
        .rk .nm small{font-weight:400;color:var(--fg-3);margin-left:4px}
        .rk .hb{height:6px;border-radius:999px;background:var(--surface-2);overflow:hidden;margin-top:3px}
        .rk .hb i{display:block;height:100%;border-radius:999px;background:#1f6fe8}
        .rk .v{text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums;font-weight:700}
        .rk .p{text-align:right;font-family:var(--font-num);font-size:11.5px;color:var(--fg-3)}
        .tree{width:100%;border-collapse:collapse;font-size:13.5px;table-layout:fixed}
        .tree td:first-child{overflow:hidden;text-overflow:ellipsis}
        .tree th{text-align:right;font-weight:500;color:var(--fg-3);font-size:12px;padding:8px 12px;border-bottom:2px solid var(--line);white-space:nowrap}
        .tree th:first-child{text-align:left}
        .tree td{padding:7px 12px;border-bottom:1px solid var(--line);text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums;white-space:nowrap}
        .tree td:first-child{text-align:left;font-family:var(--font-body)}
        .tree tr.lv{cursor:pointer}
        .tree tr.lv:hover td{background:var(--surface-2)}
        .tree tr.lv.d0>td{background:var(--surface-2);font-weight:700}
        .tree tr.lv.open>td:first-child{font-weight:700}
        .tree .caret{display:inline-block;width:16px;color:var(--fg-3);font-size:11px}
        .tree .lvl{font-size:10.5px;color:var(--fg-3);margin-left:6px;font-weight:400}
        .tree .cnt{font-size:11px;color:var(--fg-3);margin-left:6px}
        .tree .pos{color:#2c7f2c}.tree .neg{color:var(--neg)}
        .tree .share{display:inline-block;width:100%;height:6px;background:var(--surface-2);border-radius:999px;overflow:hidden;vertical-align:middle}
        .tree .share i{display:block;height:100%;background:#1f6fe8;border-radius:999px}
        .tree .rt{font-size:12px}
        .tree .legacy-leaf td{font-family:var(--font-num)}
        @media (max-width:1000px){.verdict,.trio{grid-template-columns:1fr}.verdict>div+div{border-left:0;border-top:1px solid var(--line)}.tf{grid-template-columns:1fr 1fr}.tree .c-share,.tree .c-cogs{display:none}}
      `}</style>

      <div className="page-head" style={{ alignItems: 'flex-end' }}>
        <div><h1>구매/판매 내역</h1><div className="help">LOT 단위로 구매(입고)와 판매를 선입선출로 맞춰 실현 수익을 계산합니다.</div></div>
        <span className="sp" />
        {b?.lastLoadedAt && <span className="help">분석 {new Date(b.lastLoadedAt).toLocaleTimeString('ko-KR')}</span>}
      </div>

      {!b ? <div className="card"><div className="empty"><span className="spinner" /> 구매/판매 데이터를 준비하는 중입니다.</div></div> : (
        <>
          {/* 조건: 평소엔 한 줄 요약, 필요할 때만 펼침 */}
          <div className="tbar">
            <span className="help" style={{ fontWeight: 600, color: 'var(--fg-2)' }}>조회 조건</span>
            {chips.length === 0 && <span className="chipk">전체</span>}
            {chips.map(([k, v]) => <span key={k} className="chipk">{k}<b>{v}</b></span>)}
            <span className="help">· {fmt(b.filteredRows?.length ?? b.allRows?.length ?? 0)} LOT</span>
            <span className="sp" />
            {b.isProcessing && <span className="help"><span className="spinner" /> 분석 중…</span>}
            {chips.length > 0 && <button className="btn sm ghost" onClick={() => { b.reset(); setTimeout(() => b.search(), 0); }}>조건 지우기</button>}
            <button className={'btn sm' + (showFilter ? ' pri' : '')} onClick={() => setShowFilter(v => !v)}>{showFilter ? '닫기' : '조건 변경'}</button>
          </div>
          {showFilter && (
            <div className="tf" onKeyDown={onKey}>
              <label>사업단위<select className="inp" value={f.bizUnit || ''} onChange={set('bizUnit')}><option value="">전체</option>{b.filterOptions.bizUnits.map(v => <option key={v}>{v}</option>)}</select></label>
              <label>부서<select className="inp" value={f.dept || ''} onChange={set('dept')}><option value="">전체</option>{b.filterOptions.depts.map(v => <option key={v}>{v}</option>)}</select></label>
              <label>담당자<select className="inp" value={f.buyer || ''} onChange={set('buyer')}><option value="">전체</option>{b.filterOptions.buyers.map(v => <option key={v}>{v}</option>)}</select></label>
              <label>품목<input className="inp" value={f.itemQuery || ''} onChange={set('itemQuery')} placeholder="품번 또는 품목명" /></label>
              <label>LOT<input className="inp" value={f.lotNoQuery || ''} onChange={set('lotNoQuery')} placeholder="LOT 번호" /></label>
              <label>수입처<input className="inp" value={f.vendorQuery || ''} onChange={set('vendorQuery')} placeholder="코드 또는 이름" /></label>
              <label>청구처<input className="inp" value={f.custQuery || ''} onChange={set('custQuery')} placeholder="코드 또는 이름" /></label>
              <label>BL번호<input className="inp" value={f.blNoQuery || ''} onChange={set('blNoQuery')} placeholder="BL 번호" /></label>
              <label>입고일<span className="dates"><input type="date" className="inp" min="2025-01-01" value={f.inDateFrom || ''} onChange={set('inDateFrom')} /><span className="help">~</span><input type="date" className="inp" min="2025-01-01" value={f.inDateTo || ''} onChange={set('inDateTo')} /></span></label>
              <label>발행일<span className="dates"><input type="date" className="inp" min="2025-01-01" value={f.billDateFrom || ''} onChange={set('billDateFrom')} /><span className="help">~</span><input type="date" className="inp" min="2025-01-01" value={f.billDateTo || ''} onChange={set('billDateTo')} /></span></label>
              <label>두 날짜 조건<select className="inp" value={f.dateMode || ''} onChange={set('dateMode')}><option value="">둘 중 하나라도 해당 (합집합)</option><option value="and">둘 다 해당 (교집합)</option></select></label>
              <label>판매가 설정<select className="inp" value={f.unsetPrice || ''} onChange={set('unsetPrice')}><option value="">전체</option><option value="y">판매가 미설정만</option></select></label>
              <div className="actions">
                <span className="help">조회조건 적용 {fmt(b.filteredRows?.length ?? 0)} / 전체 {fmt(b.allRows?.length ?? 0)} LOT</span>
                <span className="sp" />
                <button className="btn" onClick={b.reset}>초기화</button>
                <button className="btn pri" onClick={() => { b.search(); setShowFilter(false); }}>조회</button>
              </div>
            </div>
          )}
          {b.errorMsg && <div className="err">{b.errorMsg}</div>}

          {/* 결론 띠: 실현 수익 → 매출−원가 흐름 → 월별 수익 */}
          {s && (
            <div className="verdict">
              <div>
                <div className="l">실현 수익 (매출 − 원가)</div>
                <div className="big" style={{ color: s.margin >= 0 ? '#2c7f2c' : '#b32b2b' }}>{kor(s.margin)}<span className="rate" style={{ color: s.margin >= 0 ? '#2c7f2c' : '#b32b2b' }}>{rate == null ? '' : rate + '%'}</span></div>
                <div className="help" style={{ marginTop: 6 }}>{fmt(s.margin)}원 · 매출의 {rate == null ? '-' : rate + '%'}가 수익으로 남았습니다.</div>
                <div className="stack"><i style={{ width: costShare + '%', background: '#f26a1b' }} /><i style={{ width: (100 - costShare) + '%', background: s.margin >= 0 ? '#3aa63a' : '#d93c3c' }} /></div>
                <div className="stack-lg"><span>원가 {pctS(s.cogs, s.sales)}</span><span>수익 {rate == null ? '-' : rate + '%'}</span></div>
              </div>
              <div>
                <div className="l">매출에서 원가를 빼면</div>
                <div className="flow">
                  <div><div className="help">매출액</div><div className="n" style={{ color: '#1f6fe8' }}>{kor(s.sales)}</div><div className="help num">{fmt(s.sales)}</div></div>
                  <span className="op">−</span>
                  <div><div className="help">매출 원가</div><div className="n" style={{ color: '#f26a1b' }}>{kor(s.cogs)}</div><div className="help num">{fmt(s.cogs)}</div></div>
                  <span className="op">=</span>
                  <div><div className="help">실현 수익</div><div className="n" style={{ color: s.margin >= 0 ? '#2c7f2c' : '#b32b2b' }}>{kor(s.margin)}</div><div className="help num">{fmt(s.margin)}</div></div>
                </div>
                <div className="help" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--line)' }}>
                  <b style={{ color: 'var(--fg)' }}>재고 평가액 {kor(s.inventory)}</b> · 설정 판매가로 팔리면 예상 수익 구매 {kor(s.estMargin)} · 합성 {kor(s.estSynth)} · 영업 {kor(s.estSales)}
                </div>
              </div>
              <div>
                <div className="l">발행월별 실현 수익 <span style={{ color: 'var(--fg-3)' }}>최근 {months.length}개월</span></div>
                {months.length ? (
                  <div className="mini">{months.map(([m, v]) => <div key={m} className="col" title={`${m.slice(0, 4)}-${m.slice(4)} · ${fmt(v)}원`}><i className={v < 0 ? 'neg' : ''} style={{ height: Math.max(2, Math.round(Math.abs(v) / mMax * 48)) }} /><small>{+m.slice(4)}월</small></div>)}</div>
                ) : <div className="empty">판매 발행 내역이 없습니다.</div>}
                {months.length > 0 && <div className="help" style={{ marginTop: 6 }}>최고 {(() => { const t = months.reduce((p, c) => (c[1] > p[1] ? c : p)); return `${+t[0].slice(4)}월 ${kor(t[1])}`; })()}</div>}
              </div>
            </div>
          )}

          {/* 순위 3종: 누르면 그 조건으로 바로 조회 */}
          {s && (
            <div className="trio">
              <Rank title="부서별 실현 수익" rows={byDept} total={s.sales} onPick={n => quick({ dept: n })} />
              <Rank title="품목별 TOP 10" rows={byItem} total={s.sales} onPick={n => quick({ itemQuery: n.replace(/\s*\(.*\)$/, '') })} unit="품목" />
              <Rank title="수입처별 TOP 10" rows={byVendor} total={s.sales} onPick={n => quick({ vendorQuery: n.replace(/\s*\(.*\)$/, '') })} unit="수입처" />
            </div>
          )}

          <div className="card">
            <div className="hd">구조별 보기
              <span className="seg" style={{ marginLeft: 10 }}>{LEVELS.slice(0, 5).map((t, i) => <button key={t} className={lvl === i + 1 ? 'on' : ''} onClick={() => expandTo(i + 1)}>{LEVEL[t]}까지</button>)}</span>
              <span className="sp" />
              <input className="inp" style={{ width: 200 }} placeholder="이름으로 찾기 (품목·부서…)" value={q} onChange={e => setQ(e.target.value)} />
              <button className="btn sm" onClick={() => { b.collapse(); setOpen({}); setLvl(0); }}>전체 접기</button></div>
            <div className="tbl-wrap">
              <table className="tree">
                <thead><tr><th style={{ width: '34%' }}>사업단위 › 부서 › 담당자 › 품목 › 수입처 › BL</th><th style={{ width: '16%' }}>매출액</th><th className="c-cogs" style={{ width: '15%' }}>매출 원가</th><th style={{ width: '16%' }}>실현 수익</th><th style={{ width: '8%' }}>수익률</th><th className="c-share" style={{ width: '11%' }}>매출 비중</th></tr></thead>
                <tbody>
                  {roots.length === 0 && <tr><td colSpan={6} className="empty">{b.isFilterActive ? '조회조건에 해당하는 데이터가 없습니다.' : '분석할 데이터가 없습니다.'}</td></tr>}
                  {roots.filter(([, n]) => matches(n)).map(([k, n]) => <Row key={k} path={k} node={n} depth={0} total={s?.sales || 0} open={open} setOpen={setOpen} TreeNode={b.TreeNode} collapseSignal={b.collapseSignal} matches={matches} />)}
                </tbody>
              </table>
            </div>
            <p className="help" style={{ padding: '8px 14px' }}>행을 누르면 한 단계 더 펼쳐지고, BL을 펼치면 LOT·구매·판매 상세가 나옵니다. 위 단추로 원하는 단계까지 한 번에 펼칠 수 있습니다.</p>
          </div>
        </>
      )}
    </div>
  );
}

function Rank({ title, rows, total, onPick, unit }: { title: string; rows: { name: string; sales: number; margin: number; n: number }[]; total: number; onPick: (name: string) => void; unit?: string }) {
  const top = rows.slice(0, 10);
  const max = Math.max(1, ...top.map(r => r.sales));
  return (
    <div className="card">
      <div className="hd">{title}<span className="help" style={{ fontWeight: 400 }}>매출 순 · 누르면 그 조건으로 조회</span></div>
      <div className="rk">
        <div className="r" style={{ cursor: 'default', color: 'var(--fg-3)', fontSize: 11.5 }}><span>{unit || '부서'}</span><span style={{ textAlign: 'right' }}>실현 수익</span><span style={{ textAlign: 'right' }}>수익률</span></div>
        {top.map(r => (
          <div key={r.name} className="r" onClick={() => onPick(r.name)} title={`매출 ${fmt(r.sales)}원 · 원가 ${fmt(r.sales - r.margin)}원`}>
            <div><div className="nm">{r.name}<small>매출 {kor(r.sales)} · {pctS(r.sales, total)}</small></div><div className="hb"><i style={{ width: Math.max(2, Math.round(r.sales / max * 100)) + '%' }} /></div></div>
            <span className="v" style={{ color: r.margin >= 0 ? '#2c7f2c' : '#b32b2b' }}>{fmt(r.margin)}</span>
            <span className="p">{pctS(r.margin, r.sales)}</span>
          </div>
        ))}
        {!top.length && <div className="empty">데이터가 없습니다.</div>}
      </div>
    </div>
  );
}

/** 수익률 · 매출 비중 칸 — 새 행과 기존 BL 행이 같은 칸을 씁니다 */
function extraCells(node: Node, total: number) {
  const r = pct(node.margin, node.sales);
  return [
    <td key="rt" className={'rt ' + (r != null && r < 0 ? 'neg' : '')}>{r == null ? '-' : r + '%'}</td>,
    <td key="sh" className="c-share"><span className="share"><i style={{ width: (total > 0 ? Math.max(1, Math.round(node.sales / total * 100)) : 0) + '%' }} /></span></td>,
  ];
}

function Row({ path, node, depth, total, open, setOpen, TreeNode, collapseSignal, matches }: { path: string; node: Node; depth: number; total: number; open: Record<string, boolean>; setOpen: (f: (o: Record<string, boolean>) => Record<string, boolean>) => void; TreeNode: Bridge['TreeNode']; collapseSignal: number; matches: (n: Node) => boolean }) {
  if (node.type === 'blNo') return <TreeNode node={node} depth={depth} collapseSignal={collapseSignal} extra={(n: Node) => extraCells(n, total)} extraCount={2} />;
  const kids = Object.entries(node.children || {}).filter(([, c]) => matches(c)).sort((a, c) => (node.type === 'item' || a[1].type === 'item') ? String(a[0]).localeCompare(String(c[0]), 'ko') : c[1].sales - a[1].sales);
  const isOpen = !!open[path];
  const cnt = Object.keys(node.children || {}).length;
  return (
    <>
      <tr className={'lv d' + depth + (isOpen ? ' open' : '')} onClick={() => setOpen(o => ({ ...o, [path]: !o[path] }))}>
        <td style={{ paddingLeft: 12 + depth * 22 }}><span className="caret">{isOpen ? '▾' : '▸'}</span>{node.name}<span className="lvl">{LEVEL[node.type]}</span><span className="cnt">{cnt}</span></td>
        <td>{fmt(node.sales)}</td>
        <td className="c-cogs">{fmt(node.cogs)}</td>
        <td className={node.margin >= 0 ? 'pos' : 'neg'} style={{ fontWeight: 700 }}>{fmt(node.margin)}</td>
        {extraCells(node, total)}
      </tr>
      {isOpen && kids.map(([k, c]) => <Row key={k} path={path + '/' + k} node={c} depth={depth + 1} total={total} open={open} setOpen={setOpen} TreeNode={TreeNode} collapseSignal={collapseSignal} matches={matches} />)}
    </>
  );
}
