// 배분 비율 설정(품목) · (원자재) — 기준월별 판매가(구매)/(합성) 금액 입력
//   위: 이 달 설정 현황(입력/미입력, 참고가 대비)  가운데: 일괄 도구  아래: 표(Enter로 다음 칸). 값·저장은 기존 모듈이 수행.
import { useMemo, useState } from 'react';
import { fmt, useUI } from '../components/ui';
import { kor } from '../components/charts';
import { ymLabel } from '../lib/legacyData';
import { MonthPick, SaveBar, NumCell, useCfgTick } from '../components/settingsUi';

type Ref = { v: number; src: string | null };
type Item = { code: string; no?: string; name: string; asset: string; src?: string; unit?: string; first: string | null; isSynth?: boolean };
type ItemsBridge = {
  month: () => string; setMonth: (m: string) => void; monthOptions: () => string[]; list: () => Item[]; refPrice: (code: string, ym?: string) => Ref;
  value: (code: string, kind: 'buy' | 'syn', ym?: string) => number | null; latestBefore: (code: string, kind: 'buy' | 'syn', ym?: string) => { m: string; v: number } | null;
  setValue: (code: string, kind: 'buy' | 'syn', v: number | null) => void; defaultPct: () => { buy: number; syn: number }; setDefaultPct: (kind: 'buy' | 'syn', v: number) => void;
  dirty: () => boolean; save: () => void; revert: () => void; applyMonthAll: () => void; applyEvery: () => void; applyView: (codes: string[]) => void; prevMonth: () => void; msg: () => { text: string; cls: string }; saving: () => boolean;
};
type MatsBridge = {
  month: () => string; setMonth: (m: string) => void; monthOptions: () => string[]; list: () => Item[]; refPrice: (code: string, ym?: string) => Ref;
  value: (code: string, ym?: string) => number | null; latestBefore: (code: string, ym?: string) => { m: string; v: number } | null; setValue: (code: string, v: number | null) => void;
  defaultPct: () => number; setDefaultPct: (v: number) => void; dirty: () => boolean; save: () => void; revert: () => void; applyMonthAll: () => void; applyEvery: () => void; applyView: (codes: string[]) => void; prevMonth: () => void; msg: () => { text: string; cls: string }; saving: () => boolean;
};
const KJ = () => (window as unknown as { KJHub?: { cfg?: { items?: ItemsBridge; mats?: MatsBridge } } }).KJHub?.cfg;
const mIdx = (m: string) => +m.slice(0, 4) * 12 + (+m.slice(4, 6) - 1);
const PAGE = 100;

export default function AllocPrices({ kind }: { kind: 'items' | 'mats' }) {
  const tick = useCfgTick(kind);
  const { confirm } = useUI();
  const isItems = kind === 'items';
  const ib = KJ()?.items, mb = KJ()?.mats;
  const ready = isItems ? !!ib : !!mb;
  const month = (isItems ? ib?.month() : mb?.month()) || '';
  const opts = useMemo(() => (isItems ? ib?.monthOptions() : mb?.monthOptions()) || [], [tick, month]); // eslint-disable-line
  const [qNo, setQNo] = useState(''); const [qNm, setQNm] = useState(''); const [asset, setAsset] = useState(''); const [syn, setSyn] = useState(''); const [only, setOnly] = useState<'' | 'unset' | 'set'>('');
  const [limit, setLimit] = useState(PAGE);

  // 행 계산 — 기존 모듈과 같은 규칙(최초 입고월 이후 품목만)
  const rows = useMemo(() => {
    if (!ready || !month) return [] as { it: Item; ref: Ref; buy: number | null; synV: number | null; prev: { m: string; v: number } | null; val: number | null; editable: 'buy' | 'syn' }[];
    const list = (isItems ? ib!.list() : mb!.list()).filter(it => !it.first || mIdx(it.first) <= mIdx(month));
    return list.map(it => {
      const ref = isItems ? ib!.refPrice(it.code, month) : mb!.refPrice(it.code, month);
      const editable: 'buy' | 'syn' = isItems && it.isSynth ? 'syn' : 'buy';
      const buy = isItems ? ib!.value(it.code, 'buy') : mb!.value(it.code);
      const synV = isItems ? ib!.value(it.code, 'syn') : null;
      const prev = isItems ? ib!.latestBefore(it.code, editable) : mb!.latestBefore(it.code);
      return { it, ref, buy, synV, prev, val: editable === 'syn' ? synV : buy, editable };
    });
  }, [ready, month, tick]); // eslint-disable-line
  const assets = useMemo(() => Array.from(new Set(rows.map(r => r.it.asset).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko')), [rows]);
  const filtered = useMemo(() => { const a = qNo.trim().toLowerCase(), b = qNm.trim().toLowerCase(); return rows.filter(r => (!a || (r.it.no || r.it.code).toLowerCase().includes(a)) && (!b || r.it.name.toLowerCase().includes(b)) && (!asset || r.it.asset === asset) && (!syn || (syn === 'syn' ? r.it.isSynth : !r.it.isSynth)) && (!only || (only === 'unset' ? r.val == null : r.val != null))); }, [rows, qNo, qNm, asset, syn, only]);
  const shown = filtered.slice(0, limit);
  const total = rows.length, setCnt = rows.filter(r => r.val != null).length, unsetCnt = total - setCnt;
  const withRef = rows.filter(r => r.val != null && r.ref.v > 0);
  const avgRatio = withRef.length ? Math.round(withRef.reduce((s, r) => s + (r.val! / r.ref.v), 0) / withRef.length * 1000) / 10 : null;
  const sumVal = rows.reduce((s, r) => s + (r.val || 0), 0);
  const bySrc = useMemo(() => { const m: Record<string, number> = {}; rows.forEach(r => { if (r.val != null && r.ref.src) m[r.ref.src] = (m[r.ref.src] || 0) + 1; }); return Object.keys(m).length; }, [rows]);
  const dirty = isItems ? !!ib?.dirty() : !!mb?.dirty();
  const saving = isItems ? !!ib?.saving() : !!mb?.saving();
  const msg = isItems ? ib?.msg() : mb?.msg();
  const pct = !ready ? { buy: 0, syn: 0 } : isItems ? ib!.defaultPct() : { buy: mb!.defaultPct(), syn: 0 };
  const setPct = (k: 'buy' | 'syn', v: number) => (isItems ? ib!.setDefaultPct(k, v) : mb!.setDefaultPct(v));
  const setVal = (r: typeof rows[0], v: number | null) => (isItems ? ib!.setValue(r.it.code, r.editable, v) : mb!.setValue(r.it.code, v));
  const title = isItems ? '배분 비율 설정(품목)' : '배분 비율 설정(원자재)';

  if (!ready) return <div className="page"><div className="card"><div className="empty"><span className="spinner" /> 설정 모듈을 준비하는 중입니다.</div></div></div>;
  return (
    <div className="page brief" style={{ gap: 16, maxWidth: 1500 }}>
      <style>{`
        .brief>*{min-width:0}
        .ap .verdict{display:grid;grid-template-columns:1fr 1.4fr;background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden}
        .ap .verdict>div{padding:16px 20px;min-width:0}.ap .verdict>div+div{border-left:1px solid var(--line)}
        .ap .l{font-size:12px;color:var(--fg-3)}
        .ap .big{font:800 30px/1.1 var(--font-num);letter-spacing:-.02em;margin-top:4px;font-variant-numeric:tabular-nums}
        .ap .prog{display:flex;height:12px;border-radius:999px;overflow:hidden;background:var(--surface-2);margin-top:10px}.ap .prog i{display:block;height:100%}
        .ap .facts{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}.ap .facts div{font-size:11.5px;color:var(--fg-3)}.ap .facts b{display:block;font:700 15px var(--font-num);color:var(--fg)}
        .ap .tools{display:grid;gap:8px}
        .ap .tools .tr{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12.5px}
        .ap .fbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 14px;background:var(--surface);border:1px solid var(--line);border-radius:12px}
        .ap table{width:100%;border-collapse:collapse;font-size:12.5px}
        .ap th{text-align:left;color:var(--fg-3);font-weight:500;font-size:11.5px;padding:7px 8px;border-bottom:2px solid var(--line);white-space:nowrap;position:sticky;top:0;background:var(--surface);z-index:1}
        .ap td{padding:4px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
        .ap td.nm{max-width:260px;overflow:hidden;text-overflow:ellipsis}
        .ap td.n,.ap th.n{text-align:right;font-family:var(--font-num);font-variant-numeric:tabular-nums}
        .ap tr.unset td:first-child{box-shadow:inset 3px 0 0 #f5b400}
        .ap .ratio{font-size:11px;color:var(--fg-3)}.ap .ratio.hi{color:#2c7f2c}.ap .ratio.lo{color:var(--neg)}
        .ap .syn{font-size:10px;padding:1px 6px;border-radius:4px;background:#eef6e0;color:#4f7a12;margin-left:6px}
        @media(max-width:1000px){.ap .verdict{grid-template-columns:1fr}.ap .verdict>div+div{border-left:0;border-top:1px solid var(--line)}}
      `}</style>
      <div className="ap" style={{ display: 'grid', gap: 16 }}>
        <div className="page-head" style={{ alignItems: 'flex-end' }}>
          <div><h1>{title}</h1><div className="help">{isItems ? '품목별 판매가(구매)·판매가(합성)를 금액(원)으로 기준월(입고월)별로 정합니다. 합성 품목은 판매가(합성)만, 그 외는 판매가(구매)만 입력합니다.' : '실자재투입내역의 원료·자재별 판매가(구매)를 금액(원)으로 기준월별로 정합니다. 실자재투입 수익 계산에 쓰입니다.'}</div></div>
          <span className="sp" />
          <MonthPick value={month} options={opts} onChange={m => (isItems ? ib!.setMonth(m) : mb!.setMonth(m))} label={isItems ? '기준월(입고월)' : '기준월'} />
        </div>

        <div className="verdict">
          <div>
            <div className="l">{ymLabel(month)} 입력 현황</div>
            <div className="big" style={{ color: unsetCnt ? '#9a6f00' : '#2c7f2c' }}>{setCnt}<span style={{ fontSize: 16, color: 'var(--fg-3)', fontWeight: 600 }}> / {total}{isItems ? '품목' : '자재'} 입력됨</span></div>
            <div className="prog"><i style={{ width: (total ? setCnt / total * 100 : 0) + '%', background: '#3aa63a' }} /><i style={{ width: (total ? unsetCnt / total * 100 : 0) + '%', background: '#f5b400' }} /></div>
            <div className="facts">
              <div>미입력<b style={{ color: unsetCnt ? '#9a6f00' : undefined, cursor: 'pointer' }} onClick={() => setOnly(only === 'unset' ? '' : 'unset')}>{unsetCnt}</b></div>
              <div>참고가 대비 평균<b>{avgRatio == null ? '-' : avgRatio + '%'}</b></div>
              <div>입력 금액 합계<b>{kor(sumVal)}</b></div>
            </div>
            {bySrc > 0 && <div className="help" style={{ marginTop: 8, color: '#9a6f00' }}>참고가에 (년월) 표시는 직전 3개월 거래가 없어 이전 금액을 승계한 것입니다.</div>}
          </div>
          <div>
            <div className="l">일괄 채우기 <span>참고 판매가 × (1 + 비율%) 로 값을 채우고 바로 저장합니다</span></div>
            <div className="tools" style={{ marginTop: 8 }}>
              <div className="tr">
                <span>비율(%)</span><span className="help">구매</span><NumCell value={pct.buy} onCommit={v => setPct('buy', v ?? 0)} width={70} />
                {isItems && <><span className="help">합성</span><NumCell value={pct.syn} onCommit={v => setPct('syn', v ?? 0)} width={70} /></>}
                <span className="help">— 입력 비율은 아래 단추로 값을 채울 때만 쓰입니다.</span>
              </div>
              <div className="tr">
                <button className="btn sm" onClick={() => (isItems ? ib!.applyView(filtered.map(r => r.it.code)) : mb!.applyView(filtered.map(r => r.it.code)))} disabled={!filtered.length}>조회된 {filtered.length}개 × {ymLabel(month)} 적용</button>
                <button className="btn sm" onClick={() => (isItems ? ib!.applyMonthAll() : mb!.applyMonthAll())}>전체 × {ymLabel(month)} 적용</button>
                <button className="btn sm" onClick={async () => { if (await confirm('전체 일괄 적용', `전체 ${isItems ? '품목' : '자재'}의 모든 기준월에 기본값을 적용하고 저장합니다. 기존에 입력한 값도 덮어씁니다.`, { okText: '적용하고 저장' })) (isItems ? ib!.applyEvery() : mb!.applyEvery()); }}>전체 × 모든 월 적용</button>
                <button className="btn sm" onClick={() => (isItems ? ib!.prevMonth() : mb!.prevMonth())} title="기준월 이전에 입력된 값 중 가장 최근 월의 값을 이 달로 복사하고 저장">이전 달 값 복사</button>
              </div>
            </div>
          </div>
        </div>

        <div className="fbar">
          <input className="inp" style={{ width: 130 }} placeholder={isItems ? '품번' : '자재코드'} value={qNo} onChange={e => { setQNo(e.target.value); setLimit(PAGE); }} />
          <input className="inp" style={{ width: 160 }} placeholder={isItems ? '품목명' : '자재명'} value={qNm} onChange={e => { setQNm(e.target.value); setLimit(PAGE); }} />
          <select className="inp" value={asset} onChange={e => { setAsset(e.target.value); setLimit(PAGE); }}><option value="">자산분류 전체</option>{assets.map(a => <option key={a} value={a}>{a}</option>)}</select>
          {isItems && <select className="inp" value={syn} onChange={e => { setSyn(e.target.value); setLimit(PAGE); }}><option value="">합성 전체</option><option value="non">비합성 품목</option><option value="syn">합성 품목</option></select>}
          <span className="seg"><button className={only === '' ? 'on' : ''} onClick={() => setOnly('')}>전체</button><button className={only === 'unset' ? 'on' : ''} onClick={() => setOnly('unset')}>미입력만</button><button className={only === 'set' ? 'on' : ''} onClick={() => setOnly('set')}>입력됨만</button></span>
          <span className="sp" />
          <span className="help">조회 {fmt(filtered.length)} / 전체 {fmt(total)}{rows.length !== (isItems ? ib!.list().length : mb!.list().length) ? ` · 최초 입고월 이후만 표시` : ''}</span>
        </div>

        <div className="card">
          <div className="tbl-wrap" style={{ maxHeight: '70vh', overflow: 'auto' }}><table>
            <thead><tr><th style={{ width: 120 }}>{isItems ? '품목코드' : '자재코드'}</th><th>{isItems ? '품목명' : '자재명'}</th><th style={{ width: 110 }}>자산분류</th><th className="n" style={{ width: 130 }}>참고 판매가</th><th className="n" style={{ width: 130 }}>{isItems ? '판매가(구매)' : '판매가(구매)'}</th>{isItems && <th className="n" style={{ width: 130 }}>판매가(합성)</th>}<th className="n" style={{ width: 90 }}>참고 대비</th><th className="n" style={{ width: 130 }}>이전 입력값</th></tr></thead>
            <tbody>
              {shown.map(r => { const ratio = r.val != null && r.ref.v > 0 ? Math.round(r.val / r.ref.v * 1000) / 10 : null; return (
                <tr key={r.it.code} className={r.val == null ? 'unset' : ''}>
                  <td style={{ fontWeight: 600 }}>{r.it.no || r.it.code}{r.it.src && <span className="help" style={{ marginLeft: 4, fontSize: 10 }}>{r.it.src}</span>}</td>
                  <td className="nm" title={r.it.name}>{r.it.name || '-'}{r.it.isSynth && <span className="syn">합성</span>}</td>
                  <td className="help">{r.it.asset || '-'}</td>
                  <td className="n" style={{ color: r.ref.v ? undefined : 'var(--fg-3)' }} title={r.ref.src ? `직전 3개월 데이터 없음 → ${ymLabel(r.ref.src)} 금액 승계` : '기준월 직전 3개월 수량가중평균'}>{fmt(r.ref.v)}{r.ref.src && <span style={{ fontSize: 10, color: '#9a6f00', marginLeft: 3 }}>({ymLabel(r.ref.src)})</span>}</td>
                  <td className="n">{r.editable === 'buy' ? <NumCell value={r.buy} onCommit={v => setVal(r, v)} placeholder="0" width={110} /> : <span className="help" title="합성 품목은 판매가(구매)를 쓰지 않습니다">0</span>}</td>
                  {isItems && <td className="n">{r.editable === 'syn' ? <NumCell value={r.synV} onCommit={v => setVal(r, v)} placeholder="0" width={110} /> : <span className="help" title="합성 대상이 아닌 품목">0</span>}</td>}
                  <td className={'n ratio ' + (ratio == null ? '' : ratio >= 100 ? 'hi' : 'lo')}>{ratio == null ? '-' : ratio + '%'}</td>
                  <td className="n help" title={r.prev ? ymLabel(r.prev.m) + ' 입력값' : ''}>{r.prev ? <>{fmt(r.prev.v)} <span style={{ fontSize: 10 }}>({ymLabel(r.prev.m)})</span></> : '-'}</td>
                </tr>); })}
              {!shown.length && <tr><td colSpan={isItems ? 8 : 7} className="empty">{total ? '조건에 맞는 항목이 없습니다.' : (isItems ? '구매·판매 데이터에서 품목을 찾지 못했습니다.' : '실자재투입내역 데이터가 없습니다.')}</td></tr>}
            </tbody>
          </table></div>
          {filtered.length > shown.length && <div style={{ textAlign: 'center', padding: 8 }}><button className="btn sm" onClick={() => setLimit(l => l + PAGE)}>더 보기 ({fmt(filtered.length - shown.length)}개 남음)</button> <button className="btn sm ghost" onClick={() => setLimit(Infinity)}>전체 보기</button></div>}
          <p className="help" style={{ padding: '6px 14px' }}>노란 테두리 행은 이 달 값이 없는 항목입니다(수익 계산 시 0). 값을 입력하고 Enter를 누르면 다음 칸으로 넘어갑니다. 저장은 {ymLabel(month)} 값만 바꾸고 다른 달은 건드리지 않습니다.</p>
        </div>

        <SaveBar dirty={dirty} saving={saving} msg={msg} onSave={() => (isItems ? ib!.save() : mb!.save())} onRevert={() => (isItems ? ib!.revert() : mb!.revert())} saveLabel={`${ymLabel(month)} 저장`} />
      </div>
    </div>
  );
}
