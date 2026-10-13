// 부서별 수익/비용 — 부서 책임자용: 내 부서가 받은 수익 안에서 비용을 썼는가
//   1) 부서 표(정렬·필터)  2) 부서를 고르면 그 자리에서 상세(월별 표 · 비용 구성 · 점검)
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmt } from '../components/ui';
import { HelpDot } from '../components/Help';
import { NetTrend, Spark, Donut, RatioBar, kor, ymL } from '../components/charts';
import VoucherTable from '../components/VoucherTable';

type Dept = { d: string; hq: string; groups: { key: string; label: string; pct: number }[]; margin: number[]; supAlloc: number[]; supCost: number[]; voucher: number[]; cost: number[]; emp: number[]; empNow: number; slices: { a: string; v: number; kws: string[] }[]; alerts: { a: string; v: number; up: boolean }[] };
type Model = { id: string; months: string[]; cur: string; prev: string | null; depts: Dept[]; groupSummary: { key: string; label: string; color: string; total: number; manual: boolean; series: number[] }[]; selected: string[] | null; noAlloc: boolean; isAdmin: boolean; updatedAt: string | null; updatedBy: string | null };
type Actions = { setBaseMonth: (v: string) => void; setMonths: (n: number) => void; get: () => { baseMonth: string; months: number }; render: () => void };
const KJ = () => (window as unknown as { KJHub?: { models?: Record<string, Model>; actions?: Record<string, Actions> } }).KJHub;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const last = (a: number[]) => a[a.length - 1] || 0;
const prevOf = (a: number[]) => (a.length > 1 ? a[a.length - 2] : 0);
const ratio = (c: number, m: number) => (m > 0 ? Math.round((c / m) * 1000) / 10 : null);
const pct = (c: number, p: number) => (p > 0 ? Math.round(((c - p) / p) * 1000) / 10 : null);
const shiftMonth = (ym: string, d: number) => { const y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + d; const dt = new Date(y, m, 1); return dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2); };
type SortKey = 'net' | 'margin' | 'cost' | 'ratio' | 'name';

export default function DeptDashboard() {
  const id = 'margin-alloc';
  const [model, setModel] = useState<Model | null>(() => KJ()?.models?.[id] ?? null);
  const [ctl, setCtl] = useState({ baseMonth: '', months: 3 });
  const [sel, setSel] = useState<Set<string> | null>(null);  // 표시할 부서 (null = 전체)
  const [openDept, setOpenDept] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('net');
  const [hq, setHq] = useState('');
  const nav = useNavigate();

  useEffect(() => {
    const onModel = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.id === id) { const m = KJ()!.models![id]; setModel({ ...m }); if (m.selected) setSel(new Set(m.selected)); const a = KJ()?.actions?.[id]; if (a) setCtl(a.get()); } };
    window.addEventListener('kjhub:model', onModel);
    const a = KJ()?.actions?.[id]; if (a) { setCtl(a.get()); const m = KJ()?.models?.[id]; if (m) { setModel({ ...m }); if (m.selected) setSel(new Set(m.selected)); } }
    // 사업장 화면에서 넘어올 때(본부 더블클릭) 부서 선택을 넘겨받음
    const w = window as unknown as { __kjMarginSelectDepts?: (l: string[]) => void };
    const orig = w.__kjMarginSelectDepts;
    w.__kjMarginSelectDepts = (list: string[]) => { setSel(new Set(list)); setOpenDept(list.length === 1 ? list[0] : null); orig?.(list); };
    return () => { window.removeEventListener('kjhub:model', onModel); w.__kjMarginSelectDepts = orig; };
  }, []);

  const act = KJ()?.actions?.[id];
  const setBase = (v: string) => { setCtl(c => ({ ...c, baseMonth: v })); act?.setBaseMonth(v); };
  const drill = (dept: string, acc?: string) => { const fn = (window as unknown as { __kjDeptCostDrill?: (o: object) => void }).__kjDeptCostDrill; if (fn && model) { fn({ dept, acc, baseMonth: model.cur, months: model.months }); nav('/dept-cost'); } };

  const rows = useMemo(() => {
    if (!model) return [];
    const r = model.depts.map(x => {
      const m = x.margin, c = x.cost;
      return { ...x, curM: last(m), curC: last(c), net: last(m) - last(c), r: ratio(last(c), last(m)), tM: sum(m), tC: sum(c), tNet: sum(m) - sum(c), momC: pct(last(c), prevOf(c)) };
    }).filter(x => (!sel || sel.has(x.d)) && (!hq || x.hq === hq));
    const by: Record<SortKey, (a: typeof r[0], b: typeof r[0]) => number> = {
      net: (a, b) => a.net - b.net, margin: (a, b) => b.curM - a.curM, cost: (a, b) => b.curC - a.curC,
      ratio: (a, b) => (b.r ?? -1) - (a.r ?? -1), name: (a, b) => a.d.localeCompare(b.d, 'ko'),
    };
    return r.sort(by[sort]);
  }, [model, sel, hq, sort]);
  const hqs = useMemo(() => Array.from(new Set((model?.depts ?? []).map(x => x.hq))).sort(), [model]);
  const over = rows.filter(x => x.r != null && x.r > 100);
  const totals = useMemo(() => ({ m: rows.reduce((s, x) => s + x.curM, 0), c: rows.reduce((s, x) => s + x.curC, 0), tM: rows.reduce((s, x) => s + x.tM, 0), tC: rows.reduce((s, x) => s + x.tC, 0) }), [rows]);
  const hasPrev = ctl.baseMonth > '2025-01';

  return (
    <div className="page brief">
      <style>{`
        .brief{gap:22px;max-width:1360px}
        .brief>*{min-width:0}
        .brief .ttl{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap}
        .brief .ttl h1{font-size:22px;font-weight:700}
        .brief .ttl .sub{color:var(--fg-3);font-size:13px}
        .brief .monthnav{display:inline-flex;align-items:center;border:1px solid var(--line-2);border-radius:9px;overflow:hidden;background:var(--surface)}
        .brief .monthnav button{border:0;background:transparent;padding:6px 10px;cursor:pointer;color:var(--fg-2);font-size:14px}
        .brief .monthnav button:disabled{opacity:.3}
        .brief .monthnav input{border:0;border-left:1px solid var(--line);border-right:1px solid var(--line);padding:6px 8px;font:600 13.5px var(--font-num);color:var(--fg);background:transparent}
        .sec h2{font-size:16px;font-weight:700;margin:0}
        .sec .lead{color:var(--fg-3);font-size:13px;margin:2px 0 12px}
        .verdict{display:grid;grid-template-columns:1fr 1.5fr;border:1px solid var(--line);border-radius:12px;background:var(--surface);overflow:hidden}
        .verdict>div{padding:16px 20px;min-width:0}.verdict>div+div{border-left:1px solid var(--line)}
        .verdict .l{font-size:12px;color:var(--fg-3)}
        .verdict .big{font:800 34px/1.1 var(--font-num);letter-spacing:-.02em;margin-top:4px;font-variant-numeric:tabular-nums}
        .verdict .facts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px;padding-top:10px;border-top:1px dashed var(--line)}
        .verdict .facts div{font-size:11.5px;color:var(--fg-3)}
        .verdict .facts b{display:block;font:700 15px var(--font-num);color:var(--fg);font-variant-numeric:tabular-nums}
        .dv{display:grid;gap:1px;margin-top:8px}
        .dvr{display:grid;grid-template-columns:150px 1fr 100px;gap:8px;align-items:center;font-size:12.5px;padding:3px 6px;border-radius:6px;cursor:pointer}
        .dvr:hover{background:var(--surface-2)}.dvr.on{background:var(--brand-soft)}
        .dvr .nm{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvr .nm small{font-weight:400;color:var(--fg-3);margin-left:5px;font-family:var(--font-num)}
        .dvr .trk{position:relative;height:9px;background:var(--surface-2);border-radius:999px;display:flex}
        .dvr .trk::after{content:'';position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:var(--line-2)}
        .dvr .trk i{display:block;height:100%}
        .dvr .trk .negb{margin-left:auto;background:#d93c3c;border-radius:999px 0 0 999px;flex:0 0 auto;width:0}
        .dvr .trk .posb{background:#3aa63a;border-radius:0 999px 999px 0;flex:0 0 auto}
        .dvr .trk{justify-content:flex-start}
        .dvr .trk .negb{position:absolute;right:50%}.dvr .trk .posb{position:absolute;left:50%}
        .dvr .v{text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums;font-weight:700}
        .dvr .v.pos{color:#2c7f2c}.dvr .v.neg{color:var(--neg)}
        @media (max-width:1000px){.verdict{grid-template-columns:1fr}.verdict>div+div{border-left:0;border-top:1px solid var(--line)}.verdict .facts{grid-template-columns:1fr 1fr}}
        .score{width:100%;border-collapse:separate;border-spacing:0;font-size:13.5px}
        .score th{text-align:right;font-weight:500;color:var(--fg-3);font-size:12px;padding:8px 10px;border-bottom:2px solid var(--line);white-space:nowrap;cursor:pointer;user-select:none}
        .score th.on{color:var(--brand);font-weight:700}
        .score th:first-child,.score td:first-child{text-align:left}
        .score td{padding:9px 10px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums;font-family:var(--font-num);white-space:nowrap}
        .score td:first-child{font-family:var(--font-body);font-weight:600}
        .score tr.drow{cursor:pointer}
        .score tr.drow:hover td{background:var(--surface-2)}
        .score tr.drow.open td{background:var(--brand-soft)}
        .score .neg{color:var(--neg)}.score .pos{color:#2c7f2c}
        .score td .hqs{display:block;font:400 11px var(--font-body);color:var(--fg-3)}
        .detail{border:1px solid var(--line);border-top:3px solid var(--brand);border-radius:0 0 12px 12px;background:var(--surface);padding:18px 20px;display:grid;gap:18px;margin-top:-1px}
        .detail .head{display:flex;gap:14px;align-items:baseline;flex-wrap:wrap}
        .detail .head h3{font-size:17px;font-weight:700;margin:0}
        .detail .grid2{display:grid;grid-template-columns:1.3fr 1fr;gap:22px}
        .mtbl{width:100%;border-collapse:collapse;font-size:13px}
        .mtbl th{text-align:right;color:var(--fg-3);font-weight:500;font-size:12px;padding:6px 8px;border-bottom:1px solid var(--line)}
        .mtbl th:first-child,.mtbl td:first-child{text-align:left}
        .mtbl td{text-align:right;padding:6px 8px;border-bottom:1px solid var(--line);font-family:var(--font-num);font-variant-numeric:tabular-nums}
        .mtbl td:first-child{font-family:var(--font-body)}
        .mtbl tr.sum td{font-weight:700;background:var(--surface-2)}
        .chips{display:flex;gap:6px;flex-wrap:wrap}
        @media (max-width:900px){.detail .grid2{grid-template-columns:1fr}}
      `}</style>

      <div className="ttl">
        <div><h1>부서별 수익/비용</h1><div className="sub">부서가 배분받은 수익(배분 비율 + 지원)과 쓴 비용(전표 + 지원 부담)을 같은 기간으로 비교합니다.</div></div>
        <span className="sp" />
        <span className="monthnav"><button onClick={() => setBase(shiftMonth(ctl.baseMonth, -1))} disabled={!hasPrev}>‹</button><input id="al-base" type="month" min="2025-01" value={ctl.baseMonth} onChange={e => setBase(e.target.value)} /><button onClick={() => setBase(shiftMonth(ctl.baseMonth, 1))}>›</button></span>
        <span className="seg">{[3, 6, 12].map(n => <button key={n} className={ctl.months === n ? 'on' : ''} onClick={() => { setCtl(c => ({ ...c, months: n })); act?.setMonths(n); }}>{n}개월</button>)}</span>
      </div>

      {!model ? (
        <div className="card"><div className="empty"><span className="spinner" /> 데이터를 계산하는 중입니다.</div></div>
      ) : model.noAlloc ? (
        <div className="card"><div className="empty">{model.isAdmin ? '배분 비율 설정(부서)에서 그룹별 부서와 비율을 먼저 설정하세요.' : '아직 관리자가 배분 비율을 설정하지 않았습니다.'}</div></div>
      ) : !model.months.length ? (
        <div className="card"><div className="empty">선택한 기간에 표시할 데이터가 없습니다.</div></div>
      ) : (
        <>
          <div className="verdict">
            <div>
              <div className="l">{ymL(model.cur)} 순수익 (수익 − 비용){hq ? ` · ${hq}` : ''}<HelpDot id="dept.verdict" /></div>
              <div className="big" style={{ color: totals.m - totals.c >= 0 ? '#2c7f2c' : '#b32b2b' }}>{(totals.m - totals.c >= 0 ? '+' : '−') + kor(Math.abs(totals.m - totals.c))}</div>
              <div className="help" style={{ marginTop: 4 }}>{totals.m - totals.c >= 0 ? `수익 안에서 비용을 썼습니다. 비용은 수익의 ${ratio(totals.c, totals.m) ?? '-'}%.` : `비용이 수익보다 ${kor(totals.c - totals.m)} 많습니다. 비용은 수익의 ${ratio(totals.c, totals.m) ?? '-'}%.`}</div>
              <div style={{ marginTop: 10 }}><RatioBar ratio={ratio(totals.c, totals.m)} /></div>
              <div className="facts">
                <div>수익<b>{kor(totals.m)}</b></div>
                <div>비용<b>{kor(totals.c)}</b></div>
                <div>{model.months.length}개월 누적<b style={{ color: totals.tM - totals.tC >= 0 ? '#2c7f2c' : '#b32b2b' }}>{(totals.tM - totals.tC >= 0 ? '+' : '−') + kor(Math.abs(totals.tM - totals.tC))}</b></div>
                <div>비용 &gt; 수익<b style={{ color: over.length ? 'var(--neg)' : undefined }}>{over.length}<span className="help" style={{ fontWeight: 400 }}> / {rows.length}곳</span></b></div>
              </div>
            </div>
            <div>
              <div className="l" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>부서별 순수익 한눈에<HelpDot id="dept.verdict" /> <span>오른쪽은 남김, 왼쪽은 초과 · 누르면 상세</span><span className="sp" />
                <select id="al-hq" className="inp" style={{ padding: '3px 8px', fontSize: 12 }} value={hq} onChange={e => setHq(e.target.value)}><option value="">본부 전체</option>{hqs.map(h => <option key={h} value={h}>{h}</option>)}</select>
                {sel && <button className="btn sm" onClick={() => setSel(null)}>부서 선택 해제 ({sel.size})</button>}
              </div>
              <div className="dv">{[...rows].sort((a, b) => b.net - a.net).map(x => { const mx = Math.max(1, ...rows.map(y => Math.abs(y.net))); const w = Math.round(Math.abs(x.net) / mx * 50); return (
                <div key={x.d} className={'dvr' + (openDept === x.d ? ' on' : '')} onClick={() => setOpenDept(openDept === x.d ? null : x.d)} title={`${x.d} · 수익 ${fmt(x.curM)} · 비용 ${fmt(x.curC)}`}>
                  <span className="nm">{x.d}<small>{x.r == null ? '' : x.r + '%'}</small></span>
                  <span className="trk"><i className="negb" style={{ width: x.net < 0 ? w + '%' : 0 }} /><i className="posb" style={{ width: x.net >= 0 ? w + '%' : 0 }} /></span>
                  <span className={'v ' + (x.net >= 0 ? 'pos' : 'neg')}>{(x.net >= 0 ? '+' : '−') + kor(Math.abs(x.net))}</span>
                </div>); })}</div>
            </div>
          </div>

          <section className="sec">
            <h2>부서 현황<HelpDot id="dept.table" /></h2>
            <p className="lead">{ymL(model.cur)} 기준. 열 제목을 누르면 정렬되고, 부서를 누르면 아래에 상세가 펼쳐집니다.</p>
            <div className="tbl-wrap">
              <table className="score">
                <thead><tr>
                  <Th k="name" cur={sort} set={setSort}>부서</Th><th>인원</th><Th k="margin" cur={sort} set={setSort}>수익</Th><Th k="cost" cur={sort} set={setSort}>비용</Th><Th k="net" cur={sort} set={setSort}>순수익</Th><Th k="ratio" cur={sort} set={setSort}><span style={{ minWidth: 140, display: 'inline-block' }}>비용/수익</span></Th><th>비용 전월비</th><th>누적 순수익</th><th style={{ width: 130 }}>추이</th><th>점검</th>
                </tr></thead>
                <tbody>
                  {rows.map(x => [
                    <tr key={x.d} className={'drow' + (openDept === x.d ? ' open' : '')} onClick={() => setOpenDept(o => (o === x.d ? null : x.d))}>
                      <td>{x.d}{!hq && <span className="hqs">{x.hq}</span>}</td>
                      <td>{x.empNow ? fmt(x.empNow) : '-'}</td><td>{fmt(x.curM)}</td><td>{fmt(x.curC)}</td>
                      <td className={x.net >= 0 ? 'pos' : 'neg'}>{fmt(x.net)}</td>
                      <td><RatioBar ratio={x.r} /></td>
                      <td style={{ color: x.momC == null ? 'var(--fg-3)' : x.momC > 0 ? 'var(--neg)' : '#2c7f2c' }}>{x.momC == null ? '-' : (x.momC > 0 ? '+' : '') + x.momC + '%'}</td>
                      <td className={x.tNet >= 0 ? 'pos' : 'neg'}>{fmt(x.tNet)}</td>
                      <td><Spark series={x.margin.map((v, i) => v - x.cost[i])} color="#64748b" h={34} /></td>
                      <td style={{ textAlign: 'left', fontFamily: 'var(--font-body)' }}>{x.alerts.length ? <span className={'tag ' + (x.alerts.some(a => a.up) ? 'n' : 'b')}>{x.alerts.length}건</span> : <span className="help">-</span>}</td>
                    </tr>,
                    openDept === x.d && (
                      <tr key={x.d + '-detail'}><td colSpan={10} style={{ padding: 0, whiteSpace: 'normal', textAlign: 'left', fontFamily: 'var(--font-body)' }}>
                        <DeptDetail x={x} model={model} onDrill={drill} />
                      </td></tr>
                    ),
                  ])}
                  {!rows.length && <tr><td colSpan={10} className="empty">조건에 맞는 부서가 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="sec">
            <h2>배분의 원천<HelpDot id="dept.source" /></h2>
            <p className="lead">{model.months.length}개월 동안 구매/판매 이윤이 어느 팀 기준으로 생겼는지입니다. 이 금액이 배분 비율에 따라 부서 수익이 됩니다.</p>
            <div className="chips">{model.groupSummary.filter(g => g.total !== 0).sort((a, b) => b.total - a.total).map(g => <span key={g.key} className="chip" style={{ borderLeft: `3px solid ${g.color}`, gap: 8 }}>{g.label}<b className="num">{kor(g.total)}</b>{g.manual && <span className="help">수동</span>}</span>)}</div>
            {model.updatedAt && <p className="help" style={{ marginTop: 8 }}>배분 설정 저장: {new Date(model.updatedAt).toLocaleString('ko-KR')}{model.updatedBy ? ` (${model.updatedBy})` : ''}</p>}
          </section>
        </>
      )}
    </div>
  );
}

function Th({ k, cur, set, children }: { k: SortKey; cur: SortKey; set: (k: SortKey) => void; children: React.ReactNode }) {
  return <th className={cur === k ? 'on' : ''} onClick={() => set(k)}>{children}{cur === k ? ' ▾' : ''}</th>;
}

function DeptDetail({ x, model, onDrill }: { x: Dept & { r: number | null; curM: number; curC: number }; model: Model; onDrill: (d: string, acc?: string) => void }) {
  const months = model.months;
  const [tab, setTab] = useState<'month' | 'voucher'>('month');
  const [vAcc, setVAcc] = useState('');
  const [vMonths, setVMonths] = useState<'cur' | 'all'>('cur');
  const showVouchers = (acc?: string) => { setVAcc(acc || ''); setTab('voucher'); };
  const sumM = sum(x.margin), sumC = sum(x.cost);
  const budget = x.curM > 0 ? (x.curC > x.curM ? { t: '수익 초과', c: 'n' } : x.r != null && x.r >= 85 ? { t: '수익의 85% 이상 사용', c: 'y' } : { t: '여유 있음', c: 'g' }) : null;
  return (
    <div className="detail">
      <div className="head">
        <h3>{x.d}<HelpDot id="dept.detail" /></h3>
        <span className="help">{x.hq}{x.empNow ? ` · 현재 인원 ${x.empNow}명` : ''}</span>
        <span className="chips">{x.groups.map(g => <span key={g.key} className="tag b">{g.label} {g.pct}%</span>)}{budget && <span className={'tag ' + budget.c}>{budget.t}</span>}</span>
        <span className="sp" />
        <span className="seg"><button className={tab === 'month' ? 'on' : ''} onClick={() => setTab('month')}>월별 요약</button><button className={tab === 'voucher' ? 'on' : ''} onClick={() => showVouchers()}>전표 내역</button></span>
        <button className="btn sm ghost" onClick={() => onDrill(x.d)} title="부서별 비용 화면에서 더 넓게 보기">전체 화면</button>
      </div>
      {tab === 'voucher' ? (
        <div>
          <div className="row" style={{ marginBottom: 8 }}><span className="help">기간</span><span className="seg"><button className={vMonths === 'cur' ? 'on' : ''} onClick={() => setVMonths('cur')}>{ymL(model.cur)}</button><button className={vMonths === 'all' ? 'on' : ''} onClick={() => setVMonths('all')}>{months.length}개월 전체</button></span></div>
          <VoucherTable compact filter={{ depts: [x.d], months: vMonths === 'cur' ? [model.cur] : months, acc: vAcc }} onAccPick={setVAcc} />
        </div>
      ) : (
      <div className="grid2">
        <div>
          <NetTrend months={months} margin={x.margin} cost={x.cost} height={210} />
          <table className="mtbl" style={{ marginTop: 10 }}>
            <thead><tr><th>월</th><th>수익</th><th>그중 지원</th><th>비용</th><th>그중 지원</th><th>순수익</th><th>비용/수익</th><th>인원</th></tr></thead>
            <tbody>
              {months.map((m, i) => { const n = x.margin[i] - x.cost[i]; const r = ratio(x.cost[i], x.margin[i]); return <tr key={m}><td>{ymL(m)}</td><td>{fmt(x.margin[i])}</td><td style={{ color: 'var(--fg-3)' }}>{x.supAlloc[i] ? fmt(x.supAlloc[i]) : ''}</td><td>{fmt(x.cost[i])}</td><td style={{ color: 'var(--fg-3)' }}>{x.supCost[i] ? fmt(x.supCost[i]) : ''}</td><td style={{ color: n >= 0 ? '#2c7f2c' : 'var(--neg)' }}>{fmt(n)}</td><td style={{ color: r != null && r > 100 ? 'var(--neg)' : undefined }}>{r == null ? '-' : r + '%'}</td><td>{x.emp[i] || ''}</td></tr>; })}
              <tr className="sum"><td>합계</td><td>{fmt(sumM)}</td><td>{sum(x.supAlloc) ? fmt(sum(x.supAlloc)) : ''}</td><td>{fmt(sumC)}</td><td>{sum(x.supCost) ? fmt(sum(x.supCost)) : ''}</td><td style={{ color: sumM - sumC >= 0 ? '#2c7f2c' : 'var(--neg)' }}>{fmt(sumM - sumC)}</td><td>{ratio(sumC, sumM) == null ? '-' : ratio(sumC, sumM) + '%'}</td><td></td></tr>
            </tbody>
          </table>
        </div>
        <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>{ymL(model.cur)} 비용 구성</div>
            {x.slices.length ? <Donut slices={x.slices} total={sum(x.slices.map(s => s.v))} centerLabel={ymL(model.cur)} /> : <span className="help">기준월 전표가 없습니다.</span>}
            {x.slices.length > 0 && <div className="chips" style={{ marginTop: 8 }}>{x.slices.filter(s => s.a !== '기타').map(s => <button key={s.a} className="btn sm ghost" onClick={() => showVouchers(s.a)}>{s.a.replace(/^\((판|제)\)/, '')} 전표</button>)}</div>}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>점검 포인트</div>
            {x.alerts.length ? <div className="chips">{x.alerts.map((a, i) => <span key={i} className="chip" style={{ cursor: 'pointer', background: a.up ? 'var(--neg-soft)' : 'var(--brand-soft)', color: a.up ? 'var(--neg)' : 'var(--brand)', borderColor: 'transparent' }} onClick={() => showVouchers(a.a)}>{a.up ? '▲' : '▼'} {a.a.replace(/^\((판|제)\)/, '')} <b className="num">{(a.up ? '+' : '−') + kor(a.v)}</b></span>)}</div> : <span className="help">최근 평균 대비 크게 달라진 계정이 없습니다.</span>}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
