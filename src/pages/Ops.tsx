// 경영 › 운영 지표 — 판매 이익(구매·판매) 기준 7가지 지표
//   계산은 손익 현황 화면(bu-margin-real)과 같은 모델을 쓰고, 지원 조직 비용은 [본부 비용 배분]으로 나눕니다.
import { useNavigate } from 'react-router-dom';
import { OpsMetrics, type OpsModel } from '../components/OpsMetrics';
import { useLegacyModel } from '../lib/useLegacyModel';
import { useCostAlloc } from '../lib/hqAlloc';
import { useAuth } from '../lib/auth';
import { PageHead, MonthNav, RangeSeg, Loading, Empty, ymText } from '../components/kit';

export default function Ops() {
  const { model, ctl, setBase, setMonths } = useLegacyModel<OpsModel & { empty?: boolean; reason?: string }>('bu-margin-real');
  const allocCfg = useCostAlloc();
  const { employee } = useAuth();
  const nav = useNavigate();
  const isAdmin = employee?.role === 'admin';
  return (
    <div className="page">
      <PageHead title="운영 지표" desc={<>{model && !model.empty ? `${ymText(model.months[0])} ~ ${ymText(model.cur)}. ` : ''}사람 · 재고 · 이익률 · 거래처 · 비용 구조 · 환율을 7가지 지표로 봅니다. 카드마다 결론을 먼저 적었습니다.</>}>
        {isAdmin && <><button className="btn sm ghost" onClick={() => nav('/settings/cost-alloc')}>본부 비용 배분</button><button className="btn sm ghost" onClick={() => nav('/settings/fixed')}>고정비 기준</button></>}
        <MonthNav value={ctl.baseMonth} onChange={setBase} />
        <RangeSeg value={ctl.months} onChange={setMonths} />
      </PageHead>
      {!model ? <Loading />
        : model.empty ? <Empty>{model.reason === 'results' ? '판매 이익 계산이 아직 끝나지 않았거나 데이터가 없습니다. 잠시 뒤 자동으로 표시됩니다.' : '선택한 기간에 표시할 데이터가 없습니다. 기준월을 확인해 주세요.'}</Empty>
        : <OpsMetrics model={model} allocCfg={allocCfg} />}
    </div>
  );
}
