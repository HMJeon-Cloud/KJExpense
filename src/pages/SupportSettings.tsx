// 지원 내역 설정 — 지원 부서가 어떤 업무를 어느 부서에 지원하고, 그 비용을 어떻게 나눌지
//   위: 이 달 합계·받는 부서별 부담(미리보기)  아래: 지원 부서 카드 × 업무 행(기본 펼침). 저장은 기존 지원 모듈이 수행.
import { useMemo, useState } from 'react';
import { fmt, useUI } from '../components/ui';
import { HelpDot } from '../components/Help';
import { kor } from '../components/charts';
import { ymLabel } from '../lib/legacyData';
import { MonthPick, SaveBar, NumCell, useCfgTick } from '../components/settingsUi';

type Task = { task: string; desc: string; scope: 'all' | 'bu' | 'dept'; buNames: string[]; deptNames: string[]; excludes: string[]; split: 'unit' | 'head' | 'dept' | 'direct'; amount: number; detail: Record<string, number> };
type Grp = { dept: string; tasks: Task[] };
type Bridge = {
  month: () => string; setMonth: (m: string) => void; monthOptions: () => string[]; draft: () => Grp[]; dirty: () => boolean; touch: () => void;
  sourceMonth: (ym?: string) => string | null; savedMonths: () => string[]; deptList: () => string[]; buList: () => string[]; deptsOfBU: (b: string) => string[]; headcountOf: (d: string) => number;
  taskDepts: (t: Task) => string[]; taskShares: (t: Task) => { dept: string; amount: number }[]; canEditDept: (d: string) => boolean; isAdmin: () => boolean;
  save: () => void; applyEvery: () => void; revert: () => void; msg: () => { text: string; cls: string }; saving: () => boolean;
};
const B = () => (window as unknown as { KJHub?: { cfg?: { support?: Bridge } } }).KJHub?.cfg?.support;
const SPLIT: Record<string, string> = { unit: '인원별 단가', head: '인원수 비례', dept: '부서별 균등', direct: '직접 입력' };
const SPLIT_HELP: Record<string, string> = { unit: '금액 × 대상 부서 인원수', head: '금액을 인원수 비율로 나눔', dept: '금액을 부서 수로 균등 분할', direct: '부서마다 금액을 직접 입력' };
const SCOPE: Record<string, string> = { all: '전체 부서', bu: '사업단위', dept: '부서 지정' };
const totalOf = (b: Bridge, t: Task) => b.taskShares(t).reduce((s, x) => s + x.amount, 0);

export default function SupportSettings() {
  const tick = useCfgTick('support');
  const b = B();
  const { confirm } = useUI();
  const [q, setQ] = useState('');
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [focus, setFocus] = useState('');
  const month = b?.month() || '';
  const opts = useMemo(() => b?.monthOptions() || [], [tick, month]); // eslint-disable-line
  const draft = b ? b.draft() : [];
  const view = useMemo(() => {
    if (!b) return { byRecv: [] as [string, number, number][], total: 0, tasks: 0 };
    const m: Record<string, { amt: number; n: number }> = {}; let total = 0, tasks = 0;
    draft.forEach(g => g.tasks.forEach(t => { tasks++; b.taskShares(t).forEach(s => { const o = m[s.dept] || (m[s.dept] = { amt: 0, n: 0 }); o.amt += s.amount; o.n++; total += s.amount; }); }));
    return { byRecv: Object.entries(m).map(([d, v]) => [d, v.amt, v.n] as [string, number, number]).sort((x, y) => y[1] - x[1]), total, tasks };
  }, [b, draft, tick]); // eslint-disable-line
  const maxR = Math.max(1, ...view.byRecv.map(x => x[1]));
  const src = b?.sourceMonth(month);
  const own = src === month;
  const mut = (fn: () => void) => { fn(); b!.touch(); };
  const qq = q.trim().toLowerCase();

  if (!b) return <div className="page"><div className="card"><div className="empty"><span className="spinner" /> 지원 설정 모듈을 준비하는 중입니다.</div></div></div>;
  const deptAll = b.deptList(), buAll = b.buList();
  return (
    <div className="page brief" style={{ gap: 16, maxWidth: 1500 }}>
      <style>{`
        .brief>*{min-width:0}
        .ss .verdict{display:grid;grid-template-columns:1fr 1.5fr;background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
        .ss .verdict>div{padding:16px 20px;min-width:0}.ss .verdict>div+div{border-left:1px solid var(--line)}
        .ss .l{font-size:12px;color:var(--fg-3)}
        .ss .big{font:800 30px/1.1 var(--font-num);letter-spacing:-.02em;margin-top:4px;font-variant-numeric:tabular-nums;color:#b0760a}
        .ss .rk{display:grid;gap:2px;margin-top:6px;grid-template-columns:1fr 1fr;column-gap:18px}
        .ss .r{display:grid;grid-template-columns:minmax(0,1fr) 100px;gap:8px;align-items:center;padding:3px 6px;border-radius:6px;font-size:12.5px;cursor:pointer}
        .ss .r:hover,.ss .r.on{background:var(--brand-soft)}
        .ss .r .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.ss .r .nm small{font-weight:400;color:var(--fg-3);margin-left:5px}
        .ss .hb{height:6px;border-radius:999px;background:var(--surface-2);overflow:hidden;margin-top:3px}.ss .hb i{display:block;height:100%;border-radius:999px;background:#f5b400}
        .ss .n{text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums;font-weight:700}
        .ss .gc{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
        .ss .gh{display:flex;gap:10px;align-items:center;padding:9px 12px;background:var(--surface-2);border-bottom:1px solid var(--line);flex-wrap:wrap}
        .ss table{width:100%;border-collapse:collapse;font-size:12.5px}
        .ss th{text-align:left;color:var(--fg-3);font-weight:500;font-size:11.5px;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
        .ss td{padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:middle}
        .ss td.n,.ss th.n{text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums}
        .ss tr.t:hover td{background:color-mix(in srgb,var(--surface-2) 50%,transparent)}
        .ss .chip{font-size:11px;padding:2px 7px;border-radius:999px;background:var(--surface-2);margin:1px 2px 1px 0;display:inline-block;white-space:nowrap}
        .ss .chip.ex{text-decoration:line-through;color:var(--fg-3)}
        .ss .chip .x{margin-left:4px;cursor:pointer;color:var(--fg-3)}.ss .chip .x:hover{color:var(--neg)}
        .ss .dt{background:var(--surface-2);padding:10px 14px}
        .ss .dgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:6px;margin-top:8px}
        .ss .dd{display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:12px;padding:4px 8px;border-radius:6px;background:var(--surface);border:1px solid var(--line)}
        .ss .dd.ex{opacity:.5;text-decoration:line-through}
        .ss .dd b{font-family:var(--font-num);font-weight:600}
        .ss .inp.sm{padding:3px 6px;font-size:12.5px}
        .ss .x{cursor:pointer;color:var(--fg-3);padding:0 4px}.ss .x:hover{color:var(--neg)}
        @media(max-width:820px){.ss table.sst{min-width:760px}.ss .gh .inp{flex:1 1 160px}}
        @media(max-width:1000px){.ss .verdict{grid-template-columns:1fr}.ss .verdict>div+div{border-left:0;border-top:1px solid var(--line)}.ss .rk{grid-template-columns:1fr}}
      `}</style>
      <div className="ss" style={{ display: 'grid', gap: 16 }}>
        <div className="page-head" style={{ alignItems: 'flex-end' }}>
          <div><h1>지원 내역 설정</h1><div className="help">지원 부서가 어느 부서의 어떤 업무를 지원하는지 등록하고 비용을 정합니다. 지원 부서는 그 금액만큼 수익이, 받는 부서는 비용이 늘어납니다. 설정은 기준월별로 저장되고 없는 달은 이전 달을 승계합니다.</div></div>
          <span className="sp" />
          <MonthPick value={month} options={opts} onChange={m => b.setMonth(m)} />
        </div>

        <div className="verdict">
          <div>
            <div className="l">{ymLabel(month)} 지원 금액 합계<HelpDot id="set.support" /> <span className={own ? '' : ''} style={{ color: own ? '#2c7f2c' : '#9a6f00' }}>{own ? '· 이 달 설정' : src ? `· ${ymLabel(src)} 설정 승계 중` : '· 설정 없음'}</span></div>
            <div className="big">{kor(view.total)}</div>
            <div className="help" style={{ marginTop: 4 }}>{fmt(view.total)}원 · 지원 부서 {draft.filter(g => g.dept).length}곳 · 업무 {view.tasks}건 · 받는 부서 {view.byRecv.length}곳</div>
            <div className="help" style={{ marginTop: 8 }}>인원수는 월/부서별 인원 데이터의 {ymLabel(month)} 이하 가장 최근 월 값을 씁니다.</div>
            <div className="help" style={{ marginTop: 4 }}>저장된 달: {b.savedMonths().map(ymLabel).join(', ') || '없음'}</div>
          </div>
          <div>
            <div className="l">받는 부서별 부담액<HelpDot id="set.support" /> <span>지금 입력값 기준 미리보기 · 누르면 그 부서가 포함된 업무만 강조</span></div>
            <div className="rk">{view.byRecv.map(([d, v, n]) => <div key={d} className={'r' + (focus === d ? ' on' : '')} onClick={() => setFocus(focus === d ? '' : d)}><div><div className="nm">{d}<small>{n}건 · {view.total ? Math.round(v / view.total * 100) : 0}% · 인원 {b.headcountOf(d)}</small></div><div className="hb"><i style={{ width: Math.max(2, Math.round(v / maxR * 100)) + '%' }} /></div></div><span className="n">{fmt(v)}</span></div>)}
              {!view.byRecv.length && <div className="empty">아직 지원 내역이 없습니다.</div>}</div>
          </div>
        </div>

        <div className="filters">
          <input className="inp" style={{ width: 220 }} placeholder="업무명·부서명 검색" value={q} onChange={e => setQ(e.target.value)} />
          <span className="sp" />
          <button className="btn sm" onClick={() => mut(() => { draft.push({ dept: '', tasks: [] }); })}>+ 지원 부서 추가</button>
        </div>

        {draft.map((g, gi) => {
          const editable = !g.dept || b.canEditDept(g.dept);
          const tasks = g.tasks.filter(t => !qq || t.task.toLowerCase().includes(qq) || (t.desc || '').toLowerCase().includes(qq) || g.dept.toLowerCase().includes(qq));
          if (qq && !tasks.length) return null;
          const gsum = g.tasks.reduce((s, t) => s + totalOf(b, t), 0);
          return (
            <div className="gc" key={gi}>
              <div className="gh">
                <span className="help">지원 부서</span>
                <select className="inp" value={g.dept} disabled={!editable} onChange={e => mut(() => { g.dept = e.target.value; })} style={{ fontWeight: 700 }}><option value="">부서 선택…</option>{deptAll.map(d => <option key={d} value={d}>{d}</option>)}</select>
                <span className="help">업무 {g.tasks.length}건 · 합계 <b className="num" style={{ color: 'var(--fg)' }}>{fmt(gsum)}</b>원</span>
                <span className="sp" />
                {editable && <button className="btn sm" onClick={() => mut(() => { g.tasks.push({ task: '', desc: '', scope: 'all', buNames: [], deptNames: [], excludes: [], split: 'unit', amount: 0, detail: {} }); setOpenTask(gi + ':' + (g.tasks.length - 1)); })}>+ 업무 추가</button>}
                {editable && <button className="btn sm ghost" onClick={async () => { if (await confirm('지원 부서 삭제', `[${g.dept || '미지정'}]의 지원 내역 ${g.tasks.length}건을 모두 삭제합니다. 저장하기 전까지는 되돌리기로 취소할 수 있습니다.`, { danger: true, okText: '삭제' })) mut(() => { draft.splice(gi, 1); }); }}>부서 삭제</button>}
              </div>
              <div className="tbl-wrap"><table className="sst">
                <thead><tr><th style={{ width: 200 }}>업무</th><th>설명</th><th style={{ width: 130 }}>대상</th><th style={{ width: 130 }}>나누는 방식</th><th className="n" style={{ width: 130 }}>금액</th><th className="n" style={{ width: 120 }}>총액</th><th style={{ width: 70 }}></th></tr></thead>
                <tbody>
                  {tasks.map(t => { const ti = g.tasks.indexOf(t); const key = gi + ':' + ti; const isOpen = openTask === key; const depts = b.taskDepts(t); const shares = b.taskShares(t); const tot = shares.reduce((s, x) => s + x.amount, 0); const dim = focus && !depts.includes(focus);
                    return [
                      <tr key={key} className="t" style={{ opacity: dim ? 0.4 : 1 }}>
                        <td><input className="inp sm" style={{ width: '100%' }} value={t.task} disabled={!editable} placeholder="업무명" onChange={e => mut(() => { t.task = e.target.value; })} /></td>
                        <td><input className="inp sm" style={{ width: '100%' }} value={t.desc} disabled={!editable} placeholder="설명(선택)" onChange={e => mut(() => { t.desc = e.target.value; })} /></td>
                        <td><button className="btn sm" style={{ width: '100%' }} onClick={() => setOpenTask(isOpen ? null : key)}>{SCOPE[t.scope]} {depts.length}곳 {isOpen ? '▴' : '▾'}</button></td>
                        <td><select className="inp sm" style={{ width: '100%' }} value={t.split} disabled={!editable} title={SPLIT_HELP[t.split]} onChange={e => mut(() => { t.split = e.target.value as Task['split']; })}>{Object.entries(SPLIT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                        <td className="n">{t.split === 'direct' ? <span className="help">부서별 입력</span> : <NumCell value={t.amount || null} onCommit={v => mut(() => { t.amount = v ?? 0; })} disabled={!editable} placeholder="0" width={110} />}</td>
                        <td className="n" style={{ fontWeight: 700 }}>{fmt(tot)}</td>
                        <td style={{ textAlign: 'right' }}>{editable && <span className="x" title="업무 삭제" onClick={async () => { if (await confirm('업무 삭제', `[${t.task || '미지정'}] 업무를 삭제합니다.`, { danger: true, okText: '삭제' })) mut(() => { g.tasks.splice(ti, 1); }); }}>×</span>}</td>
                      </tr>,
                      isOpen && <tr key={key + 'd'}><td colSpan={7} className="dt">
                        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                          <span className="help">대상</span>
                          <span className="seg">{Object.entries(SCOPE).map(([k, v]) => <button key={k} className={t.scope === k ? 'on' : ''} disabled={!editable} onClick={() => mut(() => { t.scope = k as Task['scope']; t.buNames = []; t.deptNames = []; })}>{v}</button>)}</span>
                          {t.scope === 'bu' && <select className="inp sm" value="" disabled={!editable} onChange={e => { const v = e.target.value; if (v) mut(() => { if (!t.buNames.includes(v)) t.buNames.push(v); }); }}><option value="">+ 사업단위 추가…</option>{buAll.filter(x => !t.buNames.includes(x)).map(x => <option key={x} value={x}>{x}</option>)}</select>}
                          {t.scope === 'dept' && <select className="inp sm" value="" disabled={!editable} onChange={e => { const v = e.target.value; if (v) mut(() => { if (!t.deptNames.includes(v)) t.deptNames.push(v); }); }}><option value="">+ 부서 추가…</option>{deptAll.filter(x => !t.deptNames.includes(x)).map(x => <option key={x} value={x}>{x}</option>)}</select>}
                          {t.scope === 'bu' && t.buNames.map(x => <span key={x} className="chip">{x}{editable && <span className="x" onClick={() => mut(() => { t.buNames = t.buNames.filter(y => y !== x); })}>×</span>}</span>)}
                          {t.excludes.length > 0 && <span className="help">제외 {t.excludes.length}곳 <span className="x" style={{ textDecoration: 'underline' }} onClick={() => mut(() => { t.excludes = []; })}>모두 해제</span></span>}
                          <span className="sp" />
                          <span className="help">{SPLIT_HELP[t.split]} · 대상 {depts.length}곳 · 인원 {depts.reduce((s, d) => s + b.headcountOf(d), 0)}명 · 총액 <b style={{ color: 'var(--fg)' }}>{fmt(tot)}</b>원</span>
                        </div>
                        <div className="dgrid">
                          {shares.map(s => <div key={s.dept} className="dd" style={{ outline: focus === s.dept ? '2px solid var(--brand)' : undefined }}><span>{s.dept} <span className="help">({b.headcountOf(s.dept)})</span></span>
                            {t.split === 'direct' ? <NumCell value={t.detail[s.dept] ?? null} onCommit={v => mut(() => { if (v == null) delete t.detail[s.dept]; else t.detail[s.dept] = v; })} disabled={!editable} width={90} placeholder="0" /> : <b>{fmt(s.amount)}</b>}
                            {editable && <span className="x" title="이 부서 제외" onClick={() => mut(() => { if (t.scope === 'dept') t.deptNames = t.deptNames.filter(y => y !== s.dept); else if (!t.excludes.includes(s.dept)) t.excludes.push(s.dept); })}>×</span>}</div>)}
                          {t.excludes.map(d => <div key={'ex' + d} className="dd ex"><span>{d}</span><span className="help">제외</span>{editable && <span className="x" title="제외 해제" onClick={() => mut(() => { t.excludes = t.excludes.filter(y => y !== d); })}>↺</span>}</div>)}
                        </div>
                      </td></tr>,
                    ]; })}
                  {!g.tasks.length && <tr><td colSpan={7} className="help" style={{ padding: 10 }}>업무가 없습니다. "+ 업무 추가"를 누르세요.</td></tr>}
                </tbody>
              </table></div>
            </div>
          );
        })}
        {!draft.length && <div className="card"><div className="empty">{ymLabel(month)}에 등록된 지원 내역이 없습니다. "+ 지원 부서 추가"로 시작하세요.</div></div>}

        <SaveBar dirty={b.dirty()} saving={b.saving()} msg={b.msg()} onSave={() => b.save()} onRevert={() => b.revert()} saveLabel={`${ymLabel(month)} 저장`} note="저장은 선택한 기준월에만 적용됩니다.">
          <button className="btn" onClick={async () => { if (await confirm('전체 일괄 적용', '현재 지원 내역을 최근 24개월 전체에 적용하고 저장합니다. 각 월에 이미 저장된 내역도 모두 덮어씁니다.', { okText: '적용하고 저장' })) b.applyEvery(); }}>전체 월 일괄 적용</button>
        </SaveBar>
      </div>
    </div>
  );
}
