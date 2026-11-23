// 화면 공통 용어 — 같은 뜻은 어느 화면에서나 같은 말로 적습니다.
/** 지원 금액을 나누는 방식 */
export const SPLIT_LABEL: Record<string, string> = { unit: '1명당 단가', head: '인원수 비율', dept: '부서 수로 똑같이', direct: '직접 입력' };
export const SPLIT_HELP: Record<string, string> = { unit: '단가 × 받는 부서 인원', head: '금액을 인원수 비율로 나눔', dept: '금액을 부서 수로 똑같이 나눔', direct: '부서마다 금액을 직접 입력' };
