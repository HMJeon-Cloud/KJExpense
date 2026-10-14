// 설정 › 비용 배분 설정(본부) — 수익이 없는 지원 조직·연구소의 비용과 인원을 수익 본부로 나누는 비율
//   쓰는 곳: 국전 수익/비용(실현 수익) 화면의 본부별 현황, 운영 지표 ① 인당 지표
//   저장: config.key = 'costAlloc' { byMonth: { YYYYMM: { 'hq:본부' | 'dept:부서': { 받는본부: % } } } } — 기준월별, 없는 달은 이전 달 승계
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { fmt } from '../components/ui';
import { HelpDot } from '../components/Help';
import { MonthPick, NumCell, SaveBar, type Msg } from '../components/settingsUi';
import { kor, ymL } from '../components/charts';
import { useLegacyModel } from '../lib/useLegacyModel';
import { applyHqAlloc, loadCostAlloc, rulesAt, DEFAULT_RULES, type CostAllocCfg, type Rules } from '../lib/hqAlloc';
import type { OpsModel } from '../components/OpsMetrics';

const shiftYm = (ym: string, d: number) => { const y = +ym.slice(0, 4), m = +ym.slice(4, 6) - 1 + d; return (y + Math.floor(m / 12)) + String((((m % 12) + 12) % 12) + 1).padStart(2, '0'); };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const clean = (r: Rules): Rules => Object.fromEntries(Object.entries(r).map(([k, t]) => [k, Object.fromEntries(Object.entries(t).filter(([, p]) => p && p > 0))]).filter(([, t]) => Object.keys(t).length)) as Rules;
const same = (a: Rules, b: Rules) => JSON.stringify(sortR(clean(a))) === JSON.stringify(sortR(clean(b)));
const sortR = (r: Rules) => Object.fromEntries(Object.keys(r).sort().map(k => [k, Object.fromEntries(Object.keys(r[k]).sort().map(t => [t, r[k][t]]))]));

export default function CostAllocSettings() {
  const { model } = useLegacyModel<OpsModel & { empty?: boolean }>('bu-margin-real');
  const { closeMonth } = useAuth();
  const [cfg, setCfg] = useState<CostAllocCfg | null>(null);
  const [loaded, setLoaded] = useState(false);
  const endM = closeMonth || (model && !model.empty ? model.cur : '') || '';
  const options = useMemo(() => (endM ? Array.from({ length: 24 }, (_, i) => shiftYm(endM, -i)) : []), [endM]);
  const [month, setMonth] = useState('');
  useEffect(() => { if (!month && endM) setMonth(endM); }, [endM, month]);
  const [draft, setDraft] = useState<Rules>({});
  const [base, setBase] = useState<Rules>({});
  const [split, setSplit] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>({ text: '', cls: '' });

  useEffect(() => { loadCostAlloc(true).then(v => { setCfg(v); setLoaded(true); }); }, []);
  useEffect(() => { setMsg({ text: '', cls: '' }); }, [month]);
  const at = useMemo(() => (month ? rulesAt(cfg, month) : { rules: DEFAULT_RULES, src: null }), [cfg, month]);
  useEffect(() => { if (!loaded || !month) return; setDraft(clone(at.rules)); setBase(clone(at.rules));
    setSplit(Object.fromEntries(Object.keys(at.rules).filter(k => k.startsWith('dept:')).map(k => [hqOfDept(k.slice(5)), true])));
  }, [loaded, month, at]); // eslint-disable-line react-hooks/exhaustive-deps

  // 본부·부서 정보 (실현 수익 화면 계산 결과에서)
  const ready = !!(model && !model.empty && Array.isArray(model.months));
  const rows = ready ? model!.deptRows || [] : [];
  const mi = ready ? model!.months.indexOf(month) : -1;
  const ci = mi >= 0 ? mi : (ready ? model!.months.length - 1 : 0);
  const hqOfDept = (d: string) => rows.find(r => r.d === d)?.hq || '기타';
  const hqs = useMemo(() => {
    const m: Record<string, { hq: string; rev: number; cost: number; emp: number; depts: typeof rows }> = {};
    rows.forEach(r => { const o = m[r.hq] || (m[r.hq] = { hq: r.hq, rev: 0, cost: 0, emp: 0, depts: [] }); o.rev += r.margin.reduce((a, b) => a + b, 0); o.cost += r.cost[ci] || 0; o.emp += (r.empSer || [])[ci] || 0; o.depts.push(r); });
    return Object.values(m);
  }, [rows, ci]);
  // 받는 본부 = 실현 수익이 있는 본부 + 규칙에 이미 들어 있는 받는 본부
  const ruleTargets = [...Object.values(draft), ...Object.values(DEFAULT_RULES)].flatMap(t => Object.keys(t));
  const targets = Array.from(new Set([...hqs.filter(h => Math.abs(h.rev) > 0.5 && h.hq !== '기타').map(h => h.hq), ...ruleTargets])).sort();
  const sources = hqs.filter(h => !targets.includes(h.hq) && (h.cost || h.emp || draft['hq:' + h.hq])).sort((a, b) => b.cost - a.cost);
  Object.keys(draft).filter(k => k.startsWith('hq:')).forEach(k => { const h = k.slice(3); if (!sources.some(s => s.hq === h) && !targets.includes(h)) sources.push({ hq: h, rev: 0, cost: 0, emp: 0, depts: [] }); });

  const setPct = (key: string, t: string, v: number | null) => setDraft(d => { const n = clone(d); const r = n[key] || {}; if (v && v > 0) r[t] = v; else delete r[t]; n[key] = r; return n; });
  const fillBy = (key: string, mode: 'emp' | 'even' | 'clear') => setDraft(d => {
    const n = clone(d);
    if (mode === 'clear') { delete n[key]; return n; }
    const w = targets.map(t => (mode === 'even' ? 1 : hqs.find(h => h.hq === t)?.emp || 0));
    const tot = w.reduce((a, b) => a + b, 0) || 1;
    let acc = 0; const r: Record<string, number> = {};
    targets.forEach((t, i) => { const p = i === targets.length - 1 ? Math.round((100 - acc) * 10) / 10 : Math.round(w[i] / tot * 1000) / 10; acc += p; if (p > 0) r[t] = p; });
    n[key] = r; return n;
  });
  const sumOf = (key: string) => Object.values(draft[key] || {}).reduce((a, b) => a + (b || 0), 0);

  const preview = useMemo(() => {
    if (!ready || !model) return null;
    const cfgD: CostAllocCfg = { byMonth: { [month || model.cur]: draft } };
    const one = [month || model.cur];
    const rws = rows.map(r => ({ ...r, margin: [r.margin[ci] || 0], cost: [r.cost[ci] || 0], empSer: [(r.empSer || [])[ci] || 0] }));
    return applyHqAlloc(rws, one, cfgD);
  }, [draft, rows, ci, month, model, ready]);

  const save = async () => {
    setSaving(true); setMsg({ text: '', cls: '' });
    const bad = Object.keys(clean(draft)).filter(k => sumOf(k) > 100.0001);
    if (bad.length) { setSaving(false); return setMsg({ text: '비율 합이 100%를 넘는 줄이 있습니다: ' + bad.map(k => k.replace(/^(hq|dept):/, '')).join(', '), cls: 'neg' }); }
    const next: CostAllocCfg = { byMonth: { ...(cfg?.byMonth || {}), [month]: sortR(clean(draft)) } };
    const { error } = await supabase.rpc('save_config', { p_key: 'costAlloc', p_value: next, p_summary: `비용 배분 설정 ${ymL(month)}` });
    setSaving(false);
    if (error) return setMsg({ text: error.message, cls: 'neg' });
    setCfg(next); setMsg({ text: `${ymL(month)} 비율을 저장했습니다. 이후 달은 새로 저장하기 전까지 이 비율을 이어서 씁니다.`, cls: 'pos' });
    await loadCostAlloc(true); window.dispatchEvent(new CustomEvent('kjhub:costallocsaved'));
  };

  const status = at.src === month ? '이 달 설정' : at.src ? (at.src > month ? `${ymL(at.src)} 설정 사용 중 (이 달 이전 설정 없음)` : `${ymL(at.src)} 설정 승계 중`) : '기본 규칙 (아직 저장한 적 없음)';
  const pctRow = ({ k, name, sub, cost, emp, indent }: { k: string; name: string; sub?: string; cost: number; emp: number; indent?: boolean }) => {
    const s = sumOf(k);
    return (
      <tr key={k} className={indent ? 'sub' : ''}>
        <td>{name}{sub && <small className="help" style={{ marginLeft: 6 }}>{sub}</small>}</td>
        <td>{fmt(cost)}</td><td>{emp ? (Math.round(emp * 10) / 10).toLocaleString('ko-KR') : '-'}</td>
        {targets.map(t => <td key={t}><NumCell value={draft[k]?.[t] ?? null} onCommit={v => setPct(k, t, v)} width={72} placeholder="0" /></td>)}
        <td className={s > 100.0001 ? 'neg' : s === 0 ? 'mut' : s < 99.9999 ? 'warn' : 'ok'}>{s ? (Math.round(s * 10) / 10) + '%' : '-'}</td>
        <td style={{ whiteSpace: 'nowrap' }}>
          <button className="btn sm ghost" title="받는 본부의 기준월 인원 비율로 채움" onClick={() => fillBy(k, 'emp')}>인원 비율</button>
          <button className="btn sm ghost" onClick={() => fillBy(k, 'even')}>균등</button>
          <button className="btn sm ghost" onClick={() => fillBy(k, 'clear')}>비움</button>
        </td>
      </tr>
    );
  };

  return (
    <div className="page ca" style={{ gap: 16, maxWidth: 1400 }}>
      <style>{`
        .ca>*{min-width:0}
        .ca table{width:100%;border-collapse:collapse;font-size:13px}
        .ca th{font-weight:500;color:var(--fg-3);font-size:11.5px;text-align:right;padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap;background:var(--surface-2)}
        .ca th:first-child,.ca td:first-child{text-align:left}
        .ca td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums;white-space:nowrap}
        .ca td:first-child{font-family:var(--font-body);font-weight:700}
        .ca tr.sub td{background:#fafbfd}.ca tr.sub td:first-child{padding-left:26px;font-weight:500}
        .ca .ok{color:#2c7f2c;font-weight:700}.ca .warn{color:#9a6f00;font-weight:700}.ca .neg{color:var(--neg);font-weight:700}.ca .mut{color:var(--fg-3)}
        .ca .note{font-size:12.5px;color:var(--fg-2);line-height:1.6}
      `}</style>
      <div className="page-head">
        <div><h1>비용 배분 설정(본부)<HelpDot id="set.costalloc" /></h1><div className="help">수익이 없는 지원 조직·연구소의 비용과 인원을 수익이 있는 본부로 나눕니다. 실현 수익 화면의 본부별 현황과 운영 지표 ① 에 쓰입니다. 비율은 기준월별로 저장되고, 없는 달은 이전 달 비율을 이어서 씁니다.</div></div>
        <span className="sp" />
        {month && <MonthPick value={month} options={options} onChange={setMonth} />}
      </div>

      {!ready ? <div className="card"><div className="empty">{model?.empty ? '실현 수익 데이터가 없습니다. 기준월·데이터 업로드를 확인하세요.' : <><span className="spinner" /> 실현 수익 계산을 불러오는 중입니다…</>}</div></div> : <>
        <div className="card" style={{ padding: '12px 16px' }}>
          <div className="note"><b>{ymL(month)}</b> · <span style={{ color: at.src === month ? '#2c7f2c' : '#9a6f00' }}>{status}</span><br />
            받는 본부 = 조회 기간에 실현 수익이 있는 본부 ({targets.join(', ') || '없음'}). 비율 합이 100% 보다 작으면 나머지는 원래 조직에 남습니다. 본부 줄의 비율은 소속 부서 전체에 적용되고, "팀별로 따로"를 켜면 부서마다 다르게 정할 수 있습니다(부서 줄이 비어 있으면 본부 줄 비율을 따름).</div>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="tbl-wrap"><table>
            <thead><tr><th>나눌 조직</th><th>{ymL(month)} 비용</th><th>인원</th>{targets.map(t => <th key={t}>→ {t} (%)</th>)}<th>합계</th><th style={{ textAlign: 'left' }}>채우기</th></tr></thead>
            <tbody>
              {sources.map(s => [
                pctRow({ k: 'hq:' + s.hq, name: s.hq, cost: s.cost, emp: s.emp }),
                <tr key={s.hq + '-t'} className="sub"><td colSpan={5 + targets.length} style={{ textAlign: 'left', fontFamily: 'var(--font-body)' }}>
                  <label className="row" style={{ gap: 6, fontSize: 12, fontWeight: 400 }}><input type="checkbox" checked={!!split[s.hq]} onChange={e => { const on = e.target.checked; setSplit(o => ({ ...o, [s.hq]: on })); if (!on) setDraft(d => { const n = clone(d); s.depts.forEach(r => delete n['dept:' + r.d]); return n; }); }} />팀별로 따로 ({s.depts.length}개 부서)</label>
                </td></tr>,
                ...(split[s.hq] ? s.depts.map(r => pctRow({ k: 'dept:' + r.d, name: r.d, sub: draft['dept:' + r.d] ? '' : '본부 비율 따름', cost: r.cost[ci] || 0, emp: (r.empSer || [])[ci] || 0, indent: true })) : []),
              ])}
              {!sources.length && <tr><td colSpan={5 + targets.length} className="mut" style={{ textAlign: 'center', padding: 20 }}>나눌 조직이 없습니다.</td></tr>}
            </tbody>
          </table></div>
        </div>

        {preview && <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13.5 }}>미리보기 · {ymL(month)} 기준 (저장 전 값)</div>
          <div className="tbl-wrap"><table>
            <thead><tr><th>본부</th><th>원래 비용</th><th>받는 비용</th><th>배분 후 비용</th><th>원래 인원</th><th>받는 인원</th><th>배분 후 인원</th><th style={{ textAlign: 'left' }}>받는 곳</th></tr></thead>
            <tbody>{preview.hqs.map(h => {
              const inC = h.inFrom.reduce((a, f) => a + f.cost[0], 0), inE = h.inFrom.reduce((a, f) => a + f.emp[0], 0);
              return <tr key={h.hq}><td>{h.hq}</td><td>{fmt(h.ownCost[0])}</td><td style={{ color: inC ? '#9a6f00' : undefined }}>{inC ? '+' + fmt(inC) : '-'}</td><td><b>{fmt(h.cost[0])}</b></td><td>{(Math.round(h.ownEmp[0] * 10) / 10).toLocaleString('ko-KR')}</td><td>{inE ? '+' + (Math.round(inE * 10) / 10).toLocaleString('ko-KR') : '-'}</td><td><b>{(Math.round(h.emp[0] * 10) / 10).toLocaleString('ko-KR')}</b></td><td className="mut" style={{ textAlign: 'left', fontFamily: 'var(--font-body)' }}>{h.inFrom.filter(f => f.cost[0]).map(f => `${f.from} ${kor(f.cost[0])}`).join(' · ')}</td></tr>;
            })}</tbody>
          </table></div>
          {preview.gone.length > 0 && <div className="help" style={{ padding: '6px 14px 10px' }}>비용·인원이 모두 넘어가 실현 수익 화면에서 빠지는 조직: {preview.gone.join(', ')}</div>}
        </div>}

        <SaveBar dirty={!same(draft, base)} saving={saving} msg={msg} onSave={save} onRevert={() => setDraft(clone(base))} saveLabel={`${ymL(month)} 저장`} note={at.src !== month ? '저장하면 이 달부터 새 비율이 적용됩니다.' : undefined} />
      </>}
    </div>
  );
}
