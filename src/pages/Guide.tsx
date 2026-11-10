// 계산 기준 안내 — 화면의 숫자가 어디서 와서 어떻게 계산되는지 한곳에 모은 화면 (모든 사용자)
//   ① 자주 묻는 질문  ② 화면별 계산 설명 (각 화면 (?) 도움말과 같은 내용 = lib/helpDocs.ts)  ③ 용어
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HELP, type HelpDoc } from '../lib/helpDocs';
import { useAuth } from '../lib/auth';
import { ymLabel } from '../components/ui';

const GROUPS: { key: string; title: string; path?: string; pre: string[]; priv?: boolean; admin?: boolean }[] = [
  { key: 'bu', title: '국전 수익/비용 · 사업단위 수익/비용', path: '/bu-unit', pre: ['bu.'] },
  { key: 'real', title: '국전 수익/비용(실현 수익)', path: '/bu-real', pre: ['bu-real.'], priv: true },
  { key: 'ops', title: '운영 지표', path: '/ops', pre: ['ops.'], priv: true },
  { key: 'dept', title: '부서별 수익/비용', path: '/dept', pre: ['dept.'] },
  { key: 'cost', title: '부서별 비용 · 전표', path: '/dept-cost', pre: ['cost.', 'voucher.'] },
  { key: 'support', title: '부서별 지원 내역', path: '/dept-support', pre: ['support.'] },
  { key: 'trade', title: '구매/판매', path: '/trade', pre: ['trade.'] },
  { key: 'mat', title: '실자재투입 내역', path: '/matinput', pre: ['mat.'] },
  { key: 'stock', title: 'Lot별 재고조회', path: '/stock', pre: ['stock.'] },
  { key: 'set', title: '설정 (관리자)', pre: ['set.'], admin: true },
];

const FAQ: { q: string; a: string[]; tag: string }[] = [
  { tag: '수익', q: '화면마다 "수익" 숫자가 다릅니다. 어느 것이 맞나요?', a: [
    '모두 같은 구매·판매 데이터에서 나오지만, 보는 목적이 달라 세 가지 기준이 있습니다.',
    '① 배분 수익 — 국전 수익/비용 · 사업단위 수익/비용 · 부서별 수익/비용. 판매에서 생긴 이윤을 구매·합성·영업 단계별(이윤 9종)로 나누고, [배분 비율 설정]의 비율로 각 부서에 나눈 금액입니다. "누가 얼마나 기여했나"를 보는 내부 평가용입니다.',
    '② 실현 수익 — 국전 수익/비용(실현 수익) · 운영 지표 · 구매/판매. 판매금액 − 판매수량 × 원가. 배분 비율을 거치지 않은, 실제로 남은 금액입니다.',
    '③ 회계 확정 — 실현 수익 화면 맨 위 "손익 요약"의 "확정" 표시. ERP 손익계산서 금액 그대로입니다.',
    '회사 전체 실적은 ③(없으면 ②), 부서 기여도는 ①을 보시면 됩니다.',
  ] },
  { tag: '회계', q: '손익계산서(회계)와 금액이 같은가요?', a: [
    '매출액과 판관비는 올린 데이터(판매·전표)만으로 손익계산서와 일치합니다.',
    '매출원가(그리고 매출총이익·영업이익)는 앱 계산만으로는 원 단위까지 같을 수 없습니다. 회계의 매출원가는 "기초재고 + 당기 제조·매입 − 기말재고"로 정해지는데, 기말재고 평가·분기 결산 조정·타계정 대체는 ERP 원가계산 결과에만 있기 때문입니다.',
    '그래서 마감이 끝난 달은 ERP 손익계산서를 올려 그 금액을 그대로 보여주고("확정"), 마감 전인 달만 앱 계산값("추정")을 보여줍니다. 손익 요약 카드의 배지와 막대 색(진한 색 = 확정)으로 구분됩니다.',
    '배분 수익 화면(국전·사업단위·부서별)은 내부 기여도 평가 기준이라 손익계산서와 맞추는 숫자가 아닙니다.',
  ] },
  { tag: '수익', q: '우리 부서 수익이 0 이거나 생각보다 적습니다.', a: [
    '부서별 수익은 [배분 비율 설정(부서)]에 그 부서 비율이 있어야 잡힙니다. 그 달 설정이 없으면 이전 가장 최근 달의 비율을 씁니다.',
    '구매·합성 단계 이윤은 [배분 비율 설정(품목·원자재)]에 그 품목의 "판매가"가 입고월 기준으로 들어 있어야 계산됩니다. 판매가가 없으면 0이 아니라 계산에서 빠집니다.',
    '수익은 "판매가 발행된 달"에 잡힙니다. 사 놓고 아직 팔지 않은 것은 수익이 아니라 재고입니다.',
    '기타입고·반품으로 들어온 수량의 판매는 부서별 이윤에는 넣지 않고 실현 수익에만 반영합니다.',
    '부서별 수익/비용 화면에서 부서를 누르면 "수익이 어디서 왔나"에 그룹·비율·금액이 나옵니다.',
  ] },
  { tag: '비용', q: '비용에는 무엇이 들어가나요? 급여도 포함인가요?', a: [
    '전표 데이터 중 부서(코스트센터)가 있고 계정과목에 "(판)" 또는 "(제)"가 붙었거나 비용구분이 판관·제조인 전표 전부입니다. 급여·퇴직급여·복리후생비·감가상각비 등도 전표에 있으면 포함됩니다.',
    '금액 = 차변금액 − 대변금액. 취소·환입 전표는 음수로 들어가 자동으로 차감됩니다.',
    '결산·대체 전표(계정에 "집합", 적요에 "제조원가대체·손익대체·원가대체", 부서에 "원가계산")와 결산 매출 계정은 비용이 아니므로 뺍니다.',
    '국전·사업단위·부서별 수익/비용 화면은 여기에 "지원 내역으로 부담한 금액"을 더합니다.',
    '실현 수익 화면과 운영 지표는 판관비만 씁니다. (제) 제조 노무비·경비는 제품 원가에 이미 들어 있어 한 번 더 빼면 중복이기 때문입니다.',
  ] },
  { tag: '비용', q: '이 비용 금액이 맞는지 원본 전표를 보고 싶습니다.', a: [
    '비용 금액·계정·부서는 대부분 누를 수 있습니다. 누르면 [부서별 비용] 화면으로 넘어가 그 조건의 전표 목록(회계일·적요·금액)이 나옵니다.',
    '전표 목록은 CSV 로 내려받아 ERP 와 대조할 수 있습니다.',
  ] },
  { tag: '보기', q: '"비용/수익" 이 100%를 넘으면 무슨 뜻인가요?', a: [
    '비용 ÷ 수익 × 100 입니다. 100% = 번 만큼 씀, 100% 초과 = 번 것보다 많이 씀(빨강), 100% 미만 = 남김(초록).',
    '수익이 0 이하인 부서는 비율을 계산할 수 없어 "-" 로 표시하고, 999%를 넘으면 "999%+"로 줄여 표시합니다.',
    '지원 부서(경영지원·인사총무 등)는 수익이 지원 내역으로 받은 금액뿐이라 비율이 높게 나오는 것이 정상입니다.',
  ] },
  { tag: '보기', q: '기준월 · 조회 기간 · 마감월은 무엇인가요?', a: [
    '기준월 = 화면이 "이번 달"로 보는 달. 처음에는 마감월로 맞춰집니다.',
    '조회 기간 = 기준월을 끝으로 하는 3·6·12개월. 추이 그래프와 "누적" 금액의 범위입니다.',
    `마감월 = 관리자가 지정한, 데이터 마감이 끝난 가장 최근 달입니다. 그 뒤 달은 데이터가 덜 들어와 숫자가 작게 보일 수 있습니다.`,
  ] },
  { tag: '원가', q: '원가(LOT 원가 단가)는 어떻게 계산하나요?', a: [
    '구매 LOT: (구매 원화금액 + 그 BL 부대비용 배부액) ÷ 구매수량. 부대비용은 같은 BL 안에서 구매금액 비율로 나눕니다.',
    '생산입고 LOT(자사 제조): 그 LOT 입고월의 [월/품목별 제조원가] 단가. 그 달이 없으면 이전 가장 최근 달.',
    '실현 수익 화면·운영 지표에서는 소재 제품에 음성공장 제조비용(노무비·경비)을 생산월 기준으로 더 얹습니다(회계와 같은 처리).',
    '구매와 판매는 "LOT번호 + 품번"이 같은 것끼리 묶습니다. 폐기·기타출고는 수량에서 빼고, 기타입고·반품은 수량에 더합니다.',
    '구매/판매 화면에서 BL 까지 펼치면 LOT 별 구매·부대비용·판매 내역과 계산 과정을 볼 수 있습니다.',
  ] },
  { tag: '재고', q: '재고 금액은 어디서 온 숫자인가요?', a: [
    'Lot별 재고조회와 운영 지표 ② 의 재고금액은 ERP [LOT별 재고] 업로드 값 그대로입니다(앱이 다시 계산하지 않음).',
    '구매/판매 화면의 "재고 평가액"은 앱이 구매 − 판매 − 투입 − 폐기로 계산한 수량 × 원가라서 ERP 재고와 차이가 날 수 있고, 운영 지표 ② 아래 "점검"에서 차이 나는 LOT 을 볼 수 있습니다.',
  ] },
  { tag: '보기', q: '"1.2억" 과 "123,456,789" 가 섞여 있습니다.', a: [
    '큰 글씨 요약은 읽기 쉽게 억·만 단위로 반올림해 보여주고, 표는 원 단위 그대로입니다. 요약 숫자에 마우스를 올리거나 바로 아래 작은 글씨에서 원 단위 금액을 볼 수 있습니다.',
    '합계는 반올림 전 금액으로 계산하므로, 반올림된 숫자를 직접 더한 값과 1 단위 차이가 날 수 있습니다.',
  ] },
  { tag: '지원', q: '"지원 내역" 은 무엇이고 왜 수익·비용에 들어가나요?', a: [
    '한 부서가 다른 부서를 위해 한 일(예: 경영지원팀의 급여 업무)을 금액으로 정해 두고, 지원한 부서의 수익으로, 받은 부서의 비용으로 잡는 사내 정산입니다.',
    '회사 전체로는 수익과 비용에 같은 금액이 더해져 순수익에는 영향이 없습니다.',
    '실현 수익 화면과 운영 지표에는 쓰지 않습니다. 내용은 [부서별 지원 내역] 화면에서 볼 수 있습니다.',
  ] },
  { tag: '보기', q: '다른 사람과 화면에 보이는 부서·금액이 다릅니다.', a: [
    '사원별로 볼 수 있는 화면과 부서 범위가 정해져 있습니다. 범위가 제한된 사용자는 본인 본부·부서 금액만 합산되어 "전체" 금액도 그 범위의 합계입니다.',
    '회사 전체 금액인 "손익 요약(회계 기준)" 카드는 전체 권한 사용자에게만 보입니다.',
  ] },
  { tag: '데이터', q: '어제 본 숫자와 오늘 숫자가 다릅니다.', a: [
    '① 기초 데이터(구매·판매·전표 등)를 새로 올렸거나 ② 배분 비율·판매가·지원 내역 같은 설정을 바꾸면 과거 달 숫자도 다시 계산됩니다.',
    '설정 변경은 [변경 이력 · 복구]에 누가 언제 무엇을 바꿨는지 남습니다(관리자).',
    '화면 오른쪽 위 "데이터" 표시를 누르면 데이터별 상태를 보고 다시 불러올 수 있습니다.',
  ] },
  { tag: '회계', q: '3·6·9·12월 숫자가 유독 크거나 작습니다.', a: [
    '분기 마지막 달에는 결산 조정 전표(상여·충당금·재고 평가·매출 결산 등)가 한꺼번에 들어가 월 금액이 출렁입니다.',
    '월 단위보다 분기 합계나 올해 누적으로 보는 것이 정확합니다. 손익 요약의 "분기 흐름"과 "올해 누적" 열을 참고하세요.',
  ] },
  { tag: '보기', q: '인원이 23.5명처럼 소수점으로 나옵니다.', a: [
    '실현 수익 화면과 운영 지표는 수익이 없는 지원 조직(경영전략본부·연구소)의 비용과 인원을 [비용 배분 설정(본부)] 비율로 수익 본부에 나눕니다. 나눠 받은 인원이 더해져 소수점이 생깁니다.',
    '본부 줄을 펼치면 "← … 배분" 줄에서 받은 인원·비용을 따로 볼 수 있습니다.',
  ] },
  { tag: '환율', q: '운영 지표의 환율 "부담/절감" 은 실제 손익인가요?', a: [
    '회사 기준 환율과 실제 구매 환율의 차이에 외화 구매금액을 곱한 "기준 대비 차이"입니다. 장부에 따로 잡히는 외환차손익이 아니라, 이미 구매 원가에 녹아 있는 금액을 따로 떼어 보여주는 참고 지표입니다.',
  ] },
];

const GLOSSARY: [string, string][] = [
  ['실현 수익', '판매금액 − 판매수량 × LOT 원가. 판매가 발행된 달에 잡힙니다.'],
  ['배분 수익', '이윤 9종을 [배분 비율 설정]의 비율로 부서에 나눈 금액 + 지원 내역으로 받은 금액.'],
  ['이윤 9종', '판매 한 건의 이익을 구매 부서(6개 팀) · 합성 · 소재생산 · 영업 단계로 나눈 것. 단계 사이의 경계가 "판매가(구매)"와 "판매가(합성)"입니다.'],
  ['판매가(구매) · 판매가(합성)', '구매 부서가 다음 단계로 넘기는 사내 기준 가격 / 합성(생산) 부서가 영업으로 넘기는 사내 기준 가격. [배분 비율 설정(품목·원자재)]에서 입고월별로 정합니다.'],
  ['LOT', '같은 품번·같은 LOT번호로 들어온 한 묶음. 원가와 수익 계산의 기본 단위입니다.'],
  ['BL', '수입 한 건(선하증권). 부대비용이 BL 단위로 붙습니다.'],
  ['부대비용', '수입 때 드는 관세·운임·통관 수수료 등. 구매 원가에 더합니다.'],
  ['제조원가 (ProcPrice)', 'ERP 원가계산이 산출한 그 달 그 품목의 단위당 제조원가(재료비 + 노무비 + 경비 + 외주가공비).'],
  ['(판) · (제)', '계정과목 앞 표시. (판) = 판매비와 관리비, (제) = 제조 노무비·경비.'],
  ['판관비', '판매비와 관리비. (판) 계정 전표 합계.'],
  ['결산 매출', '전표의 상품·제품·수수료매출(결산) 계정. 분기 마감 수정분개 등으로, 실현 수익 화면의 수익에만 더합니다.'],
  ['자산순번 36 · 37 · 39', '36·37 = 제조에 투입하는 자재(판매가 없어 구매 부서 이윤만 계산), 39 = 판매금액 전액이 판매 부서 이윤.'],
  ['생산입고 · 기타입고 · 기타출고 · 반품 · 폐기', '구매 데이터의 수입구분. 생산입고 = 자사 제조품 입고, 기타입고 = 수량만 더함, 기타출고·폐기 = 수량을 뺌, 반품 = 음수 수량·금액을 더함.'],
  ['지원 내역', '부서 간 업무 지원을 금액으로 정산한 것. 지원한 부서의 수익, 받은 부서의 비용.'],
  ['확정 · 추정', '확정 = ERP 손익계산서 금액 그대로(마감 완료 월), 추정 = 앱이 구매·판매·전표로 계산한 값.'],
  ['전월비', '(기준월 − 전월) ÷ 전월 × 100.'],
  ['%p', '퍼센트 포인트. 두 비율의 단순 차이 (48% → 45% 는 −3%p).'],
];

function Doc({ d }: { d: HelpDoc }) {
  return (
    <div className="gd-doc">
      <p>{d.what}</p>
      <h5>데이터 출처</h5>
      <table><tbody>{d.sources.map((s, i) => <tr key={i}><td>{s.ds}</td><td>{s.cols}</td></tr>)}</tbody></table>
      <h5>계산식</h5>
      <div className="calc">{d.calc.map((c, i) => <div key={i}>{c.startsWith('  ') ? c : '• ' + c}</div>)}</div>
      {d.notes && d.notes.length > 0 && <><h5>기준 · 주의</h5><ul>{d.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></>}
    </div>
  );
}

export default function Guide() {
  const { employee, closeMonth } = useAuth();
  const nav = useNavigate();
  const isAdmin = employee?.role === 'admin';
  const privileged = isAdmin || employee?.role === 'all';
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const tog = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }));
  const kw = q.trim().toLowerCase();
  const hit = (...s: (string | undefined)[]) => !kw || s.some(x => (x || '').toLowerCase().includes(kw));
  const groups = useMemo(() => GROUPS.filter(g => (!g.admin || isAdmin) && (!g.priv || privileged)).map(g => ({
    ...g, docs: Object.entries(HELP).filter(([id]) => g.pre.some(p => id.startsWith(p))),
  })), [isAdmin, privileged]);
  const faq = FAQ.filter(f => hit(f.q, f.a.join(' '), f.tag));
  const gl = GLOSSARY.filter(([a, b]) => hit(a, b));
  const shown = groups.map(g => ({ ...g, docs: g.docs.filter(([, d]) => hit(d.title, d.what, d.calc.join(' '), (d.notes || []).join(' '), g.title)) })).filter(g => g.docs.length);
  const isOpen = (k: string) => (kw ? true : !!open[k]);

  return (
    <div className="page gd" style={{ gap: 18, maxWidth: 1040 }}>
      <style>{`
        .gd>*{min-width:0}
        .gd h1{font-size:22px;font-weight:700}
        .gd h2{font-size:16px;font-weight:700;margin:6px 0 2px}
        .gd .lead{font-size:13.5px;color:var(--fg-2);line-height:1.65}
        .gd .how{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
        .gd .how>div{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:12px 14px;font-size:13px;line-height:1.55}
        .gd .how b{display:block;margin-bottom:3px}
        .gd .item{border:1px solid var(--line);border-radius:12px;background:var(--surface);overflow:hidden}
        .gd .item+.item{margin-top:8px}
        .gd .item>button{display:flex;gap:10px;align-items:center;width:100%;text-align:left;border:0;background:transparent;padding:12px 16px;font:600 14px var(--font-body);color:var(--fg);cursor:pointer}
        .gd .item>button:hover{background:var(--surface-2)}
        .gd .item>button .tg{font-size:11px;font-weight:700;color:var(--brand);background:var(--brand-soft);border-radius:999px;padding:1px 8px;white-space:nowrap}
        .gd .item>button .ar{margin-left:auto;color:var(--fg-3);font-size:12px}
        .gd .ans{padding:2px 16px 14px 16px;font-size:13.5px;line-height:1.7;color:var(--fg-2);display:grid;gap:6px}
        .gd .sub{border-top:1px solid var(--line)}
        .gd .sub>button{display:flex;gap:8px;align-items:center;width:100%;text-align:left;border:0;background:transparent;padding:9px 16px 9px 28px;font:500 13.5px var(--font-body);color:var(--fg);cursor:pointer}
        .gd .sub>button:hover{background:var(--surface-2)}
        .gd-doc{padding:2px 16px 14px 28px;font-size:13px;line-height:1.65;color:var(--fg-2)}
        .gd-doc h5{font-size:11.5px;font-weight:700;color:var(--brand);margin:10px 0 4px}
        .gd-doc table{width:100%;border-collapse:collapse;font-size:12.5px}
        .gd-doc td{padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top}
        .gd-doc td:first-child{white-space:nowrap;font-weight:600;color:var(--fg);width:1%}
        .gd-doc .calc{background:var(--surface-2);border-radius:8px;padding:9px 12px;display:grid;gap:4px;font-size:12.5px;color:var(--fg)}
        .gd-doc .calc div{white-space:pre-wrap}
        .gd-doc ul{padding-left:18px;list-style:disc;display:grid;gap:3px;font-size:12.5px}
        .gd .gl{display:grid;grid-template-columns:200px minmax(0,1fr);gap:0;border:1px solid var(--line);border-radius:12px;background:var(--surface);overflow:hidden;font-size:13px}
        .gd .gl>div{padding:8px 14px;border-bottom:1px solid var(--line);line-height:1.6}
        .gd .gl>div:nth-child(odd){font-weight:600;background:var(--surface-2)}
        .gd .gl>div:nth-last-child(-n+2){border-bottom:0}
        @media(max-width:760px){.gd .how{grid-template-columns:1fr}.gd .gl{grid-template-columns:1fr}.gd .gl>div:nth-child(odd){border-bottom:0;padding-bottom:2px}.gd-doc{padding-left:16px}.gd .sub>button{padding-left:16px}}
      `}</style>
      <div>
        <h1>계산 기준 안내</h1>
        <p className="lead">화면의 숫자가 어떤 데이터에서 와서 어떻게 계산되는지 모아 둔 곳입니다. 모든 금액은 ERP 에서 내려받아 올린 기초 데이터(전표·구매·판매·부대비용·제조원가·재고 등)와 관리자가 정한 설정으로 계산하며, 사람이 손으로 고친 숫자는 없습니다. 현재 마감월은 <b>{ymLabel(closeMonth || '')}</b> 입니다.</p>
      </div>
      <div className="how">
        <div><b>① 제목 옆 (?)</b>표·그래프 제목 옆 물음표를 누르면 그 표가 쓰는 데이터와 계산식이 나옵니다.</div>
        <div><b>② 점선 밑줄 친 열 이름</b>표의 열 이름에 마우스를 올리면(모바일은 누르면) 그 열 값의 계산 방법이 한 줄로 나옵니다.</div>
        <div><b>③ 금액을 눌러 원본 보기</b>비용 금액은 전표 목록까지, 구매/판매는 LOT 별 구매·판매 내역까지 내려가 확인할 수 있습니다.</div>
      </div>
      <input className="inp" placeholder="찾기 — 예: 실현 수익, 부대비용, 배분, 환율" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 420 }} />

      {faq.length > 0 && <section>
        <h2>자주 묻는 질문</h2>
        {faq.map((f, i) => { const k = 'q' + FAQ.indexOf(f); return (
          <div className="item" key={i}>
            <button onClick={() => tog(k)} aria-expanded={isOpen(k)}><span className="tg">{f.tag}</span><span>{f.q}</span><span className="ar">{isOpen(k) ? '접기 ▴' : '보기 ▾'}</span></button>
            {isOpen(k) && <div className="ans">{f.a.map((p, j) => <div key={j}>{p}</div>)}</div>}
          </div>
        ); })}
      </section>}

      {shown.length > 0 && <section>
        <h2>화면별 계산 설명</h2>
        <p className="lead" style={{ marginBottom: 8 }}>각 화면의 (?) 도움말과 같은 내용입니다. 화면 이름을 누르면 그 화면의 표·그래프 목록이 펼쳐집니다.</p>
        {shown.map(g => (
          <div className="item" key={g.key}>
            <button onClick={() => tog('g' + g.key)} aria-expanded={isOpen('g' + g.key)}><span>{g.title}</span><span className="help" style={{ fontWeight: 400 }}>{g.docs.length}개 항목</span><span className="ar">{isOpen('g' + g.key) ? '접기 ▴' : '보기 ▾'}</span></button>
            {isOpen('g' + g.key) && <>
              {g.path && <div style={{ padding: '0 16px 8px' }}><button className="btn sm ghost" onClick={() => nav(g.path!)}>이 화면 열기 →</button></div>}
              {g.docs.map(([id, d]) => (
                <div className="sub" key={id}>
                  <button onClick={() => tog(id)} aria-expanded={isOpen(id)}><span>{d.title}</span><span className="ar" style={{ marginLeft: 'auto', color: 'var(--fg-3)', fontSize: 12 }}>{isOpen(id) ? '▴' : '▾'}</span></button>
                  {isOpen(id) && <Doc d={d} />}
                </div>
              ))}
            </>}
          </div>
        ))}
      </section>}

      {gl.length > 0 && <section>
        <h2>용어</h2>
        <div className="gl">{gl.map(([a, b]) => [<div key={a}>{a}</div>, <div key={a + 'v'}>{b}</div>])}</div>
      </section>}
      {!faq.length && !shown.length && !gl.length && <div className="card"><div className="empty">"{q}" 에 맞는 설명이 없습니다.</div></div>}
    </div>
  );
}
