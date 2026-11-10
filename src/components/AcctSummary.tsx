// 손익 요약 (회계 기준) — 국전 수익/비용(실현 수익) 화면 맨 위, 경영진용
//   · 마감 완료 월: [설정 › 손익계산서 올리기] 로 올린 ERP 손익계산서 금액 그대로 ("확정")
//   · 그 밖의 달 : 앱 계산 ("추정") — 매출액 = 판매 + 결산 매출, 매출원가 = 판매분 LOT 원가 + 음성공장 제조비용(판매분), 판관비 = 전표
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmt } from './ui';
import { HelpDot } from './Help';
import { kor, ymL } from './charts';
import { plMonth, usePl } from '../lib/plStmt';

export type AcctRow = { sales: number | null; gp: number; sga: number; op: number; oh: number; pool: number; disp: number; settle: number };
export type AcctModel = { hasDb: boolean; months: string[]; rows: Record<string, AcctRow> };
type V = { sales: number | null; cogs: number | null; gp: number; sga: number; op: number; net: number | null; n: number; nOff: number };

const shift = (ym: string, d: number) => { const y = +ym.slice(0, 4), m = +ym.slice(4, 6) - 1 + d; return (y + Math.floor(m / 12)) + String((((m % 12) + 12) % 12) + 1).padStart(2, '0'); };
const pct = (a: number, b: number | null) => (b && b !== 0 ? Math.round((a / b) * 1000) / 10 : null);
const sgn = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + kor(Math.abs(v));
const pp = (a: number | null, b: number | null) => (a == null || b == null ? null : Math.round((a - b) * 10) / 10);

export default function AcctSummary({ acct, cur, isAdmin }: { acct: AcctModel; cur: string; isAdmin: boolean }) {
  const pl = usePl();
  const nav = useNavigate();
  const [more, setMore] = useState(false);
  const d = useMemo(() => {
    const one = (ym: string, est = false): V | null => {
      const o = est ? null : plMonth(pl, ym);
      if (o) return { sales: o.sales, cogs: o.cogs, gp: o.gp, sga: o.sga, op: o.op, net: o.net, n: 1, nOff: 1 };
      const r = acct.rows[ym]; if (!r) return null;
      return { sales: r.sales, cogs: r.sales == null ? null : r.sales - r.gp, gp: r.gp, sga: r.sga, op: r.op, net: null, n: 1, nOff: 0 };
    };
    const add = (yms: string[]): V | null => {
      let out: V | null = null;
      yms.forEach(m => { const v = one(m); if (!v) return;
        if (!out) { out = { ...v }; return; }
        out = { sales: out.sales == null || v.sales == null ? null : out.sales + v.sales, cogs: out.cogs == null || v.cogs == null ? null : out.cogs + v.cogs, gp: out.gp + v.gp, sga: out.sga + v.sga, op: out.op + v.op, net: out.net == null || v.net == null ? null : out.net + v.net, n: out.n + 1, nOff: out.nOff + v.nOff };
      });
      return out;
    };
    const y = cur.slice(0, 4), mm = +cur.slice(4, 6);
    const ytdM = Array.from({ length: mm }, (_, i) => y + String(i + 1).padStart(2, '0'));
    const lyM = ytdM.map(m => (+m.slice(0, 4) - 1) + m.slice(4));
    const c = one(cur);
    // 기준월이 추정이면 전월·전년 동월도 추정끼리 비교 (확정과 추정을 섞어 비교하지 않음). 누적은 확정 월 + 추정 월.
    const estBase = !!c && c.nOff === 0;
    const p = one(shift(cur, -1), estBase), ly = one(shift(cur, -12), estBase), ytd = add(ytdM), lytd = add(lyM);
    const lyFull = lytd && lytd.n === ytdM.length ? lytd : null;   // 전년 같은 기간이 모두 있을 때만 비교
    // 영업이익이 전월보다 왜 달라졌나: 매출 효과(전월 이익률로 매출만 변했다면) + 이익률 효과 + 판관비 효과
    let why: { sales: number; rate: number; sga: number } | null = null;
    if (c && p && c.sales != null && p.sales != null && p.sales !== 0 && c.sales !== 0) {
      const pr = p.gp / p.sales, cr = c.gp / c.sales;
      why = { sales: (c.sales - p.sales) * pr, rate: (cr - pr) * c.sales, sga: -(c.sga - p.sga) };
    }
    const series = ytdM.map(m => ({ m, v: one(m) }));
    const q: { q: number; op: number; sales: number | null; full: boolean; off: boolean }[] = [];
    for (let k = 0; k < 4; k++) { const ms = ytdM.filter(m => Math.floor((+m.slice(4) - 1) / 3) === k); if (!ms.length) continue; const v = add(ms); if (v) q.push({ q: k + 1, op: v.op, sales: v.sales, full: ms.length === 3, off: v.nOff === v.n }); }
    // 참고 수치 (앱 계산)
    const ar = ytdM.map(m => acct.rows[m]).filter(Boolean) as AcctRow[];
    const ref = { pool: ar.reduce((s, r) => s + r.pool, 0), oh: ar.reduce((s, r) => s + r.oh, 0), disp: ar.reduce((s, r) => s + r.disp, 0), dispCur: acct.rows[cur]?.disp || 0 };
    const est = acct.rows[cur];
    return { c, p, ly, ytd, lytd: lyFull, why, series, q, ref, est, mm, y, estBase, pOff: plMonth(pl, shift(cur, -1)) };
  }, [acct, cur, pl]);

  const { c, p, ly, ytd, lytd } = d;
  if (!c) return null;
  const official = c.nOff === 1;
  const rate = (v: V | null) => (v ? pct(v.op, v.sales) : null);
  const gpr = (v: V | null) => (v ? pct(v.gp, v.sales) : null);
  const cell = (v: number | null | undefined, neg = true) => (v == null ? <td className="mut">-</td> : <td style={{ color: neg && v < 0 ? 'var(--neg)' : undefined }}>{fmt(Math.round(v))}</td>);
  const diff = (a: number | null | undefined, b: number | null | undefined, invert = false) => {
    if (a == null || b == null) return <td className="mut">-</td>;
    const v = a - b; const good = invert ? v < 0 : v > 0;
    return <td style={{ color: v === 0 ? 'var(--fg-3)' : good ? '#2c7f2c' : '#b32b2b', fontWeight: 600 }}>{sgn(v)}{b !== 0 && <small style={{ fontWeight: 400, marginLeft: 4 }}>{(v / Math.abs(b) * 100).toFixed(0)}%</small>}</td>;
  };
  const pcell = (v: number | null) => (v == null ? <td className="mut">-</td> : <td style={{ color: v < 0 ? 'var(--neg)' : 'var(--fg-2)' }}>{v.toFixed(1)}%</td>);
  const pdiff = (a: number | null, b: number | null) => { const v = pp(a, b); return v == null ? <td className="mut">-</td> : <td style={{ color: v === 0 ? 'var(--fg-3)' : v > 0 ? '#2c7f2c' : '#b32b2b' }}>{(v > 0 ? '+' : '') + v.toFixed(1)}%p</td>; };
  const line = (label: string, k: 'sales' | 'cogs' | 'gp' | 'sga' | 'op' | 'net', o: { strong?: boolean; invert?: boolean; sub?: boolean } = {}) => (
    <tr className={o.strong ? 'st' : o.sub ? 'sb' : ''}>
      <td>{label}</td>{cell(c[k])}{cell(p?.[k])}{diff(c[k], p?.[k], o.invert)}{cell(ly?.[k])}{diff(c[k], ly?.[k], o.invert)}{cell(ytd?.[k])}{cell(lytd?.[k])}{diff(ytd?.[k], lytd?.[k], o.invert)}
    </tr>
  );
  const rline = (label: string, f: (v: V | null) => number | null) => (
    <tr className="rt"><td>{label}</td>{pcell(f(c))}{pcell(f(p))}{pdiff(f(c), f(p))}{pcell(f(ly))}{pdiff(f(c), f(ly))}{pcell(f(ytd))}{pcell(f(lytd))}{pdiff(f(ytd), f(lytd))}</tr>
  );
  const badge = (off: boolean) => <span className={'bdg ' + (off ? 'ok' : 'est')}>{off ? '확정 · 손익계산서' : '추정 · 앱 계산'}</span>;

  // 경영 포인트 (자동 문장)
  const pts: { t: string; b: string }[] = [];
  if (ytd) {
    const avg = ytd.op / ytd.n;
    pts.push({ t: `올해 누적 (1~${d.mm}월)`, b: `영업이익 ${kor(ytd.op)}${rate(ytd) != null ? ` (이익률 ${rate(ytd)!.toFixed(1)}%)` : ''}, 월평균 ${kor(avg)}. 남은 달도 같은 속도라면 연간 약 ${kor(avg * 12)} 입니다.${lytd ? ` 전년 같은 기간(${kor(lytd.op)})보다 ${sgn(ytd.op - lytd.op)}.` : ''}` });
    if (ytd.sales && ytd.gp > 0) {
      const be = (ytd.sga / ytd.n) / (ytd.gp / ytd.sales), avgS = ytd.sales / ytd.n;
      pts.push({ t: '손익분기 매출', b: `판관비(월평균 ${kor(ytd.sga / ytd.n)})를 감당하려면 매출이 월 ${kor(be)} 이상이어야 합니다. 올해 월평균 매출 ${kor(avgS)} — ${avgS >= be ? `매출이 ${((1 - be / avgS) * 100).toFixed(0)}% 줄어도 적자가 아닙니다.` : `손익분기까지 월 ${kor(be - avgS)} 부족합니다.`}` });
    }
  }
  if (d.why && p) {
    const w = d.why; const parts = [['매출 증감', w.sales], ['이익률(매출총이익률) 변화', w.rate], ['판관비 증감', w.sga]] as [string, number][];
    const top = parts.slice().sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
    pts.push({ t: '전월 대비 변동 원인', b: `영업이익이 전월보다 ${sgn(c.op - p.op)} — 가장 큰 원인은 ${top[0]} (${sgn(top[1])}) 입니다.` });
  }
  if (gpr(c) != null && gpr(ytd) != null) { const g = pp(gpr(c), gpr(ytd))!; if (Math.abs(g) >= 1) pts.push({ t: '매출총이익률', b: `${ymL(cur)} ${gpr(c)!.toFixed(1)}% — 올해 평균(${gpr(ytd)!.toFixed(1)}%)보다 ${g > 0 ? '+' : ''}${g.toFixed(1)}%p ${g > 0 ? '높습니다' : '낮습니다. 품목 구성·판매 단가·원가를 확인해 볼 달입니다'}.` }); }
  if (d.q.length > 1) pts.push({ t: '분기 흐름', b: d.q.map(x => `${x.q}분기${x.full ? '' : '(진행 중)'} ${kor(x.op)}`).join(' → ') + '. 분기 마지막 달(3·6·9·12월)은 결산 조정이 한꺼번에 반영되어 월 단위로는 출렁이므로, 분기·누적으로 보는 것이 정확합니다.' });

  const maxAbs = Math.max(1, ...d.series.map(s => Math.abs(s.v?.op || 0)));
  return (
    <section className="card acs" style={{ padding: 0, overflow: 'hidden' }}>
      <style>{`
        .acs .hd{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:14px 18px 10px}
        .acs .hd h2{font-size:16px;font-weight:700}
        .acs .bdg{font-size:11.5px;font-weight:700;padding:2px 9px;border-radius:999px;white-space:nowrap}
        .acs .bdg.ok{background:#e6f4e6;color:#226a22}.acs .bdg.est{background:#fff3d6;color:#8a6200}
        .acs .top{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
        .acs .top>div{padding:12px 18px;border-right:1px solid var(--line);min-width:0}.acs .top>div:last-child{border-right:0}
        .acs .top .l{font-size:12px;color:var(--fg-3)}.acs .top .v{font:700 22px var(--font-num);letter-spacing:-.01em}.acs .top .s{font-size:12px;color:var(--fg-2);margin-top:2px}
        .acs table{width:100%;border-collapse:collapse;font-size:13px}
        .acs th{font-weight:500;color:var(--fg-3);font-size:11.5px;text-align:right;padding:7px 10px;border-bottom:1px solid var(--line);white-space:nowrap;background:var(--surface-2)}
        .acs th:first-child,.acs td:first-child{text-align:left}
        .acs td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums;white-space:nowrap}
        .acs td:first-child{font-family:var(--font-body)}
        .acs tr.st td{font-weight:700;background:#fafbfd}.acs tr.rt td{font-size:12px;color:var(--fg-2);border-bottom-color:var(--line)}.acs tr.rt td:first-child{padding-left:22px}
        .acs td.mut{color:var(--fg-3)}.acs th.g,.acs td.g{border-left:1px solid var(--line)}
        .acs .grid2{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:0}
        .acs .grid2>div{padding:14px 18px;min-width:0}.acs .grid2>div+div{border-left:1px solid var(--line)}
        .acs h3{font-size:13px;font-weight:700;margin-bottom:8px}
        .acs .pt{display:grid;grid-template-columns:118px minmax(0,1fr);gap:10px;font-size:13px;line-height:1.55;padding:5px 0;border-bottom:1px dashed var(--line)}
        .acs .pt:last-child{border-bottom:0}.acs .pt b{color:var(--fg-2);font-weight:600}
        .acs .bars{display:flex;align-items:stretch;gap:6px;height:120px}
        .acs .bars .b{flex:1;display:flex;flex-direction:column;align-items:center;min-width:0}
        .acs .bars .up,.acs .bars .dn{flex:1;width:100%;display:flex;justify-content:center}
        .acs .bars .up{align-items:flex-end;border-bottom:1px solid var(--line-2)}.acs .bars .dn{align-items:flex-start}
        .acs .bars i{display:block;width:70%;max-width:34px;border-radius:3px 3px 0 0}.acs .bars .dn i{border-radius:0 0 3px 3px}
        .acs .bars small{font-size:10.5px;color:var(--fg-3);white-space:nowrap}
        .acs .wf{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;font-size:13px}
        .acs .wf span:nth-child(even){font-family:var(--font-num);font-weight:600;text-align:right}
        .acs .ft{padding:10px 18px;border-top:1px solid var(--line);font-size:12px;color:var(--fg-3);line-height:1.6;background:var(--surface-2)}
        @media(max-width:900px){.acs .top{grid-template-columns:repeat(2,minmax(0,1fr))}.acs .top>div:nth-child(2){border-right:0}.acs .top>div:nth-child(-n+2){border-bottom:1px solid var(--line)}.acs .grid2{grid-template-columns:1fr}.acs .grid2>div+div{border-left:0;border-top:1px solid var(--line)}.acs .pt{grid-template-columns:1fr;gap:0}}
      `}</style>
      <div className="hd">
        <h2>손익 요약 (회계 기준)<HelpDot id="bu-real.acct" /></h2>
        {badge(official)}
        <span className="help">{ymL(cur)} · 손익계산서와 같은 순서 (매출액 → 매출원가 → 매출총이익 → 판관비 → 영업이익)</span>
        <span className="sp" />
        {isAdmin && <button className="btn sm ghost" onClick={() => nav('/settings/pl')}>손익계산서 올리기 →</button>}
      </div>
      <div className="top">
        <div><div className="l">매출액</div><div className="v">{c.sales == null ? '-' : kor(c.sales)}</div><div className="s">{p?.sales != null && c.sales != null ? `전월비 ${sgn(c.sales - p.sales)}` : ' '}</div></div>
        <div><div className="l">매출총이익</div><div className="v" style={{ color: c.gp < 0 ? 'var(--neg)' : undefined }}>{kor(c.gp)}</div><div className="s">{gpr(c) != null ? `이익률 ${gpr(c)!.toFixed(1)}%` : ' '}</div></div>
        <div><div className="l">판매비와 관리비</div><div className="v">{kor(c.sga)}</div><div className="s">{pct(c.sga, c.sales) != null ? `매출의 ${pct(c.sga, c.sales)!.toFixed(1)}%` : ' '}</div></div>
        <div style={{ background: c.op >= 0 ? '#f3faf3' : '#fdf3f3' }}><div className="l">영업이익</div><div className="v" style={{ color: c.op >= 0 ? '#2c7f2c' : '#b32b2b' }}>{(c.op >= 0 ? '+' : '−') + kor(Math.abs(c.op))}</div><div className="s">{rate(c) != null ? `이익률 ${rate(c)!.toFixed(1)}%` : ''}{p ? ` · 전월비 ${sgn(c.op - p.op)}` : ''}</div></div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>구분</th><th>{ymL(cur)}</th><th className="g">전월</th><th>증감</th><th className="g">전년 동월</th><th>증감</th><th className="g">올해 누적 (1~{d.mm}월){ytd && ytd.nOff > 0 && ytd.nOff < ytd.n ? <small> 확정 {ytd.nOff} + 추정 {ytd.n - ytd.nOff}개월</small> : null}</th><th>전년 같은 기간</th><th>증감</th></tr></thead>
          <tbody>
            {line('매출액', 'sales')}
            {line('매출원가', 'cogs', { invert: true })}
            {line('매출총이익', 'gp', { strong: true })}
            {rline('매출총이익률', gpr)}
            {line('판매비와 관리비', 'sga', { invert: true })}
            {line('영업이익', 'op', { strong: true })}
            {rline('영업이익률', rate)}
            {(c.net != null || ytd?.net != null) && line('당기순이익', 'net')}
          </tbody>
        </table>
      </div>
      <div className="grid2">
        <div>
          <h3>경영 포인트</h3>
          {pts.map((x, i) => <div key={i} className="pt"><b>{x.t}</b><span>{x.b}</span></div>)}
          {!pts.length && <div className="help">비교할 달이 아직 없습니다.</div>}
        </div>
        <div>
          <h3>{d.y}년 월별 영업이익 <small className="help" style={{ fontWeight: 400 }}>진한 색 = 확정, 연한 색 = 추정</small></h3>
          <div className="bars">
            {d.series.map(s => { const v = s.v?.op || 0, off = s.v?.nOff === 1; const h = Math.max(v ? 3 : 0, Math.round(Math.abs(v) / maxAbs * 100)); const col = v >= 0 ? (off ? '#2f8f2f' : '#a9d8a9') : (off ? '#d93c3c' : '#f0b0b0');
              return <div key={s.m} className="b" title={`${ymL(s.m)} 영업이익 ${fmt(Math.round(v))} (${off ? '확정' : '추정'})`}><div className="up">{v > 0 && <i style={{ height: h + '%', background: col }} />}</div><div className="dn">{v < 0 && <i style={{ height: h + '%', background: col }} />}</div><small>{+s.m.slice(4)}월</small><small style={{ color: v < 0 ? 'var(--neg)' : 'var(--fg-2)', fontFamily: 'var(--font-num)' }}>{s.v ? kor(v) : '-'}</small></div>; })}
          </div>
          {d.why && p && (
            <div style={{ marginTop: 14 }}>
              <h3>영업이익이 전월과 달라진 이유</h3>
              <div className="wf">
                <span>{ymL(shift(cur, -1))} 영업이익</span><span>{fmt(Math.round(p.op))}</span>
                <span className="help">① 매출이 {c.sales! >= p.sales! ? '늘어서' : '줄어서'} (전월 이익률 기준)</span><span style={{ color: d.why.sales >= 0 ? '#2c7f2c' : '#b32b2b' }}>{sgn(d.why.sales)}</span>
                <span className="help">② 매출총이익률이 {d.why.rate >= 0 ? '올라서' : '내려서'} ({gpr(p)?.toFixed(1)}% → {gpr(c)?.toFixed(1)}%)</span><span style={{ color: d.why.rate >= 0 ? '#2c7f2c' : '#b32b2b' }}>{sgn(d.why.rate)}</span>
                <span className="help">③ 판관비가 {d.why.sga >= 0 ? '줄어서' : '늘어서'}</span><span style={{ color: d.why.sga >= 0 ? '#2c7f2c' : '#b32b2b' }}>{sgn(d.why.sga)}</span>
                <span style={{ fontWeight: 700 }}>{ymL(cur)} 영업이익</span><span style={{ fontWeight: 700 }}>{fmt(Math.round(c.op))}</span>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="ft">
        <b style={{ color: 'var(--fg-2)' }}>확정</b> = ERP 손익계산서 금액 그대로 (마감 완료 월) · <b style={{ color: 'var(--fg-2)' }}>추정</b> = 앱이 구매·판매·전표로 계산 (재고 평가·결산 조정 전이라 확정 금액과 다를 수 있음).
        {official && d.est && <> {ymL(cur)} 앱 추정 영업이익 {fmt(Math.round(d.est.op))} → 확정 {fmt(Math.round(c.op))} (회계 조정 {sgn(c.op - d.est.op)}).</>}
        {d.estBase && d.pOff && <> 기준월이 추정이므로 전월·전년 동월도 앱 추정값끼리 비교했습니다 (전월 확정 영업이익은 {fmt(Math.round(d.pOff.op))}).</>}
        {!official && (pl === null || !pl?.closedThrough) && <> 아직 올린 손익계산서가 없습니다{isAdmin ? ' — [손익계산서 올리기]에서 올리면 마감 월은 확정 금액으로 바뀝니다.' : '.'}</>}
        {!acct.hasDb && <> ※ 회계 기준 집계(0011 SQL)가 아직 없어 매출액·음성공장 제조비용이 빠져 있습니다.</>}
        {' '}<button className="btn sm ghost" style={{ padding: '0 8px' }} onClick={() => setMore(v => !v)}>{more ? '참고 숫자 접기' : '참고 숫자 보기'}</button>
        {more && (
          <div style={{ marginTop: 6 }}>
            · 음성공장 제조비용(소재 제품에 얹는 노무비·경비): 올해 발생 {fmt(Math.round(d.ref.pool))} 중 판매되어 매출원가로 반영 {fmt(Math.round(d.ref.oh))} — 차이는 아직 재고에 남아 있거나 전년 재고가 팔린 몫입니다.<br />
            · 폐기(수량 × LOT 원가): {ymL(cur)} {fmt(Math.round(d.ref.dispCur))}, 올해 누적 {fmt(Math.round(d.ref.disp))} — 손익계산서에서는 매출원가 밖(타계정 대체)으로 처리되어 위 영업이익에는 들어 있지 않습니다.<br />
            · 아래 본부·부서별 수익은 앱 계산(회계 시점 반영)이며 본부별로 나눌 수 있는 금액만 담습니다. 회사 전체 확정 금액과의 차이는 위 "회계 조정" 입니다.
          </div>
        )}
      </div>
    </section>
  );
}
