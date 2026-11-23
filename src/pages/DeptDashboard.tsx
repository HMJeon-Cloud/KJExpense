// 부서 손익 — 팀장이 매달 보는 화면
//   우리 부서가 받은 배분 이익 안에서 비용을 썼는가 · 비용은 어느 계정에서 평소와 달라졌는가 · 배분 이익은 어디서 왔는가
//   여러 부서를 보는 사람(본부장·임원)은 왼쪽 목록에서 부서를 고르고, "전체"에서 부서를 비교합니다.
// 숫자는 계산 모듈(legacy/screens/profit.js)의 모델(KJHub.models['margin-alloc'])과 전표 집계(KJHub.agg.voucher)를 그대로 씁니다.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { accL } from '../lib/acc';
import { fmt } from '../components/ui';
import { useAuth } from '../lib/auth';
import { NetTrend, TrendLine, RatioBar, DivBar, pctCap, C } from '../components/charts';
import { PageHead, MonthNav, RangeSeg, Stat, Card, Delta, Loading, Empty, Legend, won, swon, ymText, ymShort } from '../components/kit';
import VoucherTable from '../components/VoucherTable';

type Dept = { d: string; hq: string; groups: { key: string; label: string; pct: number }[]; margin: number[]; supAlloc: number[]; supCost: number[]; voucher: number[]; cost: number[]; emp: number[]; empNow: number; slices: { a: string; v: number; kws: string[] }[]; alerts: { a: string; v: number; up: boolean }[] };
type Model = { id: string; months: string[]; cur: string; prev: string | null; depts: Dept[]; groupSummary: { key: string; label: string; color: string; total: number; manual: boolean; series: number[] }[]; selected: string[] | null; noAlloc: boolean; isAdmin: boolean; updatedAt: string | null; updatedBy: string | null };
type Actions = { setBaseMonth: (v: string) => void; setMonths: (n: number) => void; get: () => { baseMonth: string; months: number }; render: () => void };
type AggRow = { dept: string; ym: string; acc: string; amt: number | string };
const KJ = () => (window as unknown as { KJHub?: { models?: Record<string, Model>; actions?: Record<string, Actions>; agg?: { voucher?: AggRow[] } } }).KJHub;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const last = (a: number[]) => a[a.length - 1] || 0;
const prevOf = (a: number[]) => (a.length > 1 ? a[a.length - 2] : 0);
const ratio = (c: number, m: number) => (m > 0 ? Math.round((c / m) * 1000) / 10 : null);
const nrm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
const isSettle = (a: string) => /^(상품|제품|수수료)매출\(결산\)$/.test(a.replace(/\s+/g, ''));
type SortKey = 'net' | 'margin' | 'cost' | 'ratio' | 'name';

export default function DeptDashboard() {
  const id = 'margin-alloc';
  const [model, setModel] = useState<Model | null>(() => KJ()?.models?.[id] ?? null);
  const [ctl, setCtl] = useState({ baseMonth: '', months: 3 });
  const [sel, setSel] = useState<string | null>(null);         // 고른 부서 ('' = 전체 비교, null = 아직 안 고름)
  const [only, setOnly] = useState<Set<string> | null>(null);   // 다른 화면에서 넘겨받은 부서 묶음
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('net');
  const { employee } = useAuth();

  useEffect(() => {
    const onModel = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.id === id) { setModel({ ...KJ()!.models![id] }); const a = KJ()?.actions?.[id]; if (a) setCtl(a.get()); } };
    window.addEventListener('kjhub:model', onModel);
    const a = KJ()?.actions?.[id]; if (a) { setCtl(a.get()); const m = KJ()?.models?.[id]; if (m) setModel({ ...m }); }
    // 다른 화면(본부 표)에서 넘어올 때 부서 선택을 넘겨받음
    const w = window as unknown as { __kjMarginSelectDepts?: (l: string[]) => void };
    const orig = w.__kjMarginSelectDepts;
    w.__kjMarginSelectDepts = (list: string[]) => { if (list.length === 1) { setSel(list[0]); setOnly(null); } else { setSel(''); setOnly(new Set(list)); } };
    return () => { window.removeEventListener('kjhub:model', onModel); w.__kjMarginSelectDepts = orig; };
  }, []);

  const act = KJ()?.actions?.[id];
  const setBase = (v: string) => { setCtl(c => ({ ...c, baseMonth: v })); act?.setBaseMonth(v); };
  const setMonths = (n: number) => { setCtl(c => ({ ...c, months: n })); act?.setMonths(n); };

  const rows = useMemo(() => (model?.depts ?? []).map(x => ({ ...x, curM: last(x.margin), curC: last(x.cost), net: last(x.margin) - last(x.cost), r: ratio(last(x.cost), last(x.margin)), tNet: sum(x.margin) - sum(x.cost) })), [model]);
  // 처음 고를 부서: 한 부서만 보이면 그 부서, 내 부서가 있으면 내 부서, 아니면 전체 비교
  const cur = useMemo(() => {
    if (!rows.length) return '';
    if (sel != null && (sel === '' || rows.some(r => r.d === sel))) return sel;
    if (rows.length === 1) return rows[0].d;
    const mine = rows.find(r => nrm(r.d) === nrm(employee?.dept || ''));
    return mine ? mine.d : '';
  }, [rows, sel, employee?.dept]);
  const one = rows.find(r => r.d === cur) || null;
  const multi = rows.length > 1;

  const head = (
    <PageHead title="부서 손익" desc="부서가 받은 배분 이익과 쓴 비용을 같은 기간으로 봅니다. 손익 = 배분 이익 − 비용.">
      {ctl.baseMonth && <MonthNav id="al-base" value={ctl.baseMonth} onChange={setBase} />}
      <RangeSeg value={ctl.months} onChange={setMonths} />
    </PageHead>
  );
  if (!model) return <div className="page">{head}<Loading /></div>;
  if (model.noAlloc) return <div className="page">{head}<Empty>{model.isAdmin ? '배분 비율을 먼저 설정해 주세요. (관리 › 기준 설정 › 배분 비율)' : '아직 관리자가 배분 비율을 설정하지 않았습니다.'}</Empty></div>;
  if (!model.months.length || !rows.length) return <div className="page">{head}<Empty>선택한 기간에 표시할 데이터가 없습니다.</Empty></div>;

  const HQ_ORDER = ['API사업본부', 'API합성본부', '소재사업본부', '경영전략본부'];
  const hqRank = (h: string) => { const i = HQ_ORDER.indexOf(h); return i < 0 ? 99 : i; };
  const list = rows.filter(r => (!only || only.has(r.d)) && (!q.trim() || nrm(r.d + r.hq).includes(nrm(q)))).sort((a, b) => hqRank(a.hq) - hqRank(b.hq) || a.hq.localeCompare(b.hq, 'ko') || a.d.localeCompare(b.d, 'ko'));
  const hqList = Array.from(new Set(list.map(r => r.hq)));
  const maxNet = Math.max(1, ...rows.map(r => Math.abs(r.net)));

  return (
    <div className="page dpt">
      <style>{`
        .dpt .lay{display:grid;grid-template-columns:268px minmax(0,1fr);gap:18px;align-items:start}
        .dpt .lay.single{grid-template-columns:minmax(0,1fr)}
        .dpt .pick{position:sticky;top:calc(var(--top-h) + 14px);max-height:calc(100vh - var(--top-h) - 28px);display:flex;flex-direction:column}
        .dpt .pick .srch{padding:12px 12px 8px}
        .dpt .pick .srch .inp{width:100%}
        .dpt .pick .ls{overflow-y:auto;padding:0 6px 8px;scrollbar-width:thin}
        .dpt .pick .gt{font-size:11px;font-weight:700;color:var(--fg-4);padding:10px 8px 4px;letter-spacing:.03em}
        .dpt .pick button.it{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;width:100%;text-align:left;border:0;background:transparent;padding:7px 8px;border-radius:8px;cursor:pointer;font:500 13.5px var(--font-body);color:var(--fg)}
        .dpt .pick button.it:hover{background:var(--surface-2)}
        .dpt .pick button.it.on{background:var(--blue-soft);color:var(--blue-2);font-weight:700}
        .dpt .pick button.it span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .dpt .pick button.it b{font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums}
        .dpt .msel{display:none}
        .dpt .body{display:grid;gap:18px;min-width:0}
        .dpt .body>*{min-width:0}
        .dpt .dh{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
        .dpt .dh h2{font-size:19px;font-weight:800}
        .dpt .dh .meta{font-size:13px;color:var(--fg-3)}
        .dpt .al{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 6px;border-radius:8px;cursor:pointer;font-size:13.5px}
        .dpt .al:hover{background:var(--surface-2)}
        .dpt .al b{font-variant-numeric:tabular-nums}
        .dpt .t.acc td.kw{text-align:left;max-width:220px;overflow:hidden;white-space:nowrap}
        .dpt .t.acc tr.open td{background:var(--blue-soft)}
        .dpt .t.acc td.vch{padding:0;text-align:left;white-space:normal;background:var(--surface-2)}
        .dpt .vin{padding:12px 16px}
        .dpt .src{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) 64px minmax(0,1fr);gap:6px 12px;font-size:13.5px;align-items:center}
        .dpt .src>*{padding:7px 0;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}
        .dpt .src .h{font-size:12px;font-weight:600;color:var(--fg-3);padding:0 0 6px}
        .dpt .src .r{text-align:right}
        .dpt .src .tot{font-weight:700;border-bottom:0}
        @media(max-width:1080px){.dpt .lay{grid-template-columns:minmax(0,1fr)}.dpt .pick{display:none}.dpt .msel{display:block}.dpt .msel .inp{width:100%;font-weight:700}}
        @media(max-width:820px){.dpt .src{grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) 46px minmax(0,1fr);font-size:13px;gap:4px 8px}.dpt .t.acc td.kw,.dpt .t.acc th.kw{display:none}}
      `}</style>
      {head}
      {multi && (
        <div className="msel">
          <select className="inp" value={cur} onChange={e => { setSel(e.target.value); setOnly(null); }} aria-label="부서 고르기">
            <option value="">전체 부서 비교 ({rows.length}곳)</option>
            {hqList.map(h => <optgroup key={h} label={h}>{list.filter(r => r.hq === h).map(r => <option key={r.d} value={r.d}>{r.d} ({swon(r.net)})</option>)}</optgroup>)}
          </select>
        </div>
      )}
      <div className={'lay' + (multi ? '' : ' single')}>
        {multi && (
          <aside className="card pick" aria-label="부서 목록">
            <div className="srch"><input className="inp" placeholder="부서 찾기" value={q} onChange={e => setQ(e.target.value)} /></div>
            <div className="ls">
              <button className={'it' + (cur === '' ? ' on' : '')} onClick={() => { setSel(''); }}><span>전체 부서 비교</span><b className="mut">{(only ? list : rows).length}곳</b></button>
              {only && <button className="it" onClick={() => setOnly(null)} style={{ color: 'var(--blue)' }}><span>모든 부서 보기</span><b /></button>}
              {hqList.map(h => (
                <div key={h}>
                  <div className="gt">{h}</div>
                  {list.filter(r => r.hq === h).map(r => (
                    <button key={r.d} className={'it' + (cur === r.d ? ' on' : '')} onClick={() => setSel(r.d)} title={`${r.d} · 배분 이익 ${fmt(r.curM)} · 비용 ${fmt(r.curC)}`}>
                      <span>{r.d}</span><b className={r.net >= 0 ? 'pos' : 'neg'}>{swon(r.net)}</b>
                    </button>
                  ))}
                </div>
              ))}
              {!list.length && <div className="help" style={{ padding: 12 }}>찾는 부서가 없습니다.</div>}
            </div>
          </aside>
        )}
        <div className="body">
          {one
            ? <DeptReport key={one.d + model.cur} x={one} model={model} />
            : <Overview rows={only ? rows.filter(r => only.has(r.d)) : rows} model={model} sort={sort} setSort={setSort} onPick={d => setSel(d)} maxNet={maxNet} />}
        </div>
      </div>
    </div>
  );
}

type Row = Dept & { curM: number; curC: number; net: number; r: number | null; tNet: number };

/** 전체 부서 비교 */
function Overview({ rows, model, sort, setSort, onPick, maxNet }: { rows: Row[]; model: Model; sort: SortKey; setSort: (k: SortKey) => void; onPick: (d: string) => void; maxNet: number }) {
  const by: Record<SortKey, (a: Row, b: Row) => number> = {
    net: (a, b) => a.net - b.net, margin: (a, b) => b.curM - a.curM, cost: (a, b) => b.curC - a.curC,
    ratio: (a, b) => (b.r ?? -1) - (a.r ?? -1), name: (a, b) => a.d.localeCompare(b.d, 'ko'),
  };
  const sorted = rows.slice().sort(by[sort]);
  const tM = sum(rows.map(r => r.curM)), tC = sum(rows.map(r => r.curC)), tNet = sum(rows.map(r => r.tNet));
  const over = rows.filter(r => r.net < 0).length, mm = +model.cur.slice(4), nM = model.months.length;
  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => <th onClick={() => setSort(k)} style={{ cursor: 'pointer', color: sort === k ? 'var(--blue-2)' : undefined }} aria-sort={sort === k ? 'descending' : undefined}>{children}{sort === k ? ' ▾' : ''}</th>;
  return (
    <>
      <div className="stats">
        <Stat label={`${mm}월 배분 이익`} value={won(tM)} sub={<span>{rows.length}개 부서 합계</span>} />
        <Stat label={`${mm}월 비용`} value={won(tC)} sub={<span>전표 + 받은 지원</span>} />
        <Stat label={`${mm}월 손익`} help="dept.verdict" keyColor={tM - tC >= 0 ? 'var(--green)' : 'var(--red)'} tone={tM - tC >= 0 ? 'pos' : 'neg'} value={swon(tM - tC)} sub={<span>{nM}개월 누적 <b style={{ color: tNet >= 0 ? 'var(--green-2)' : 'var(--red-2)' }}>{swon(tNet)}</b></span>} />
        <Stat label="비용이 이익보다 많은 부서" value={String(over)} unit={`/ ${rows.length}곳`} tone={over ? 'neg' : undefined} sub={<span>지원 부서는 이익이 작아 적자가 일반적입니다</span>} />
      </div>
      <Card title="부서별 손익" help="dept.table" desc={`${ymText(model.cur)} · 열 이름으로 정렬 · 부서를 누르면 상세 · 이름 옆 숫자 = 평소와 다른 비용 계정 수`} flush>
        <div className="tbl-wrap">
          <table className="t wide">
            <thead><tr><Th k="name">부서</Th><th>인원</th><Th k="margin">배분 이익</Th><Th k="cost">비용</Th><Th k="net">손익</Th><th className="l" style={{ width: 120 }}>적자 ◀ · ▶ 흑자</th><Th k="ratio">이익 대비 비용</Th><th style={{ width: 96 }}>손익 추이</th></tr></thead>
            <tbody>
              {sorted.map(x => (
                <tr key={x.d} className="click" onClick={() => onPick(x.d)}>
                  <td><b>{x.d}</b>{x.alerts.length > 0 && <span className={'tag ' + (x.alerts.some(a => a.up) ? 'o' : 'gr')} style={{ marginLeft: 6 }} title="평소와 다른 비용 계정 수">{x.alerts.length}</span>}<small style={{ display: 'block' }}>{x.hq}</small></td>
                  <td>{x.empNow ? fmt(x.empNow) : '-'}</td><td>{fmt(x.curM)}</td><td>{fmt(x.curC)}</td>
                  <td className={x.net >= 0 ? 'pos' : 'neg'} style={{ fontWeight: 700 }}>{fmt(x.net)}</td>
                  <td className="l"><DivBar v={x.net} max={maxNet} w={110} /></td>
                  <td style={{ color: x.r != null && x.r > 100 ? 'var(--red-2)' : undefined }}>{pctCap(x.r)}</td>
                  <td title={`${nM}개월 누적 손익 ${fmt(x.tNet)}`}><TrendLine series={x.margin.map((v, i) => v - x.cost[i])} w={88} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="이익이 생긴 단계" help="dept.source" desc={`${nM}개월 합계 · 이 금액을 배분 비율로 나눈 것이 부서의 배분 이익입니다`}>
        <div className="row" style={{ gap: 8 }}>{model.groupSummary.filter(g => g.total !== 0).sort((a, b) => b.total - a.total).map(g => <span key={g.key} className="chip" style={{ gap: 8 }}>{g.label}<b className="num">{won(g.total)}</b>{g.manual && <span className="mut">직접 입력</span>}</span>)}</div>
        {model.updatedAt && <p className="help" style={{ marginTop: 10 }}>배분 비율 저장: {new Date(model.updatedAt).toLocaleString('ko-KR')}{model.updatedBy ? ` (${model.updatedBy})` : ''}</p>}
      </Card>
    </>
  );
}

/** 한 부서 보고서 */
function DeptReport({ x, model }: { x: Row; model: Model }) {
  const nav = useNavigate();
  const months = model.months, ci = months.length - 1, mm = +model.cur.slice(4), nM = months.length;
  const [openAcc, setOpenAcc] = useState<string | null>(null);
  const [nAcc, setNAcc] = useState(10);
  const [tick, setTick] = useState(0);
  useEffect(() => { const h = () => setTick(t => t + 1); window.addEventListener('kjhub:data', h); return () => window.removeEventListener('kjhub:data', h); }, []);

  // 계정별: 이번 달 · 전월 · 평소(조회 기간 중 이번 달을 뺀 달들의 평균) — 전표 집계(부서×월×계정)에서
  const acc = useMemo(() => {
    const agg = KJ()?.agg?.voucher; if (!Array.isArray(agg)) return null;
    const key = nrm(x.d), prevMs = months.slice(0, -1), prevM = model.prev;
    const m: Record<string, { cur: number; prev: number; base: number }> = {};
    for (const r of agg) {
      if (nrm(String(r.dept || '')) !== key || isSettle(String(r.acc || ''))) continue;
      const o = m[r.acc] || (m[r.acc] = { cur: 0, prev: 0, base: 0 }); const v = Number(r.amt) || 0;
      if (r.ym === model.cur) o.cur += v;
      if (r.ym === prevM) o.prev += v;
      if (prevMs.indexOf(r.ym) >= 0) o.base += v;
    }
    const n = prevMs.length || 1;
    return Object.entries(m).map(([a, o]) => ({ a, cur: o.cur, prev: o.prev, avg: prevMs.length ? o.base / n : null })).filter(r => r.cur !== 0 || (r.avg != null && Math.abs(r.avg) >= 1)).sort((p, q2) => q2.cur - p.cur);
  }, [x.d, model, tick]); // eslint-disable-line  (model 은 다시 계산될 때마다 새 객체 — 전표 집계가 늦게 와도 반영)
  const kwOf = useMemo(() => { const o: Record<string, string[]> = {}; x.slices.forEach(s => { o[s.a] = s.kws; }); return o; }, [x.slices]);
  const vTotal = x.voucher[ci] || 0, supC = x.supCost[ci] || 0, supA = x.supAlloc[ci] || 0;

  // 배분 이익이 온 곳: 단계별 금액 × 우리 비율 (+ 해 준 지원)
  const src = useMemo(() => {
    const lines = x.groups.map(g => { const gs = model.groupSummary.find(s => s.key === g.key); const base = gs ? gs.series[ci] || 0 : 0; return { label: g.label, base, pct: g.pct, v: base * g.pct / 100 }; }).filter(l => l.pct > 0);
    const rest = x.curM - supA - sum(lines.map(l => l.v));
    return { lines, rest: Math.abs(rest) >= 1 ? rest : 0 };
  }, [x, model.groupSummary, ci, supA]);

  const baseCost = months.length > 1 ? sum(x.cost.slice(0, -1)) / (months.length - 1) : null;
  const perEmp = x.emp[ci] ? x.curC / x.emp[ci] : null;
  const top = x.alerts.slice().sort((a, b) => b.v - a.v)[0];
  const s1 = x.net >= 0 ? `배분 이익 안에서 비용을 썼습니다 (${won(x.net)} 남음).` : `비용이 배분 이익보다 ${won(-x.net)} 많았습니다.`;
  const s2 = baseCost != null ? ` 비용은 평소(직전 ${months.length - 1}개월 평균 ${won(baseCost)})보다 ${Math.abs(x.curC - baseCost) < 1 ? '같습니다' : won(Math.abs(x.curC - baseCost)) + (x.curC > baseCost ? ' 많습니다' : ' 적습니다')}.` : '';
  const s3 = top ? ` 가장 달라진 계정은 ${accL(top.a)}입니다 (${top.up ? '+' : '−'}${won(top.v)}).` : '';
  const toggleAcc = (a: string) => setOpenAcc(o => (o === a ? null : a));
  const jump = (a: string) => { setOpenAcc(a); setNAcc(999); setTimeout(() => document.getElementById('acc-' + a)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60); };
  const allCost = () => { const fn = (window as unknown as { __kjDeptCostDrill?: (o: object) => void }).__kjDeptCostDrill; if (fn) fn({ dept: x.d, baseMonth: model.cur, months }); nav('/dept-cost'); };

  return (
    <>
      <div className="dh">
        <h2>{x.d}</h2>
        <span className="meta">{x.hq}{x.emp[ci] ? ` · ${fmt(x.emp[ci])}명` : x.empNow ? ` · ${fmt(x.empNow)}명` : ''}{perEmp != null ? ` · 1인당 비용 ${won(perEmp)}` : ''}</span>
        <span className="sp" />
        {x.groups.filter(g => g.pct > 0).map(g => <span key={g.key} className="tag b" title="이 단계에서 생긴 이익 중 우리 부서가 받는 비율">{g.label} {g.pct}%</span>)}
      </div>
      <div className="stats">
        <Stat label={`${mm}월 배분 이익`} value={won(x.curM)} sub={<><Delta cur={x.curM} prev={model.prev ? prevOf(x.margin) : null} label="전월" mode="pct" />{supA !== 0 && <span>그중 해 준 지원 {won(supA)}</span>}</>} />
        <Stat label={`${mm}월 비용`} value={won(x.curC)} sub={<><Delta cur={x.curC} prev={model.prev ? prevOf(x.cost) : null} label="전월" mode="pct" invert />{supC !== 0 && <span>그중 받은 지원 {won(supC)}</span>}</>} />
        <Stat label={`${mm}월 손익`} help="dept.detail" keyColor={x.net >= 0 ? 'var(--green)' : 'var(--red)'} tone={x.net >= 0 ? 'pos' : 'neg'} value={swon(x.net)} sub={<span>{nM}개월 누적 <b style={{ color: x.tNet >= 0 ? 'var(--green-2)' : 'var(--red-2)' }}>{swon(x.tNet)}</b></span>} />
        <Stat label="이익 대비 비용" value={pctCap(x.r)} sub={<span style={{ flex: 1 }}>{x.r == null ? '배분 이익이 없어 비율을 계산하지 않습니다' : <RatioBar ratio={x.r} />}</span>} title="비용 ÷ 배분 이익 × 100. 100%를 넘으면 받은 이익보다 많이 쓴 것입니다." />
      </div>
      <div className={'note' + (x.net < 0 ? ' warn' : '')}><div><b>{ymText(model.cur)} — {s1}</b>{s2}{s3}</div></div>

      <div className="g21">
        <Card title="월별 추이" right={<Legend items={[{ c: C.pos, t: '손익' }, { c: C.margin, t: '배분 이익', kind: 'line' }, { c: C.cost, t: '비용', kind: 'dash' }]} />}>
          <NetTrend months={months} margin={x.margin} cost={x.cost} height={250} />
        </Card>
        <Card title="확인할 것" desc="평소와 다른 계정 · 누르면 전표">
          {x.alerts.length ? x.alerts.slice().sort((a, b) => b.v - a.v).map((a, i) => (
            <div key={i} className="al" onClick={() => jump(a.a)}>
              <span className={'tag ' + (a.up ? 'n' : 'g')} style={{ padding: '2px 0', textAlign: 'center' }}>{a.up ? '▲' : '▼'}</span>
              <span>{accL(a.a)}</span>
              <b style={{ color: a.up ? 'var(--red-2)' : 'var(--green-2)' }}>{(a.up ? '+' : '−') + won(a.v)}</b>
            </div>
          )) : <div className="empty" style={{ padding: 24 }}>평소와 크게 다른 계정이 없습니다.</div>}
        </Card>
      </div>

      <Card title={`${mm}월 비용 내역`} help="dept.detail" desc="계정을 누르면 전표가 펼쳐집니다" flush right={<button className="btn sm ghost" onClick={allCost}>비용 내역 화면에서 보기 →</button>}>
        {acc ? (
          <div className="tbl-wrap">
            <table className="t wide acc">
              <thead><tr><th>계정</th><th>{mm}월</th><th>전월</th><th>평소 ({Math.max(1, nM - 1)}개월 평균)</th><th>평소 대비</th><th style={{ width: 130 }} className="l">비중</th><th className="l kw">주요 적요</th></tr></thead>
              <tbody>
                {acc.slice(0, nAcc).map(r => [
                  <tr key={r.a} id={'acc-' + r.a} className={'click' + (openAcc === r.a ? ' open' : '')} onClick={() => toggleAcc(r.a)}>
                    <td><span className="caret">{openAcc === r.a ? '▾' : '▸'}</span>{accL(r.a)}</td>
                    <td style={{ fontWeight: 600 }}>{fmt(r.cur)}</td><td className="mut">{fmt(r.prev)}</td><td className="mut">{r.avg == null ? '-' : fmt(r.avg)}</td>
                    <td>{r.avg == null ? '-' : <Delta cur={r.cur} prev={r.avg} invert />}</td>
                    <td className="l"><div className="bar" style={{ width: 110 }}><i style={{ width: Math.max(2, Math.min(100, Math.round(Math.abs(r.cur) / Math.max(1, Math.abs(acc[0].cur)) * 100))) + '%', background: C.cost }} /></div></td>
                    <td className="l kw">{(kwOf[r.a] || []).map(k => <span key={k} className="tag gr" style={{ marginRight: 4 }}>{k}</span>)}</td>
                  </tr>,
                  openAcc === r.a && <tr key={r.a + '-v'}><td className="vch" colSpan={7}><div className="vin"><VoucherTable compact filter={{ depts: [x.d], months: [model.cur], acc: r.a }} /></div></td></tr>,
                ])}
                {supC !== 0 && <tr className="adj" title="다른 부서의 지원을 받고 부담하는 금액. 전표에는 없고 [지원 내역 설정]으로 계산합니다."><td>받은 지원 (전표 아님)</td><td>{fmt(supC)}</td><td /><td /><td /><td /><td className="kw" /></tr>}
                <tr className="total"><td>합계</td><td>{fmt(vTotal + supC)}</td><td>{model.prev ? fmt(prevOf(x.cost)) : '-'}</td><td>{baseCost == null ? '-' : fmt(baseCost)}</td><td>{baseCost == null ? '-' : <Delta cur={x.curC} prev={baseCost} invert />}</td><td /><td className="kw" /></tr>
              </tbody>
            </table>
            {acc.length > nAcc && <div style={{ padding: '10px 16px' }}><button className="btn sm" onClick={() => setNAcc(999)}>나머지 {acc.length - nAcc}개 계정 더 보기</button></div>}
          </div>
        ) : <div className="empty" style={{ padding: 24 }}>전표 집계를 불러오는 중입니다.</div>}
      </Card>

      <div className="g2">
        <Card title={`${mm}월 배분 이익이 온 곳`} help="dept.source" desc="단계별 이익 × 우리 부서 비율">
          {src.lines.length || supA !== 0 ? (
            <div className="src">
              <span className="h">이익이 생긴 단계</span><span className="h r">단계 전체</span><span className="h r">비율</span><span className="h r">우리 부서 몫</span>
              {src.lines.map(l => [<span key={l.label}>{l.label}</span>, <span key={l.label + 'b'} className="r mut">{fmt(l.base)}</span>, <span key={l.label + 'p'} className="r">{l.pct}%</span>, <span key={l.label + 'v'} className="r" style={{ fontWeight: 600 }}>{fmt(l.v)}</span>])}
              {supA !== 0 && [<span key="s">해 준 지원</span>, <span key="sb" className="r mut">-</span>, <span key="sp" className="r mut">-</span>, <span key="sv" className="r" style={{ fontWeight: 600 }}>{fmt(supA)}</span>]}
              {src.rest !== 0 && [<span key="r" className="mut" title="직접 입력한 이익이나 월별 비율 차이로 생기는 금액">그 밖</span>, <span key="rb" className="r mut">-</span>, <span key="rp" className="r mut">-</span>, <span key="rv" className="r">{fmt(src.rest)}</span>]}
              <span className="tot">배분 이익</span><span className="tot" /><span className="tot" /><span className="tot r">{fmt(x.curM)}</span>
            </div>
          ) : <div className="empty" style={{ padding: 24 }}>이 부서는 배분받는 단계가 없습니다. 이익은 다른 부서에 해 준 지원으로만 생깁니다.</div>}
          {(supA !== 0 || supC !== 0) && <p className="help" style={{ marginTop: 10 }}>해 준 지원 {fmt(supA)} · 받은 지원 {fmt(supC)} <button className="btn link" style={{ fontSize: 12.5 }} onClick={() => nav('/dept-support')}>지원 내역 보기 →</button></p>}
        </Card>
        <Card title="월별 표" flush>
          <div className="tbl-wrap">
            <table className="t">
              <thead><tr><th>월</th><th>배분 이익</th><th>비용</th><th>손익</th><th>이익 대비 비용</th><th>인원</th></tr></thead>
              <tbody>
                {months.map((m, i) => { const n = x.margin[i] - x.cost[i]; const r = ratio(x.cost[i], x.margin[i]); return (
                  <tr key={m} title={`그중 해 준 지원 ${fmt(x.supAlloc[i] || 0)} · 받은 지원 ${fmt(x.supCost[i] || 0)}`}><td>{ymShort(m)}</td><td>{fmt(x.margin[i])}</td><td>{fmt(x.cost[i])}</td><td className={n >= 0 ? 'pos' : 'neg'}>{fmt(n)}</td><td style={{ color: r != null && r > 100 ? 'var(--red-2)' : undefined }}>{pctCap(r)}</td><td>{x.emp[i] || '-'}</td></tr>
                ); })}
                <tr className="total"><td>합계</td><td>{fmt(sum(x.margin))}</td><td>{fmt(sum(x.cost))}</td><td className={x.tNet >= 0 ? 'pos' : 'neg'}>{fmt(x.tNet)}</td><td>{pctCap(ratio(sum(x.cost), sum(x.margin)))}</td><td /></tr>
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
