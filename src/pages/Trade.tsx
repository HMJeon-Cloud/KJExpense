// 거래·재고 › 구매 · 판매 — 매출 · 원가 · 판매 이익 → 월별 → 부서 · 품목 · 수입처 순위 → 단계별 표(부서까지 펼침)
//   필터·집계·LOT 상세 계산은 기존 모듈(legacy/screens/trade.js)이 그대로 수행하고, 이 화면은 그 상태를 받아 그립니다.
//   LOT 상세(BL 단위) 표는 기존 컴포넌트(TreeNode)를 그대로 끼워 넣어 숫자가 달라지지 않게 했습니다.
import { useAuth } from '../lib/auth';
import { useEffect, useMemo, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react';
import { fmt } from '../components/ui';
import { HelpDot } from '../components/Help';
import { MonthBars } from '../components/charts';
import { PageHead, Stat, Card, Loading, won } from '../components/kit';

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
const LEVEL: Record<string, string> = { bizUnit: '본부', dept: '부서', buyer: '담당자', item: '품목', vendor: '수입처', blNo: 'BL' };
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
  const isAdmin = useAuth().employee?.role === 'admin';
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
  const costShare = s && s.sales > 0 ? Math.min(100, Math.max(0, s.cogs / s.sales * 100)) : 0;

  // 적용 중인 조건 요약 칩
  const chips: [string, string][] = [];
  if (a.bizUnit) chips.push(['본부', a.bizUnit]); if (a.dept) chips.push(['부서', a.dept]); if (a.buyer) chips.push(['담당자', a.buyer]);
  if (a.itemQuery) chips.push(['품목', a.itemQuery]); if (a.lotNoQuery) chips.push(['LOT', a.lotNoQuery]); if (a.vendorQuery) chips.push(['수입처', a.vendorQuery]); if (a.custQuery) chips.push(['거래처', a.custQuery]); if (a.blNoQuery) chips.push(['BL', a.blNoQuery]);
  if (a.inDateFrom || a.inDateTo) chips.push(['입고일', `${dL(a.inDateFrom)} ~ ${dL(a.inDateTo)}`]);
  if (a.billDateFrom || a.billDateTo) chips.push(['판매 발행일', `${dL(a.billDateFrom)} ~ ${dL(a.billDateTo)}`]);
  if (a.unsetPrice) chips.push(['판매가', '없는 것만']);
  const quick = (patch: Filters) => { b?.setDraft(patch); setTimeout(() => b?.search(), 0); };

  return (
    <div className="page tr">
      <style>{`
        .tr .tbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 14px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow-xs)}
        .tr .tbar .k{font-size:12.5px;font-weight:600;color:var(--fg-2)}
        .tr .tf{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px 14px;padding:16px 18px;background:var(--surface);border:1.5px solid var(--blue);border-radius:var(--r)}
        .tr .tf label{display:grid;gap:5px;font-size:12.5px;color:var(--fg-3);font-weight:600;min-width:0}
        .tr .tf .inp{width:100%;font-weight:400}
        .tr .tf .dates{display:flex;gap:6px;align-items:center}
        .tr .tf .dates .inp{flex:1;min-width:0}
        .tr .tf .actions{grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap}
        .tr .split{display:flex;height:8px;border-radius:999px;overflow:hidden;margin-top:6px;background:var(--surface-3);gap:2px}
        .tr .split i{display:block;height:100%}
        .tr .rl{display:grid;grid-template-columns:minmax(0,1fr) 108px 52px;gap:10px;align-items:center;padding:7px 8px;border-radius:8px;cursor:pointer;font-size:13.5px}
        .tr .rl:hover{background:var(--surface-2)}
        .tr .rl .nm{font-weight:600;min-width:0;display:grid;gap:5px}.tr .rl .nm>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tr .rl .nm small{font-weight:400;color:var(--fg-3);margin-left:6px;font-size:12px}
        .tr .rl .bar{height:5px}
        .tr .rl>:nth-child(n+2){text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.tr .rl>:nth-child(3){font-size:12.5px;color:var(--fg-3)}
        .tr .rl.h{cursor:default;font-size:12px;color:var(--fg-3);font-weight:600;border-bottom:1px solid var(--line);border-radius:0;padding-bottom:6px}.tr .rl.h:hover{background:none}
        .tr .tree{width:100%;border-collapse:separate;border-spacing:0;font-size:13.5px;table-layout:fixed}
        .tr .tree td:first-child{overflow:hidden;text-overflow:ellipsis}
        .tr .tree th{text-align:right;font-weight:600;color:var(--fg-3);font-size:12px;padding:9px 12px;border-bottom:1px solid var(--line);white-space:nowrap;background:var(--surface-2)}
        .tr .tree th:first-child{text-align:left}
        .tr .tree td{padding:8px 12px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .tr .tree td:first-child{text-align:left}
        .tr .tree tr.lv{cursor:pointer}
        .tr .tree tr.lv:hover td{background:var(--surface-2)}
        .tr .tree tr.lv.d0>td{background:var(--surface-2);font-weight:700}
        .tr .tree tr.lv.open>td:first-child{font-weight:700}
        .tr .tree .caret{display:inline-block;width:16px;color:var(--fg-3);font-size:11px}
        .tr .tree .lvl{font-size:11px;color:var(--fg-4);margin-left:6px;font-weight:400}
        .tr .tree .cnt{font-size:11.5px;color:var(--fg-3);margin-left:5px;font-weight:400}
        .tr .tree .pos{color:var(--green-2)}.tr .tree .neg{color:var(--red-2)}
        .tr .tree .share{display:inline-block;width:100%;height:6px;background:var(--surface-3);border-radius:999px;overflow:hidden;vertical-align:middle}
        .tr .tree .share i{display:block;height:100%;background:var(--blue);border-radius:999px}
        .tr .tree .rt{font-size:12.5px}
        @media (max-width:1000px){.tr .tf{grid-template-columns:1fr 1fr}.tr .tree .c-share,.tr .tree .c-cogs{display:none}}
        @media (max-width:820px){.tr .tree{font-size:12.5px}.tr .tree td,.tr .tree th{padding:8px 8px}.tr .tree .c-rt{display:none}}
      `}</style>

      <PageHead title="구매 · 판매" desc="구매(입고)와 판매를 LOT 단위로 맞춰 판매 이익을 계산합니다. 판매 이익 = 매출 − 원가.">
        {b?.lastLoadedAt && <span className="help">계산 {new Date(b.lastLoadedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>}
      </PageHead>

      {!b ? <Loading text="구매 · 판매 데이터를 준비하는 중입니다." /> : (
        <>
          {/* 조건: 평소엔 한 줄 요약, 필요할 때만 펼침 */}
          <div className="tbar">
            <span className="k">조건</span>
            {chips.length === 0 && <span className="chip">전체</span>}
            {chips.map(([k, v]) => <span key={k} className="chip on">{k} <b>{v}</b></span>)}
            <span className="help">{fmt(b.filteredRows?.length ?? b.allRows?.length ?? 0)} LOT</span>
            <span className="sp" />
            {b.isProcessing && <span className="help"><span className="spinner" /> 계산하는 중입니다.</span>}
            {chips.length > 0 && <button className="btn sm ghost" onClick={() => { b.reset(); setTimeout(() => b.search(), 0); }}>조건 지우기</button>}
            <button className={'btn sm' + (showFilter ? ' pri' : '')} onClick={() => setShowFilter(v => !v)}>{showFilter ? '닫기' : '조건 바꾸기'}</button>
          </div>
          {showFilter && (
            <div className="tf" onKeyDown={onKey}>
              <label>본부<select className="inp" value={f.bizUnit || ''} onChange={set('bizUnit')}><option value="">전체</option>{b.filterOptions.bizUnits.map(v => <option key={v}>{v}</option>)}</select></label>
              <label>부서<select className="inp" value={f.dept || ''} onChange={set('dept')}><option value="">전체</option>{b.filterOptions.depts.map(v => <option key={v}>{v}</option>)}</select></label>
              <label>담당자<select className="inp" value={f.buyer || ''} onChange={set('buyer')}><option value="">전체</option>{b.filterOptions.buyers.map(v => <option key={v}>{v}</option>)}</select></label>
              <label>품목<input className="inp" value={f.itemQuery || ''} onChange={set('itemQuery')} placeholder="품번 또는 품목명" /></label>
              <label>LOT<input className="inp" value={f.lotNoQuery || ''} onChange={set('lotNoQuery')} placeholder="LOT 번호" /></label>
              <label>수입처<input className="inp" value={f.vendorQuery || ''} onChange={set('vendorQuery')} placeholder="코드 또는 이름" /></label>
              <label>거래처<input className="inp" value={f.custQuery || ''} onChange={set('custQuery')} placeholder="코드 또는 이름" /></label>
              <label>BL 번호<input className="inp" value={f.blNoQuery || ''} onChange={set('blNoQuery')} placeholder="BL 번호" /></label>
              <label>입고일<span className="dates"><input type="date" className="inp" min="2025-01-01" value={f.inDateFrom || ''} onChange={set('inDateFrom')} /><span className="help">~</span><input type="date" className="inp" min="2025-01-01" value={f.inDateTo || ''} onChange={set('inDateTo')} /></span></label>
              <label>판매 발행일<span className="dates"><input type="date" className="inp" min="2025-01-01" value={f.billDateFrom || ''} onChange={set('billDateFrom')} /><span className="help">~</span><input type="date" className="inp" min="2025-01-01" value={f.billDateTo || ''} onChange={set('billDateTo')} /></span></label>
              <label>두 날짜를 함께 넣으면<select className="inp" value={f.dateMode || ''} onChange={set('dateMode')}><option value="">둘 중 하나라도 맞으면</option><option value="and">둘 다 맞아야</option></select></label>
              <label>판매가 설정<select className="inp" value={f.unsetPrice || ''} onChange={set('unsetPrice')}><option value="">전체</option><option value="y">판매가가 없는 것만</option></select></label>
              <div className="actions">
                <span className="help">조건에 맞는 LOT {fmt(b.filteredRows?.length ?? 0)} / 전체 {fmt(b.allRows?.length ?? 0)}</span>
                <span className="sp" />
                <button className="btn" onClick={b.reset}>처음으로</button>
                <button className="btn pri" onClick={() => { b.search(); setShowFilter(false); }}>조회</button>
              </div>
            </div>
          )}
          {b.errorMsg && <div className="note warn">{b.errorMsg}</div>}

          {s && <>
            <div className="stats">
              <Stat label="매출" value={won(s.sales)} sub={<span className="num">{fmt(s.sales)}</span>} />
              <Stat label="원가" value={won(s.cogs)} sub={<>매출의 {pctS(s.cogs, s.sales)}</>} />
              <Stat label="판매 이익" help="trade.verdict" value={won(s.margin)} unit={rate == null ? undefined : `이익률 ${rate}%`} tone={s.margin >= 0 ? 'pos' : 'neg'} keyColor={s.margin >= 0 ? 'var(--green)' : 'var(--red)'} sub="매출 − 원가">
                <div className="split" title={`원가 ${pctS(s.cogs, s.sales)} · 판매 이익 ${rate == null ? '-' : rate + '%'}`}><i style={{ width: costShare + '%', background: 'var(--orange)' }} /><i style={{ width: (100 - costShare) + '%', background: s.margin >= 0 ? 'var(--green)' : 'var(--red)' }} /></div>
              </Stat>
              <Stat label="재고 평가액" value={won(s.inventory)} sub="아직 팔리지 않은 LOT의 원가" />
            </div>
            {isAdmin && <div className="help" title="관리자에게만 보이는 참고값입니다. 판매가가 없는 품목은 0으로 계산되어 구매는 큰 음수, 영업은 큰 양수로 나올 수 있습니다. 부서 손익 화면은 판매가가 없는 품목을 빼고 계산합니다.">관리자 참고 · 설정 판매가로 나눈 단계 이익(판매가 없는 품목 포함): 구매 {won(s.estMargin)} · 합성 {won(s.estSynth)} · 영업 {won(s.estSales)}<HelpDot id="trade.est" /></div>}

            <div className="g21">
              <Card title="월별 판매 이익" help="trade.monthly" desc={`판매 발행월 기준 · 최근 ${months.length}개월`}>
                {months.length ? <MonthBars items={months.map(([m, v]) => ({ m, v }))} mode="sign" height={220} label="월별 판매 이익" /> : <div className="empty">판매 내역이 없습니다.</div>}
              </Card>
              <Rank title="부서별" rows={byDept} total={s.sales} onPick={n => quick({ dept: n })} unit="부서" />
            </div>
            <div className="g2">
              <Rank title="품목 상위 10" rows={byItem} total={s.sales} onPick={n => quick({ itemQuery: n.replace(/\s*\(.*\)$/, '') })} unit="품목" />
              <Rank title="수입처 상위 10" rows={byVendor} total={s.sales} onPick={n => quick({ vendorQuery: n.replace(/\s*\(.*\)$/, '') })} unit="수입처" />
            </div>
          </>}

          <Card title="단계별로 펼쳐 보기" help="trade.tree" flush
            right={<span className="row"><span className="seg">{LEVELS.slice(0, 5).map((t, i) => <button key={t} className={lvl === i + 1 ? 'on' : ''} onClick={() => expandTo(i + 1)}>{LEVEL[t]}</button>)}</span><input className="inp" style={{ width: 190 }} placeholder="이름으로 찾기" value={q} onChange={e => setQ(e.target.value)} /><button className="btn sm" onClick={() => { b.collapse(); setOpen({}); setLvl(0); }}>모두 접기</button></span>}>
            <div className="tbl-wrap">
              <table className="tree">
                <thead><tr><th style={{ width: '34%' }}>본부 › 부서 › 담당자 › 품목 › 수입처 › BL</th><th style={{ width: '16%' }}>매출</th><th className="c-cogs" style={{ width: '15%' }}>원가</th><th style={{ width: '16%' }}>판매 이익</th><th className="c-rt" style={{ width: '8%' }}>이익률</th><th className="c-share" style={{ width: '11%' }}>매출 비중</th></tr></thead>
                <tbody>
                  {roots.length === 0 && <tr><td colSpan={6} className="empty">{b.isFilterActive ? '조건에 맞는 데이터가 없습니다.' : '데이터가 없습니다.'}</td></tr>}
                  {roots.filter(([, n]) => matches(n)).map(([k, n]) => <Row key={k} path={k} node={n} depth={0} total={s?.sales || 0} open={open} setOpen={setOpen} TreeNode={b.TreeNode} collapseSignal={b.collapseSignal} matches={matches} />)}
                </tbody>
              </table>
            </div>
            <p className="help" style={{ padding: '10px 20px 14px' }}>줄을 누르면 한 단계씩 펼쳐집니다. BL까지 펼치면 LOT별 구매 · 판매 내역이 나옵니다.</p>
          </Card>
        </>
      )}
    </div>
  );
}

function Rank({ title, rows, total, onPick, unit }: { title: string; rows: { name: string; sales: number; margin: number; n: number }[]; total: number; onPick: (name: string) => void; unit?: string }) {
  const top = rows.slice(0, 10);
  const max = Math.max(1, ...top.map(r => r.sales));
  return (
    <Card title={title} help="trade.rank" desc="매출 큰 순 · 누르면 그 조건으로 조회">
      {top.length ? <>
        <div className="rl h"><span>{unit || '부서'} · 매출</span><span>판매 이익</span><span>이익률</span></div>
        {top.map(r => (
          <div key={r.name} className="rl" onClick={() => onPick(r.name)} title={`매출 ${fmt(r.sales)} · 원가 ${fmt(r.sales - r.margin)}`}>
            <span className="nm"><span>{r.name}<small>{won(r.sales)} · {pctS(r.sales, total)}</small></span><div className="bar"><i style={{ width: Math.max(2, Math.round(r.sales / max * 100)) + '%' }} /></div></span>
            <b style={{ color: r.margin >= 0 ? 'var(--green-2)' : 'var(--red-2)' }}>{fmt(r.margin)}</b>
            <span>{pctS(r.margin, r.sales)}</span>
          </div>
        ))}
      </> : <div className="empty">데이터가 없습니다.</div>}
    </Card>
  );
}

/** 이익률 · 매출 비중 칸 — 새 행과 기존 BL 행이 같은 칸을 씁니다 */
function extraCells(node: Node, total: number) {
  const r = pct(node.margin, node.sales);
  return [
    <td key="rt" className={'rt c-rt ' + (r != null && r < 0 ? 'neg' : '')}>{r == null ? '-' : r + '%'}</td>,
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
