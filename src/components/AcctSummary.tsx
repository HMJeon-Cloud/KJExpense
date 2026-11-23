// 회사 전체 손익 (회계 기준) — 손익 현황 화면 맨 위
//   · 마감 완료 월: [손익계산서 올리기]로 올린 ERP 손익계산서 금액 그대로 ("확정")
//   · 그 밖의 달 : 앱 계산 ("추정") — 매출액 = 판매 + 결산 매출, 매출원가 = 판매분 LOT 원가 + 음성공장 제조비용(판매분), 판관비 = 전표
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmt } from './ui';
import { HelpDot } from './Help';
import { MonthBars } from './charts';
import { Delta, won, swon, ymText, shiftYm } from './kit';
import { usePl, plMonth } from '../lib/plStmt';
import { pnlOf, pnlSum, gpRate, opRate, sgaRate, opBridge, ytdMonths, lastYear, type AcctModel, type AcctRow, type Pnl } from '../lib/pnl';
export type { AcctModel, AcctRow };

const p1 = (v: number | null) => (v == null ? '-' : v.toFixed(1) + '%');

export default function AcctSummary({ acct, cur, isAdmin }: { acct: AcctModel; cur: string; isAdmin: boolean }) {
  const pl = usePl();
  const nav = useNavigate();
  const [more, setMore] = useState(false);
  const d = useMemo(() => {
    const c = pnlOf(acct, pl, cur); if (!c) return null;
    // 기준월이 추정이면 전월·전년 동월도 추정끼리 비교 (확정과 추정을 섞어 비교하지 않음). 누적은 확정 월 + 추정 월.
    const est = c.nOff === 0;
    const p = pnlOf(acct, pl, shiftYm(cur, -1), est), ly = pnlOf(acct, pl, lastYear(cur), est);
    const ytdM = ytdMonths(cur), ytd = pnlSum(acct, pl, ytdM), lyAll = pnlSum(acct, pl, ytdM.map(lastYear));
    const lytd = lyAll && lyAll.n === ytdM.length ? lyAll : null;   // 전년 같은 기간이 모두 있을 때만 비교
    const why = opBridge(c, p);
    const series = ytdM.map(m => ({ m, v: pnlOf(acct, pl, m) }));
    const q: { q: number; op: number; full: boolean; off: boolean }[] = [];
    for (let k = 0; k < 4; k++) { const ms = ytdM.filter(m => Math.floor((+m.slice(4) - 1) / 3) === k); if (!ms.length) continue; const v = pnlSum(acct, pl, ms); if (v) q.push({ q: k + 1, op: v.op, full: ms.length === 3, off: v.nOff === v.n }); }
    const ar = ytdM.map(m => acct.rows[m]).filter(Boolean) as AcctRow[];
    const ref = { pool: ar.reduce((s, r) => s + r.pool, 0), oh: ar.reduce((s, r) => s + r.oh, 0), disp: ar.reduce((s, r) => s + r.disp, 0), dispCur: acct.rows[cur]?.disp || 0 };
    const l3 = series.slice(-3).filter(x => x.v); const r3 = l3.length === 3 ? l3.reduce((a, x) => a + x.v!.op, 0) / 3 : null;
    return { c, p, ly, ytd, lytd, why, series, q, ref, est, estRow: acct.rows[cur], mm: +cur.slice(4), y: cur.slice(0, 4), pOff: plMonth(pl, shiftYm(cur, -1)), r3 };
  }, [acct, cur, pl]);
  if (!d) return null;
  const { c, p, ly, ytd, lytd } = d;
  const official = !d.est;

  const cell = (v: number | null | undefined) => (v == null ? <td className="mut">-</td> : <td style={{ color: v < 0 ? 'var(--red-2)' : undefined }}>{fmt(Math.round(v))}</td>);
  const diff = (a: number | null | undefined, b: number | null | undefined, invert = false) => <td><Delta cur={a} prev={b} invert={invert} mode="both" /></td>;
  const pcell = (v: number | null) => (v == null ? <td className="mut">-</td> : <td style={{ color: v < 0 ? 'var(--red-2)' : 'var(--fg-2)' }}>{v.toFixed(1)}%</td>);
  const pdiff = (a: number | null, b: number | null) => <td><Delta cur={a} prev={b} mode="pp" /></td>;
  const line = (label: string, k: 'sales' | 'cogs' | 'gp' | 'sga' | 'op' | 'net', o: { strong?: boolean; invert?: boolean } = {}) => (
    <tr className={o.strong ? 'total' : ''}>
      <td>{label}</td>{cell(c[k])}<td className="g" style={{ padding: 0, width: 0 }} />{cell(p?.[k])}{diff(c[k], p?.[k], o.invert)}<td className="g" style={{ padding: 0, width: 0 }} />{cell(ly?.[k])}{diff(c[k], ly?.[k], o.invert)}<td className="g" style={{ padding: 0, width: 0 }} />{cell(ytd?.[k])}{cell(lytd?.[k])}{diff(ytd?.[k], lytd?.[k], o.invert)}
    </tr>
  );
  const rline = (label: string, f: (v: Pnl | null) => number | null) => (
    <tr className="sub"><td>{label}</td>{pcell(f(c))}<td className="g" style={{ padding: 0, width: 0 }} />{pcell(f(p))}{pdiff(f(c), f(p))}<td className="g" style={{ padding: 0, width: 0 }} />{pcell(f(ly))}{pdiff(f(c), f(ly))}<td className="g" style={{ padding: 0, width: 0 }} />{pcell(f(ytd))}{pcell(f(lytd))}{pdiff(f(ytd), f(lytd))}</tr>
  );

  // 짚어볼 점 (자동 문장)
  const pts: { t: string; b: string }[] = [];
  if (ytd) {
    const avg = ytd.op / ytd.n;
    pts.push({ t: '연간 전망', b: `올해 누적 영업이익 ${won(ytd.op)} (월평균 ${won(avg)}). 같은 속도면 연간 약 ${won(avg * 12)}${d.r3 != null && ytd.n > 3 ? `, 최근 3개월 속도면 약 ${won(ytd.op + d.r3 * (12 - ytd.n))}` : ''}입니다.` });
    if (ytd.sales && ytd.gp > 0) {
      const be = (ytd.sga / ytd.n) / (ytd.gp / ytd.sales), avgS = ytd.sales / ytd.n;
      pts.push({ t: '손익분기 매출', b: `월 매출이 ${won(be)}을 넘어야 판관비를 감당합니다. 올해 월평균 매출은 ${won(avgS)} — ${avgS >= be ? `매출이 ${((1 - be / avgS) * 100).toFixed(0)}% 줄어도 적자가 아닙니다.` : `손익분기까지 월 ${won(be - avgS)} 부족합니다.`}` });
    }
  }
  if (gpRate(c) != null && gpRate(ytd) != null) { const g = gpRate(c)! - gpRate(ytd)!; if (Math.abs(g) >= 1) pts.push({ t: '매출총이익률', b: `${d.mm}월 ${p1(gpRate(c))}로 올해 평균(${p1(gpRate(ytd))})보다 ${Math.abs(g).toFixed(1)}%p ${g > 0 ? '높습니다.' : '낮습니다. 품목 구성·판매 단가·원가를 확인할 달입니다.'}` }); }
  if (d.q.length > 1) pts.push({ t: '분기 흐름', b: d.q.map(x => `${x.q}분기${x.full ? '' : '(진행 중)'} ${won(x.op)}`).join(' → ') + '. 분기 마지막 달은 결산 조정이 몰려 월 금액이 출렁이므로 분기·누적으로 보세요.' });

  return (
    <section className="card acs">
      <style>{`
        .acs .top{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-top:14px}
        .acs .top>div{padding:14px 20px;border-right:1px solid var(--line);min-width:0}.acs .top>div:last-child{border-right:0}
        .acs .top .l{font-size:12.5px;color:var(--fg-3)}.acs .top .v{font-size:24px;font-weight:800;letter-spacing:-.025em;font-variant-numeric:tabular-nums;line-height:1.2;margin-top:2px}.acs .top .s{font-size:12.5px;color:var(--fg-3);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap}
        .acs .t td:first-child,.acs .t th:first-child{position:sticky;left:0;z-index:1;background:var(--surface)}.acs .t th:first-child{background:var(--surface-2)}.acs .t tr.total td:first-child{background:var(--surface-2)}
        .acs .t tr.sub td{font-size:12.5px;padding-block:6px}.acs .t tr.sub td:first-child{padding-left:26px;background:color-mix(in srgb,var(--surface-2) 60%,var(--surface))}
        .acs .t th.g{padding:0;width:0;border-left:1px solid var(--line)}
        .acs .grid2{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);border-top:1px solid var(--line)}
        .acs .grid2>div{padding:16px 20px;min-width:0}.acs .grid2>div+div{border-left:1px solid var(--line)}
        .acs h3{font-size:13.5px;font-weight:700;margin-bottom:8px}
        .acs .pt{display:grid;grid-template-columns:104px minmax(0,1fr);gap:10px;font-size:13.5px;line-height:1.6;padding:7px 0;border-bottom:1px solid var(--line);color:var(--fg-2)}
        .acs .pt:last-child{border-bottom:0}.acs .pt b{color:var(--fg);font-weight:600}
        .acs .wf{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 12px;font-size:13.5px;margin-top:6px}
        .acs .wf span:nth-child(even){font-variant-numeric:tabular-nums;font-weight:600;text-align:right}
        .acs .ft{padding:11px 20px;border-top:1px solid var(--line);font-size:12.5px;color:var(--fg-3);line-height:1.65;background:var(--surface-2)}
        @media(max-width:900px){.acs .top{grid-template-columns:repeat(2,minmax(0,1fr))}.acs .top>div:nth-child(2){border-right:0}.acs .top>div:nth-child(-n+2){border-bottom:1px solid var(--line)}.acs .top>div{padding:12px 14px}.acs .top .v{font-size:20px}.acs .grid2{grid-template-columns:1fr}.acs .grid2>div+div{border-left:0;border-top:1px solid var(--line)}.acs .grid2>div{padding:14px}.acs .pt{grid-template-columns:1fr;gap:0}.acs .ft{padding:11px 14px}}
      `}</style>
      <div className="card-h">
        <h2>회사 전체 손익<HelpDot id="bu-real.acct" /></h2>
        <span className={'badge ' + (official ? 'ok' : 'est')}>{official ? '확정 · 손익계산서' : '추정 · 마감 전'}</span>
        <span className="d">{ymText(cur)}</span>
        <span className="sp" />
        {isAdmin && <button className="btn sm ghost" onClick={() => nav('/settings/pl')}>손익계산서 올리기 →</button>}
      </div>
      <div className="top">
        <div><div className="l">매출액</div><div className="v">{won(c.sales)}</div><div className="s"><Delta cur={c.sales} prev={p?.sales} label="전월" mode="pct" /></div></div>
        <div><div className="l">매출총이익</div><div className="v" style={{ color: c.gp < 0 ? 'var(--red-2)' : undefined }}>{won(c.gp)}</div><div className="s">이익률 {p1(gpRate(c))}</div></div>
        <div><div className="l">판매비와 관리비</div><div className="v">{won(c.sga)}</div><div className="s">매출의 {p1(sgaRate(c))}</div></div>
        <div style={{ background: c.op >= 0 ? 'var(--green-soft)' : 'var(--red-soft)' }}><div className="l">영업이익</div><div className="v" style={{ color: c.op >= 0 ? 'var(--green-2)' : 'var(--red-2)' }}>{swon(c.op)}</div><div className="s">이익률 {p1(opRate(c))}<Delta cur={c.op} prev={p?.op} label="전월" /></div></div>
      </div>
      <div className="tbl-wrap">
        <table className="t">
          <thead><tr><th>구분</th><th>{d.mm}월</th><th className="g" /><th>전월</th><th>증감</th><th className="g" /><th>전년 동월</th><th>증감</th><th className="g" /><th>올해 누적 (1~{d.mm}월){ytd && ytd.nOff > 0 && ytd.nOff < ytd.n ? <small> 확정 {ytd.nOff} + 추정 {ytd.n - ytd.nOff}</small> : null}</th><th>전년 같은 기간</th><th>증감</th></tr></thead>
          <tbody>
            {line('매출액', 'sales')}
            {line('매출원가', 'cogs', { invert: true })}
            {line('매출총이익', 'gp', { strong: true })}
            {rline('매출총이익률', gpRate)}
            {line('판매비와 관리비', 'sga', { invert: true })}
            {line('영업이익', 'op', { strong: true })}
            {rline('영업이익률', opRate)}
            {(c.net != null || ytd?.net != null) && line('당기순이익', 'net')}
          </tbody>
        </table>
      </div>
      <div className="grid2">
        <div>
          <h3>짚어볼 점</h3>
          {pts.map((x, i) => <div key={i} className="pt"><b>{x.t}</b><span>{x.b}</span></div>)}
          {!pts.length && <div className="help">비교할 달이 아직 없습니다.</div>}
        </div>
        <div>
          <h3>{d.y}년 월별 영업이익 <small className="help" style={{ fontWeight: 400 }}>빗금 = 추정(마감 전)</small></h3>
          <MonthBars mode="sign" height={150} label="월별 영업이익" items={d.series.map(s => ({ m: s.m, v: s.v ? s.v.op : null, est: s.v ? s.v.nOff === 0 : false }))} />
          {d.why && p && (
            <div style={{ marginTop: 12 }}>
              <h3>전월과 달라진 이유</h3>
              <div className="wf">
                <span>{+shiftYm(cur, -1).slice(4)}월 영업이익</span><span>{fmt(Math.round(p.op))}</span>
                <span className="mut">매출이 {c.sales! >= p.sales! ? '늘어서' : '줄어서'}</span><span className={d.why.sales >= 0 ? 'pos' : 'neg'}>{swon(d.why.sales)}</span>
                <span className="mut">매출총이익률이 {d.why.rate >= 0 ? '올라서' : '내려서'} ({p1(gpRate(p))} → {p1(gpRate(c))})</span><span className={d.why.rate >= 0 ? 'pos' : 'neg'}>{swon(d.why.rate)}</span>
                <span className="mut">판관비가 {d.why.sga >= 0 ? '줄어서' : '늘어서'}</span><span className={d.why.sga >= 0 ? 'pos' : 'neg'}>{swon(d.why.sga)}</span>
                <span style={{ fontWeight: 700 }}>{d.mm}월 영업이익</span><span style={{ fontWeight: 800 }}>{fmt(Math.round(c.op))}</span>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="ft">
        <b style={{ color: 'var(--fg-2)' }}>확정</b>은 ERP 손익계산서 금액 그대로이고, <b style={{ color: 'var(--fg-2)' }}>추정</b>은 앱이 구매·판매·전표로 계산한 값입니다(결산 조정 전이라 확정과 다를 수 있음).
        {official && d.estRow && <> {d.mm}월 추정 {fmt(Math.round(d.estRow.op))} → 확정 {fmt(Math.round(c.op))} (회계 조정 {swon(c.op - d.estRow.op)}).</>}
        {d.est && d.pOff && <> 기준월이 추정이라 전월·전년 동월도 추정값끼리 비교했습니다 (전월 확정 영업이익 {fmt(Math.round(d.pOff.op))}).</>}
        {!official && (pl === null || !pl?.closedThrough) && <> 아직 올린 손익계산서가 없습니다.</>}
        {!acct.hasDb && <> ※ 회계 기준 집계(0011 SQL)가 없어 매출액·음성공장 제조비용이 빠져 있습니다.</>}
        {' '}<button className="btn link" style={{ fontSize: 12.5 }} onClick={() => setMore(v => !v)}>{more ? '참고 숫자 접기' : '참고 숫자 보기'}</button>
        {more && (
          <div style={{ marginTop: 6 }}>
            · 음성공장 제조비용(소재 제품에 얹는 노무비·경비): 올해 발생 {fmt(Math.round(d.ref.pool))}, 그중 판매되어 매출원가로 반영 {fmt(Math.round(d.ref.oh))}. 차이는 재고에 남았거나 전년 재고가 팔린 몫입니다.<br />
            · 폐기(수량 × LOT 원가): {d.mm}월 {fmt(Math.round(d.ref.dispCur))}, 올해 누적 {fmt(Math.round(d.ref.disp))}. 손익계산서에서는 매출원가 밖에서 처리되어 영업이익에 들어 있지 않습니다.
          </div>
        )}
      </div>
    </section>
  );
}
