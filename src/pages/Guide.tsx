// 도움말 › 계산 기준 — 화면의 숫자가 어떤 데이터로 어떻게 계산되는지 한곳에 모은 화면 (모든 사용자)
//   ① 세 가지 이익  ② 자주 묻는 질문  ③ 용어  ④ 화면별 계산 (각 화면 (?) 도움말과 같은 내용 = lib/helpDocs.ts)
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HELP, type HelpDoc } from '../lib/helpDocs';
import { useAuth } from '../lib/auth';
import { ymLabel } from '../components/ui';
import { PageHead } from '../components/kit';

const GROUPS: { key: string; title: string; path?: string; pre: string[]; priv?: boolean; admin?: boolean }[] = [
  { key: 'real', title: '경영 요약 · 손익 현황', path: '/bu-real', pre: ['bu-real.'], priv: true },
  { key: 'bu', title: '본부 성과 · 본부 손익', path: '/bu-unit', pre: ['bu.'] },
  { key: 'ops', title: '운영 지표', path: '/ops', pre: ['ops.'], priv: true },
  { key: 'dept', title: '부서 손익', path: '/dept', pre: ['dept.'] },
  { key: 'cost', title: '비용 내역 · 전표', path: '/dept-cost', pre: ['cost.', 'voucher.'] },
  { key: 'support', title: '지원 내역', path: '/dept-support', pre: ['support.'] },
  { key: 'trade', title: '구매 · 판매', path: '/trade', pre: ['trade.'] },
  { key: 'mat', title: '자재 투입', path: '/matinput', pre: ['mat.'] },
  { key: 'stock', title: '재고', path: '/stock', pre: ['stock.'] },
  { key: 'set', title: '기준 설정 (관리자)', pre: ['set.'], admin: true },
];

/** 세 가지 이익 — 화면마다 숫자가 다른 이유 */
const THREE: { name: string; color: string; def: string; use: string; where: string }[] = [
  { name: '영업이익', color: 'var(--green)', def: '매출 − 매출원가 − 판관비', use: '회사 전체 실적. 마감한 달은 손익계산서 금액 그대로(확정)입니다.', where: '경영 요약 · 손익 현황' },
  { name: '판매 이익', color: 'var(--blue)', def: '매출 − 판매수량 × LOT 원가', use: '판매로 실제 남은 금액. 본부 · 품목 · 거래처별로 나눠 봅니다.', where: '손익 현황 · 운영 지표 · 구매 · 판매' },
  { name: '배분 이익', color: 'var(--orange)', def: '단계 이익 × 배분 비율 + 해 준 지원', use: '판매 이익을 구매 · 합성 · 영업 단계로 나눠 부서에 돌린 금액. 부서 기여도를 봅니다.', where: '본부 성과 · 부서 손익' },
];

const FAQ: { q: string; a: string[]; tag: string }[] = [
  { tag: '이익', q: '화면마다 이익 숫자가 다릅니다. 어느 것이 맞나요?', a: [
    '기준이 셋이라 그렇습니다. 영업이익은 회사 전체 실적, 판매 이익은 판매로 실제 남은 금액, 배분 이익은 그 금액을 단계별로 나눠 부서에 돌린 금액입니다.',
    '회사 실적은 영업이익으로, 부서 기여도는 배분 이익으로 보시면 됩니다.',
  ] },
  { tag: '회계', q: '손익계산서와 금액이 같은가요?', a: [
    '매출액과 판관비는 올린 데이터(판매 · 전표)만으로 손익계산서와 맞습니다.',
    '매출원가는 재고 평가 · 결산 조정이 ERP 원가계산에만 있어 앱 계산과 차이가 납니다.',
    '그래서 마감한 달은 손익계산서를 올려 그 금액을 그대로 쓰고(확정), 마감 전 달만 앱이 계산한 값(추정)을 씁니다.',
  ] },
  { tag: '회계', q: '영업이익과 본부 손익 합계가 다릅니다.', a: [
    '차이는 "회계 조정"입니다. 재고 평가 · 결산 조정처럼 ERP 원가계산에서만 나오는 금액이라 어느 본부 몫인지 나눌 수 없어 회사 전체에만 반영합니다.',
    '본부 손익 합계 ± 회계 조정 = 영업이익. 손익 현황과 경영 요약의 본부 표 아래에 같은 줄이 있습니다.',
  ] },
  { tag: '이익', q: '우리 부서 배분 이익이 0이거나 생각보다 적습니다.', a: [
    '① [배분 비율]에 우리 부서 비율이 있어야 합니다. 그 달 설정이 없으면 가장 최근 달 비율을 씁니다.',
    '② [품목 판매가] · [자재 판매가]에 그 품목의 판매가가 입고월 기준으로 있어야 단계 이익이 계산됩니다. 없으면 0이 아니라 계산에서 빠집니다.',
    '③ 이익은 판매가 발행된 달에 잡힙니다. 아직 팔지 않은 것은 재고입니다.',
    '[부서 손익]의 "배분 이익이 온 곳"에서 단계 · 비율 · 금액을 확인할 수 있습니다.',
  ] },
  { tag: '비용', q: '비용에는 무엇이 들어가나요? 급여도 포함인가요?', a: [
    '부서가 있고 계정에 (판) 또는 (제)가 붙은 전표 전부입니다. 급여 · 퇴직급여 · 감가상각비도 포함입니다. 금액 = 차변 − 대변.',
    '결산 · 대체 전표와 결산 매출 계정은 비용이 아니라서 뺍니다.',
    '본부 성과 · 부서 손익은 여기에 "받은 지원"을 더합니다.',
    '경영 요약 · 손익 현황 · 운영 지표는 판관비((판) 계정)만 씁니다. (제) 계정은 제품 원가에 이미 들어 있어 또 빼면 두 번 빼는 것이기 때문입니다.',
  ] },
  { tag: '비용', q: '이 비용이 맞는지 원본 전표를 보고 싶습니다.', a: [
    '비용 금액 · 계정 · 부서는 대부분 누를 수 있습니다. 누르면 그 조건의 전표(회계일 · 적요 · 금액)가 나옵니다.',
    '전표는 엑셀(CSV)로 받아 ERP와 대조할 수 있습니다.',
  ] },
  { tag: '보기', q: '"이익 대비 비용"이 100%를 넘으면 무슨 뜻인가요?', a: [
    '비용 ÷ 이익 × 100입니다. 100%를 넘으면 번 것보다 많이 쓴 것입니다. 이익이 0 이하면 "-"로 표시합니다.',
    '지원 부서는 이익이 "해 준 지원"뿐이라 높게 나오는 것이 보통입니다.',
  ] },
  { tag: '보기', q: '기준월 · 조회 기간 · 마감월은 무엇인가요?', a: [
    '기준월 = 화면이 "이번 달"로 보는 달. 처음에는 마감월입니다.',
    '조회 기간 = 기준월까지의 3 · 6 · 12개월. 추이 그래프와 누적 금액의 범위입니다.',
    '마감월 = 관리자가 정한, 데이터가 다 들어온 가장 최근 달. 그 뒤 달은 데이터가 덜 들어와 숫자가 작을 수 있습니다.',
  ] },
  { tag: '경영', q: '경영 요약의 "살펴볼 것"은 어떤 기준으로 나오나요?', a: [
    '자동 점검 결과입니다. 영업적자 · 적자 본부 · 매출총이익률이 올해 평균보다 1.5%p 넘게 하락 · 평소보다 3천만원 넘게 늘어난 부서 비용 · 이익률이 5%p 넘게 떨어진 품목 · 상위 5개 거래처 매출 비중 · 6개월 넘은 재고 · 환율 영향(올해 1천만원 이상) · 유효기간이 지났거나 90일 안에 끝나는 재고를 봅니다.',
    '빨강 = 바로 확인, 노랑 = 주의, 파랑 = 참고, 초록 = 좋은 소식. 누르면 해당 화면으로 갑니다.',
  ] },
  { tag: '경영', q: '"연간 전망"은 어떻게 계산하나요?', a: [
    '올해 평균 속도 = 올해 누적 영업이익 ÷ 지난 달 수 × 12. 최근 3개월 속도 = 올해 누적 + 최근 3개월 평균 × 남은 달 수.',
    '단순 환산이라 계획이나 계절성은 반영하지 않습니다.',
  ] },
  { tag: '원가', q: 'LOT 원가는 어떻게 계산하나요?', a: [
    '구매한 LOT = (구매 금액 + 그 BL의 부대비용 몫) ÷ 구매 수량. 부대비용은 같은 BL 안에서 구매 금액 비율로 나눕니다.',
    '생산한 LOT = 입고월의 [월/품목별 제조원가] 단가. 그 달이 없으면 가장 최근 달.',
    '구매와 판매는 "LOT 번호 + 품번"이 같은 것끼리 맞춥니다. [구매 · 판매]에서 BL까지 펼치면 계산 과정을 볼 수 있습니다.',
  ] },
  { tag: '재고', q: '재고 금액은 어디서 온 숫자인가요?', a: [
    '[재고]와 운영 지표 ②의 재고 금액은 ERP [LOT별 재고] 데이터 그대로입니다. 앱이 다시 계산하지 않습니다.',
    '[구매 · 판매]의 "재고 평가액"은 앱이 구매 − 판매 − 투입 − 폐기로 계산한 값이라 ERP 재고와 다를 수 있습니다. 차이 나는 LOT은 운영 지표 ② 아래 "점검"에서 봅니다.',
  ] },
  { tag: '보기', q: '"1.2억"과 "123,456,789"가 섞여 있습니다.', a: [
    '큰 글씨는 읽기 쉽게 억 · 만으로 반올림하고, 표는 원 단위 그대로입니다.',
    '합계는 반올림 전 금액으로 계산하므로, 반올림한 숫자를 직접 더한 값과 조금 다를 수 있습니다.',
  ] },
  { tag: '지원', q: '"지원 내역"은 무엇이고 왜 이익 · 비용에 들어가나요?', a: [
    '한 부서가 다른 부서를 위해 한 일을 금액으로 정해 두고, 해 준 부서의 배분 이익과 받은 부서의 비용에 더하는 사내 정산입니다.',
    '회사 전체로는 같은 금액이 양쪽에 더해져 손익에는 영향이 없습니다. 경영 요약 · 손익 현황 · 운영 지표에는 쓰지 않습니다.',
  ] },
  { tag: '보기', q: '다른 사람과 화면에 보이는 부서 · 금액이 다릅니다.', a: [
    '사원마다 볼 수 있는 화면과 부서가 정해져 있습니다. 부서가 제한된 사용자는 그 범위의 합계만 봅니다.',
    '회사 전체 금액(경영 화면)은 전체 권한 사용자에게만 보입니다.',
  ] },
  { tag: '데이터', q: '어제 본 숫자와 오늘 숫자가 다릅니다.', a: [
    '데이터(구매 · 판매 · 전표 등)를 새로 올렸거나 배분 비율 · 판매가 · 지원 내역 같은 설정을 바꾸면 지난 달 숫자도 다시 계산됩니다.',
    '설정을 누가 언제 바꿨는지는 [변경 이력]에 남습니다(관리자).',
  ] },
  { tag: '회계', q: '3 · 6 · 9 · 12월 숫자가 유독 크거나 작습니다.', a: [
    '분기 마지막 달에는 결산 조정(상여 · 충당금 · 재고 평가 등)이 한꺼번에 들어가 월 금액이 출렁입니다.',
    '분기 합계나 올해 누적으로 보는 것이 정확합니다.',
  ] },
  { tag: '보기', q: '인원이 23.5명처럼 소수점으로 나옵니다.', a: [
    '경영 화면은 경영전략본부 · 연구소의 비용과 인원을 [본부 비용 배분] 비율로 사업 본부에 나눕니다. 나눠 받은 인원이 더해져 소수점이 생깁니다.',
  ] },
  { tag: '환율', q: '환율 "부담 / 절감"은 실제 손익인가요?', a: [
    '(실제 구매 환율 − 회사 기준 환율) × 외화 구매 금액입니다. 장부의 외환차손익이 아니라, 이미 구매 원가에 들어 있는 금액을 따로 떼어 본 참고 지표입니다.',
  ] },
];

const GLOSSARY: [string, string][] = [
  ['매출', '판매 데이터의 판매금액(원화). 판매가 발행된 달에 잡힙니다.'],
  ['판매 이익', '매출 − 판매수량 × LOT 원가. 배분하지 않은, 판매로 실제 남은 금액입니다.'],
  ['단계 이익', '판매 한 건의 이익을 구매 · 합성 · 소재생산 · 영업 단계로 나눈 것. 단계의 경계가 "판매가(구매)"와 "판매가(합성)"입니다.'],
  ['배분 이익', '단계 이익을 [배분 비율]대로 부서에 나눈 금액 + 해 준 지원.'],
  ['손익', '이익 − 비용. 회사 전체는 영업이익이라고 부릅니다.'],
  ['이익 대비 비용', '비용 ÷ 이익 × 100. 100%를 넘으면 번 것보다 많이 쓴 것입니다.'],
  ['이익률', '판매 이익 ÷ 매출 × 100.'],
  ['확정 · 추정', '확정 = 손익계산서 금액 그대로(마감한 달). 추정 = 앱이 구매 · 판매 · 전표로 계산한 값(마감 전).'],
  ['회계 조정', '영업이익 − 본부 손익 합계. 재고 평가 · 결산 조정처럼 본부로 나눌 수 없는 금액입니다.'],
  ['받은 지원 · 해 준 지원', '부서 사이의 업무 지원을 금액으로 정산한 것. 받은 지원은 비용에, 해 준 지원은 배분 이익에 더합니다.'],
  ['판매가(구매) · 판매가(합성)', '구매 부서가 다음 단계로 넘기는 사내 가격 / 합성 부서가 영업으로 넘기는 사내 가격. [품목 판매가] · [자재 판매가]에서 입고월별로 정합니다.'],
  ['LOT', '같은 품번 · 같은 LOT 번호로 들어온 한 묶음. 원가와 이익 계산의 기본 단위입니다.'],
  ['BL', '수입 한 건(선하증권). 부대비용이 BL 단위로 붙습니다.'],
  ['부대비용', '수입할 때 드는 관세 · 운임 · 통관 수수료 등. 구매 원가에 더합니다.'],
  ['거래처', '판매 데이터의 청구처. 수입처는 구매 데이터의 공급 업체입니다.'],
  ['제조원가', 'ERP 원가계산이 낸 그 달 그 품목의 1단위 제조원가(재료비 + 노무비 + 경비 + 외주가공비).'],
  ['(판) · (제)', '계정과목 표시. (판) = 판매비와 관리비(판관비), (제) = 제조 노무비 · 경비.'],
  ['결산 매출', '전표의 상품 · 제품 · 수수료매출(결산) 계정. 분기 마감 수정분개로, 손익 현황의 판매 이익에만 더합니다.'],
  ['자산순번 36 · 37 · 39', '36 · 37 = 제조에 넣는 자재(판매가 없어 구매 단계 이익만 계산). 39 = 판매금액 전부가 판매 부서 단계 이익.'],
  ['생산입고 · 기타입고 · 기타출고 · 반품 · 폐기', '구매 데이터의 수입구분. 생산입고 = 자사 제조품, 기타입고 = 수량만 더함, 기타출고 · 폐기 = 수량을 뺌, 반품 = 음수 수량 · 금액을 더함.'],
  ['%p', '퍼센트 포인트. 두 비율의 차이 (48% → 45%는 −3%p).'],
];

function Doc({ d }: { d: HelpDoc }) {
  return (
    <div className="gd-doc">
      <p>{d.what}</p>
      <h5>계산</h5>
      <div className="calc">{d.calc.map((c, i) => <div key={i}>{c.startsWith('  ') ? c : '• ' + c}</div>)}</div>
      <h5>쓰는 데이터</h5>
      <table><tbody>{d.sources.map((s, i) => <tr key={i}><td>{s.ds}</td><td>{s.cols}</td></tr>)}</tbody></table>
      {d.notes && d.notes.length > 0 && <><h5>세부 기준</h5><ul>{d.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></>}
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
    <div className="page narrow gd">
      <style>{`
        .gd h2{font-size:16.5px;font-weight:700;margin:4px 0 8px}
        .gd .three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
        .gd .three>div{background:var(--surface);border:1px solid var(--line);border-top:3px solid var(--k);border-radius:var(--r);padding:14px 16px;box-shadow:var(--shadow-xs);display:grid;gap:5px;align-content:start}
        .gd .three b{font-size:16px}
        .gd .three code{font:600 12.5px var(--font-body);background:var(--surface-2);border-radius:6px;padding:4px 8px;color:var(--fg-2);justify-self:start}
        .gd .three p{font-size:13.5px;line-height:1.6;color:var(--fg-2)}
        .gd .three small{font-size:12px;color:var(--fg-3)}
        .gd .item{border:1px solid var(--line);border-radius:12px;background:var(--surface);overflow:hidden}
        .gd .item+.item{margin-top:8px}
        .gd .item>button{display:flex;gap:10px;align-items:center;width:100%;text-align:left;border:0;background:transparent;padding:13px 16px;font:600 14.5px var(--font-body);color:var(--fg);cursor:pointer}
        .gd .item>button:hover{background:var(--surface-2)}
        .gd .item>button .ar{margin-left:auto;color:var(--fg-3);font-size:12px;white-space:nowrap}
        .gd .ans{padding:0 16px 14px 16px;font-size:14px;line-height:1.7;color:var(--fg-2);display:grid;gap:5px}
        .gd .sub{border-top:1px solid var(--line)}
        .gd .sub>button{display:flex;gap:8px;align-items:center;width:100%;text-align:left;border:0;background:transparent;padding:10px 16px 10px 28px;font:500 14px var(--font-body);color:var(--fg);cursor:pointer}
        .gd .sub>button:hover{background:var(--surface-2)}
        .gd-doc{padding:2px 16px 14px 28px;font-size:13.5px;line-height:1.65;color:var(--fg-2)}
        .gd-doc h5{font-size:12px;font-weight:700;color:var(--fg-3);margin:12px 0 5px}
        .gd-doc table{width:100%;border-collapse:collapse;font-size:13px}
        .gd-doc td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
        .gd-doc td:first-child{white-space:nowrap;font-weight:600;color:var(--fg);width:1%}
        .gd-doc .calc{background:var(--surface-2);border-radius:10px;padding:10px 13px;display:grid;gap:4px;font-size:13px;color:var(--fg)}
        .gd-doc .calc div{white-space:pre-wrap}
        .gd-doc ul{padding-left:18px;list-style:disc;display:grid;gap:3px;font-size:13px}
        .gd .gl{display:grid;grid-template-columns:210px minmax(0,1fr);border:1px solid var(--line);border-radius:12px;background:var(--surface);overflow:hidden;font-size:13.5px}
        .gd .gl>div{padding:9px 14px;border-bottom:1px solid var(--line);line-height:1.6}
        .gd .gl>div:nth-child(odd){font-weight:600;background:var(--surface-2)}
        .gd .gl>div:nth-last-child(-n+2){border-bottom:0}
        @media(max-width:820px){.gd .three{grid-template-columns:1fr}.gd .gl{grid-template-columns:1fr}.gd .gl>div:nth-child(odd){border-bottom:0;padding-bottom:2px}.gd-doc{padding-left:16px}.gd .sub>button{padding-left:16px}}
      `}</style>
      <PageHead title="계산 기준" desc={<>화면의 숫자가 어떤 데이터로 어떻게 계산됐는지 모았습니다. 모두 ERP에서 받은 데이터와 관리자가 정한 기준으로 계산하며, 손으로 고친 숫자는 없습니다. 지금 마감월은 <b>{ymLabel(closeMonth || '')}</b>입니다.</>}>
        <input className="inp" placeholder="찾기 — 예: 판매 이익, 부대비용, 환율" value={q} onChange={e => setQ(e.target.value)} style={{ width: 280 }} aria-label="설명 찾기" />
      </PageHead>

      {!kw && <section>
        <h2>이익은 세 가지입니다</h2>
        <div className="three">{THREE.map(t => (
          <div key={t.name} style={{ '--k': t.color } as React.CSSProperties}><b>{t.name}</b><code>{t.def}</code><p>{t.use}</p><small>보는 곳: {t.where}</small></div>
        ))}</div>
        <ol className="steps" style={{ marginTop: 12 }}>
          <li><span><b>제목 옆 (?)</b> 를 누르면 그 표의 뜻과 계산이 나옵니다.</span></li>
          <li><span><b>점선 밑줄 친 열 이름</b>에 마우스를 올리면 그 열의 계산이 한 줄로 나옵니다.</span></li>
          <li><span><b>금액을 누르면</b> 전표나 LOT 내역까지 내려가 확인할 수 있습니다.</span></li>
        </ol>
      </section>}

      {faq.length > 0 && <section>
        <h2>자주 묻는 질문</h2>
        {faq.map((f, i) => { const k = 'q' + FAQ.indexOf(f); return (
          <div className="item" key={i}>
            <button onClick={() => tog(k)} aria-expanded={isOpen(k)}><span className="tag b">{f.tag}</span><span>{f.q}</span><span className="ar">{isOpen(k) ? '▴' : '▾'}</span></button>
            {isOpen(k) && <div className="ans">{f.a.map((p, j) => <div key={j}>{p}</div>)}</div>}
          </div>
        ); })}
      </section>}

      {gl.length > 0 && <section>
        <h2>용어</h2>
        <div className="gl">{gl.map(([a, b]) => [<div key={a}>{a}</div>, <div key={a + 'v'}>{b}</div>])}</div>
      </section>}

      {shown.length > 0 && <section>
        <h2>화면별 계산</h2>
        {shown.map(g => (
          <div className="item" key={g.key}>
            <button onClick={() => tog('g' + g.key)} aria-expanded={isOpen('g' + g.key)}><span>{g.title}</span><span className="help" style={{ fontWeight: 400 }}>{g.docs.length}개</span><span className="ar">{isOpen('g' + g.key) ? '▴' : '▾'}</span></button>
            {isOpen('g' + g.key) && <>
              {g.path && <div style={{ padding: '0 16px 8px' }}><button className="btn sm ghost" onClick={() => nav(g.path!)}>이 화면 열기 →</button></div>}
              {g.docs.map(([id, d]) => (
                <div className="sub" key={id}>
                  <button onClick={() => tog(id)} aria-expanded={isOpen(id)}><span>{d.title}</span><span style={{ marginLeft: 'auto', color: 'var(--fg-3)', fontSize: 12 }}>{isOpen(id) ? '▴' : '▾'}</span></button>
                  {isOpen(id) && <Doc d={d} />}
                </div>
              ))}
            </>}
          </div>
        ))}
      </section>}
      {!faq.length && !shown.length && !gl.length && <div className="card"><div className="empty">"{q}"에 맞는 설명이 없습니다.</div></div>}
    </div>
  );
}
