// 기존 화면 모듈 (Apps Script 판에서 그대로 이전) — 셸 API(KJHub)와 google.script.run 셈을 통해 Supabase 와 연결
/* eslint-disable */
export default function init() {
  const __onReady = fn => fn();

(function () {
  const formatCurrency = value => new Intl.NumberFormat('ko-KR').format(Math.round(value || 0));
  // 부서 마스터(BizUnitName)에서 부서→사업단위 맵 생성. 없으면 아래 BUMap 휴리스틱으로 폴백.
  function buMapFromMaster() {
    const rows = window.KJHub && window.KJHub.data && window.KJHub.data.dept;
    if (!Array.isArray(rows) || !rows.length) return null;
    const nrm = s => String(s == null ? '' : s).replace(/\s+/g, '');
    const m = {};
    for (const r of rows) {
      const dn = String(r['DeptName'] || '').trim();
      const bu = String(r['BizUnitName'] || '').trim();
      if (dn && bu) m[nrm(dn)] = bu;
    }
    return Object.keys(m).length ? m : null;
  }
  const BUMap = {
    '보관관리_ATS': 'ATS',
    '총무_ATS': 'ATS',
    '품질경영_ATS': 'ATS',
    'RA팀': '본사',
    '글로벌구매팀': '본사',
    '영업지원팀': '본사',
    '영업팀': '본사',
    '인재문화팀': '본사',
    '자금팀': '본사',
    '전략기획팀': '본사',
    '회계팀': '본사',
    '소재공무팀': '소재',
    '소재기술연구소': '소재',
    '소재기술제2연구소': '소재',
    '소재영업지원팀': '소재',
    '소재영업팀': '소재',
    '소재운영지원팀': '소재',
    '소재전략구매팀': '소재',
    '소재품질경영팀': '소재',
    '소재합성팀': '소재',
    '소재환경안전팀': '소재',
    '공무팀': '합성',
    '보관관리팀': '합성',
    '운영지원팀_합성': '합성',
    '의약연구소': '합성',
    '품질관리팀(Q.C)': '합성',
    '품질보증팀(Q.A)': '합성',
    '합성기획팀': '합성',
    '합성팀': '합성',
    '환경안전팀': '합성'
  };
  let rawData = [];
  let activeTab = '판관비';
  let analyzedData = null;
  let currentTreeRows = [];
  let isAllExpanded = false;

  // 렌더링 제한: 계정과목별 적요(level4) 표시 개수 — 계정마다 독립 제어
  const ITEM_BASE = 20;
  const ITEM_STEP = 50;
  let acctItemLimits = new Map(); // acctId → 표시 상한 (기본 ITEM_BASE)

  // DOM 요소
  // 상태/에러 표시는 상단 공용 패널이 담당. 아래는 미존재 시 안전 폴백(분리된 노드).
  const statusText = document.getElementById('statusText') || document.createElement('span');
  const errorBox = document.getElementById('errorBox') || document.createElement('div');
  const errorMessage = document.getElementById('errorMessage') || document.createElement('span');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const collapseAllBtn = document.getElementById('collapseAllBtn');
  const searchBtn = document.getElementById('searchBtn');

  // 필터 요소
  const dateFrom = document.getElementById('dateFrom');
  const dateTo = document.getElementById('dateTo');
  const deptFilter = document.getElementById('deptFilter');
  const accFilter = document.getElementById('accFilter');
  const buFilter = document.getElementById('buFilter');
  const descFilter = document.getElementById('descFilter');

  // 🚨 텍스트 정규화: 구글 시트를 거치며 흔히 생기는 표기 차이를 흡수
  //    - 전각 괄호(（）) -> 반각 괄호(()) : 육안으로는 구분이 거의 안 되지만 문자열 비교시 다르게 취급됨
  //    - 폭 없는 공백/줄바꿈 없는 공백 등 눈에 안 보이는 문자 제거
  function normalizeText(s) {
    return (s || '').toString().replace(/[\uFF08]/g, '(').replace(/[\uFF09]/g, ')').replace(/[\u200B\u200C\u200D\uFEFF]/g, '').replace(/\u00A0/g, ' ').trim();
  }

  // 💡 문제 진단용: 문자열을 유니코드 코드포인트(16진수)로 풀어서 보여줌
  //    -> 화면상으로는 똑같아 보이는 전각/반각 문자, BOM, 폭 없는 공백 등을 구분하기 위함
  //    참고로 반각 괄호 ( = 0028, ) = 0029 / 전각 괄호 （ = ff08, ） = ff09 / BOM = feff
  function hexDump(s) {
    return Array.from((s || '').toString()).map(c => c.codePointAt(0).toString(16).padStart(4, '0')).join(' ');
  }

  // 🚨 아주 단순하고 명확하게 숫자만 추출하는 파싱 함수
  // 전표 컬럼명 신구 대응표: 영문(신규) -> 한글(기존 내부 키)
  const VOUCHER_COLMAP = {
    AccDate: '회계일',
    AccNo: '계정코드',
    AccName: '계정과목',
    UMCostTypeName: '비용구분',
    DrAmt: '차변금액',
    CrAmt: '대변금액',
    Summary: '적요',
    CostCCtrName: '코스트센터'
  };
  function parseRawRow(obj) {
    // 새 영문 컬럼명이 오면 기존 한글 키로 복사해 하위 로직이 그대로 동작하게 함
    for (const en in VOUCHER_COLMAP) {
      const ko = VOUCHER_COLMAP[en];
      if ((obj[ko] == null || obj[ko] === '') && obj[en] != null) obj[ko] = obj[en];
    }
    // 엑셀의 '회계일' 열에서 숫자(-, / 제외)만 추출
    const rawDateStr = (obj['회계일'] || '').toString();
    obj._cleanDate = rawDateStr.replace(/[^0-9]/g, '');
    // 분류 판별에 쓰이는 필드는 미리 정규화해서 저장해둠
    obj._normAccName = normalizeText(obj['계정과목']);
    obj._normCostType = normalizeText(obj['비용구분']);
    return obj;
  }
  rawData = []; // 데이터 로드 전에는 아무것도 표시하지 않음

  // 이벤트 리스너 설정
  searchBtn.addEventListener('click', processData);
  function showLoadError(msg) {
    errorMessage.innerText = msg;
    errorBox.classList.remove('hidden');
    errorBox.style.display = 'flex';
    statusText.innerText = '불러오기 실패';
  }

  // 💡 회계일자 "To" 필터 기본값을, 불러온 데이터에 실제로 존재하는 가장 마지막 날짜로 설정
  //    (사용자가 이미 직접 값을 입력해둔 경우에는 덮어쓰지 않음)
  function applyDefaultDateTo(force) {
    if (!dateFrom.value) dateFrom.value = '2025-01-01'; // 최초 접속 회계일 From 기준
    if (dateTo.value && !force) return; // 이미 사용자가 값을 지정했으면 유지
    // ★ 회계일 To 기본값 = 마감월의 마지막 일자 (마감월 미설정 시 데이터 최종일)
    if (window.KJHub && window.KJHub.closeMonthEnd) { dateTo.value = window.KJHub.closeMonthEnd(); return; }
    const validDates = rawData.map(r => r._cleanDate).filter(d => d && d.length === 8);
    if (validDates.length === 0) return;
    const maxDate = validDates.reduce((a, b) => b > a ? b : a);
    dateTo.value = maxDate.slice(0, 4) + "-" + maxDate.slice(4, 6) + "-" + maxDate.slice(6, 8);
  }
  // 마감월이 바뀌면 회계일 To 를 새 마감월 말일로 갱신
  window.addEventListener('kjhub:closemonth', () => { applyDefaultDateTo(true); processData(); });
  tabBtns.forEach(btn => {
    btn.addEventListener('click', e => {
      activeTab = e.currentTarget.dataset.tab;
      updateTabUI();
      acctItemLimits = new Map();
      renderDashboard();
    });
  });
  collapseAllBtn.addEventListener('click', () => {
    isAllExpanded = false;
    currentTreeRows.forEach(r => {
      r.expanded = false;
    });
    acctItemLimits = new Map();
    renderTableHTML();
  });
  function processData() {
    const result = {
      '판관비': {
        total: 0,
        bus: {}
      },
      '제조경비': {
        total: 0,
        bus: {}
      }
    };

    // 🚨 입력된 날짜에서 숫자만 추출 (예: 2026-04-05 -> 20260405)
    const startDate = dateFrom.value ? dateFrom.value.replace(/[^0-9]/g, '') : '';
    const endDate = dateTo.value ? dateTo.value.replace(/[^0-9]/g, '') : '';
    const fDept = deptFilter.value.trim().toLowerCase();
    const fAcc = accFilter.value.trim().toLowerCase();
    const fBu = buFilter ? buFilter.value.trim().toLowerCase() : '';
    const fDesc = descFilter.value.trim().toLowerCase();
    const masterBU = buMapFromMaster(); // 부서 마스터 기반 사업단위 맵 (없으면 null)
    const nrmDept = s => String(s == null ? '' : s).replace(/\s+/g, '');
    rawData.forEach(row => {
      // 🚨 회계일 숫자값 추출
      const accDate = row._cleanDate;

      // 🚨 회계일 BETWEEN 시작일 AND 종료일 논리 적용
      if (startDate && (!accDate || accDate < startDate)) return;
      if (endDate && (!accDate || accDate > endDate)) return;
      const accName = row._normAccName !== undefined ? row._normAccName : normalizeText(row['계정과목']);
      const desc = (row['적요'] || '').trim();
      const dept = (row['코스트센터'] || row['부서'] || '기타').trim();
      const costType = row._normCostType !== undefined ? row._normCostType : normalizeText(row['비용구분']);

      // 텍스트 필터 적용 (부분 일치)
      if (fDept && !dept.toLowerCase().includes(fDept)) return;
      if (fAcc && !accName.toLowerCase().includes(fAcc)) return;
      if (fDesc && !desc.toLowerCase().includes(fDesc)) return;

      // 월말 결산/대체 전표 무시
      if (accName.includes('집합') || desc.includes('제조원가대체') || desc.includes('손익대체') || desc.includes('원가대체') || dept.includes('원가계산')) return;
      if (/^(상품|제품)매출\(결산\)$/.test(String(accName).replace(/\s+/g, ''))) return; // 결산 매출 — 비용 아님

      // 비용 타입 판별
      let type = null;
      if (accName.includes('(판)')) type = '판관비';else if (accName.includes('(제)')) type = '제조경비';else if (costType.includes('판관')) type = '판관비';else if (costType.includes('제조')) type = '제조경비';
      if (!type) return;

      // 사업단위 매핑 (부서 마스터 BizUnitName 우선, 없으면 휴리스틱)
      let bu = (masterBU && masterBU[nrmDept(dept)]) || BUMap[dept];
      if (!bu) {
        if (dept.includes('ATS')) bu = 'ATS';else if (dept.includes('소재')) bu = '소재';else if (dept.includes('합성')) bu = '합성';else bu = '본사';
      }
      // 사업단위 필터 (부분 일치)
      if (fBu && !String(bu).toLowerCase().includes(fBu)) return;
      const debit = parseFloat(String(row['차변금액'] || '').replace(/,/g, '').trim()) || 0;
      const credit = parseFloat(String(row['대변금액'] || '').replace(/,/g, '').trim()) || 0;
      const cost = debit - credit;
      if (cost === 0 && debit === 0 && credit === 0) return;
      const target = result[type];
      target.total += cost;
      if (!target.bus[bu]) target.bus[bu] = {
        total: 0,
        centers: {}
      };
      const buNode = target.bus[bu];
      buNode.total += cost;
      if (!buNode.centers[dept]) buNode.centers[dept] = {
        total: 0,
        accounts: {}
      };
      const ccNode = buNode.centers[dept];
      ccNode.total += cost;
      if (!ccNode.accounts[accName]) ccNode.accounts[accName] = {
        total: 0,
        items: {}
      };
      const accNode = ccNode.accounts[accName];
      accNode.total += cost;
      accNode.items[desc] = (accNode.items[desc] || 0) + cost;
    });
    analyzedData = result;
    updateKPIs();
    acctItemLimits = new Map();
    renderDashboard();
  }
  function updateKPIs() {
    const pTotal = analyzedData['판관비'].total;
    const mTotal = analyzedData['제조경비'].total;
    document.getElementById('kpiTotal').innerText = "₩" + formatCurrency(pTotal + mTotal);
    document.getElementById('kpiPan').innerText = "₩" + formatCurrency(pTotal);
    document.getElementById('kpiJejo').innerText = "₩" + formatCurrency(mTotal);
  }
  function updateTabUI() {
    tabBtns.forEach(btn => {
      if (btn.dataset.tab === activeTab) {
        btn.className = "tab-btn px-8 py-4 font-bold text-base transition-all relative rounded-t-lg bg-white text-indigo-700 border-t border-l border-r border-slate-200 shadow-[0_-2px_4px_rgba(0,0,0,0.02)]";
        btn.querySelector('.tab-indicator').classList.remove('hidden');
      } else {
        btn.className = "tab-btn px-8 py-4 font-bold text-base transition-all relative rounded-t-lg text-slate-500 hover:text-slate-700 hover:bg-slate-200/50";
        btn.querySelector('.tab-indicator').classList.add('hidden');
      }
    });
    document.getElementById('tableTitle').innerText = "[" + activeTab + "] 사업단위 ➔ 부서 ➔ 계정과목";
  }
  function renderDashboard() {
    buildTreeData(analyzedData[activeTab]);
    renderTableHTML();
  }

  // 💡 적요에서 핵심 키워드 추출 (금액 가중 빈도 상위 n개)
  //    팀장이 "이 계정에서 실제로 뭐에 돈이 나갔는지"를 펼치지 않고도 볼 수 있게 함
  // 불용어: 일반 명사/컬럼명 계열(정보성 없음)은 제외
  const KW_STOP = new Set(['및', '관련', '비용', '대금', '지급', '결제', '기타', '외', '건', '정기', '금액', '처리', '부서', '건수', '수량', '지역', '내역', '일자', '합계', '당월', '전월', '월분', '상세', '명세', '개월', '코스트센터', '계정과목', '적요', '차변', '대변', '차변금액', '대변금액', '회계일', '비용구분', '사업장', '거래처', '전표', '급여', '상여', '상여금']);
  // 은행명 제외
  ['국민','하나','신한','우리','기업','농협','수협','새마을','신협','씨티','산업','수출입','케이','토스','카카오','국민은행','하나은행','신한은행','우리은행','농협은행','기업은행','카카오뱅크','토스뱅크','케이뱅크','은행','법인','계좌','이체','송금'].forEach(w => KW_STOP.add(w));
  // 사람 이름(정확 일치) + 성씨 기반 추정 제외
  const KW_NAME = new Set(['홍종호', '임무택']);
  const KW_SURNAME = new Set('김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허남심노하곽성차주우구민'.split(''));
  const KW_SUFFIX_OK = new Set(['비', '료', '대', '금', '값', '품', '서']);
  // 날짜/금액/건수/차수 등 숫자성 토큰 제거 (2026년06월 처럼 붙은 형태까지)
  const kwIsDateNum = t => /[0-9]/.test(t) && t.replace(/[0-9,.\-\/]/g, '').replace(/(년도|분기|월분|년|월|일|차|회|기|호|건|차수)/g, '').length < 2;
  // 3글자 한글 + 성씨로 시작 + 업무접미사(비/료/대…) 아님 → 사람 이름으로 간주
  const kwLikelyName = t => KW_NAME.has(t) || (t.length === 3 && /^[가-힣]{3}$/.test(t) && KW_SURNAME.has(t[0]) && !KW_SUFFIX_OK.has(t[2]));
  // 적요 → 키워드 후보 토큰 (유니그램 + 인접 바이그램). 숫자/날짜/불용어 제외.
  function kwTokens(desc) {
    const raw = String(desc).split(/[^0-9A-Za-z가-힣]+/);
    const toks = [];
    for (let t of raw) {
      t = t.trim();
      if (t.length < 2) continue;
      if (/^[0-9]+$/.test(t)) continue;
      if (/[0-9]/.test(t) && /[A-Za-z]/.test(t)) continue; // BLNo/PONo 등 영숫자 혼합 코드 (예: 202604230003DD, M10E92605NU00185)
      if (kwIsDateNum(t)) continue; // 날짜/금액/건수/차수
      if (KW_STOP.has(t)) continue; // 불용어 + 은행명
      if (kwLikelyName(t)) continue; // 사람 이름
      toks.push(t);
    }
    const out = toks.slice();
    for (let i = 0; i < toks.length - 1; i++) out.push(toks[i] + ' ' + toks[i + 1]); // ② 인접 두 단어 묶음
    return out;
  }
  // ① 계정 간 문서빈도(DF) 사전 계산 → 여러 계정에 흔한 단어는 감점(IDF)에 사용
  function buildKwIdf(data) {
    const df = Object.create(null);
    let N = 0;
    const bus = (data && data.bus) || {};
    for (const b in bus) {
      const centers = bus[b].centers || {};
      for (const c in centers) {
        const accounts = centers[c].accounts || {};
        for (const a in accounts) {
          const items = accounts[a].items || {};
          const set = new Set();
          for (const desc in items)
            for (const t of kwTokens(desc)) set.add(t);
          if (!set.size) continue;
          N++;
          set.forEach(t => {
            df[t] = (df[t] || 0) + 1;
          });
        }
      }
    }
    return { df: df, N: N };
  }
  // 💡 적요 핵심 키워드: 금액 가중 + ② 바이그램 + ① IDF(흔한 단어 감점)
  function topKeywords(items, n, idf) {
    const score = {},
      cnt = {};
    for (const desc in items) {
      const w = Math.abs(items[desc]) || 1;
      const seen = new Set();
      for (const t of kwTokens(desc)) {
        if (seen.has(t)) continue; // 같은 적요 내 중복 1회만
        seen.add(t);
        score[t] = (score[t] || 0) + w; // 금액 가중
        cnt[t] = (cnt[t] || 0) + 1; // 등장한 적요 건수
      }
    }
    // ② 두 단어 묶음은 정보량이 커서 소폭 가산 → 대표어로 승격되기 쉽게
    for (const t in score)
      if (t.indexOf(' ') >= 0) score[t] *= 1.35;
    // ① IDF: 여러 계정에 두루 나오는 단어는 감점, 이 계정만의 특징어는 유지
    if (idf && idf.N) {
      for (const t in score) {
        let iw = Math.log((idf.N + 1) / ((idf.df[t] || 0) + 1));
        score[t] *= (iw < 0.1 ? 0.1 : iw); // 모든 계정에 나와도 완전히 죽이지는 않음
      }
    }
    // 2건 이상의 서로 다른 적요에서 등장한 키워드만 (우연한 한 줄 노출 방지)
    const __dc = Object.keys(items).length; // 적요 건수
    const __min = __dc <= 1 ? 1 : 2; // 1건이면 1건 키워드도 생성
    let cands = Object.keys(score).filter(t => cnt[t] >= __min);
    if (!cands.length) cands = Object.keys(score).filter(t => cnt[t] >= 1);
    // 포함 관계 병합: 점수 높은 온전한 단어를 대표로 (조각어/부분어 노출 방지)
    cands.sort((a, b) => score[b] - score[a]);
    const kept = [];
    for (const t of cands) {
      const rep = kept.find(k => t.includes(k) || k.includes(t));
      if (rep) {
        score[rep] += score[t];
      } else kept.push(t);
    }
    return kept.sort((a, b) => score[b] - score[a]).slice(0, n);
  }
  function buildTreeData(data) {
    currentTreeRows = [];
    const __kwIdf = buildKwIdf(data); // ① 계정 간 흔한 단어 감점을 위한 문서빈도(1회 계산)
    let rIdx = 0;
    const sortedBUs = Object.entries(data.bus).sort((a, b) => b[1].total - a[1].total);
    for (const [buName, buData] of sortedBUs) {
      if (buData.total === 0) continue;
      const buId = "r-" + rIdx++;
      currentTreeRows.push({
        id: buId,
        level: 1,
        name: buName,
        total: buData.total,
        expanded: isAllExpanded
      });
      const sortedCCs = Object.entries(buData.centers).sort((a, b) => b[1].total - a[1].total);
      for (const [ccName, ccData] of sortedCCs) {
        if (ccData.total === 0) continue;
        const ccId = "r-" + rIdx++;
        currentTreeRows.push({
          id: ccId,
          level: 2,
          name: ccName,
          total: ccData.total,
          expanded: isAllExpanded
        });
        const sortedAccs = Object.entries(ccData.accounts).sort((a, b) => b[1].total - a[1].total);
        for (const [accName, accData] of sortedAccs) {
          if (accData.total === 0) continue;
          const accId = "r-" + rIdx++;
          currentTreeRows.push({
            id: accId,
            level: 3,
            name: accName,
            total: accData.total,
            expanded: isAllExpanded,
            keywords: topKeywords(accData.items, 3, __kwIdf)
          });
          const sortedItems = Object.entries(accData.items).sort((a, b) => b[1] - a[1]);
          for (const [itemName, itemTotal] of sortedItems) {
            if (itemTotal === 0) continue;
            currentTreeRows.push({
              id: "r-" + rIdx++,
              level: 4,
              name: itemName,
              total: itemTotal
            });
          }
        }
      }
    }
  }
  function getVisibleRows() {
    const visible = [];
    let hiddenLevel = 999;
    let curAcctId = null,
      shown = 0,
      total = 0;
    const limitOf = id => acctItemLimits.get(id) || ITEM_BASE;
    const flush = () => {
      // 계정 끝: 숨김이 있으면 그 계정 전용 컨트롤 행(더 보기/전체 보기) 추가
      if (curAcctId != null && total > limitOf(curAcctId)) {
        visible.push({
          isCtl: true,
          level: 4,
          acctId: curAcctId,
          hidden: total - limitOf(curAcctId),
          total: 0
        });
      }
      curAcctId = null;
      shown = 0;
      total = 0;
    };
    for (let row of currentTreeRows) {
      if (row.level <= hiddenLevel) hiddenLevel = 999;
      if (hiddenLevel !== 999) continue;
      if (row.level < 4) {
        flush();
        visible.push(row);
        if (row.level === 3) curAcctId = row.id;
        if (!row.expanded) hiddenLevel = row.level;
      } else {
        total++;
        if (shown < limitOf(curAcctId)) {
          visible.push(row);
          shown++;
        }
      }
    }
    flush();
    return visible;
  }
  window.toggleRow = function (id) {
    const row = currentTreeRows.find(r => r.id === id);
    if (row && row.level < 4) {
      row.expanded = !row.expanded;
      renderTableHTML();
    }
  };
  // 계정과목별 적요 더 보기(+50) / 전체 보기
  window.loadMoreItems = function (acctId, amount) {
    const cur = acctItemLimits.get(acctId) || ITEM_BASE;
    acctItemLimits.set(acctId, amount === 'all' ? 999999 : cur + ITEM_STEP);
    renderTableHTML();
  };
  // 상세내역 전체 펼침: 모든 노드 펼치고 계정별 적요도 전부 표시
  function expandAllRows() {
    isAllExpanded = true;
    currentTreeRows.forEach(r => { if (r.level < 4) r.expanded = true; });
    acctItemLimits = new Map();
    currentTreeRows.forEach(r => { if (r.level === 3) acctItemLimits.set(r.id, 999999); });
    renderTableHTML();
  }
  // 사업장별 수익/본부 화면 등에서의 드릴다운 진입점:
  //   부서/계정/사업단위/기간으로 조회 → 데이터가 있는 탭(판관비·제조경비) 자동 선택 → 전체 펼침
  window.__kjDeptCostDrill = function (opts) {
    opts = opts || {};
    if (window.KJHub && window.KJHub.showScreen) window.KJHub.showScreen('dept-cost');
    if (deptFilter) deptFilter.value = opts.dept || '';
    if (accFilter) accFilter.value = opts.acc || '';
    if (buFilter) buFilter.value = opts.unit || '';
    if (descFilter) descFilter.value = '';
    // 기준월(baseMonth, YYYYMM)이 오면 그 한 달을 회계일 From~To에 적용 (기준월 정보 유지)
    const bm = String(opts.baseMonth || '');
    const ms = opts.months || [];
    if (bm.length >= 6) {
      const y = bm.slice(0, 4), mo = bm.slice(4, 6);
      const last = new Date(Number(y), Number(mo), 0).getDate();
      if (dateFrom) dateFrom.value = y + '-' + mo + '-01';
      if (dateTo) dateTo.value = y + '-' + mo + '-' + String(last).padStart(2, '0');
    } else if (ms.length) {
      const m0 = ms[0], m1 = ms[ms.length - 1];
      if (dateFrom) dateFrom.value = m0.slice(0, 4) + '-' + m0.slice(4, 6) + '-01';
      if (dateTo) {
        const last = new Date(Number(m1.slice(0, 4)), Number(m1.slice(4, 6)), 0).getDate();
        dateTo.value = m1.slice(0, 4) + '-' + m1.slice(4, 6) + '-' + String(last).padStart(2, '0');
      }
    }
    processData();
    // 데이터가 있는 탭으로 자동 이동 (계정과목 힌트가 있으면 우선, 없으면 금액 있는 쪽)
    const pT = (analyzedData && analyzedData['판관비']) ? analyzedData['판관비'].total : 0;
    const jT = (analyzedData && analyzedData['제조경비']) ? analyzedData['제조경비'].total : 0;
    let want = null;
    const acc = String(opts.acc || '');
    if (acc.includes('(판)')) want = '판관비';else if (acc.includes('(제)')) want = '제조경비';
    if (want && analyzedData[want] && analyzedData[want].total !== 0) activeTab = want;else if (jT !== 0 && pT === 0) activeTab = '제조경비';else if (pT !== 0) activeTab = '판관비';else activeTab = Math.abs(jT) > Math.abs(pT) ? '제조경비' : '판관비';
    updateTabUI();
    renderDashboard();
    expandAllRows();
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) {}
  };
  function renderTableHTML() {
    const tbody = document.getElementById('tableBody');
    const tableContent = document.getElementById('tableContent');
    const tableEmpty = document.getElementById('tableEmpty');
    const loadMoreContainer = document.getElementById('loadMoreContainer');
    const remainCount = document.getElementById('remainCount');
    const currentDataTotal = analyzedData[activeTab].total;
    if (currentTreeRows.length === 0) {
      tableContent.classList.add('hidden');
      tableEmpty.classList.remove('hidden');
      return;
    }
    tableContent.classList.remove('hidden');
    tableEmpty.classList.add('hidden');
    const rowsToRender = getVisibleRows();
    let html = '';
    rowsToRender.forEach(row => {
      if (row.isCtl) {
        // 계정과목별 컨트롤 행: 적요 더 보기(+50) / 적요 전체 보기
        html += "\n          <tr class=\"border-b border-slate-100 bg-slate-50/40\">\n            <td class=\"p-2 pl-28\" colspan=\"3\"><span class=\"inline-flex items-center gap-2\">" + "<span class=\"text-[11px] text-slate-400 font-semibold\">숨김 적요 " + row.hidden + "건</span>" + "<button onclick=\"loadMoreItems('" + row.acctId + "', 50)\" class=\"text-xs font-semibold text-indigo-600 hover:text-indigo-800 border border-indigo-200 bg-white rounded-full px-2.5 py-0.5 transition-colors\">적요 더 보기 +50</button>" + "<button onclick=\"loadMoreItems('" + row.acctId + "', 'all')\" class=\"text-xs font-semibold text-white bg-slate-700 hover:bg-slate-800 rounded-full px-2.5 py-0.5 transition-colors\">적요 전체 보기</button>" + "</span></td>\n          </tr>\n        ";
        return;
      }
      const hasChild = row.level < 4;
      let paddingCls = 'pl-6';
      if (row.level === 2) paddingCls = 'pl-12';
      if (row.level === 3) paddingCls = 'pl-20';
      if (row.level === 4) paddingCls = 'pl-28';
      let nameSty = 'text-slate-600';
      let iconHtml = '';
      if (row.level === 1) {
        nameSty = 'font-bold text-slate-800 text-[15px]';
        iconHtml = "<i data-lucide=\"chevron-right\" class=\"w-4 h-4 text-indigo-500 tree-icon " + (row.expanded ? 'expanded' : '') + "\"></i>";
      } else if (row.level === 2) {
        nameSty = 'font-semibold text-indigo-700';
        iconHtml = "<i data-lucide=\"chevron-right\" class=\"w-4 h-4 text-indigo-300 tree-icon " + (row.expanded ? 'expanded' : '') + "\"></i>";
      } else if (row.level === 3) {
        nameSty = 'font-medium text-slate-700';
        iconHtml = "<i data-lucide=\"folder\" class=\"w-4 h-4 text-slate-400\"></i>";
      } else {
        nameSty = 'text-slate-500';
        iconHtml = "<div class=\"w-1.5 h-1.5 bg-slate-300 rounded-full ml-1\"></div>";
      }
      const ratio = currentDataTotal > 0 ? (Math.max(0, row.total) / currentDataTotal * 100).toFixed(1) : 0;
      const cursor = hasChild ? 'cursor-pointer tree-row' : '';
      html += "\n          <tr class=\"border-b border-slate-100 " + cursor + "\" " + (hasChild ? "onclick=\"toggleRow('" + row.id + "')\"" : '') + ">\n            <td class=\"p-3 " + paddingCls + " flex items-center gap-2\">\n              <div class=\"w-5 flex justify-center " + (row.expanded ? 'expanded' : '') + "\">\n                " + iconHtml + "\n              </div>\n              <span class=\"" + nameSty + "\">" + row.name + "</span>" + (row.level === 3 && row.keywords && row.keywords.length ? '<span class="hidden lg:flex items-center gap-1 ml-2">' + row.keywords.map(k => "<span class=\"text-[10px] leading-none px-1.5 py-1 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100 whitespace-nowrap\" title=\"적요 주요 키워드 (금액 가중)\">" + k + "</span>").join('') + '</span>' : '') + "\n            </td>\n            <td class=\"p-3 text-right font-semibold " + (row.level === 1 ? 'text-indigo-900' : 'text-slate-700') + "\">\n              " + formatCurrency(row.total) + "\n            </td>\n            <td class=\"p-3\">\n              <div class=\"flex items-center gap-2 justify-end pr-2\">\n                <div class=\"w-24 h-2 bg-slate-100 rounded-full overflow-hidden hidden md:block\">\n                  <div class=\"h-full " + (row.level === 1 ? 'bg-indigo-500' : 'bg-slate-300') + " rounded-full\" style=\"width: " + ratio + "%\"></div>\n                </div>\n                <span class=\"text-xs text-slate-500 w-8 text-right\">" + ratio + "%</span>\n              </div>\n            </td>\n          </tr>\n        ";
    });
    tbody.innerHTML = html;
    lucide.createIcons();
    // 전역 하단 더보기는 폐지 — 계정과목별 컨트롤 행으로 대체
    loadMoreContainer.classList.add('hidden');
    loadMoreContainer.classList.remove('flex');
  }

  // 초기에는 샘플 데이터로 화면을 먼저 그려두고,
  // 상단 공용 데이터 패널(KJHub)에서 "전표(voucher)" 데이터가 준비되면 자동으로 교체합니다.
  processData();

  // [요청 5] 회계일 직접 입력 시에도 2025-01-01 하한 강제 (blur 시 검사)
  ['dateFrom', 'dateTo'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('blur', () => {
      if (el.value && el.value < '2025-01-01') {
        el.value = '2025-01-01';
        if (window.__kjToast) window.__kjToast('조회 가능 기간은 2025년 1월부터예요. 날짜를 2025-01-01로 맞췄습니다.', { title: '조회 기간 안내' });
      }
    });
  });
  let __lastVoucherRows = null; // 동일 데이터 중복 처리 방지
  let __lastDeptRows = null; // 부서 마스터(사업단위 맵) 도착 시 재처리용
  function applyHubData() {
    if (window.KJHub && window.KJHub.isReactScreen && window.KJHub.isReactScreen('dept-cost')) return; // 새 화면이 그림 — 중복 계산 방지
    const raw = window.KJHub && window.KJHub.data && window.KJHub.data.voucher;
    if (!raw) return;
    const deptRows = window.KJHub.data.dept || null;
    if (raw === __lastVoucherRows && deptRows === __lastDeptRows) return; // 전표·부서마스터 모두 그대로면 스킵
    __lastVoucherRows = raw;
    __lastDeptRows = deptRows;
    // 화면별 권한: 이 화면(부서별 비용 현황)에 허용된 부서 행만 사용
    const rows = window.KJHub.rowsFor ? window.KJHub.rowsFor('voucher', '부서별 비용') : raw;
    const deptRoot = document.getElementById('deptRoot');
    if (deptRoot) deptRoot.classList.remove('hidden'); // 데이터 도착 -> 화면 노출
    rawData = rows.map(parseRawRow);
    statusText.innerText = "전표 " + rows.length.toLocaleString('ko-KR') + "건 로드됨";
    applyDefaultDateTo();
    processData();
  }
  window.addEventListener('kjhub:data', applyHubData);
  applyHubData(); // 이미 로드되어 있으면 즉시 반영
})();
  
}
