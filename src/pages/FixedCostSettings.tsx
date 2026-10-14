// 설정 › 고정비 설정 — 운영 지표 ⑥ "고정비 대비 수익" 에서 어떤 전표를 고정비로 볼지 관리자가 정합니다.
//   계정마다: 고정비 아님 / 전부 고정비 / 적요에 단어가 있는 것만 / 적요에 단어가 있는 것은 빼고
//   저장: config.key = 'fixedCost'  { accounts: { [계정]: { mode, kws[] } } }  — 계산은 DB(fixed_cost_agg)가 같은 규칙으로 합니다.
import { accL } from '../lib/acc';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { fmt } from '../components/ui';
import { HelpDot } from '../components/Help';
import { SaveBar, type Msg } from '../components/settingsUi';
import { kor, ymL } from '../components/charts';

type Mode = 'all' | 'only' | 'except';
type Rule = { mode: Mode; kws: string[] };
type Cfg = { accounts: Record<string, Rule> };
type Cand = { items: [string, string, number, number, number][]; months: [string, string, number][] };

const MODE_L: Record<Mode | 'none', string> = { none: '고정비 아님', all: '전부 고정비', only: '적요에 단어 있는 것만', except: '적요에 단어 있는 것 빼고' };
const shiftYm = (ym: string, d: number) => { const y = +ym.slice(0, 4), m = +ym.slice(4, 6) - 1 + d; const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12 + 1; return yy + String(mm).padStart(2, '0'); };
const hit = (summary: string, kws: string[]) => { const s = summary.toLowerCase(); return kws.some(k => k && s.includes(k.toLowerCase())); };
/** DB 의 kj_is_fixed 와 같은 규칙 */
export const isFixed = (rule: Rule | undefined, summary: string) => !rule ? false : rule.mode === 'all' ? true : rule.mode === 'only' ? hit(summary, rule.kws) : !hit(summary, rule.kws);
const clone = (c: Cfg): Cfg => JSON.parse(JSON.stringify(c));
const same = (a: Cfg, b: Cfg) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const norm = (c: Cfg) => Object.fromEntries(Object.entries(c.accounts).sort(([a], [b]) => a.localeCompare(b)).map(([k, r]) => [k, { mode: r.mode, kws: r.mode === 'all' ? [] : [...r.kws].filter(Boolean) }]));

export default function FixedCostSettings() {
  const { closeMonth } = useAuth();
  const now = new Date();
  const endM = closeMonth || (now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0'));
  const [span, setSpan] = useState(6);
  const from = shiftYm(endM, -(span - 1));
  const months = useMemo(() => Array.from({ length: span }, (_, i) => shiftYm(from, i)), [from, span]);
  const [cand, setCand] = useState<Cand | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [saved, setSaved] = useState<Cfg>({ accounts: {} });
  const [draft, setDraft] = useState<Cfg>({ accounts: {} });
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filt, setFilt] = useState<'all' | 'set' | 'unset' | 'rec'>('all');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>({ text: '', cls: '' });

  useEffect(() => { (async () => {
    const { data } = await supabase.from('config').select('value').eq('key', 'fixedCost').maybeSingle();
    const v = (data?.value as Cfg) || { accounts: {} }; if (!v.accounts) v.accounts = {};
    setSaved(clone(v)); setDraft(clone(v));
  })(); }, []);
  useEffect(() => { let alive = true; setCand(null); setLoadErr('');
    supabase.rpc('fixed_cost_candidates', { p_from: from, p_to: endM }).then(({ data, error }) => {
      if (!alive) return;
      if (error) setLoadErr(/fixed_cost_candidates|PGRST202|function/i.test(error.message + (error.code || '')) ? '이 화면은 DB 함수가 필요합니다. Supabase SQL Editor 에서 0009_fixed_cost.sql 을 실행하세요.' : error.message);
      else setCand(data as Cand);
    });
    return () => { alive = false; };
  }, [from, endM]);

  // 계정별 정리
  const accs = useMemo(() => {
    if (!cand) return [];
    const by: Record<string, { acc: string; total: number; items: { s: string; amt: number; n: number; nm: number }[]; mon: number[] }> = {};
    const mi: Record<string, number> = {}; months.forEach((m, i) => { mi[m] = i; });
    cand.items.forEach(([a, s, amt, n, nm]) => { const o = by[a] || (by[a] = { acc: a, total: 0, items: [], mon: months.map(() => 0) }); o.total += +amt; o.items.push({ s, amt: +amt, n: +n, nm: +nm }); });
    cand.months.forEach(([a, m, amt]) => { const o = by[a]; if (o && mi[m] != null) o.mon[mi[m]] += +amt; });
    return Object.values(by).map(o => {
      o.items.sort((x, y) => y.amt - x.amt);
      const present = o.mon.filter(v => v !== 0).length;
      const avg = o.total / months.length;
      const nz = o.mon.filter(v => v !== 0); const mean = nz.length ? nz.reduce((a, b) => a + b, 0) / nz.length : 0;
      const cv = nz.length > 1 && mean > 0 ? Math.sqrt(nz.reduce((a, v) => a + (v - mean) ** 2, 0) / nz.length) / mean : null;
      const rec = present === months.length && cv != null && cv < 0.2;   // 매달 나오고 변동이 작음 → 고정비 후보
      const rule = draft.accounts[o.acc];
      const fixedAmt = rule ? o.items.reduce((a, it) => a + (isFixed(rule, it.s) ? it.amt : 0), 0) : 0;
      return { ...o, present, avg, cv, rec, rule, fixedAmt };
    }).sort((a, b) => b.total - a.total);
  }, [cand, months, draft]);

  const tot = useMemo(() => {
    const all = accs.reduce((a, x) => a + x.total, 0), fx = accs.reduce((a, x) => a + x.fixedAmt, 0);
    return { all, fx, set: Object.keys(draft.accounts).length };
  }, [accs, draft]);

  const dirty = !same(draft, saved);
  const setRule = (acc: string, r: Rule | null) => setDraft(d => { const n = clone(d); if (r) n.accounts[acc] = r; else delete n.accounts[acc]; return n; });
  const setMode = (acc: string, m: Mode | 'none') => { const cur = draft.accounts[acc]; setRule(acc, m === 'none' ? null : { mode: m, kws: cur?.kws || [] }); };
  const addKw = (acc: string, kw: string) => { const k = kw.trim(); if (!k) return; const cur = draft.accounts[acc] || { mode: 'only' as Mode, kws: [] }; if (cur.kws.includes(k)) return; setRule(acc, { mode: cur.mode === 'all' ? 'only' : cur.mode, kws: [...cur.kws, k] }); };
  const delKw = (acc: string, kw: string) => { const cur = draft.accounts[acc]; if (!cur) return; setRule(acc, { ...cur, kws: cur.kws.filter(x => x !== kw) }); };
  const applyRec = () => setDraft(d => { const n = clone(d); accs.filter(a => a.rec && !n.accounts[a.acc]).forEach(a => { n.accounts[a.acc] = { mode: 'all', kws: [] }; }); return n; });

  const save = async () => {
    setSaving(true); setMsg({ text: '', cls: '' });
    const value: Cfg = { accounts: norm(draft) as Record<string, Rule> };
    const summary = `고정비 설정 · 계정 ${Object.keys(value.accounts).length}개`;
    const { error } = await supabase.rpc('save_config', { p_key: 'fixedCost', p_value: value, p_summary: summary });
    setSaving(false);
    if (error) return setMsg({ text: error.message, cls: 'neg' });
    setSaved(clone(value)); setDraft(clone(value)); setMsg({ text: '저장했습니다. 국전 수익/비용 화면의 운영 지표 ⑥ 에 바로 반영됩니다.', cls: 'pos' });
    window.dispatchEvent(new CustomEvent('kjhub:fixedsaved'));
  };

  const shown = accs.filter(a => (!q || a.acc.includes(q) || accL(a.acc).includes(q) || a.items.some(it => it.s.includes(q)))
    && (filt === 'all' || (filt === 'set' && a.rule) || (filt === 'unset' && !a.rule) || (filt === 'rec' && a.rec)));
  const recN = accs.filter(a => a.rec && !a.rule).length;

  return (
    <div className="page fx" style={{ gap: 16, maxWidth: 1400 }}>
      <style>{`
        .fx>*{min-width:0}
        .fx .verdict{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
        .fx .verdict>div{padding:14px 18px;min-width:0}.fx .verdict>div+div{border-left:1px solid var(--line)}
        .fx .l{font-size:12px;color:var(--fg-3)}.fx .big{font:800 26px/1.15 var(--font-num);font-variant-numeric:tabular-nums;margin-top:3px}
        .fx .bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 14px;background:var(--surface);border:1px solid var(--line);border-radius:12px}
        .fx table.acc{width:100%;border-collapse:collapse;font-size:13px}
        .fx table.acc th{font-weight:500;color:var(--fg-3);font-size:11.5px;text-align:right;padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap;background:var(--surface-2)}
        .fx table.acc>thead>tr>th:first-child,.fx table.acc>tbody>tr>td:first-child{text-align:left}
        .fx table.acc>tbody>tr>td{padding:7px 8px;border-bottom:1px solid var(--line);text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums;white-space:nowrap;vertical-align:middle}
        .fx table.acc>tbody>tr>td:first-child{font-family:var(--font-body);font-weight:600;cursor:pointer}
        .fx table.acc>tbody>tr.on>td{background:var(--brand-soft)}
        .fx tr.isfx td:first-child{box-shadow:inset 3px 0 0 #f26a1b}
        .fx .seg button{font-size:12px;padding:4px 9px}
        .fx .det{background:var(--surface-2);padding:12px 14px;display:grid;gap:10px;text-align:left;white-space:normal;font-family:var(--font-body)}
        .fx .kw{display:inline-flex;align-items:center;gap:4px;background:#fff1e6;color:#b4500e;border-radius:999px;padding:2px 4px 2px 10px;font-size:12px;margin:2px 4px 2px 0}
        .fx .kw button{border:0;background:transparent;cursor:pointer;color:inherit;font-size:14px;line-height:1;padding:0 4px}
        .fx table.sm{width:100%;border-collapse:collapse;font-size:12.5px;background:var(--surface);border-radius:8px}
        .fx table.sm th{font-weight:500;color:var(--fg-3);font-size:11.5px;text-align:right;padding:5px 8px;border-bottom:1px solid var(--line)}
        .fx table.sm th:first-child,.fx table.sm td:first-child{text-align:left}
        .fx table.sm td{padding:5px 8px;border-bottom:1px solid var(--line);text-align:right;font-family:var(--font-num)}
        .fx table.sm td:first-child{font-family:var(--font-body);white-space:normal;word-break:break-all}
        .fx .ok{color:#b4500e;font-weight:700}.fx .no{color:var(--fg-3)}
        .fx .rec{font-size:11px;background:#e8f5e8;color:#2c7f2c;border-radius:999px;padding:1px 7px;margin-left:6px;font-weight:600}
        @media(max-width:820px){.fx table.acc>thead>tr>th:nth-child(3),.fx table.acc>tbody>tr>td:nth-child(3),.fx table.acc>thead>tr>th:nth-child(4),.fx table.acc>tbody>tr>td:nth-child(4),.fx table.acc>thead>tr>th:nth-child(5),.fx table.acc>tbody>tr>td:nth-child(5),.fx table.acc>thead>tr>th:nth-child(7),.fx table.acc>tbody>tr>td:nth-child(7){display:none}.fx table.acc>tbody>tr>td:first-child{white-space:normal}.fx table.acc select{max-width:128px}.fx .det .seg{flex-wrap:wrap;overflow:visible}.fx .det{padding:10px}.fx table.sm th:nth-child(3),.fx table.sm td:nth-child(3),.fx table.sm th:nth-child(4),.fx table.sm td:nth-child(4){display:none}}
        @media(max-width:900px){.fx .verdict{grid-template-columns:1fr 1fr}.fx .verdict>div:nth-child(3){border-left:0}.fx .verdict>div:nth-child(n+3){border-top:1px solid var(--line)}}
      `}</style>
      <div className="page-head">
        <div><h1>고정비 설정<HelpDot id="set.fixed" /></h1><div className="help">운영 지표 ⑥ "고정비 대비 수익"에서 어떤 전표를 고정비로 볼지 계정과 적요로 정합니다. 계정을 누르면 적요별 금액이 펼쳐집니다.</div></div>
        <span className="sp" />
        <span className="row" style={{ gap: 6 }}><span className="help">살펴볼 기간</span><span className="seg">{[3, 6, 12].map(n => <button key={n} className={span === n ? 'on' : ''} onClick={() => setSpan(n)}>{n}개월</button>)}</span><span className="help">{ymL(from)} ~ {ymL(endM)}</span></span>
      </div>

      {loadErr && <div className="card"><div className="empty">{loadErr}</div></div>}

      <div className="verdict">
        <div><div className="l">기간 비용 전표 합계</div><div className="big">{kor(tot.all)}</div><div className="help">계정 {accs.length}개 · {months.length}개월</div></div>
        <div><div className="l">고정비 (지금 설정 기준)</div><div className="big" style={{ color: '#c2561a' }}>{kor(tot.fx)}</div><div className="help">월평균 {kor(tot.fx / months.length)}</div></div>
        <div><div className="l">비용 중 고정비 비중</div><div className="big">{tot.all ? Math.round(tot.fx / tot.all * 1000) / 10 : 0}%</div><div className="help">저장 전 미리보기</div></div>
        <div><div className="l">고정비로 정한 계정</div><div className="big">{tot.set}개</div><div className="help">{recN ? `추천 후보 ${recN}개 남음` : '추천 후보 없음'}</div></div>
      </div>

      <div className="bar">
        <input className="inp" style={{ width: 220 }} placeholder="계정·적요 검색" value={q} onChange={e => setQ(e.target.value)} />
        <span className="seg">{([['all', '전체'], ['set', '고정비로 정함'], ['unset', '정하지 않음'], ['rec', '추천']] as const).map(([k, l]) => <button key={k} className={filt === k ? 'on' : ''} onClick={() => setFilt(k)}>{l}</button>)}</span>
        <span className="sp" />
        <button className="btn sm" disabled={!recN} onClick={applyRec} title="살펴볼 기간에 매달 나오고 월 금액 변동이 20% 미만인 계정을 '전부 고정비'로">추천 {recN}개 일괄 적용</button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="tbl-wrap">
          <table className="acc">
            <thead><tr><th>계정과목</th><th>기간 금액</th><th>월평균</th><th>나온 달</th><th>월 변동</th><th style={{ textAlign: 'center' }}>고정비 기준</th><th>고정비 인정액</th></tr></thead>
            <tbody>
              {!cand && !loadErr && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24 }}><span className="spinner" /></td></tr>}
              {shown.map(a => {
                const isOpen = open === a.acc; const mode: Mode | 'none' = a.rule?.mode || 'none';
                return [
                  <tr key={a.acc} className={(isOpen ? 'on ' : '') + (a.rule ? 'isfx' : '')}>
                    <td onClick={() => setOpen(isOpen ? null : a.acc)}>{isOpen ? '▾ ' : '▸ '}{accL(a.acc)}{a.rec && <span className="rec" title="매달 나오고 월 금액 변동이 20% 미만">추천</span>}</td>
                    <td>{fmt(a.total)}</td><td>{fmt(a.avg)}</td>
                    <td className={a.present === months.length ? '' : 'no'}>{a.present}/{months.length}</td>
                    <td className="no">{a.cv == null ? '-' : Math.round(a.cv * 100) + '%'}</td>
                    <td style={{ textAlign: 'center' }}>
                      <select className="inp" style={{ padding: '3px 6px', fontSize: 12.5, fontWeight: a.rule ? 700 : 400, color: a.rule ? '#b4500e' : undefined }} value={mode} onChange={e => { setMode(a.acc, e.target.value as Mode | 'none'); if (e.target.value === 'only' || e.target.value === 'except') setOpen(a.acc); }}>
                        {(['none', 'all', 'only', 'except'] as const).map(m => <option key={m} value={m}>{MODE_L[m]}</option>)}
                      </select>
                    </td>
                    <td className={a.fixedAmt ? 'ok' : 'no'}>{a.fixedAmt ? fmt(a.fixedAmt) : '-'}{a.rule && a.total ? <small className="no" style={{ marginLeft: 6, fontWeight: 400 }}>{Math.round(a.fixedAmt / a.total * 100)}%</small> : null}</td>
                  </tr>,
                  isOpen && <tr key={a.acc + '-d'}><td colSpan={7} style={{ padding: 0 }}><AccDetail a={a} rule={a.rule} onAdd={k => addKw(a.acc, k)} onDel={k => delKw(a.acc, k)} onMode={m => setMode(a.acc, m)} /></td></tr>,
                ];
              })}
              {cand && !shown.length && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24 }} className="no">조건에 맞는 계정이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <SaveBar dirty={dirty} saving={saving} msg={msg} onSave={save} onRevert={() => setDraft(clone(saved))} note="설정은 기간과 관계없이 모든 달에 같이 적용됩니다." />
    </div>
  );
}

function AccDetail({ a, rule, onAdd, onDel, onMode }: { a: { acc: string; total: number; items: { s: string; amt: number; n: number; nm: number }[] }; rule?: Rule; onAdd: (k: string) => void; onDel: (k: string) => void; onMode: (m: Mode | 'none') => void }) {
  const [kw, setKw] = useState('');
  const [q, setQ] = useState('');
  const [more, setMore] = useState(false);
  const list = a.items.filter(it => !q || it.s.includes(q));
  const mode: Mode | 'none' = rule?.mode || 'none';
  const fx = a.items.reduce((s, it) => s + (isFixed(rule, it.s) ? it.amt : 0), 0);
  return (
    <div className="det">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 13 }}>{accL(a.acc)}</b>
        <span className="seg">{(['none', 'all', 'only', 'except'] as const).map(m => <button key={m} className={mode === m ? 'on' : ''} onClick={() => onMode(m)}>{MODE_L[m]}</button>)}</span>
        <span className="sp" />
        <span className="help">이 계정 고정비 <b style={{ color: '#b4500e' }}>{fmt(fx)}</b> / {fmt(a.total)} ({a.total ? Math.round(fx / a.total * 100) : 0}%)</span>
      </div>
      {(mode === 'only' || mode === 'except') && (
        <div>
          <div className="help" style={{ marginBottom: 4 }}>{mode === 'only' ? '적요에 아래 단어 중 하나라도 들어간 전표만 고정비입니다.' : '적요에 아래 단어 중 하나라도 들어간 전표는 고정비에서 뺍니다.'} (대소문자 구분 없음, 일부만 같아도 됨)</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {(rule?.kws || []).map(k => <span key={k} className="kw">{k}<button onClick={() => onDel(k)} aria-label={k + ' 삭제'}>×</button></span>)}
            <input className="inp" style={{ width: 200, padding: '4px 8px', fontSize: 12.5 }} placeholder="단어 입력 후 Enter" value={kw} onChange={e => setKw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { onAdd(kw); setKw(''); } }} />
            <button className="btn sm" onClick={() => { onAdd(kw); setKw(''); }} disabled={!kw.trim()}>추가</button>
          </div>
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <span className="help">적요별 금액 ({a.items.length}개) — {mode === 'only' || mode === 'except' ? '"단어로" 를 누르면 그 적요를 단어 목록에 넣습니다 (넣은 뒤 줄여도 됩니다).' : '적요로 나누려면 위에서 "적요에 단어 있는 것만/빼고" 를 고르세요.'}</span>
        <span className="sp" />
        <input className="inp" style={{ width: 180, padding: '4px 8px', fontSize: 12.5 }} placeholder="적요 검색" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div style={{ maxHeight: 360, overflow: 'auto' }}>
        <table className="sm">
          <thead><tr><th>적요</th><th>금액</th><th>건수</th><th>나온 달</th><th style={{ textAlign: 'center' }}>고정비</th><th></th></tr></thead>
          <tbody>{list.slice(0, more ? 500 : 40).map(it => { const f = isFixed(rule, it.s); return (
            <tr key={it.s}><td>{it.s || <span className="no">(적요 없음)</span>}</td><td>{fmt(it.amt)}</td><td>{fmt(it.n)}</td><td>{it.nm}</td><td style={{ textAlign: 'center' }} className={f ? 'ok' : 'no'}>{f ? '✓' : '–'}</td>
              <td>{(mode === 'only' || mode === 'except') && it.s && <button className="btn sm ghost" style={{ padding: '1px 8px' }} onClick={() => onAdd(it.s)}>단어로</button>}</td></tr>); })}</tbody>
        </table>
        {list.length > 40 && !more && <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => setMore(true)}>나머지 {Math.min(list.length, 500) - 40}개 더 보기</button>}
      </div>
    </div>
  );
}
