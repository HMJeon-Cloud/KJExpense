// 부서별 지원 내역 — 받는 부서 기준: 어떤 부서의 어떤 업무 지원을 받아 얼마를 부담하는가
//   결론(총 부담액·부서별) → 지원 부서별 → 부서별 상세 표(기본 펼침). 금액은 기존 지원 모듈(__kjSupport.detailsFor)이 계산합니다.
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { fmt } from '../components/ui';
import { kor } from '../components/charts';
import { KJ, nrm, pick, ymLabel, type Raw } from '../lib/legacyData';

type SRow = { from: string; task: string; desc: string; split: string; targetCount: number; amount: number };
const SP = () => (window as unknown as { __kjSupport?: { ready: boolean; detailsFor: (dept: string, ym: string) => SRow[] } }).__kjSupport;
const SPLIT_LABEL: Record<string, string> = { unit: '인원별(단가)', head: '인원별 배분', dept: '부서별 배분', direct: '직접입력' };
const monthsBack = (end: string, n: number) => { const out: string[] = []; let y = +end.slice(0, 4), m = +end.slice(4, 6); for (let i = 0; i < n; i++) { out.unshift(y + ('0' + m).slice(-2)); m--; if (m === 0) { m = 12; y--; } } return out; };
const shift = (ym: string, d: number) => { let y = +ym.slice(0, 4), m = +ym.slice(4, 6) + d; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y + ('0' + m).slice(-2); };

export default function DeptSupport() {
  const { closeMonth } = useAuth();
  const [tick, setTick] = useState(0);
  useEffect(() => { const h = () => setTick(t => t + 1); ['kjhub:data', 'kjsupport:ready', 'kjhub:login'].forEach(e => window.addEventListener(e, h)); return () => ['kjhub:data', 'kjsupport:ready', 'kjhub:login'].forEach(e => window.removeEventListener(e, h)); }, []);
  const end0 = closeMonth || KJ()?.closeMonth?.() || '';
  const [ym, setYm] = useState(end0);
  useEffect(() => { if (end0) setYm(end0); }, [end0]);
  const [fromSel, setFromSel] = useState(''); const [deptSel, setDeptSel] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const ready = !!SP()?.ready; // eslint-disable-line
  // 대상 부서: 권한이 없으면(관리자) 전체
  const mine = useMemo(() => {
    const rows = (KJ()?.data?.dept || []) as Raw[]; const all: string[] = []; const seen = new Set<string>();
    rows.forEach(r => { const d = String(pick(r, ['DeptName', '부서명', '부서'])).trim(); if (d && !seen.has(d)) { seen.add(d); all.push(d); } });
    all.sort((a, b) => a.localeCompare(b, 'ko'));
    const a = KJ()?.screenDepts?.('부서별 지원 내역'); if (a == null) return all;
    const set = new Set(a.map(nrm)); const pref = a.filter(x => String(x).endsWith('*')).map(x => nrm(String(x).slice(0, -1)));
    return all.filter(d => set.has(nrm(d)) || pref.some(p => p && nrm(d).indexOf(p) === 0));
  }, [tick]); // eslint-disable-line
  const hqOf = useMemo(() => { const m: Record<string, string> = {}; ((KJ()?.data?.dept || []) as Raw[]).forEach(r => { const d = String(pick(r, ['DeptName', '부서명', '부서'])).trim(); if (d) m[d] = String(pick(r, ['BizUnitName', '본부'])).trim(); }); return m; }, [tick]); // eslint-disable-line

  const detail = useMemo(() => { const sp = SP(); if (!sp?.ready || !ym) return {} as Record<string, SRow[]>; const o: Record<string, SRow[]> = {}; mine.forEach(d => { const r = sp.detailsFor(d, ym) || []; if (r.length) o[d] = r; }); return o; }, [mine, ym, tick]); // eslint-disable-line
  const byDept = useMemo(() => Object.entries(detail).map(([d, r]) => [d, r.reduce((a, x) => a + x.amount, 0), r.length] as [string, number, number]).sort((a, b) => b[1] - a[1]), [detail]);
  const byFrom = useMemo(() => { const m: Record<string, { amt: number; n: number; tasks: Set<string> }> = {}; Object.values(detail).forEach(rs => rs.forEach(r => { const o = m[r.from] || (m[r.from] = { amt: 0, n: 0, tasks: new Set() }); o.amt += r.amount; o.n++; o.tasks.add(r.task); })); return Object.entries(m).sort((a, b) => b[1].amt - a[1].amt); }, [detail]);
  const total = byDept.reduce((a, b) => a + b[1], 0);
  const trend = useMemo(() => { const sp = SP(); if (!sp?.ready || !ym) return [] as [string, number][]; return monthsBack(ym, 6).map(m => [m, mine.reduce((a, d) => a + (sp.detailsFor(d, m) || []).reduce((s, x) => s + x.amount, 0), 0)] as [string, number]); }, [mine, ym, tick]); // eslint-disable-line
  const tMax = Math.max(1, ...trend.map(t => t[1]));
  const prev = trend.length >= 2 ? trend[trend.length - 2][1] : null;
  const shown = byDept.filter(([d]) => !deptSel || d === deptSel).map(([d]) => [d, (detail[d] || []).filter(r => !fromSel || r.from === fromSel)] as [string, SRow[]]).filter(x => x[1].length);
  const maxD = Math.max(1, ...byDept.map(x => x[1])), maxF = Math.max(1, ...byFrom.map(x => x[1].amt));

  return (
    <div className="page brief" style={{ gap: 16, maxWidth: 1500 }}>
      <style>{`
        .brief>*{min-width:0}
        .ds .verdict{display:grid;grid-template-columns:1fr 1.2fr 1.2fr;background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
        .ds .verdict>div{padding:16px 20px;min-width:0}.ds .verdict>div+div{border-left:1px solid var(--line)}
        .ds .l{font-size:12px;color:var(--fg-3)}
        .ds .big{font:800 34px/1.1 var(--font-num);letter-spacing:-.02em;margin-top:4px;font-variant-numeric:tabular-nums;color:#b0760a}
        .ds .mini{display:flex;align-items:flex-end;gap:5px;height:60px;margin-top:10px}
        .ds .mini .col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;min-width:0;cursor:pointer}
        .ds .mini .col i{display:block;width:100%;border-radius:3px 3px 0 0;background:#f5b400;opacity:.55}.ds .mini .col.on i{opacity:1}
        .ds .mini .col small{font-size:10px;color:var(--fg-3);margin-top:3px;white-space:nowrap}
        .ds .rk{display:grid;gap:2px;margin-top:6px}
        .ds .r{display:grid;grid-template-columns:minmax(0,1fr) 110px;gap:8px;align-items:center;padding:4px 6px;border-radius:6px;cursor:pointer;font-size:12.5px}
        .ds .r:hover{background:var(--surface-2)}.ds .r.on{background:var(--brand-soft)}
        .ds .r .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.ds .r .nm small{font-weight:400;color:var(--fg-3);margin-left:5px}
        .ds .hb{height:6px;border-radius:999px;background:var(--surface-2);overflow:hidden;margin-top:3px}.ds .hb i{display:block;height:100%;border-radius:999px;background:#f5b400}
        .ds .n{text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums;font-weight:700}
        .ds table{width:100%;border-collapse:collapse;font-size:12.5px}
        .ds th{text-align:left;color:var(--fg-3);font-weight:500;font-size:11.5px;padding:7px 10px;border-bottom:2px solid var(--line);white-space:nowrap}
        .ds td{padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
        .ds td.n,.ds th.n{text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums}
        .ds .dhd{display:flex;gap:10px;align-items:center;padding:9px 12px;background:var(--surface-2);border-bottom:1px solid var(--line);cursor:pointer;font-weight:700;font-size:13px}
        @media(max-width:1000px){.ds .verdict{grid-template-columns:1fr}.ds .verdict>div+div{border-left:0;border-top:1px solid var(--line)}}
      `}</style>
      <div className="ds" style={{ display: 'grid', gap: 16 }}>
        <div className="page-head" style={{ alignItems: 'flex-end' }}>
          <div><h1>부서별 지원 내역</h1><div className="help">지원 받는 부서 기준으로, 어느 부서의 어떤 업무 지원을 받아 얼마를 부담하는지 봅니다. 이 부담액은 부서 비용에 더해집니다.</div></div>
          <span className="sp" />
          <span className="seg"><button onClick={() => ym && setYm(shift(ym, -1))}>‹</button></span>
          <input type="month" className="inp" min="2025-01" value={ymLabel(ym)} onChange={e => setYm(e.target.value.replace('-', ''))} />
          <span className="seg"><button onClick={() => ym && setYm(shift(ym, 1))}>›</button></span>
        </div>

        {!ready ? <div className="card"><div className="empty"><span className="spinner" /> 지원 내역을 불러오는 중입니다.</div></div> : !mine.length ? <div className="card"><div className="empty">조회 권한이 있는 부서가 없습니다.</div></div> : !byDept.length ? <div className="card"><div className="empty">{ymLabel(ym)} 기준으로 받는 지원 내역이 없습니다.</div></div> : (
          <>
            <div className="verdict">
              <div>
                <div className="l">{ymLabel(ym)} 지원 부담액 합계</div>
                <div className="big">{kor(total)}</div>
                <div className="help" style={{ marginTop: 4 }}>{fmt(total)}원 · 받는 부서 {byDept.length}곳 · 지원 {Object.values(detail).reduce((a, r) => a + r.length, 0)}건{prev != null && prev > 0 && <> · 전월 대비 <b style={{ color: total - prev > 0 ? 'var(--neg)' : '#2c7f2c' }}>{total - prev >= 0 ? '+' : ''}{Math.round((total - prev) / prev * 1000) / 10}%</b></>}</div>
                <div className="mini">{trend.map(([m, v]) => <div key={m} className={'col' + (m === ym ? ' on' : '')} title={`${ymLabel(m)} · ${fmt(v)}원`} onClick={() => setYm(m)}><i style={{ height: Math.max(2, Math.round(v / tMax * 44)) }} /><small>{+m.slice(4)}월</small></div>)}</div>
              </div>
              <div>
                <div className="l">받는 부서별 부담액 <span>누르면 그 부서만</span></div>
                <div className="rk">{byDept.slice(0, 12).map(([d, v, n]) => <div key={d} className={'r' + (deptSel === d ? ' on' : '')} onClick={() => setDeptSel(deptSel === d ? '' : d)}><div><div className="nm">{d}<small>{hqOf[d]} · {n}건 · {total > 0 ? Math.round(v / total * 100) : 0}%</small></div><div className="hb"><i style={{ width: Math.max(2, Math.round(v / maxD * 100)) + '%' }} /></div></div><span className="n">{fmt(v)}</span></div>)}</div>
              </div>
              <div>
                <div className="l">지원하는 부서별 <span>누르면 그 부서가 준 지원만</span></div>
                <div className="rk">{byFrom.slice(0, 12).map(([f, v]) => <div key={f} className={'r' + (fromSel === f ? ' on' : '')} onClick={() => setFromSel(fromSel === f ? '' : f)}><div><div className="nm">{f}<small>업무 {v.tasks.size}개 · {v.n}건</small></div><div className="hb"><i style={{ width: Math.max(2, Math.round(v.amt / maxF * 100)) + '%', background: '#1f6fe8' }} /></div></div><span className="n">{fmt(v.amt)}</span></div>)}</div>
              </div>
            </div>

            {(deptSel || fromSel) && <div className="filters">{deptSel && <span className="chip on">{deptSel} <span className="x" onClick={() => setDeptSel('')}>×</span></span>}{fromSel && <span className="chip on">지원 부서 {fromSel} <span className="x" onClick={() => setFromSel('')}>×</span></span>}<span className="sp" /><button className="btn sm ghost" onClick={() => { setDeptSel(''); setFromSel(''); }}>조건 지우기</button></div>}

            {shown.map(([d, rows]) => {
              const isOpen = open[d] ?? true; const sum = rows.reduce((a, r) => a + r.amount, 0);
              return (
                <div className="card" key={d}>
                  <div className="dhd" onClick={() => setOpen(o => ({ ...o, [d]: !isOpen }))}><span style={{ color: 'var(--fg-3)', fontSize: 11 }}>{isOpen ? '▾' : '▸'}</span>{d}<span className="help" style={{ fontWeight: 400 }}>{hqOf[d]} · 지원 {rows.length}건</span><span className="sp" /><span className="help">부담 합계 <b className="num" style={{ color: 'var(--fg)' }}>{fmt(sum)}</b>원</span></div>
                  {isOpen && <div className="tbl-wrap"><table>
                    <thead><tr><th style={{ width: 160 }}>지원 부서</th><th style={{ width: 200 }}>업무</th><th>설명</th><th style={{ width: 120 }}>형식</th><th style={{ width: 90 }}>대상</th><th className="n" style={{ width: 130 }}>우리 부담액</th></tr></thead>
                    <tbody>{rows.slice().sort((a, b) => b.amount - a.amount).map((r, i) => <tr key={i}><td style={{ fontWeight: 600 }}>{r.from}</td><td>{r.task}</td><td className="help">{r.desc || '-'}</td><td className="help">{SPLIT_LABEL[r.split] || r.split}</td><td className="help">{r.targetCount}개 부서</td><td className="n" style={{ fontWeight: 700 }}>{fmt(r.amount)}</td></tr>)}</tbody>
                  </table></div>}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
