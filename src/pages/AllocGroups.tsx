// 배분 비율 설정(부서) — 그룹(수익이 생기는 팀)별로 어느 부서에 몇 %를 나눠 주는지
//   위: 이 달 결과 미리보기(부서별 받는 수익)  아래: 그룹 카드(비율 입력 · 금액 미리보기). 저장·검증은 기존 모듈이 수행.
import { useMemo, useState } from 'react';
import { fmt, useUI } from '../components/ui';
import { kor } from '../components/charts';
import { ymLabel } from '../lib/legacyData';
import { MonthPick, SaveBar, NumCell, useCfgTick } from '../components/settingsUi';

type Group = { key: string; label: string; depts: string[] };
type Bridge = {
  GROUPS: Group[]; GROUP_COLORS: Record<string, string>; month: () => string; setMonth: (m: string) => void;
  rows: (gk: string) => { dept: string; pct: number }[]; deptOptions: (gk: string) => string[];
  setPct: (gk: string, i: number, v: number) => void; del: (gk: string, i: number) => void; add: (gk: string, d: string) => void; equal: (gk: string) => void;
  manual: (gk: string) => string; setManual: (gk: string, v: string) => void; isDirty: () => boolean; save: () => void; applyEvery: () => void; revert: () => void;
  hasOwnMonth: (gk: string) => boolean; sourceMonth: (gk: string) => string | null; monthlyMargin: (gk: string) => Record<string, number>; manualOf: (gk: string) => number | null;
  msg: () => { text: string; cls: string }; updatedAt: () => string | null; updatedBy: () => string | null;
};
const B = () => (window as unknown as { KJHub?: { cfg?: { groups?: Bridge } } }).KJHub?.cfg?.groups;
const monthOpts = () => { const d = new Date(); let y = d.getFullYear(), m = d.getMonth() + 1; const out: string[] = []; for (let i = 0; i < 24; i++) { out.push(y + ('0' + m).slice(-2)); m--; if (m === 0) { m = 12; y--; } } return out; };

export default function AllocGroups() {
  const tick = useCfgTick('groups');
  const b = B();
  const { confirm } = useUI();
  const [focusDept, setFocusDept] = useState('');
  const month = b?.month() || '';
  const opts = useMemo(() => { const o = monthOpts(); if (month && !o.includes(month)) o.unshift(month); return o; }, [month]);

  // 이 달 미리보기: 그룹 기준 수익 × 비율 → 부서별 합계
  const view = useMemo(() => {
    if (!b) return { groups: [] as { g: Group; margin: number; manual: number | null; rows: { dept: string; pct: number; amt: number }[]; sum: number; ok: boolean; src: string | null; own: boolean }[], byDept: [] as [string, number, { g: string; amt: number; pct: number }[]][], total: 0 };
    const byDept: Record<string, { total: number; parts: { g: string; amt: number; pct: number }[] }> = {};
    const groups = b.GROUPS.map(g => {
      const mm = b.monthlyMargin(g.key); const manual = b.manualOf(g.key);
      const margin = manual != null ? manual : (mm[month] || 0);
      const rows = b.rows(g.key).map(r => { const amt = Math.round(margin * r.pct / 100); const o = byDept[r.dept] || (byDept[r.dept] = { total: 0, parts: [] }); o.total += amt; o.parts.push({ g: g.label, amt, pct: r.pct }); return { ...r, amt }; });
      const sum = rows.reduce((s, r) => s + r.pct, 0);
      return { g, margin, manual, rows, sum, ok: !rows.length || Math.abs(sum - 100) <= 0.01, src: b.sourceMonth(g.key), own: b.hasOwnMonth(g.key) };
    });
    const list = Object.entries(byDept).map(([d, v]) => [d, v.total, v.parts] as [string, number, { g: string; amt: number; pct: number }[]]).sort((x, y) => y[1] - x[1]);
    return { groups, byDept: list, total: list.reduce((s, x) => s + x[1], 0) };
  }, [b, month, tick]); // eslint-disable-line
  const maxD = Math.max(1, ...view.byDept.map(x => x[1]));
  const bad = view.groups.filter(x => !x.ok);

  if (!b) return <div className="page"><div className="card"><div className="empty"><span className="spinner" /> 설정 모듈을 준비하는 중입니다.</div></div></div>;
  return (
    <div className="page brief" style={{ gap: 16, maxWidth: 1500 }}>
      <style>{`
        .brief>*{min-width:0}
        .ag .verdict{display:grid;grid-template-columns:1fr 1.6fr;background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
        .ag .verdict>div{padding:16px 20px;min-width:0}.ag .verdict>div+div{border-left:1px solid var(--line)}
        .ag .l{font-size:12px;color:var(--fg-3)}
        .ag .big{font:800 30px/1.1 var(--font-num);letter-spacing:-.02em;margin-top:4px;font-variant-numeric:tabular-nums;color:var(--brand)}
        .ag .rk{display:grid;gap:2px;margin-top:6px;grid-template-columns:1fr 1fr;column-gap:18px}
        .ag .r{display:grid;grid-template-columns:minmax(0,1fr) 100px;gap:8px;align-items:center;padding:3px 6px;border-radius:6px;cursor:pointer;font-size:12.5px}
        .ag .r:hover,.ag .r.on{background:var(--brand-soft)}
        .ag .r .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.ag .r .nm small{font-weight:400;color:var(--fg-3);margin-left:5px}
        .ag .hb{height:6px;border-radius:999px;background:var(--surface-2);overflow:hidden;margin-top:3px}.ag .hb i{display:block;height:100%;border-radius:999px;background:#1f6fe8}
        .ag .n{text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums;font-weight:700}
        .ag .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(440px,1fr));gap:14px;align-items:start}
        .ag .gc{background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
        .ag .gc.bad{border-color:#d93c3c}
        .ag .gh{display:flex;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line);border-top:3px solid var(--c)}
        .ag .gh b{font-size:14px}.ag .gh>b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.ag .gh .sum,.ag .gh .src{white-space:nowrap}
        .ag .gh .m{margin-left:auto;text-align:right}.ag .gh .m b{font-family:var(--font-num);font-size:15px}.ag .gh .m small{display:block;color:var(--fg-3);font-size:11px}
        .ag table{width:100%;border-collapse:collapse;font-size:13px}
        .ag td{padding:5px 10px;border-bottom:1px solid var(--line)}
        .ag td.n{text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums}
        .ag .share{height:6px;background:var(--surface-2);border-radius:999px;overflow:hidden}.ag .share i{display:block;height:100%;background:var(--c);border-radius:999px}
        .ag .x{color:var(--fg-3);cursor:pointer;padding:0 4px}.ag .x:hover{color:var(--neg)}
        .ag .gf{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 10px;background:var(--surface-2)}
        .ag .sum{font-size:12px;font-weight:700;padding:2px 9px;border-radius:999px;background:#e8f5e8;color:#2c7f2c}.ag .sum.bad{background:#fdeaea;color:var(--neg)}
        .ag .src{font-size:11px;color:var(--fg-3)}.ag .src.inh{color:#9a6f00}
        @media(max-width:1000px){.ag .verdict{grid-template-columns:1fr}.ag .verdict>div+div{border-left:0;border-top:1px solid var(--line)}.ag .rk{grid-template-columns:1fr}.ag .grid{grid-template-columns:1fr}}
      `}</style>
      <div className="ag" style={{ display: 'grid', gap: 16 }}>
        <div className="page-head" style={{ alignItems: 'flex-end' }}>
          <div><h1>배분 비율 설정(부서)</h1><div className="help">구매/판매 이윤이 생기는 팀(그룹)별로, 그 수익을 어느 부서에 몇 %씩 나눠 줄지 정합니다. 비율은 기준월별로 저장되고, 설정이 없는 달은 이전 달을 승계합니다.</div></div>
          <span className="sp" />
          <MonthPick value={month} options={opts} onChange={m => b.setMonth(m)} />
        </div>

        <div className="verdict">
          <div>
            <div className="l">{ymLabel(month)} 배분되는 수익 합계 <span>(지금 입력한 비율 기준 미리보기)</span></div>
            <div className="big">{kor(view.total)}</div>
            <div className="help" style={{ marginTop: 4 }}>{fmt(view.total)}원 · 받는 부서 {view.byDept.length}곳 · 그룹 {view.groups.filter(x => x.rows.length).length}/{view.groups.length}개 설정됨</div>
            {bad.length > 0 && <div className="help" style={{ marginTop: 8, color: 'var(--neg)', fontWeight: 600 }}>합계가 100%가 아닌 그룹 {bad.length}개: {bad.map(x => x.g.label).join(', ')} — 저장되지 않습니다.</div>}
            <div className="help" style={{ marginTop: 8 }}>그룹 수익은 구매/판매 내역에서 계산된 {ymLabel(month)} 이윤입니다. 수동 수익을 입력하면 그 값을 대신 씁니다.</div>
            {b.updatedAt() && <div className="help" style={{ marginTop: 6 }}>마지막 저장 {new Date(b.updatedAt()!).toLocaleString('ko-KR')}{b.updatedBy() ? ` (${b.updatedBy()})` : ''}</div>}
          </div>
          <div>
            <div className="l">부서별 받는 수익 <span>누르면 그 부서가 들어간 그룹만 강조</span></div>
            <div className="rk">{view.byDept.map(([d, v, parts]) => <div key={d} className={'r' + (focusDept === d ? ' on' : '')} onClick={() => setFocusDept(focusDept === d ? '' : d)} title={parts.map(p => `${p.g} ${p.pct}% → ${fmt(p.amt)}`).join('\n')}><div><div className="nm">{d}<small>{parts.length}개 그룹 · {view.total ? Math.round(v / view.total * 100) : 0}%</small></div><div className="hb"><i style={{ width: Math.max(2, Math.round(v / maxD * 100)) + '%' }} /></div></div><span className="n">{fmt(v)}</span></div>)}
              {!view.byDept.length && <div className="empty">아직 설정된 비율이 없습니다. 아래 그룹 카드에서 부서를 추가하세요.</div>}</div>
          </div>
        </div>

        <div className="grid">
          {view.groups.map(x => {
            const c = b.GROUP_COLORS[x.g.key]; const dim = focusDept && !x.rows.some(r => r.dept === focusDept);
            const options = b.deptOptions(x.g.key).filter(d => !x.rows.some(r => r.dept === d));
            return (
              <div key={x.g.key} className={'gc' + (x.ok ? '' : ' bad')} style={{ ['--c' as string]: c, opacity: dim ? 0.45 : 1 }}>
                <div className="gh"><b style={{ color: c }}>{x.g.label}</b>
                  <span className={'src' + (x.own ? '' : ' inh')}>{x.own ? '이 달 설정' : x.src ? `${ymLabel(x.src)} 설정 승계` : x.rows.length ? '공통 비율 사용' : '설정 없음'}</span>
                  <span className={'sum' + (x.ok ? '' : ' bad')}>합계 {Math.round(x.sum * 100) / 100}%</span>
                  <div className="m"><b>{fmt(x.margin)}</b><small>{x.manual != null ? '수동 수익' : ymLabel(month) + ' 그룹 수익'}</small></div>
                </div>
                <table><tbody>
                  {x.rows.map((r, i) => <tr key={r.dept} style={{ background: focusDept === r.dept ? 'var(--brand-soft)' : undefined }}>
                    <td style={{ fontWeight: 600, width: '36%' }}>{r.dept}</td>
                    <td style={{ width: 90 }}><NumCell value={r.pct} onCommit={v => b.setPct(x.g.key, i, v ?? 0)} width={76} /></td>
                    <td style={{ width: 24, color: 'var(--fg-3)' }}>%</td>
                    <td><div className="share"><i style={{ width: Math.min(100, Math.max(0, r.pct)) + '%' }} /></div></td>
                    <td className="n" style={{ width: 110 }}>{fmt(r.amt)}</td>
                    <td style={{ width: 28 }}><span className="x" title="삭제" onClick={() => b.del(x.g.key, i)}>×</span></td>
                  </tr>)}
                  {!x.rows.length && <tr><td colSpan={6} className="help" style={{ padding: 10 }}>아직 부서가 없습니다. 아래에서 추가하세요.</td></tr>}
                </tbody></table>
                <div className="gf">
                  <select className="inp" value="" onChange={e => { if (e.target.value) b.add(x.g.key, e.target.value); }}><option value="">+ 부서 추가…</option>{options.map(d => <option key={d} value={d}>{d}</option>)}</select>
                  <button className="btn sm" onClick={() => b.equal(x.g.key)} disabled={!x.rows.length}>균등 배분</button>
                  <span className="sp" />
                  <span className="help">수동 수익</span>
                  <NumCell value={b.manual(x.g.key) === '' ? null : Number(b.manual(x.g.key))} onCommit={v => b.setManual(x.g.key, v == null ? '' : String(v))} placeholder="비우면 자동" width={120} />
                </div>
              </div>
            );
          })}
        </div>

        <SaveBar dirty={b.isDirty()} msg={b.msg()} onSave={() => b.save()} onRevert={() => b.revert()} saveLabel={`${ymLabel(month)} 저장`} note="저장은 선택한 기준월에만 적용됩니다.">
          <button className="btn" onClick={async () => { if (await confirm('전체 일괄 적용', '현재 입력한 비율을 최근 24개월 전체에 적용하고 저장합니다. 기존 월별 설정도 덮어씁니다.', { okText: '적용하고 저장' })) b.applyEvery(); }}>전체 월 일괄 적용</button>
        </SaveBar>
      </div>
    </div>
  );
}
