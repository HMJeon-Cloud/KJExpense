// 수익/비용 › 운영 지표 — 실현 수익(구매/판매) 기준 7가지 지표
//   계산은 실현 수익 화면(bu-margin-real)과 같은 모델을 쓰고, 경영전략본부·연구소 비용은 [비용 배분 설정]으로 나눕니다.
import { useNavigate } from 'react-router-dom';
import { OpsMetrics, type OpsModel } from '../components/OpsMetrics';
import { useLegacyModel, shiftMonth } from '../lib/useLegacyModel';
import { useCostAlloc } from '../lib/hqAlloc';
import { useAuth } from '../lib/auth';
import { ymL } from '../components/charts';

export default function Ops() {
  const { model, ctl, setBase, setMonths } = useLegacyModel<OpsModel & { empty?: boolean; reason?: string }>('bu-margin-real');
  const allocCfg = useCostAlloc();
  const { employee } = useAuth();
  const nav = useNavigate();
  const isAdmin = employee?.role === 'admin';
  return (
    <div className="page brief opsp">
      <style>{`
        .opsp{gap:18px;max-width:1360px}.opsp>*{min-width:0}
        .opsp .ttl{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap}
        .opsp .ttl h1{font-size:22px;font-weight:700;letter-spacing:-.01em}
        .opsp .ttl .sub{color:var(--fg-3);font-size:13px}
        .opsp .monthnav{display:inline-flex;align-items:center;border:1px solid var(--line-2);border-radius:9px;overflow:hidden;background:var(--surface)}
        .opsp .monthnav button{border:0;background:transparent;padding:6px 10px;cursor:pointer;color:var(--fg-2);font-size:14px}
        .opsp .monthnav button:disabled{opacity:.3;cursor:default}
        .opsp .monthnav input{border:0;border-left:1px solid var(--line);border-right:1px solid var(--line);padding:6px 8px;font:600 13.5px var(--font-num);color:var(--fg);background:transparent}
      `}</style>
      <div className="ttl">
        <div><h1>운영 지표</h1><div className="sub">{model && !model.empty ? `${ymL(model.months[0])} ~ ${ymL(model.cur)} 기준. ` : ''}수익은 구매/판매의 실현 수익, 비용은 전표 비용입니다. 각 카드 맨 위에 결론을 먼저 적었고, (?) 를 누르면 계산 방법이 나옵니다.</div></div>
        <span className="sp" />
        {isAdmin && <span className="row" style={{ gap: 6 }}><button className="btn sm ghost" onClick={() => nav('/settings/cost-alloc')}>비용 배분 설정</button><button className="btn sm ghost" onClick={() => nav('/settings/fixed')}>고정비 설정</button></span>}
        <span className="monthnav" title="기준월">
          <button onClick={() => setBase(shiftMonth(ctl.baseMonth, -1))} disabled={!(ctl.baseMonth > '2025-01')} aria-label="이전 달">‹</button>
          <input type="month" min="2025-01" value={ctl.baseMonth} onChange={e => setBase(e.target.value)} />
          <button onClick={() => setBase(shiftMonth(ctl.baseMonth, 1))} aria-label="다음 달">›</button>
        </span>
        <span className="seg">{[3, 6, 12].map(n => <button key={n} className={ctl.months === n ? 'on' : ''} onClick={() => setMonths(n)}>{n}개월</button>)}</span>
      </div>
      {!model ? <div className="card"><div className="empty"><span className="spinner" /> 데이터를 계산하는 중입니다. 처음 접속은 수십 초 걸릴 수 있습니다.</div></div>
        : model.empty ? <div className="card"><div className="empty">{model.reason || '표시할 데이터가 없습니다.'}</div></div>
        : <OpsMetrics model={model} allocCfg={allocCfg} />}
    </div>
  );
}
