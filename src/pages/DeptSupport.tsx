// 부서 › 지원 내역 — 받은 지원(우리 부담)과 준 지원을 부서 기준으로 봅니다.
//   금액은 지원 모듈(__kjSupport)이 [지원 내역 설정]대로 계산한 값을 그대로 씁니다.
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { fmt } from '../components/ui';
import { MonthBars } from '../components/charts';
import { PageHead, MonthNav, Stat, Card, Loading, Empty, Delta, won, swon, ymText } from '../components/kit';
import { KJ, nrm, pick, type Raw } from '../lib/legacyData';
import { useData } from '../lib/useData';
import { SPLIT_LABEL } from '../lib/terms';

type SRow = { from: string; task: string; desc: string; split: string; targetCount: number; amount: number };
const SP = () => (window as unknown as { __kjSupport?: { ready: boolean; detailsFor: (dept: string, ym: string) => SRow[] } }).__kjSupport;
const monthsBack = (end: string, n: number) => { const out: string[] = []; let y = +end.slice(0, 4), m = +end.slice(4, 6); for (let i = 0; i < n; i++) { out.unshift(y + ('0' + m).slice(-2)); m--; if (m === 0) { m = 12; y--; } } return out; };
const sumAmt = (rs: SRow[]) => rs.reduce((a, r) => a + r.amount, 0);

export default function DeptSupport() {
  const { closeMonth, employee } = useAuth();
  const [t0, setT0] = useState(0);
  const { ver } = useData(['dept', 'headcount']);
  useEffect(() => { const h = () => setT0(t => t + 1); ['kjsupport:ready', 'kjhub:login'].forEach(e => window.addEventListener(e, h)); return () => ['kjsupport:ready', 'kjhub:login'].forEach(e => window.removeEventListener(e, h)); }, []);
  const tick = t0 + '|' + ver;
  const end0 = closeMonth || KJ()?.closeMonth?.() || '';
  const [ym, setYm] = useState(end0);
  useEffect(() => { if (end0) setYm(end0); }, [end0]);
  const [fromSel, setFromSel] = useState(''); const [deptSel, setDeptSel] = useState('');
  const [openG, setOpenG] = useState<Record<string, boolean>>({});

  const ready = !!SP()?.ready;
  // 부서 목록과 볼 수 있는 부서 (일반 사용자인데 권한 정보가 아직 없으면 아무것도 보이지 않게)
  const { all, mine, restricted } = useMemo(() => {
    const rows = (KJ()?.data?.dept || []) as Raw[]; const all: string[] = []; const seen = new Set<string>();
    rows.forEach(r => { const d = String(pick(r, ['DeptName', '부서명', '부서'])).trim(); if (d && !seen.has(d)) { seen.add(d); all.push(d); } });
    all.sort((a, b) => a.localeCompare(b, 'ko'));
    const a = KJ()?.screenDepts?.('부서별 지원 내역');
    if (a == null) return employee?.role === 'user' ? { all, mine: [] as string[], restricted: true } : { all, mine: all, restricted: false };
    const set = new Set(a.map(nrm)); const pref = a.filter(x => String(x).endsWith('*')).map(x => nrm(String(x).slice(0, -1)));
    return { all, mine: all.filter(d => set.has(nrm(d)) || pref.some(p => p && nrm(d).indexOf(p) === 0)), restricted: true };
  }, [tick, employee?.role]); // eslint-disable-line
  const hqOf = useMemo(() => { const m: Record<string, string> = {}; ((KJ()?.data?.dept || []) as Raw[]).forEach(r => { const d = String(pick(r, ['DeptName', '부서명', '부서'])).trim(); if (d) m[d] = String(pick(r, ['BizUnitName', '본부'])).trim(); }); return m; }, [tick]); // eslint-disable-line

  // 받은 지원 (받는 부서별 상세)
  const detail = useMemo(() => { const sp = SP(); if (!sp?.ready || !ym) return {} as Record<string, SRow[]>; const o: Record<string, SRow[]> = {}; mine.forEach(d => { const r = sp.detailsFor(d, ym) || []; if (r.length) o[d] = r; }); return o; }, [mine, ym, tick]); // eslint-disable-line
  const scope = deptSel ? [deptSel] : mine;
  const byDept = useMemo(() => Object.entries(detail).map(([d, r]) => [d, sumAmt(r), r.length] as [string, number, number]).sort((a, b) => b[1] - a[1]), [detail]);
  const scoped = useMemo(() => scope.flatMap(d => (detail[d] || []).map(r => ({ ...r, to: d }))), [detail, scope.join('|')]); // eslint-disable-line
  const byFrom = useMemo(() => { const m: Record<string, { amt: number; n: number; tasks: Set<string> }> = {}; scoped.forEach(r => { const o = m[r.from] || (m[r.from] = { amt: 0, n: 0, tasks: new Set() }); o.amt += r.amount; o.n++; o.tasks.add(r.task); }); return Object.entries(m).sort((a, b) => b[1].amt - a[1].amt); }, [scoped]);
  const total = sumAmt(scoped);
  const trend = useMemo(() => { const sp = SP(); if (!sp?.ready || !ym) return [] as [string, number][]; return monthsBack(ym, 6).map(m => [m, scope.reduce((a, d) => a + sumAmt(sp.detailsFor(d, m) || []), 0)] as [string, number]); }, [scope.join('|'), ym, tick]); // eslint-disable-line
  const prev = trend.length >= 2 ? trend[trend.length - 2][1] : null;
  // 준 지원: 볼 수 있는 부서(또는 고른 부서)가 다른 부서에 해 준 지원. 회사 전체를 볼 때는 받은 지원과 같은 금액이라 따로 보이지 않습니다.
  const focus = deptSel ? [deptSel] : restricted ? mine : null;
  const given = useMemo(() => {
    const sp = SP(); if (!sp?.ready || !ym || !focus) return [] as (SRow & { to: string })[];
    const fs = new Set(focus.map(nrm)); const out: (SRow & { to: string })[] = [];
    all.forEach(d => (sp.detailsFor(d, ym) || []).forEach(r => { if (fs.has(nrm(r.from))) out.push({ ...r, to: d }); }));
    return out.sort((a, b) => b.amount - a.amount);
  }, [focus?.join('|'), all, ym, tick]); // eslint-disable-line
  const givenTotal = sumAmt(given);
  const groups = (deptSel ? byDept.filter(x => x[0] === deptSel) : byDept).map(([d]) => [d, (detail[d] || []).filter(r => !fromSel || r.from === fromSel).slice().sort((a, b) => b.amount - a.amount)] as [string, SRow[]]).filter(x => x[1].length);
  const maxD = Math.max(1, ...byDept.map(x => x[1])), maxF = Math.max(1, ...byFrom.map(x => x[1].amt));
  const multi = mine.length > 1;
  const scopeL = deptSel || (restricted ? (mine.length === 1 ? mine[0] : '볼 수 있는 부서 전체') : '회사 전체');

  return (
    <div className="page ds">
      <style>{`
        .ds .sl{display:grid;grid-template-columns:minmax(0,1fr) 104px 40px;gap:10px;align-items:center;font-size:13.5px;padding:7px 8px;border-radius:8px;cursor:pointer}
        .ds .sl:hover{background:var(--surface-2)}.ds .sl.on{background:var(--blue-soft)}
        .ds .sl .nm{font-weight:600;min-width:0;display:grid;gap:5px}.ds .sl .nm>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ds .sl .nm small{font-weight:400;color:var(--fg-3);margin-left:6px;font-size:12px}
        .ds .sl .bar{height:5px}
        .ds .sl>:nth-child(n+2){text-align:right;white-space:nowrap}.ds .sl>:nth-child(3){font-size:12.5px}
        .ds .sl.h{cursor:default;font-size:12px;color:var(--fg-3);font-weight:600;border-bottom:1px solid var(--line);border-radius:0;padding-bottom:6px}.ds .sl.h:hover{background:none}
        .ds .t td.l{white-space:normal}
        .ds .t tr.grp td{background:var(--surface-2);font-weight:700;cursor:pointer}
        .ds .chip .x{cursor:pointer;font-weight:700;margin-left:2px}
        .ds .g21{align-items:stretch}
      `}</style>
      <PageHead title="지원 내역" desc="다른 부서에서 받은 지원과 우리가 해 준 지원입니다. 받은 지원은 부서 비용에, 해 준 지원은 배분 이익에 더해집니다.">
        <MonthNav value={ym ? ym.slice(0, 4) + '-' + ym.slice(4, 6) : ''} onChange={v => setYm(v.replace('-', ''))} />
      </PageHead>

      {!ready ? <Loading text="지원 내역을 불러오는 중입니다." />
        : !mine.length ? <Empty>볼 수 있는 부서가 없습니다. 관리자에게 권한을 요청해 주세요.</Empty>
        : !byDept.length && !given.length ? <Empty>{ymText(ym)}에는 지원 내역이 없습니다.</Empty> : (
        <>
          {(deptSel || fromSel) && <div className="row">{deptSel && <span className="chip on">{deptSel} <span className="x" onClick={() => setDeptSel('')}>×</span></span>}{fromSel && <span className="chip on">지원 부서: {fromSel} <span className="x" onClick={() => setFromSel('')}>×</span></span>}<button className="btn sm ghost" onClick={() => { setDeptSel(''); setFromSel(''); }}>조건 지우기</button></div>}

          <div className="stats">
            <Stat label={`${+ym.slice(4)}월 받은 지원`} help="support.view" value={won(total)} keyColor="var(--orange)" sub={<>{scopeL} · {scoped.length}건 · 비용에 더해짐</>} />
            <Stat label="전월 대비" value={prev == null ? '-' : (total - prev > 0 ? '+' : total - prev < 0 ? '−' : '') + won(Math.abs(total - prev))} tone={prev == null || total === prev ? undefined : total > prev ? 'neg' : 'pos'} sub={prev == null ? undefined : <>전월 {won(prev)} <Delta cur={total} prev={prev} invert mode="pct" /></>} />
            {focus ? <>
              <Stat label={`${+ym.slice(4)}월 해 준 지원`} value={won(givenTotal)} sub={<>{given.length}건 · 배분 이익에 더해짐</>} />
              <Stat label="차이 (해 준 − 받은)" value={swon(givenTotal - total)} tone={givenTotal - total > 0 ? 'pos' : givenTotal - total < 0 ? 'neg' : undefined} sub="+ 이면 손익에 보탬" />
            </> : <>
              <Stat label="지원 받는 부서" value={byDept.length} unit="곳" sub={`지원 ${scoped.length}건`} />
              <Stat label="지원하는 부서" value={byFrom.length} unit="곳" sub={byFrom[0] ? `가장 큰 곳 ${byFrom[0][0]}` : undefined} />
            </>}
          </div>

          <div className="g21">
            <Card title="받은 지원 추이" desc="최근 6개월 · 누르면 그 달">
              <MonthBars items={trend.map(([m, v]) => ({ m, v }))} mode="orange" height={210} sel={[ym]} onPick={setYm} label="월별 받은 지원" />
            </Card>
            <Card title="지원하는 부서" desc="누르면 그 부서가 해 준 지원만">
              {byFrom.length ? <>
                <div className="sl h"><span>부서 · 업무 수</span><span>금액</span><span>비중</span></div>
                {byFrom.slice(0, 10).map(([f, v]) => (
                  <div key={f} className={'sl' + (fromSel === f ? ' on' : '')} onClick={() => setFromSel(fromSel === f ? '' : f)}>
                    <span className="nm"><span>{f}<small>업무 {v.tasks.size}개</small></span><div className="bar"><i style={{ width: Math.max(2, Math.round(v.amt / maxF * 100)) + '%' }} /></div></span>
                    <b className="num">{fmt(v.amt)}</b><span className="mut">{total > 0 ? Math.round(v.amt / total * 100) : 0}%</span>
                  </div>))}
              </> : <div className="empty">받은 지원이 없습니다.</div>}
            </Card>
          </div>

          {multi && !deptSel && byDept.length > 1 && (
            <Card title="받는 부서" desc="누르면 그 부서만">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: '0 24px' }}>
                {byDept.map(([d, v, n]) => (
                  <div key={d} className="sl" onClick={() => setDeptSel(d)}>
                    <span className="nm"><span>{d}<small>{hqOf[d]} · {n}건</small></span><div className="bar"><i style={{ width: Math.max(2, Math.round(v / maxD * 100)) + '%', background: 'var(--orange)' }} /></div></span>
                    <b className="num">{fmt(v)}</b><span className="mut">{total > 0 ? Math.round(v / total * 100) : 0}%</span>
                  </div>))}
              </div>
            </Card>
          )}

          <Card title="받은 지원" desc={`${ymText(ym)} · ${scopeL}${fromSel ? ' · ' + fromSel : ''}${multi && groups.length > 3 ? ' · 부서 줄을 누르면 펼쳐집니다' : ''}`} flush>
            {groups.length ? <div className="tbl-wrap"><table className="t">
              <thead><tr><th>지원 부서</th><th className="l">업무</th><th className="l">설명</th><th className="l">나누는 방식</th><th>받는 부서 수</th><th>우리 부담</th></tr></thead>
              <tbody>{groups.flatMap(([d, rows]) => {
                const isOpen = openG[d] ?? (!multi || groups.length <= 3);
                return [
                  ...(multi ? [<tr key={d} className="grp" onClick={() => setOpenG(o => ({ ...o, [d]: !isOpen }))}><td colSpan={5}><span className="caret">{isOpen ? '▾' : '▸'}</span>{d} <small>{hqOf[d]} · {rows.length}건</small></td><td>{fmt(sumAmt(rows))}</td></tr>] : []),
                  ...(isOpen ? rows.map((r, i) => <tr key={d + i}><td style={multi ? { paddingLeft: 28 } : undefined}><b>{r.from}</b></td><td className="l">{r.task}</td><td className="l mut">{r.desc || '-'}</td><td className="l mut">{SPLIT_LABEL[r.split] || r.split}</td><td className="mut">{r.targetCount}곳</td><td><b>{fmt(r.amount)}</b></td></tr>) : []),
                ];
              })}
              <tr className="total"><td colSpan={5}>합계</td><td>{fmt(groups.reduce((a, g) => a + sumAmt(g[1]), 0))}</td></tr></tbody>
            </table></div> : <div className="empty">조건에 맞는 지원이 없습니다.</div>}
          </Card>

          {focus && (
            <Card title="해 준 지원" desc={`${ymText(ym)} · ${scopeL}이(가) 다른 부서에 해 준 지원`} flush>
              {given.length ? <div className="tbl-wrap"><table className="t">
                <thead><tr><th>받는 부서</th>{focus.length > 1 && <th className="l">지원 부서</th>}<th className="l">업무</th><th className="l">나누는 방식</th><th>금액</th></tr></thead>
                <tbody>{given.map((r, i) => <tr key={i}><td><b>{r.to}</b> <small>{hqOf[r.to]}</small></td>{focus.length > 1 && <td className="l">{r.from}</td>}<td className="l">{r.task}</td><td className="l mut">{SPLIT_LABEL[r.split] || r.split}</td><td><b>{fmt(r.amount)}</b></td></tr>)}
                <tr className="total"><td colSpan={focus.length > 1 ? 4 : 3}>합계</td><td>{fmt(givenTotal)}</td></tr></tbody>
              </table></div> : <div className="empty">해 준 지원이 없습니다.</div>}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
