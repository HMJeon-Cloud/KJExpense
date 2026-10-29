// 기존 화면 모듈 (Apps Script 판에서 그대로 이전) — 셸 API(KJHub)와 google.script.run 셈을 통해 Supabase 와 연결
/* eslint-disable */
export default function init() {
  const __onReady = fn => fn();

(function () {
  // 공용 허브에서 마지막으로 분석한 데이터 스냅샷 (중복 분석 방지용)
  let __lastHubSnapshot = null;
  const {
    useState,
    useEffect
  } = React;

  // ============================================================================
  // 공통 유틸리티 함수
  // ============================================================================
  // 행에서 첫 번째로 값이 있는 컬럼을 반환 (모듈 최상위 공용 — 인덱스 생성 등에서 사용)
  const pickVal = (row, ...keys) => {
    for (let k of keys) if (row[k] != null && row[k] !== '') return row[k];
    return '';
  };
  const cleanString = str => str ? String(str).replace(/[\r\n]+/g, '').trim() : '';
  const parseNum = str => {
    if (str === null || str === undefined || str === '') return 0;
    const num = parseFloat(String(str).replace(/,/g, ''));
    return isNaN(num) ? 0 : num;
  };
  const formatNumber = num => {
    if (num === null || num === undefined || isNaN(Number(num))) return '0';
    return Math.round(Number(num)).toLocaleString('ko-KR');
  };
  // ── 이윤 9종 (부서별) 컬럼 정의 ─────────────────────────────────────
  //   dept: 이 컬럼이 대응하는 부서명 (구매 데이터 dept / 실자재투입내역 DeptName 과 정확히 일치)
  const PROFIT_COLS = [
    { key: 'ops', short: '운영지원팀', dept: '운영지원팀', color: '#4f46e5', kind: 'buy' },
    { key: 'globalpur', short: '글로벌구매팀', dept: '글로벌구매팀', color: '#0369a1', kind: 'buy' },
    { key: 'salessup', short: '영업지원팀', dept: '영업지원팀', color: '#0d9488', kind: 'buy' },
    { key: 'synth', short: '합성팀', dept: '합성팀', color: '#059669', kind: 'syn' },
    { key: 'sales', short: '영업+영지', dept: '영업팀+영업지원팀', color: '#be123c', kind: 'sales' },
    { key: 'matops', short: '소재운영지원팀', dept: '소재운영지원팀', color: '#c2410c', kind: 'buy' },
    { key: 'scm', short: 'SCM팀', dept: 'SCM팀', color: '#7c3aed', kind: 'buy' },
    { key: 'matsalessup', short: '소재영업지원팀', dept: '소재영업지원팀', color: '#9333ea', kind: 'buy' },
    { key: 'matprod', short: '소재생산팀', dept: '소재생산팀', color: '#b45309', kind: 'syn' },
    { key: 'matsales', short: '소재영업+영지', dept: '소재영업팀+소재영업지원팀', color: '#1d4ed8', kind: 'sales' }
  ];
  PROFIT_COLS.forEach(pc => {
    pc.title = pc.kind === 'buy'
      ? pc.dept + ' 수익 — 합성 대상 아님: 입고 부서가 ' + pc.dept + '인 LOT의 (판매가(구매) − 단가(원)) × 판매수량 · 합성 대상: 실자재투입내역에서 DeptName이 ' + pc.dept + '인 원료의 (판매가(구매) − InPrice) × Qty 합계 · 판매가(구매)는 원료 입고월(DelvInDate) 기준'
      : pc.kind === 'syn'
        ? pc.dept + ' 수익 — (판매가(합성) − 제조원가) × 판매수량 · 합성 대상 LOT 중 품목코드 ' + (pc.key === 'matprod' ? '첫 글자 M' : '첫 글자 M 외') + ' 인 경우'
        : pc.dept + ' 수익 — 판매금액 − (넘겨받는 단가 × 판매수량) · 합성 대상: 판매가(합성) / 그 외: 판매가(구매) · 품목코드 ' + (pc.key === 'matsales' ? '첫 글자 M' : '첫 글자 M 외') + ' 인 경우';
  });
  const PROFIT_DEPT_KEY = (() => { const m = Object.create(null); PROFIT_COLS.forEach(pc => { if (pc.kind === 'buy') m[String(pc.dept).replace(/\s+/g, '').toUpperCase()] = pc.key; }); return m; })();
  // 실자재투입내역 조회 유틸 (원료별 부서·단가)
  const __matPick = (row, cands) => {
    const nz = s => String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase();
    for (const k in row) { const n = nz(k); for (const c of cands) if (n === nz(c)) return row[k]; }
    for (const k in row) { const n = nz(k); for (const c of cands) if (n.indexOf(nz(c)) >= 0) return row[k]; }
    return '';
  };
  //   실자재투입내역 컬럼: GoodItemNo(생산품번) / RRealLotNo(생산LOT) / MatItemNo / MatItemName /
  //                        Qty(투입수량) / InPrice(입고단가) / DeptName
  //   성능: 판매행마다 전체 스캔하지 않도록 (생산품번|생산LOT) 인덱스를 캐시
  let __matIdx = null, __matSrc = null;
  const __matIndex = () => {
    const rows = (window.KJHub && window.KJHub.data && window.KJHub.data.matinput) || [];
    if (__matSrc === rows && __matIdx) return __matIdx;
    const nz = v => String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase();
    const idx = Object.create(null);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const it = nz(__matPick(r, ['GoodItemNo', '생산품번']));
      if (!it) continue;
      const lt = nz(__matPick(r, ['RRealLotNo', '생산LotNo']));
      // 계산에 필요한 값은 인덱스 시점에 한 번만 파싱 (판매행마다 재파싱하지 않도록)
      const ent = {
        row: r,
        deptKey: PROFIT_DEPT_KEY[nz(__matPick(r, ['DeptName', '부서명', '부서']))],
        code: nz(__matPick(r, ['MatItemNo', '자재코드', '원료코드']) || __matPick(r, ['MatItemName', '자재명', '원료명'])),
        ym: String(__matPick(r, ['DelvInDate', '입고일자', '입고일'])).replace(/[^0-9]/g, '').slice(0, 6),
        inPrice: parseNum(__matPick(r, ['InPrice', '입고단가'])),
        qty: parseNum(__matPick(r, ['Qty', '투입수량']))
      };
      (idx[it + '|' + lt] || (idx[it + '|' + lt] = [])).push(ent);
      if (lt) (idx[it + '|'] || (idx[it + '|'] = [])).push(ent); // LOT 미지정 조회용
    }
    __matSrc = rows; __matIdx = idx;
    return idx;
  };
  const __matRowsFor = (itemNo, lotNo) => {
    const nz = v => String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase();
    const it = nz(itemNo);
    if (!it) return [];
    return __matIndex()[it + '|' + nz(lotNo)] || [];
  };
  // ★ 기타입고 배정: 입고(구매 행 + 기타입고 행)를 입고일 순(같으면 구매 행 먼저, 원래 순서)으로 판매에 선입선출 배정했을 때
  //   각 판매 행 중 기타입고 몫 수량 → [판매 행 순서대로 수량]   (DB 0006 의 'c' 와 같은 규칙)
  const inCoverOf = (pRows, inRows, sRows) => {
    const cov = (sRows || []).map(() => 0);
    if (!inRows || !inRows.length) return cov;
    const dOf = r => String(r && (r['PERMITDATE'] || r['수입면장일자'] || r['구매일자']) || '').replace(/[\r\n]+/g, '').trim();
    const qOf = r => { const v = parseFloat(String(r && (r['QTY'] != null && r['QTY'] !== '' ? r['QTY'] : r['수량']) || 0).replace(/,/g, '')); return isNaN(v) ? 0 : v; };
    const ins = (pRows || []).map((r, ix) => ({ d: dOf(r), ix, left: qOf(r), other: false }))
      .concat(inRows.map((r, ix) => ({ d: dOf(r), ix: 1e6 + ix, left: Math.abs(qOf(r)), other: true })))
      .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.ix - b.ix));
    let pi = 0;
    (sRows || []).forEach((sr, si) => {
      let left = qOf(sr);
      while (left > 1e-9) {
        while (pi < ins.length && ins[pi].left <= 1e-9) pi++;
        if (pi >= ins.length) break;
        const q = Math.min(ins[pi].left, left);
        if (ins[pi].other) cov[si] += q;
        ins[pi].left -= q; left -= q;
      }
    });
    return cov;
  };
  const mfgUnitOfLot = lotObj => { const q = lotObj.totalBuyQty != null ? lotObj.totalBuyQty : (lotObj.totalPQty || 0); return q > 0 ? (lotObj.totalPAmt || 0) / q : 0; };
  // 한 판매 행의 이윤 9종 계산 → { key: 값 }
  const computeProfits = args => {
    const out = Object.create(null);
    PROFIT_COLS.forEach(pc => { out[pc.key] = null; });
    const nz = s => String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase();
    const isM = String(args.itemNo || '').trim().toUpperCase().charAt(0) === 'M';
    // ★ 판매데이터 AssetSeq 39 — 판매 부서(DeptName)의 이윤으로 판매금액을 그대로 계상
    if (args.saleDeptAsset) {
      const d0 = nz(args.saleDept);
      // 영업팀·영업지원팀 → 영업+영지 / 소재영업팀·소재영업지원팀 → 소재영업+영지 / 그 외는 해당 부서
      const k0 = (d0 === nz('영업팀') || d0 === nz('영업지원팀')) ? 'sales'
        : (d0 === nz('소재영업팀') || d0 === nz('소재영업지원팀')) ? 'matsales'
        : PROFIT_DEPT_KEY[d0];
      if (k0 != null) out[k0] = Math.round(args.saleAmt || 0);
      return out;
    }
    // ① 구매(원료) 이윤
    if (!args.isSynth || args.tradeAsset) {
      // 합성 대상 아님 → 입고 부서 1곳에 (판매가(구매) − 단가(원))
      const k = PROFIT_DEPT_KEY[nz(args.lotDept)];
      if (k != null && args.sellBuy) out[k] = Math.round((args.sellBuy - args.unitWon) * args.saleQty); // 판매가(구매) 미설정 시 미산출
    } else {
      // 합성 대상 → 실자재투입내역의 원료별 (판매가(구매) − 단가(원)) × 투입수량 을 DeptName 부서로 합산
      const ma = window.__kjMatAlloc;
      const rows2 = __matRowsFor(args.itemNo, args.lotNo);
      out.__matMonths = Object.create(null); // 원료 수익의 '입고월별' 내역 (집계용)
      for (let i = 0; i < rows2.length; i++) {
        const e2 = rows2[i];
        const k = e2.deptKey;
        if (k == null) continue;
        // ★ 판매가(구매)는 그 원료의 입고월(DelvInDate) 기준으로 조회 (LOT 입고월이 아님)
        const sell = (ma && ma.ready && ma.sellBuyOf) ? ma.sellBuyOf(e2.code, e2.ym || args.ym) : 0;
        if (!sell) continue; // 판매가(구매) 미설정 → 계산하지 않음 (0으로 두면 큰 음수가 됨)
        const v = Math.round((sell - e2.inPrice) * e2.qty); // (판매가(구매) − InPrice) × Qty
        out[k] = (out[k] || 0) + v;
        const ym2 = e2.ym || args.ym;
        (out.__matMonths[k] || (out.__matMonths[k] = Object.create(null)));
        out.__matMonths[k][ym2] = (out.__matMonths[k][ym2] || 0) + v;
      }
    }
    // ② 합성/소재생산 이윤 = 판매가(합성) − 제조원가 (합성 대상 LOT만)
    //    noSales: 제품 제조에 투입되는 자재성 입고(AssetSeq 36/37) — 판매가 없으므로 ②③ 미산출
    if (!args.noSales && !args.tradeAsset && args.isSynth && args.sellSyn && args.proc != null) {
      out[isM ? 'matprod' : 'synth'] = Math.round((args.sellSyn - args.proc) * args.saleQty);
    }
    // ③ 영업 이윤 = 판매금액 − (영업이 넘겨받는 단가 × 판매수량)
    //    합성 대상: 內 제조원가 = 판매가(합성) (합성팀에서 넘겨받음)
    //    그 외    : 판매가(구매) (구매팀에서 넘겨받음)
    const __inCost = (args.isSynth && !args.tradeAsset) ? args.sellSyn : args.sellBuy;
    if (!args.noSales && __inCost) { // 미설정(0)이면 판매금액 전액이 수익이 되므로 산출하지 않음
      out[isM ? 'matsales' : 'sales'] = Math.round(args.saleAmt - __inCost * args.saleQty);
    }
    return out;
  };
  // AssetSeq 구분 — 구매 데이터 기준
  //   36·37: 제품 제조에 투입되는 자재성 입고 → 판매내역 공백, 구매 부서 이윤만 산출
  const ASSET_NOSALE = { '36': true, '37': true };
  //   27·28·29·30·42·43: 구매 부서 / 판매 부서 이윤만 (합성팀·소재생산팀 미산출)
  const ASSET_TRADE = { '27': true, '28': true, '29': true, '30': true, '42': true, '43': true };
  //   판매데이터 39: 판매 부서(DeptName)의 이윤으로 판매금액을 그대로 계상
  const ASSET_SALEDEPT = { '39': true };
  const assetSeqOf = row => String(pickVal(row || {}, 'ASSETSEQ', 'AssetSeq', '자산순번') || '').trim();
  const isNoSaleAsset = row => !!ASSET_NOSALE[assetSeqOf(row)];
  const isTradeAsset = row => !!ASSET_TRADE[assetSeqOf(row)];
  const isSaleDeptAsset = row => !!ASSET_SALEDEPT[assetSeqOf(row)];
  // 합성 대상 LOT 여부 — 합성 대상 데이터의 품번+LOT 이 모두 일치할 때
  //   성능: LOT 수 × 합성 데이터 수 선형 탐색을 피하려고 Set 인덱스를 캐시 (데이터가 바뀔 때만 재구축)
  let __synIdx = null, __synSrc = null;
  const __synIndex = () => {
    const rows = (window.KJHub && window.KJHub.data && window.KJHub.data.synth) || [];
    if (__synSrc === rows && __synIdx) return __synIdx;
    const set = Object.create(null);
    for (let i = 0; i < rows.length; i++) {
      const it = String(pickVal(rows[i], 'ITEMNO', 'ItemNo', '품번') || '').trim().toUpperCase();
      const lt = String(pickVal(rows[i], 'LOTNO', 'LotNo', 'LOT번호', 'LOT') || '').trim().toUpperCase();
      if (it && lt) set[it + '|' + lt] = true;
    }
    __synSrc = rows; __synIdx = set;
    return set;
  };
  const __isSynLotOf = (itemNo, lotNo) => {
    const key = String(itemNo || '').trim().toUpperCase() + '|' + String(lotNo || '').trim().toUpperCase();
    return !!__synIndex()[key];
  };
  // 합성 대상 품목 여부 — 이 목록의 품번만 [실자재투입내역] 이동 가능
  const __isPlanItem = code => {
    const c = String(code == null ? '' : code).replace(/\s+/g, '').toUpperCase();
    if (!c) return false;
    try {
      const set = (window.KJHub && window.KJHub.prodPlanItems) ? window.KJHub.prodPlanItems() : null;
      return !!(set && set[c]);
    } catch (e) { return false; }
  };
  const formatFloat = num => {
    if (num === null || num === undefined || isNaN(Number(num))) return '0';
    return Number(num).toLocaleString('ko-KR', {
      maximumFractionDigits: 4
    });
  };
  const formatDate = dateStr => {
    if (!dateStr || dateStr.length !== 8) return dateStr || '-';
    return dateStr.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  };

  // ============================================================================
  // 아이콘 컴포넌트
  // ============================================================================
  const BarChart3 = ({
    size = 24,
    className = ""
  }) => /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className
  }, /*#__PURE__*/React.createElement("path", {
    d: "M3 3v18h18"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M18 17V9"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M13 17V5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8 17v-3"
  }));
  const ShoppingCart = ({
    size = 24,
    className = ""
  }) => /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "8",
    cy: "21",
    r: "1"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "19",
    cy: "21",
    r: "1"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"
  }));
  const Store = ({
    size = 24,
    className = ""
  }) => /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className
  }, /*#__PURE__*/React.createElement("path", {
    d: "m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M2 7h20"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M22 7v3a2 2 0 0 1-2 2v0a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12v0a2 2 0 0 1-2-2V7"
  }));
  const Calculator = ({
    size = 24,
    className = ""
  }) => /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className
  }, /*#__PURE__*/React.createElement("rect", {
    width: "16",
    height: "20",
    x: "4",
    y: "2",
    rx: "2"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "8",
    x2: "16",
    y1: "6",
    y2: "6"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "16",
    x2: "16",
    y1: "14",
    y2: "18"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 10h.01"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 10h.01"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8 10h.01"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 14h.01"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8 14h.01"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 18h.01"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8 18h.01"
  }));
  const AlertCircle = ({
    size = 20,
    className = ""
  }) => /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "8",
    x2: "12",
    y2: "12"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "16",
    x2: "12.01",
    y2: "16"
  }));
  const ChevronRight = ({
    size = 16,
    className = ""
  }) => /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className
  }, /*#__PURE__*/React.createElement("path", {
    d: "m9 18 6-6-6-6"
  }));
  const Building = ({
    size = 16,
    className = ""
  }) => /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className
  }, /*#__PURE__*/React.createElement("rect", {
    width: "16",
    height: "20",
    x: "4",
    y: "2",
    rx: "2",
    ry: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9 22v-4h6v4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8 6h.01"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 6h.01"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 6h.01"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 10h.01"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 14h.01"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 10h.01"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 14h.01"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8 10h.01"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8 14h.01"
  }));
  const Users = ({
    size = 16,
    className = ""
  }) => /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className
  }, /*#__PURE__*/React.createElement("path", {
    d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "9",
    cy: "7",
    r: "4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M22 21v-2a4 4 0 0 0-3-3.87"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 3.13a4 4 0 0 1 0 7.75"
  }));
  const User = ({
    size = 16,
    className = ""
  }) => /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className
  }, /*#__PURE__*/React.createElement("path", {
    d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "7",
    r: "4"
  }));
  const Package = ({
    size = 16,
    className = ""
  }) => /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className
  }, /*#__PURE__*/React.createElement("path", {
    d: "m7.5 4.27 9 5.15"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m3.3 7 8.7 5 8.7-5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 22V12"
  }));
  const Factory = ({
    size = 16,
    className = ""
  }) => /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"
  }));
  const ClipboardList = ({
    size = 16,
    className = ""
  }) => /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className
  }, /*#__PURE__*/React.createElement("rect", {
    width: "8",
    height: "4",
    x: "8",
    y: "2",
    rx: "1",
    ry: "1"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 11h4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 16h4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8 11h.01"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8 16h.01"
  }));
  const Box = ({
    size = 16,
    className = ""
  }) => /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className
  }, /*#__PURE__*/React.createElement("path", {
    d: "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m3.3 7 8.7 5 8.7-5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 22V12"
  }));
  const RefreshCw = ({
    size = 16,
    className = ""
  }) => /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className
  }, /*#__PURE__*/React.createElement("path", {
    d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M21 3v5h-5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8 16H3v5"
  }));
  const CheckCircle2 = ({
    size = 16,
    className = ""
  }) => /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className
  }, /*#__PURE__*/React.createElement("path", {
    d: "M21.801 10A10 10 0 1 1 17 3.335"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m9 11 3 3L22 4"
  }));
  const ChevronsDownUp = ({
    size = 16,
    className = ""
  }) => /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className
  }, /*#__PURE__*/React.createElement("path", {
    d: "m7 20 5-5 5 5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m7 4 5 5 5-5"
  }));
  const TrendingUp = ({
    size = 24,
    className = ""
  }) => /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className
  }, /*#__PURE__*/React.createElement("polyline", {
    points: "22 7 13.5 15.5 8.5 10.5 2 17"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "16 7 22 7 22 13"
  }));
  const Receipt = ({
    size = 24,
    className = ""
  }) => /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 17.5v-11"
  }));
  const Coins = ({
    size = 24,
    className = ""
  }) => /*#__PURE__*/React.createElement("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "8",
    cy: "8",
    r: "6"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M18.09 10.37A6 6 0 1 1 10.34 18"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M7 6h1v4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m16.71 13.88.7.71-2.82 2.82"
  }));

  // 도움말 (?) — 새 화면의 도움말 창을 엽니다
  const HelpQ = ({ id }) => React.createElement("button", {
    type: "button", className: "helpdot", title: "이 값은 어떻게 계산되나요?",
    onClick: e => { e.stopPropagation(); if (window.KJHub && window.KJHub.openHelp) window.KJHub.openHelp(id); }
  }, "?");
  // ============================================================================
  // 트리 노드 생성 헬퍼 함수
  // ============================================================================
  const createTreeNode = (name, type) => {
    const node = Object.create(null);
    // 💡 [문제 4 해결] inventoryQty(재고 수량) 필드 추가
    Object.assign(node, {
      name,
      type,
      sales: 0,
      cogs: 0,
      inventory: 0,
      inventoryQty: 0,
      margin: 0,
      estMargin: 0,
      estSynth: 0,
      estSales: 0,
      children: Object.create(null),
      lotGroups: []
    });
    return node;
  };
  const finalizeLeafNode = node => {
    if (node.type === 'blNo') {
      // 부대비용이 포함된 LOTGroup이 하나라도 있으면 showExpense true
      node.showExpense = node.lotGroups.some(g => g.impKind === '직수입' || g.impKind === '생산입고' || g.blExpenseTotal > 0);
      node.blExpenseItems = node.lotGroups[0]?.blExpenseItems || [];
      node.blExpenseTotal = node.lotGroups[0]?.blExpenseTotal || 0;
    } else if (node.children) {
      Object.values(node.children).forEach(finalizeLeafNode);
    }
  };
  const buildTreeFromRows = lotSummaryRows => {
    const tree = Object.create(null);
    let totalSalesAmt = 0,
      totalCogsAmt = 0,
      totalInventoryAmt = 0,
      totalMargin = 0,
      totalEstMargin = 0,
      totalEstSynth = 0,
      totalEstSales = 0;
    const monthlyMargin = Object.create(null); // 발행월(YYYYMM)별 수익
    // 실현 수익(구매) 계산기: 설정 판매가 × 구매수량 × 비율% − 구매원가(부대비용 포함)
    //   판매가(설정/기본값) 없는 품목은 계산 제외(0)
    const ia = window.__kjItemAlloc;
    const lotMonth = lotObj => String(lotObj.pDateRaw || '').replace(/[^0-9]/g, '').slice(0, 6);
    const estOf = lotObj => {
      if (!ia || !ia.ready || !ia.sellBuyOf) return 0;
      const code = lotObj.searchKeywords && lotObj.searchKeywords.itemNo || '';
      const sell = ia.sellBuyOf(code, lotMonth(lotObj)); // 판매가(구매)
      if (sell == null) return 0;
      const __bq = lotObj.totalBuyQty != null ? lotObj.totalBuyQty : (lotObj.totalPQty || 0);
      const unitWon = __bq > 0 ? (lotObj.totalPAmt || 0) / __bq : 0; // 단가(원) — 구매 행 수량 기준
      const cov = (lotObj.inRows && lotObj.inRows.length) ? inCoverOf(lotObj.pRows, lotObj.inRows, lotObj.sRows).reduce((a, b) => a + b, 0) : 0; // 기타입고 몫 판매
      return Math.round((sell - unitWon) * ((lotObj.totalSQty || 0) - cov + (lotObj.totalOutQty || 0))); // (판매가(구매) − 단가(원)) × (판매수량 − 기타입고 몫 + 기타출고수량)
    };
    // 제조원가 단가 = LOT 구매금액 ÷ 구매수량
    const mfgUnitOf = lotObj => { const q = lotObj.totalBuyQty != null ? lotObj.totalBuyQty : (lotObj.totalPQty || 0); return q > 0 ? (lotObj.totalPAmt || 0) / q : 0; };
    // 합성 대상 매칭 셋: 합성 대상 데이터의 (품번|LOT) — 일치하는 LOT에만 실현 수익(합성) 계산
    const synthRows = (window.KJHub && window.KJHub.data && window.KJHub.data.synth) || [];
    const synthSet = new Set();
    const sgv = (row, keys) => { for (let k = 0; k < keys.length; k++) { const v = row[keys[k]]; if (v != null && v !== '') return v; } return ''; };
    for (let i = 0; i < synthRows.length; i++) {
      const r = synthRows[i];
      const it = String(sgv(r, ['ITEMNO', 'ItemNo', '품번']) || '').trim().toUpperCase();
      const lt = String(sgv(r, ['LOTNO', 'LotNo', 'LOT번호', 'LOT']) || '').trim().toUpperCase();
      if (it && lt) synthSet.add(it + '|' + lt);
    }
    // 실현 수익(합성) = 제조원가(그 LOT의 구매금액 합) × 비율(합성)% — 매칭 LOT에만
    const estSynthOf = lotObj => {
      if (!ia || !ia.ready || !synthSet.size) return 0;
      const kw = lotObj.searchKeywords || {};
      const key = String(kw.itemNo || '').trim().toUpperCase() + '|' + String(kw.lotNo || '').trim().toUpperCase();
      if (!synthSet.has(key)) return 0;
      const ym = String(lotObj.pDateRaw || '').replace(/[^0-9]/g, '').slice(0, 6);
      const sellSyn = ia.sellSynOf ? ia.sellSynOf(kw.itemNo || '', ym) : null; // 판매가(합성)
      const proc = ia.mfgOf ? ia.mfgOf(kw.itemNo || '', ym).proc : null;       // 제조원가(입고월 ProcPrice)
      if (sellSyn == null || proc == null) return 0;
      return Math.round((sellSyn - proc) * (lotObj.totalSQty || 0)); // (판매가(합성) − 제조원가) × 판매수량
    };

    lotSummaryRows.forEach(lotObj => {
      const b = lotObj.bizUnit;
      const d = lotObj.dept;
      const bu = lotObj.buyer;
      const i = lotObj.item;
      const v = lotObj.vendor;
      const isLocal = lotObj.impKind === '생산입고' || lotObj.impKind === '내수';
      const bl = lotObj.blNo === '상세 내역' ? '상세 내역' : isLocal ? '상세 내역 (내수/생산입고)' : lotObj.blNo || 'BL정보없음';
      if (!tree[b]) tree[b] = createTreeNode(b, 'bizUnit');
      if (!tree[b].children[d]) tree[b].children[d] = createTreeNode(d, 'dept');
      if (!tree[b].children[d].children[bu]) tree[b].children[d].children[bu] = createTreeNode(bu, 'buyer');
      if (!tree[b].children[d].children[bu].children[i]) tree[b].children[d].children[bu].children[i] = createTreeNode(i, 'item');
      if (!tree[b].children[d].children[bu].children[i].children[v]) tree[b].children[d].children[bu].children[i].children[v] = createTreeNode(v, 'vendor');
      if (!tree[b].children[d].children[bu].children[i].children[v].children[bl]) {
        tree[b].children[d].children[bu].children[i].children[v].children[bl] = createTreeNode(bl, 'blNo');
      }
      const n1 = tree[b],
        n2 = n1.children[d],
        n3 = n2.children[bu],
        n4 = n3.children[i],
        n5 = n4.children[v],
        n6 = n5.children[bl];
      n6.lotGroups.push(lotObj);
      const est = estOf(lotObj);
      const estSy = estSynthOf(lotObj);
      const __kwE = lotObj.searchKeywords || {};
      const __isSyn = synthSet.has(String(__kwE.itemNo || '').trim().toUpperCase() + '|' + String(__kwE.lotNo || '').trim().toUpperCase());
      // 실현 수익(영업) = 판매금액 − (內 제조원가 × 판매수량) · 內 제조원가 = 판매가(합성)
      const __ymE = String(lotObj.pDateRaw || '').replace(/[^0-9]/g, '').slice(0, 6);
      const __p3eE = (ia && ia.ready && ia.sellSynOf) ? ia.sellSynOf(__kwE.itemNo || '', __ymE) : null;
      const estSa = __p3eE == null ? 0 : Math.round((lotObj.totalSAmt || 0) - __p3eE * (lotObj.totalSQty || 0));
      [n1, n2, n3, n4, n5, n6].forEach(node => {
        node.sales += lotObj.sales;
        node.cogs += lotObj.cogs;
        node.inventory += lotObj.inventory;
        node.inventoryQty += lotObj.inventoryQty; // 💡 재고 수량 누적
        node.margin += lotObj.margin;
        node.estMargin += est;
        node.estSynth += estSy;
        node.estSales += estSa;
      });
      totalSalesAmt += lotObj.sales;
      totalCogsAmt += lotObj.cogs;
      totalInventoryAmt += lotObj.inventory;
      totalMargin += lotObj.margin;
      totalEstMargin += est;
      totalEstSynth += estSy;
      totalEstSales += estSa;

      // 💡 판매행 발행일 기준 월별 수익 집계 (buildTreeFromRows는 상위 스코프라 getVal 미사용)
      (lotObj.sRows || []).forEach(s => {
        if (!s) return;
        const raw = s['BILLDATE'] || s['청구일자'] || s['판매일자'] || s['일자'] || '';
        const m = String(raw).replace(/[^0-9]/g, '').slice(0, 6);
        if (m.length === 6) monthlyMargin[m] = (monthlyMargin[m] || 0) + (Number(s._margin) || 0);
      });
    });
    Object.values(tree).forEach(finalizeLeafNode);
    return {
      tree,
      summary: {
        sales: totalSalesAmt,
        cogs: totalCogsAmt,
        inventory: totalInventoryAmt,
        margin: totalMargin,
        estMargin: totalEstMargin,
        estSynth: totalEstSynth,
        estSales: totalEstSales,
        monthly: monthlyMargin
      }
    };
  };

  // ============================================================================
  // 메인 App 컴포넌트
  // ============================================================================
  function App() {
    const [isProcessing, setIsProcessing] = useState(false);
    const [allRows, setAllRows] = useState(null);
    const [errorMsg, setErrorMsg] = useState("");
    const [lastLoadedAt, setLastLoadedAt] = useState(null);
    const [collapseSignal, setCollapseSignal] = useState(0);
    const [itemAllocVer, setItemAllocVer] = useState(0); // 품목 배분 설정 변경 → 실현 수익(구매) 재계산
    React.useEffect(() => {
      const h = () => setItemAllocVer(v => v + 1);
      window.addEventListener('kjhub:itemalloc', h);
      window.addEventListener('kjhub:data', h); // 합성 대상 데이터 등 늦게 도착해도 실현 수익 재계산
      return () => { window.removeEventListener('kjhub:itemalloc', h); window.removeEventListener('kjhub:data', h); };
    }, []);
    const emptyFilters = {
      bizUnit: '',
      dept: '',
      buyer: '',
      itemQuery: '',
      lotNoQuery: '',
      vendorQuery: '',
      custQuery: '',
      blNoQuery: '',
      inDateFrom: '',
      inDateTo: '',
      billDateFrom: '',
      billDateTo: '',
      dateMode: '' // '' = OR(합집합, 기본) / 'and' = AND(두 조건 모두 만족)
    };
    // 최초 접속 기본값: 입고일 From·발행일 From = 2025-01-01 (두 기준의 합집합으로 조회)
    // 입고일/발행일 To 기본값 = 마감월 마지막 일자
    const closeEnd = () => (window.KJHub && window.KJHub.closeMonthEnd) ? window.KJHub.closeMonthEnd() : '';
    // To 는 로그인 후 마감월이 도착하면 채웁니다 (초기에는 비워 둠 → 현재월이 굳는 문제 방지)
    const defaultFilters = Object.assign({}, emptyFilters, {
      inDateFrom: '2025-01-01', billDateFrom: '2025-01-01'
    });
    const autoTo = React.useRef(''); // 자동으로 넣어준 To 값 (사용자가 바꿨는지 판단용)
    const [draftFilters, setDraftFilters] = useState(defaultFilters);
    const [appliedFilters, setAppliedFilters] = useState(defaultFilters);
    // 마감월이 (로그인 후) 정해지거나 바뀌면 아직 손대지 않은 To 날짜를 마감월 말일로 맞춤
    React.useEffect(() => {
      const onCm = () => {
        const end = closeEnd();
        if (!end) return;
        const prev = autoTo.current;
        // 비어 있거나, 이전에 자동으로 넣어준 값 그대로면 새 마감월 말일로 갱신
        const fix = f => Object.assign({}, f, {
          inDateTo: (!f.inDateTo || f.inDateTo === prev) ? end : f.inDateTo,
          billDateTo: (!f.billDateTo || f.billDateTo === prev) ? end : f.billDateTo
        });
        setDraftFilters(f => fix(f));
        setAppliedFilters(f => fix(f));
        autoTo.current = end;
      };
      onCm();
      window.addEventListener('kjhub:closemonth', onCm);
      window.addEventListener('kjhub:login', onCm);
      return () => {
        window.removeEventListener('kjhub:closemonth', onCm);
        window.removeEventListener('kjhub:login', onCm);
      };
    }, []);
    const updateDraft = key => e => setDraftFilters(prev => ({
      ...prev,
      [key]: e.target.value
    }));
    // 날짜 하한: 달력 선택은 min으로, 직접 타이핑은 blur 시점에 검사해 되돌림
    const MIN_QUERY_DATE = '2025-01-01';
    const clampMinDate = key => e => {
      const v = e.target.value;
      if (v && v < MIN_QUERY_DATE) {
        setDraftFilters(prev => ({
          ...prev,
          [key]: MIN_QUERY_DATE
        }));
        if (window.__kjToast) window.__kjToast('조회 가능 기간은 2025년 1월부터예요. 날짜를 ' + MIN_QUERY_DATE + '로 맞췄습니다.', { title: '조회 기간 안내' });
      }
    };
    const handleSearch = () => setAppliedFilters(draftFilters);
    const handleResetFilters = () => {
      const end = closeEnd();
      autoTo.current = end;
      setDraftFilters(Object.assign({}, defaultFilters, end ? { inDateTo: end, billDateTo: end } : {}));
      setAppliedFilters(defaultFilters);
    };
    const normalizeRow = row => {
      const res = Object.create(null);
      for (let key in row) if (key != null) res[String(key).toUpperCase().replace(/[\s\r\n\uFEFF]+/g, '')] = row[key];
      return res;
    };
    const getVal = (row, ...keys) => {
      for (let k of keys) if (row[k] != null && row[k] !== '') return row[k];
      return '';
    };
    const processData = async () => {
      setIsProcessing(true);
      setErrorMsg("");
      try {
        // 💡 데이터 로딩은 상단 공용 데이터 패널(KJHub)에서 일괄 처리
        const hub = window.KJHub && window.KJHub.data || {};
        if (!hub.purchase || !hub.expense || !hub.sale) {
          // 3종 데이터가 아직 준비되지 않음 -> kjhub:data 이벤트가 오면 다시 호출됨
          setIsProcessing(false);
          return;
        }
        // 구매/판매/부대비용은 부서가 개별 행이 아니라 BL 기초행에 있어 행 단위 필터가 불가.
        // → 서버(getScreenData)가 BL/LOT 기준으로 화면 권한에 맞게 스코프해 내려줌. 여기선 그대로 사용.
        // 동일한 데이터로 중복 분석 방지 (다른 데이터셋 publish 시 불필요한 재계산 스킵)
        const snap = [hub.purchase, hub.expense, hub.sale, hub.mfgcost || null];
        if (__lastHubSnapshot && snap.every((v, i) => v === __lastHubSnapshot[i])) {
          setIsProcessing(false);
          return;
        }
        __lastHubSnapshot = snap;
        const rawPurchase = hub.purchase,
          rawExpense = hub.expense,
          rawSale = hub.sale;
        const pDataRaw = rawPurchase.map(normalizeRow);
        const eData = rawExpense.map(normalizeRow);
        const sData = rawSale.map(normalizeRow);
        const disposalMap = Object.create(null);
        const pDataMap = Object.create(null);
        let noLotIdx = 0;
        const returnRaw = [];   // ★ 반품 (수입구분 또는 SMImpTypeName = '반품'): 수량·금액이 음수 — 같은 구매 LOT 에 그대로 더함
        const otherInRaw = [];  // ★ 기타입고 (수입구분 또는 SMImpTypeName = '기타입고'): 같은 LOT 에 수량만 더함
        const otherOutRaw = []; // ★ 기타출고 (SMImpTypeName = '기타출고'): 구매가 아니라 재고에서 나간 수량
        pDataRaw.forEach(p => {
          const impKind = cleanString(getVal(p, 'SMIMPKINDNAME', '수입구분', 'SMIMPKIND'));
          const lot = cleanString(getVal(p, 'LOTNO')).toUpperCase();
          const itemNo = cleanString(getVal(p, 'ITEMNOCHK', 'ITEMNO', '품번')).toUpperCase();
          const __impType = cleanString(getVal(p, 'SMIMPTYPENAME', 'SMIMPTYPE', '입출고구분'));
          if ([impKind, __impType].some(v => v.replace(/\s+/g, '') === '반품')) {
            const itemAlt = cleanString(getVal(p, 'ITEMNO', 'ITEMNOCHK', '품번')).toUpperCase();
            if (lot) returnRaw.push({ row: p, keys: [lot + "_" + itemNo, lot + "_" + itemAlt].filter((v, i, a) => v && a.indexOf(v) === i), qty: parseNum(getVal(p, 'QTY', '수량')), amt: Math.round(parseNum(getVal(p, 'DOMAMT', '원화금액'))) });
            return;
          }
          if ([impKind, __impType].some(v => v.replace(/\s+/g, '') === '기타입고')) {
            const itemAlt = cleanString(getVal(p, 'ITEMNO', 'ITEMNOCHK', '품번')).toUpperCase();
            if (lot) otherInRaw.push({ row: p, keys: [lot + "_" + itemNo, lot + "_" + itemAlt].filter((v, i, a) => v && a.indexOf(v) === i), qty: Math.abs(parseNum(getVal(p, 'QTY', '수량'))) });
            return;
          }
          // ★ 기타출고: 수입구분(SMImpKindName) 또는 SMImpTypeName 값이 '기타출고'
          if ([impKind, cleanString(getVal(p, 'SMIMPTYPENAME', 'SMIMPTYPE', '입출고구분'))].some(v => v.replace(/\s+/g, '') === '기타출고')) {
            const itemAlt = cleanString(getVal(p, 'ITEMNO', 'ITEMNOCHK', '품번')).toUpperCase();
            if (lot) otherOutRaw.push({ row: p, keys: [lot + "_" + itemNo, lot + "_" + itemAlt].filter((v, i, a) => v && a.indexOf(v) === i), qty: Math.abs(parseNum(getVal(p, 'QTY', '수량'))) });
            return;
          }
          if (impKind === '폐기') {
            const key = lot + "_" + itemNo;
            if (!disposalMap[key]) disposalMap[key] = [];
            // 품번 컬럼이 ItemNoChk / ItemNo 로 갈릴 수 있어 후보 키를 함께 보관
            const itemAlt = cleanString(getVal(p, 'ITEMNO', 'ITEMNOCHK', '품번')).toUpperCase();
            disposalMap[key].push({
              lotNo: lot,
              itemNo,
              keys: [lot + "_" + itemNo, lot + "_" + itemAlt].filter((v, i, a) => v && a.indexOf(v) === i),
              qty: parseNum(getVal(p, 'QTY', '수량')),
              blNo: cleanString(getVal(p, 'BLNO', 'BL번호'))
            });
          } else {
            const amt = parseNum(getVal(p, 'DOMAMT', '원화금액'));
            const qty = parseNum(getVal(p, 'QTY', '수량'));
            if (amt > 0 || qty > 0) {
              const key = lot ? lot + "_" + itemNo : "__NO_LOT_PURCHASE_" + noLotIdx++ + "__";
              if (!pDataMap[key]) pDataMap[key] = [];
              pDataMap[key].push(p);
            }
          }
        });

        // ★ 폐기 처리된 입고 제외
        //   수입구분이 '폐기'인 행과 품목·LotNo·수량이 모두 같은 구매 행은 폐기된 건이므로 목록에서 제거
        //   (같은 수량이 여러 건이면 폐기 건수만큼만 제거)
        // (폐기 처리는 판매 맵 구성 후, '잔량' 기준으로 아래에서 수행)

        // 💡 [문제 1 해결] 판매 데이터 LOTNO 공백인 MSV, DSV, HSV 품목 묶어주기
        const sDataMap = Object.create(null);
        let noLotSalesIdx = 0;
        sData.forEach(s => {
          const qty = parseNum(getVal(s, 'QTY', '수량'));
          if (qty === 0) return; // 수량이 정확히 0인 건만 제외, 음수(반품) 통과

          const lot = cleanString(getVal(s, 'LOTNO')).toUpperCase();
          const itemNo = cleanString(getVal(s, 'ITEMNO', '품번')).toUpperCase();
          let key;
          if (lot) {
            key = lot + "_" + itemNo;
          } else if (itemNo.startsWith('MSV') || itemNo.startsWith('DSV') || itemNo.startsWith('HSV')) {
            key = "NO_LOT_" + itemNo;
            s.LOTNO = '-';
          } else {
            key = "__NO_LOT_SALE_" + noLotSalesIdx++ + "__";
          }
          if (!sDataMap[key]) sDataMap[key] = [];
          sDataMap[key].push(s);
        });

        // ★ 같은 LOT 이라도 품번이 다르면 다른 LOT — 항상 "LOT + 품번" 으로 맞춤
        //   구매 행은 품번이 ItemNoChk / ItemNo 두 칸이라, 다른 데이터(폐기·실자재투입)가 ItemNo 로 적혀 있어도 찾을 수 있게 보조 색인을 둠
        const altKeyIdx = Object.create(null); // LOT_ItemNo(보조) → LOT 키
        Object.keys(pDataMap).forEach(k => {
          if (k.indexOf('__NO_LOT_') === 0) return;
          (pDataMap[k] || []).forEach(p => {
            const lt = cleanString(getVal(p, 'LOTNO')).toUpperCase();
            const alt = cleanString(getVal(p, 'ITEMNO', 'ITEMNOCHK', '품번')).toUpperCase();
            if (lt && alt && !altKeyIdx[lt + '_' + alt]) altKeyIdx[lt + '_' + alt] = k;
          });
        });
        // LOT 키 찾기: 정확히 같은 (LOT_품번) 이 있으면 그것, 없으면 보조 품번으로
        const lotKeyOf = cands => { for (const c of cands) if (c && pDataMap[c]) return c; for (const c of cands) if (c && altKeyIdx[c]) return altKeyIdx[c]; return null; };
        // ★ 실자재투입: 생산에 투입된 원료는 재고에서 빠짐 — (자재 LOT RealLotNo + 자재 품번 MatItemNo) 로 구매 LOT 에 맞춤
        const matUseMap = Object.create(null); // LOT 키 → 투입 수량 합
        ((window.KJHub && window.KJHub.data && window.KJHub.data.matinput) || []).forEach(r => {
          const lt = cleanString(__matPick(r, ['RealLotNo', '자재LotNo'])).toUpperCase();
          const it = cleanString(__matPick(r, ['MatItemNo', '자재코드', '원료코드'])).toUpperCase();
          if (!lt || !it) return;
          const k = lotKeyOf([lt + '_' + it]);
          if (!k) return;
          matUseMap[k] = (matUseMap[k] || 0) + Math.abs(parseNum(__matPick(r, ['Qty', '투입수량'])));
        });
        // ★ 기타출고: ItemNoChk + LOTNo 가 같은 구매 LOT 에서 수량을 뺌 (없으면 보조 품번 ItemNo 로)
        const otherOutMap = Object.create(null); // LOT 키 → { qty, rows }
        otherOutRaw.forEach(o => {
          const k = lotKeyOf(o.keys);
          if (!k) return;
          const e = otherOutMap[k] || (otherOutMap[k] = { qty: 0, rows: [] });
          e.qty += o.qty; e.rows.push(o.row);
        });
        // ★ 기타입고: ItemNoChk + LOTNo 가 같은 LOT 에 수량을 더함 (구매 LOT → 보조 품번 → 판매만 있는 LOT 순)
        //   맞는 LOT 이 없으면 반영하지 않음 · 금액·부서는 쓰지 않음 (구매 단가는 구매 행 기준 그대로)
        const otherInMap = Object.create(null); // LOT 키 → { qty, rows }
        // ★ 반품: ItemNoChk + LOTNo 가 같은 구매 LOT 에 수량·금액(음수)을 더함 (없으면 보조 품번) — 맞는 구매 LOT 이 없으면 반영 안 함
        const returnMap = Object.create(null); // LOT 키 → { qty, amt, rows }
        returnRaw.forEach(o => {
          const k = lotKeyOf(o.keys);
          if (!k) return;
          const e = returnMap[k] || (returnMap[k] = { qty: 0, amt: 0, rows: [] });
          e.qty += o.qty; e.amt += o.amt; e.rows.push(o.row);
        });
        otherInRaw.forEach(o => {
          const k = lotKeyOf(o.keys) || o.keys.find(c => sDataMap[c]) || null;
          if (!k) return;
          const e = otherInMap[k] || (otherInMap[k] = { qty: 0, rows: [] });
          e.qty += o.qty; e.rows.push(o.row);
        });
        // ★ 폐기 수량: 폐기 행의 (LOT + 품번 후보) 로 LOT 하나에만 배정
        const disposalByKey = Object.create(null);
        Object.keys(disposalMap).forEach(key => {
          (disposalMap[key] || []).forEach(d => {
            const k = lotKeyOf(d.keys || [key]);
            if (k) disposalByKey[k] = (disposalByKey[k] || 0) + Math.abs(parseNum(d.qty));
          });
        });

        // ★ 폐기 정보 (표시용)
        //   LOT의 잔량(총 입고수량 − 총 판매수량)이 폐기 수량과 같으면 그 잔량은 폐기된 것으로 보고
        //   비용 상세에서 '잔량 행'을 표시하지 않습니다. 총 구매수량·금액은 그대로 둡니다.
        const disposalInfo = Object.create(null); // lotKey → { qty, matched, all }
        let __dispHit = 0, __dispMiss = [];
        Object.keys(disposalMap).forEach(key => {
          const dQty = disposalMap[key].reduce((a, d) => a + Math.abs(parseNum(d.qty)), 0);
          if (dQty <= 0) return;
          const lotNo = (disposalMap[key][0] || {}).lotNo || '';
          // LOT 만 같은 다른 품번은 보지 않음 — 폐기 행의 품번 후보(ItemNoChk/ItemNo)와 맞는 LOT 만
          const keys = (disposalMap[key][0] && disposalMap[key][0].keys || [key]).map(c => (pDataMap[c] ? c : altKeyIdx[c])).filter((v, i, a) => v && a.indexOf(v) === i);
          let hit = false;
          for (const k of keys) {
            const pr = pDataMap[k] || [];
            if (!pr.length) continue;
            const pQty = pr.reduce((a, r) => a + parseNum(getVal(r, 'QTY', '수량')), 0);
            const sQty = (sDataMap[k] || []).reduce((a, r) => a + parseNum(getVal(r, 'QTY', '수량')), 0);
            const left = pQty + ((otherInMap[k] && otherInMap[k].qty) || 0) + ((returnMap[k] && returnMap[k].qty) || 0) - sQty - (matUseMap[k] || 0) - ((otherOutMap[k] && otherOutMap[k].qty) || 0);   // 생산 투입·기타출고분은 이미 빠진 잔량
            if (left <= 0) continue;
            if (Math.abs(left - dQty) > Math.max(1e-6, dQty * 1e-6)) continue;
            disposalInfo[k] = { qty: dQty, matched: true, all: sQty <= 1e-9 }; // 판매가 전혀 없으면 전량 폐기
            hit = true; __dispHit++;
            break;
          }
          if (!hit) __dispMiss.push({ lot: lotNo, qty: dQty });
        });
        if (__dispMiss.length) console.warn('[폐기] 잔량과 수량이 일치하지 않아 반영하지 않은 건 ' + __dispMiss.length + '건:', __dispMiss.slice(0, 20));
        console.info('[폐기] 잔량을 폐기로 표시한 LOT: ' + __dispHit + '건');

        const blBaseInfoMap = Object.create(null);
        const blExpenseMap = Object.create(null);
        const blItemTotalAmtMap = Object.create(null);
        eData.forEach(row => {
          const blNo = cleanString(getVal(row, 'BLNO', 'BL번호'));
          if (!blNo) return;
          const itemCode = cleanString(getVal(row, 'UMEXPENSEITEM', '비용항목코드'));
          if (itemCode.includes('8100011')) {
            blBaseInfoMap[blNo] = {
              bizUnit: cleanString(getVal(row, 'BIZUNITNAME', '사업단위')),
              dept: cleanString(getVal(row, 'DEPTNAME', '부서')),
              buyer: cleanString(getVal(row, 'EMPNAME', '담당자'))
            };
          } else {
            if (!blExpenseMap[blNo]) blExpenseMap[blNo] = {
              total: 0,
              items: []
            };
            const amt = parseNum(getVal(row, 'TOTDOMAMT', '발생금액', '원화금액', 'DOMAMT'));
            blExpenseMap[blNo].items.push({
              name: cleanString(getVal(row, 'UMEXPENSEITEMNAME', '비용항목명', '항목명')),
              vendor: cleanString(getVal(row, 'COSTCUSTNAME', '지급처', '거래처')),
              date: formatDate(cleanString(getVal(row, 'COSTDATE', '청구일자', '일자'))),
              amt: Math.round(amt)
            });
            blExpenseMap[blNo].total += Math.round(amt);
          }
        });
        Object.values(pDataMap).forEach(rows => {
          rows.forEach(r => {
            const bNo = cleanString(getVal(r, 'BLNO', 'BL번호'));
            const iNo = cleanString(getVal(r, 'ITEMNOCHK', 'ITEMNO', '품번')).toUpperCase();
            if (bNo && iNo) {
              blItemTotalAmtMap[bNo + "_" + iNo] = (blItemTotalAmtMap[bNo + "_" + iNo] || 0) + Math.round(parseNum(getVal(r, 'DOMAMT', '원화금액')));
            }
          });
        });
        const lotSummaryRows = [];
        const allLotKeys = new Set([...Object.keys(pDataMap), ...Object.keys(sDataMap)]);
        for (let lotKey of allLotKeys) {
          const pRows = pDataMap[lotKey] || [];
          const sRows = sDataMap[lotKey] || [];
          let bizUnit,
            dept,
            buyer,
            item,
            vendor,
            blNo,
            lotNo,
            itemNo,
            itemName,
            impKind = '';
          if (pRows.length > 0) {
            const firstP = pRows[0];
            blNo = cleanString(getVal(firstP, 'BLNO', 'BL번호'));
            lotNo = cleanString(getVal(firstP, 'LOTNO'));
            bizUnit = blBaseInfoMap[blNo]?.bizUnit || cleanString(getVal(firstP, 'BIZUNITNAME', '사업단위')) || '미지정 사업단위';
            dept = cleanString(getVal(firstP, 'DEPTNAME', '부서')) || blBaseInfoMap[blNo]?.dept || '미지정 부서';
            buyer = blBaseInfoMap[blNo]?.buyer || cleanString(getVal(firstP, 'EMPNAME', '담당자')) || '미지정 담당자';
            itemNo = cleanString(getVal(firstP, 'ITEMNOCHK', 'ITEMNO', '품번'));
            itemName = cleanString(getVal(firstP, 'ITEMNAME', '품목'));
            item = itemName ? itemName + " (" + itemNo + ")" : '미지정 품목';
            vendor = cleanString(getVal(firstP, 'CUSTNAME', '수입처')) + " (" + cleanString(getVal(firstP, 'CUSTNO', '수입처번호')) + ")";
            impKind = cleanString(getVal(firstP, 'SMIMPKINDNAME', '수입구분', 'SMIMPKIND'));
          } else {
            const firstS = sRows[0];
            blNo = '상세 내역';
            lotNo = cleanString(getVal(firstS, 'LOTNO'));
            bizUnit = cleanString(getVal(firstS, 'BIZUNITNAME', '사업단위')) || '미지정 사업단위';
            dept = cleanString(getVal(firstS, 'DEPTNAME', '부서')) || '미지정 부서';
            buyer = cleanString(getVal(firstS, 'EMPNAME', '담당자')) || '미지정 담당자';
            itemNo = cleanString(getVal(firstS, 'ITEMNO', '품번'));
            itemName = cleanString(getVal(firstS, 'ITEMNAME', '품목'));
            item = itemName ? itemName + " (" + itemNo + ")" : '미지정 품목';
            vendor = '(주)국전 (116-87-01173)';
          }
          let totalPQty = 0,
            totalPAmt = 0,
            totalAllocExp = 0,
            pDateRaw = '';
          pRows.forEach(p => {
            const qty = parseNum(getVal(p, 'QTY', '수량'));
            const amt = Math.round(parseNum(getVal(p, 'DOMAMT', '원화금액')));
            totalPQty += qty;
            totalPAmt += amt;
            const pBlNo = cleanString(getVal(p, 'BLNO', 'BL번호'));
            const pItemNo = cleanString(getVal(p, 'ITEMNOCHK', 'ITEMNO', '품번')).toUpperCase();
            const bKey = pBlNo + "_" + pItemNo;
            let allocExp = 0;
            if (blItemTotalAmtMap[bKey] > 0 && amt > 0) {
              allocExp = Math.round((blExpenseMap[pBlNo]?.total || 0) * (amt / blItemTotalAmtMap[bKey]));
            }
            p._allocatedExpense = allocExp;
            totalAllocExp += allocExp;
            const pDate = cleanString(getVal(p, 'PERMITDATE', '수입면장일자', '구매일자'));
            if (pDate > pDateRaw) pDateRaw = pDate;
          });
          const totalRetQty = (returnMap[lotKey] && returnMap[lotKey].qty) || 0;    // 반품 수량 (음수)
          const totalRetAmt = (returnMap[lotKey] && returnMap[lotKey].amt) || 0;    // 반품 금액 (음수)
          const retRows = (returnMap[lotKey] && returnMap[lotKey].rows) || [];
          totalPQty += totalRetQty; totalPAmt += totalRetAmt;     // 구매 수량·금액에 반품을 더함
          const totalCost = totalPAmt + totalAllocExp;
          const totalBuyQty = totalPQty;                          // 구매 + 반품 수량 (단가 기준)
          const unitCost = totalBuyQty > 0 ? totalCost / totalBuyQty : 0;
          const totalInQty = (otherInMap[lotKey] && otherInMap[lotKey].qty) || 0;   // 기타입고 수량
          const inRows = (otherInMap[lotKey] && otherInMap[lotKey].rows) || [];
          totalPQty += totalInQty;                                // 총 입고 수량 = 구매 + 기타입고
          const disposals = disposalMap[lotNo + "_" + itemNo] || disposalMap[String(lotKey)] || [];
          const totalDisposalQty = disposalByKey[lotKey] || 0;   // LOT + 품번 으로 맞춘 폐기 수량
          const totalMatQty = matUseMap[lotKey] || 0;            // 생산에 투입된 수량 (실자재투입)
          const totalOutQty = (otherOutMap[lotKey] && otherOutMap[lotKey].qty) || 0;   // 기타출고 수량
          const outRows = (otherOutMap[lotKey] && otherOutMap[lotKey].rows) || [];
          let totalSQty = 0,
            totalSAmt = 0,
            sDateRaw = '';

          // 💡 [문제 3 해결] 판매 데이터 청구일자(발행일) 기준 오름차순 정렬
          sRows.sort((a, b) => {
            const dateA = cleanString(getVal(a, 'BILLDATE', '청구일자', '판매일자', '일자')).replace(/[^0-9]/g, '');
            const dateB = cleanString(getVal(b, 'BILLDATE', '청구일자', '판매일자', '일자')).replace(/[^0-9]/g, '');
            return dateA.localeCompare(dateB);
          });
          // 실현 수익 원가 기준: [월별품목별제조원가] 입고월 ProcPrice — 없으면 기존 구매 단가(부대비용 포함)
          const __iaM = window.__kjItemAlloc;
          const __lotM = String(pDateRaw || '').replace(/[^0-9]/g, '').slice(0, 6);
          const __procU = (__iaM && __iaM.ready && __iaM.mfgOf) ? __iaM.mfgOf(itemNo, __lotM).proc : null;
          const marginUnit = __procU != null ? __procU : unitCost;
          sRows.forEach(s => {
            const qty = parseNum(getVal(s, 'QTY', '수량'));
            const amt = Math.round(parseNum(getVal(s, 'DOMAMT', '판매금액', '원화금액')));
            totalSQty += qty;
            totalSAmt += amt;
            s._margin = amt - qty * marginUnit;
            const sDate = cleanString(getVal(s, 'BILLDATE', '청구일자', '판매일자', '일자'));
            if (sDate > sDateRaw) sDateRaw = sDate;
          });
          const cogs = totalSQty * marginUnit; // 매출원가 = 제조원가(입고월) × 판매수량
          const margin = totalSAmt - cogs;      // 실현 수익 = 판매금액 − 제조원가 × 판매수량
          // 💡 소수점 오차 방지를 위해 toFixed(4) 적용하여 재고 수량 계산
          const inventoryQty = Number((totalPQty - totalSQty - totalDisposalQty - totalMatQty - totalOutQty).toFixed(4));
          const inventoryAmt = inventoryQty > 0 ? inventoryQty * unitCost : 0;
          const searchKeywords = {
            itemNo,
            itemName,
            lotNo,
            blNo,
            pCust: pRows.map(r => getVal(r, 'CUSTNO') + " " + getVal(r, 'CUSTNAME')).join(' '),
            sCust: sRows.map(r => getVal(r, 'CUSTNO') + " " + getVal(r, 'CUSTNAME')).join(' ')
          };
          lotSummaryRows.push({
            __key: lotKey, // 검증용 (DB 계산의 lot_key 와 같은 규칙)
            bizUnit,
            dept,
            buyer,
            item,
            vendor,
            blNo,
            lotNo,
            impKind,
            pRows,
            sRows,
            disposals,
            totalPQty,
            totalPAmt,
            totalAllocExp,
            unitCost,
            totalSQty,
            totalSAmt,
            totalDisposalQty,
            totalMatQty,
            totalOutQty,
            outRows,
            totalInQty,
            inRows,
            totalRetQty,
            totalRetAmt,
            retRows,
            totalBuyQty,
            sales: totalSAmt,
            cogs,
            inventory: inventoryAmt,
            inventoryQty,
            margin,
            // 💡 inventoryQty 속성 추가
            pDateRaw,
            sDateRaw,
            searchKeywords,
            disposalInfo: disposalInfo[lotKey] || null, // 폐기(잔량) 표시 정보
            blExpenseTotal: blExpenseMap[blNo]?.total || 0,
            blExpenseItems: blExpenseMap[blNo]?.items || []
          });
        }
        // ★ 입고 부서가 여러 개인 LOT은 부서별로 분리 — 상위 분석 구조(부서 계층)에 정확히 반영
        //   선입선출로 판매 수량을 각 입고 건에 배정한 뒤, 그 입고 건의 부서로 판매분을 귀속시킵니다.
        const splitLotByDept = lot => {
          const pr = lot.pRows || [], sr = lot.sRows || [];
          // 분리 기준: 부서 / 담당자 / 매입처 — 트리 계층과 동일한 축 (BL은 제외)
          const infoOf = p => ({
            dept: cleanString(getVal(p, 'DEPTNAME', '부서')) || lot.dept || '미지정 부서',
            buyer: cleanString(getVal(p, 'EMPNAME', '담당자')) || lot.buyer || '',
            vendor: cleanString(getVal(p, 'CUSTNAME', '수입처')) || lot.vendor || '',
            blNo: cleanString(getVal(p, 'BLNO', 'BL번호')) || lot.blNo || ''
          });
          // BL번호는 입고 건마다 달라 키에서 제외 (같은 부서·담당자·매입처면 한 LOT으로 유지)
          const dOf = p => { const v = infoOf(p); return v.dept + '\u0001' + v.buyer + '\u0001' + v.vendor; };
          const depts = [];
          const meta = Object.create(null);
          pr.forEach(p => { const d = dOf(p); if (depts.indexOf(d) < 0) { depts.push(d); meta[d] = infoOf(p); } });
          if (depts.length <= 1) return [lot];
          const dateOf = p => cleanString(getVal(p, 'PERMITDATE', '수입면장일자', '구매일자'));
          const ps = pr.map((p, ix) => ({ p: p, ix: ix, left: parseNum(getVal(p, 'QTY', '수량')) }))
            .sort((a, b) => (dateOf(a.p) || '').localeCompare(dateOf(b.p) || '') || a.ix - b.ix);
          const bucket = Object.create(null);
          depts.forEach(d => { bucket[d] = { pRows: pr.filter(p => dOf(p) === d), sRows: [] }; });
          let pi = 0;
          sr.forEach(sRow => {
            const tot = parseNum(getVal(sRow, 'QTY', '수량'));
            const amt = parseNum(getVal(sRow, 'DOMAMT', '판매금액', '원화금액'));
            let left = tot;
            while (left > 1e-9) {
              while (pi < ps.length && ps[pi].left <= 1e-9) pi++;
              if (pi >= ps.length) break;
              const po = ps[pi];
              const q = Math.min(po.left, left);
              const d = dOf(po.p);
              const clone = Object.assign({}, sRow);
              clone.QTY = q;
              clone.DOMAMT = Math.round(amt * (tot > 0 ? q / tot : 1)); // 판매금액 안분
              bucket[d].sRows.push(clone);
              po.left -= q; left -= q;
            }
            if (left > 1e-9) { // 입고보다 판매가 많은 잔여분은 첫 부서에 귀속
              const clone = Object.assign({}, sRow);
              clone.QTY = left;
              clone.DOMAMT = Math.round(amt * (tot > 0 ? left / tot : 1));
              bucket[depts[0]].sRows.push(clone);
            }
          });
          return depts.map(d => {
            const mi = meta[d] || {};
            const nl = Object.assign({}, recalcLot(lot, bucket[d].pRows, bucket[d].sRows), {
              dept: mi.dept, buyer: mi.buyer, vendor: mi.vendor, blNo: mi.blNo
            });
            // 검색 키워드(매입처)도 분리된 값으로 갱신
            if (nl.searchKeywords) nl.searchKeywords = Object.assign({}, nl.searchKeywords, { pCust: mi.vendor || '', blNo: mi.blNo || '' });
            nl.blExpenseTotal = (blExpenseMap[mi.blNo] && blExpenseMap[mi.blNo].total) || 0;
            nl.blExpenseItems = (blExpenseMap[mi.blNo] && blExpenseMap[mi.blNo].items) || [];
            return nl;
          });
        };
        try { window.KJHub.lotRows = lotSummaryRows; } catch (e) {} // 검증 화면: 부서 분리 전 LOT 요약 (DB 계산과 대조)
        const expandedRows = [];
        lotSummaryRows.forEach(lo => splitLotByDept(lo).forEach(x => expandedRows.push(x)));
        // 화면 권한: 이 화면(구매 및 판매 현황)은 "구매 내역의 부서" 기준으로 LOT 필터
        let screenRows = expandedRows;
        const allowDepts = window.KJHub && window.KJHub.screenDepts ? window.KJHub.screenDepts('구매 및 판매 내역') : null;
        if (allowDepts != null) {
          const nrm = s => String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
          const allow = new Set(allowDepts.map(nrm));
          const pref = allowDepts.filter(d => String(d).endsWith('*')).map(d => nrm(String(d).slice(0, -1)));
          screenRows = allow.size === 0 && pref.length === 0 ? [] : expandedRows.filter(lot => {
            const d = nrm(lot.dept);
            if (allow.has(d)) return true;
            for (const p of pref) if (p && d.indexOf(p) === 0) return true;
            return false;
          });
        }
        setAllRows(screenRows);

        // 💡 [수익 배분용] "전체 데이터" 기준 판매 발행일별(월) 수익 발행
        //    구매/판매 화면의 조회 필터와 무관하게 항상 전체 기준으로 고정
        try {
          const fullMonthly = Object.create(null);
          const byBU = Object.create(null);   // 사업단위별 월 수익
          const byDept = Object.create(null);  // 부서별 월 수익 (참고용)
          // ★ 이윤 9종 × 월 집계 — [배분 비율 설정(부서)] 그룹의 기준 수익
          const byProfit = Object.create(null);
          PROFIT_COLS.forEach(pc => { byProfit[pc.key] = Object.create(null); });
          const __matSeen = Object.create(null); // (품번|LOT) 원료 수익 중복 집계 방지
          const ia = window.__kjItemAlloc;
          lotSummaryRows.forEach(lo => {
            const bu = String(lo.bizUnit || '').trim();
            const dp = String(lo.dept || '').trim();
            // LOT 단위 공통값 (비용 상세의 이윤 계산과 동일 기준)
            const kw = lo.searchKeywords || {};
            const lym = String(lo.pDateRaw || '').replace(/[^0-9]/g, '').slice(0, 6);
            const isSyn = __isSynLotOf(kw.itemNo, lo.lotNo);
            const sellBuy = (ia && ia.ready && ia.sellBuyOf) ? ia.sellBuyOf(kw.itemNo || '', lym) : null;
            const sellSyn = (ia && ia.ready && ia.sellSynOf) ? ia.sellSynOf(kw.itemNo || '', lym) : null;
            const p0 = (lo.pRows && lo.pRows[0]) || null;
            const procU = (ia && ia.ready && ia.mfgOf) ? ia.mfgOf(kw.itemNo || '', lym).proc
              : (p0 && getVal(p0, 'PROCPRICE', '제조원가') !== '' ? parseNum(getVal(p0, 'PROCPRICE', '제조원가')) : null);
            const unitWon = p0 ? parseNum(getVal(p0, 'PRICE', '단가')) * parseNum(getVal(p0, 'EXRATE', '환율')) : 0;
            // ★ AssetSeq 36/37: 판매가 없으므로 입고월 기준으로 구매 부서 이윤만 1회 집계
            if (isNoSaleAsset(p0)) {
              const pv0 = computeProfits({
                noSales: true, itemNo: kw.itemNo || '', lotNo: lo.lotNo || '', ym: lym,
                isSynth: isSyn, lotDept: dp, sellBuy: sellBuy, sellSyn: sellSyn, proc: procU,
                unitWon: unitWon, saleQty: (lo.totalPQty || 0) - (lo.totalInQty || 0) - (lo.totalRetQty || 0), saleAmt: 0   // 기타입고·반품 수량 제외 (구매 행 수량)
              });
              if (lym.length === 6) PROFIT_COLS.forEach(pc => {
                const x = pv0[pc.key];
                if (x == null) return;
                byProfit[pc.key][lym] = (byProfit[pc.key][lym] || 0) + x;
              });
              return; // 판매행 집계는 건너뜀
            }
            // ★ 합성 품목의 원료 수익: (품번|LOT) 단위로 1회만, 제품 입고월(LOT 입고월)에 귀속
            //   · 판매 행마다 더하면 판매 건수만큼 중복
            //   · 입고 부서가 여러 개라 LOT이 분리된 경우에도 실자재 내역은 동일하므로 1회만
            //   · 판매가 아직 없어도 입고 시점에 수익이 발생하므로 판매 유무와 무관하게 집계
            const __matKey = String(kw.itemNo || '').toUpperCase() + '|' + String(lo.lotNo || '').toUpperCase();
            if (isSyn && !__matSeen[__matKey]) {
              __matSeen[__matKey] = true;
              const pvLot = computeProfits({
                tradeAsset: isTradeAsset(p0), itemNo: kw.itemNo || '', lotNo: lo.lotNo || '', ym: lym,
                isSynth: true, lotDept: dp, sellBuy: sellBuy, sellSyn: sellSyn, proc: procU,
                unitWon: unitWon, saleQty: 0, saleAmt: 0
              });
              // 귀속월 = 합성 제품이 생산·입고된 월(LOT 입고월). 판매가 조회월(원료 DelvInDate)과는 별개.
              if (String(lym).length === 6) {
                const mm2 = pvLot.__matMonths || {};
                for (const k2 in mm2) {
                  let sum2 = 0;
                  for (const ym2 in mm2[k2]) sum2 += mm2[k2][ym2];
                  if (sum2) byProfit[k2][lym] = (byProfit[k2][lym] || 0) + sum2;
                }
              }
            }
            const __cov = inCoverOf(lo.pRows, lo.inRows, lo.sRows);   // 기타입고 몫 (부서별 이윤 제외)
            (lo.sRows || []).forEach((s, __si) => {
              if (!s) return;
              const raw = s['BILLDATE'] || s['청구일자'] || s['판매일자'] || s['일자'] || '';
              const m = String(raw).replace(/[^0-9]/g, '').slice(0, 6);
              if (m.length !== 6) return;
              const v = Number(s._margin) || 0;
              fullMonthly[m] = (fullMonthly[m] || 0) + v;
              if (bu) {
                if (!byBU[bu]) byBU[bu] = Object.create(null);
                byBU[bu][m] = (byBU[bu][m] || 0) + v;
              }
              if (dp) {
                if (!byDept[dp]) byDept[dp] = Object.create(null);
                byDept[dp][m] = (byDept[dp][m] || 0) + v;
              }
              // 이윤 9종 (판매 발행월 기준 누적) — 기타입고 몫 수량은 빼고 계산 (실현 수익은 그대로)
              const __q = parseNum(getVal(s, 'QTY', '수량')), __a = Math.round(parseNum(getVal(s, 'DOMAMT', '판매금액', '원화금액'))), __c = __cov[__si] || 0;
              if (__c > 0 && __q - __c <= 1e-9) return;   // 전부 기타입고 몫 → 이윤 없음
              const pv = computeProfits({
                tradeAsset: isTradeAsset(p0),
                saleDeptAsset: isSaleDeptAsset(s),
                saleDept: cleanString(pickVal(s, 'DEPTNAME', '부서')),
                itemNo: kw.itemNo || '', lotNo: lo.lotNo || '', ym: lym,
                isSynth: isSyn, lotDept: dp,
                sellBuy: sellBuy, sellSyn: sellSyn, proc: procU, unitWon: unitWon,
                saleQty: __c > 0 ? __q - __c : __q,
                saleAmt: __c > 0 ? __a * (__q - __c) / __q : __a
              });
              // ★ 월 귀속 기준
              //   합성 품목 : 구매 계열(운영지원·글로벌구매·영업지원·소재운영지원·SCM·소재영업지원) = 제품 입고월(LOT)
              //              합성/소재생산/영업 계열 = 판매 발행월
              //   비합성 품목: 전부 판매 발행월
              PROFIT_COLS.forEach(pc => {
                const x = pv[pc.key];
                if (x == null) return;
                if (isSyn && pc.kind === 'buy') return; // 원료 수익은 LOT 단위로 따로 집계 (아래)
                byProfit[pc.key][m] = (byProfit[pc.key][m] || 0) + x;
              });
            });
            // ★ 기타출고: 판매가 아니므로 실현 수익·합성·영업 이윤은 없고, 구매 부서 이윤만 (판매가(구매) − 단가) × 출고수량, 출고월에
            if (!isSyn) (lo.outRows || []).forEach(o => {
              const om = String(getVal(o, 'PERMITDATE', '수입면장일자', '구매일자') || '').replace(/[^0-9]/g, '').slice(0, 6) || lym;
              if (om.length !== 6) return;
              const pvo = computeProfits({ noSales: true, tradeAsset: true, isSynth: false, itemNo: kw.itemNo || '', lotNo: lo.lotNo || '', ym: lym, lotDept: dp,
                sellBuy: sellBuy, sellSyn: sellSyn, proc: procU, unitWon: unitWon, saleQty: Math.abs(parseNum(getVal(o, 'QTY', '수량'))), saleAmt: 0 });
              PROFIT_COLS.forEach(pc => { const x = pvo[pc.key]; if (x == null) return; byProfit[pc.key][om] = (byProfit[pc.key][om] || 0) + x; });
            });
          });
          if (window.KJHub) {
            const jsRes = { marginMonthlyFull: fullMonthly, marginMonthlyByBU: byBU, marginMonthlyByDept: byDept, profitMonthlyByGroup: byProfit };
            window.KJHub.resultsJs = jsRes; // 검증용 (DB 계산과 대조)
            if (window.KJHub.resultsFromDb) {
              // ★ B단계: 수익 집계는 DB(trade_profit_groups 등)가 원천 — 화면 계산값으로 덮어쓰지 않음
            } else {
              window.KJHub.results = Object.assign({}, window.KJHub.results, jsRes);
              window.dispatchEvent(new CustomEvent('kjhub:results'));
            }
          }
        } catch (e) {/* 발행 실패해도 화면 동작에는 지장 없음 */}
        setLastLoadedAt(new Date());
      } catch (error) {
        console.error("데이터 처리 오류:", error);
        setErrorMsg("오류가 발생했습니다: " + error.message);
      } finally {
        setIsProcessing(false);
      }
    };
    useEffect(() => {
      const onHubData = () => processData();
      window.addEventListener('kjhub:data', onHubData);
      processData(); // 이미 데이터가 로드된 상태라면 즉시 분석
      return () => window.removeEventListener('kjhub:data', onHubData);
    }, []);
    const filterOptions = React.useMemo(() => {
      if (!allRows) return {
        bizUnits: [],
        depts: [],
        buyers: []
      };
      const uniq = arr => Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko'));
      return {
        bizUnits: uniq(allRows.map(r => r.bizUnit)),
        depts: uniq(allRows.map(r => r.dept)),
        buyers: uniq(allRows.map(r => r.buyer))
      };
    }, [allRows]);
    const normText = s => (s || '').toString().toUpperCase().trim();
    // LOT 단위 조건만 판정 (매입처·청구처·일자는 행 단위로 별도 필터링)
    const matchesFilters = (lotObj, f) => {
      if (f.bizUnit && lotObj.bizUnit !== f.bizUnit) return false;
      if (f.dept && lotObj.dept !== f.dept) return false;
      if (f.buyer && lotObj.buyer !== f.buyer) return false;
      const kw = lotObj.searchKeywords;
      if (f.itemQuery) {
        const q = normText(f.itemQuery);
        if (!normText(kw.itemNo).includes(q) && !normText(kw.itemName).includes(q)) return false;
      }
      if (f.lotNoQuery && !normText(kw.lotNo).includes(normText(f.lotNoQuery))) return false;
      if (f.blNoQuery && !normText(kw.blNo).includes(normText(f.blNoQuery))) return false;
      return true;
    };
    // 행 단위 조건으로 좁힌 pRows/sRows 로 LOT 합계·수익 재계산
    const recalcLot = (lot, pRows, sRows) => {
      let pQty = 0, pAmt = 0, allocExp = 0, pDateRaw = '';
      pRows.forEach(p => {
        pQty += parseNum(getVal(p, 'QTY', '수량'));
        pAmt += Math.round(parseNum(getVal(p, 'DOMAMT', '원화금액')));
        allocExp += Number(p._allocatedExpense) || 0;
        const d = cleanString(getVal(p, 'PERMITDATE', '수입면장일자', '구매일자'));
        if (d > pDateRaw) pDateRaw = d;
      });
      pQty += lot.totalRetQty || 0; pAmt += lot.totalRetAmt || 0;   // 반품(음수) 반영
      const unitCost = pQty > 0 ? (pAmt + allocExp) / pQty : 0;   // 구매 + 반품 기준 (기타입고 제외)
      const buyQty = pQty;
      pQty += lot.totalInQty || 0;                                  // 총 입고 수량 = 구매 + 기타입고
      const ym = String(pDateRaw || lot.pDateRaw || '').replace(/[^0-9]/g, '').slice(0, 6);
      const ia = window.__kjItemAlloc;
      const procU = (ia && ia.ready && ia.mfgOf) ? ia.mfgOf((lot.searchKeywords && lot.searchKeywords.itemNo) || '', ym).proc : null;
      const marginUnit = procU != null ? procU : unitCost; // 제조원가(입고월) 우선 — 원본과 동일 기준
      let sQty = 0, sAmt = 0, sDateRaw = '';
      sRows.forEach(s => {
        const q = parseNum(getVal(s, 'QTY', '수량'));
        const a = Math.round(parseNum(getVal(s, 'DOMAMT', '판매금액', '원화금액')));
        sQty += q; sAmt += a;
        s._margin = a - q * marginUnit;
        const d = cleanString(getVal(s, 'BILLDATE', '청구일자', '판매일자', '일자'));
        if (d > sDateRaw) sDateRaw = d;
      });
      const dQty = lot.totalDisposalQty || 0, mQty = lot.totalMatQty || 0, oQty = lot.totalOutQty || 0;
      const invQty = Number((pQty - sQty - dQty - mQty - oQty).toFixed(4));
      const cogs = sQty * marginUnit;
      return Object.assign({}, lot, {
        pRows, sRows,
        totalPQty: pQty, totalBuyQty: buyQty, totalPAmt: pAmt, totalAllocExp: allocExp, unitCost,
        totalSQty: sQty, totalSAmt: sAmt, sales: sAmt, cogs, margin: sAmt - cogs,
        inventoryQty: invQty, inventory: invQty > 0 ? invQty * unitCost : 0,
        pDateRaw: pDateRaw || lot.pDateRaw, sDateRaw
      });
    };
    const isFilterActive = Object.values(appliedFilters).some(v => v !== '');
    // 조회 결과 = LOT 조건 통과 + 행 단위 조건(매입처·청구처·입고일·발행일)에 맞는 행만 남긴 LOT
    //   → 조건에 맞는 행이 하나도 없는 LOT 은 목록에서 제외 (조건 데이터만 표시)
    //   단, 입고일·발행일을 함께 지정하면 그 둘만 합집합(OR)으로 판정하고 행은 좁히지 않음
    const filteredRows = React.useMemo(() => {
      if (!allRows) return null;
      if (!isFilterActive) return allRows;
      const f = appliedFilters;
      const vQ = normText(f.vendorQuery || ''), cQ = normText(f.custQuery || '');
      const inFrom = (f.inDateFrom || '').replace(/-/g, ''), inTo = (f.inDateTo || '').replace(/-/g, '');
      const billFrom = (f.billDateFrom || '').replace(/-/g, ''), billTo = (f.billDateTo || '').replace(/-/g, '');
      const inActive = !!(inFrom || inTo), billActive = !!(billFrom || billTo);
      // ★ 입고일·발행일 동시 지정 시 결합 방식: 기본 OR(합집합) / dateMode='and' 이면 AND(각 행을 좁힘)
      const bothDates = inActive && billActive && f.dateMode !== 'and';
      const pActive = !!(vQ) || (inActive && !bothDates);   // 구매(입고) 행 조건
      const sActive = !!(cQ) || (billActive && !bothDates); // 판매 행 조건
      const out = [];
      // 판매가(구매·합성) 미설정 LOT만 보기
      const unsetOnly = f.unsetPrice === 'y';
      const needsPrice = lot => {
        const ia = window.__kjItemAlloc;
        if (!ia || !ia.ready) return false;
        const kw2 = lot.searchKeywords || {};
        const ym2 = String(lot.pDateRaw || '').replace(/[^0-9]/g, '').slice(0, 6);
        const syn = __isSynLotOf(kw2.itemNo, lot.lotNo);
        return syn ? !(ia.sellSynOf(kw2.itemNo || '', ym2)) : !(ia.sellBuyOf(kw2.itemNo || '', ym2));
      };
      allRows.forEach(lot => {
        if (!matchesFilters(lot, f)) return;
        if (unsetOnly && !needsPrice(lot)) return;
        let pRows = lot.pRows, sRows = lot.sRows;
        if (pActive) {
          pRows = pRows.filter(r => {
            if (vQ) {
              const v = normText(getVal(r, 'CUSTNAME', '수입처') + ' ' + getVal(r, 'CUSTNO', '수입처번호'));
              if (!v.includes(vQ)) return false;
            }
            if (inActive && !bothDates) {
              const d = cleanString(getVal(r, 'PERMITDATE', '수입면장일자', '구매일자'));
              if (!d) return false;
              if (inFrom && d < inFrom) return false;
              if (inTo && d > inTo) return false;
            }
            return true;
          });
          if (!pRows.length) return; // 조건에 맞는 입고 행 없음 → 제외
        }
        if (sActive) {
          sRows = sRows.filter(r => {
            if (cQ) {
              const v = normText(getVal(r, 'CUSTNAME', '청구처') + ' ' + getVal(r, 'CUSTNO'));
              if (!v.includes(cQ)) return false;
            }
            if (billActive && !bothDates) {
              const d = cleanString(getVal(r, 'BILLDATE', '청구일자', '판매일자', '일자'));
              if (!d) return false;
              if (billFrom && d < billFrom) return false;
              if (billTo && d > billTo) return false;
            }
            return true;
          });
          if (!sRows.length) return; // 조건에 맞는 판매 행 없음 → 제외
        }
        // ★ 입고일·발행일을 함께 지정한 경우: 두 기준을 합집합(OR)으로 판정 (행은 좁히지 않음)
        if (bothDates) {
          const inHit = pRows.some(r => {
            const d = cleanString(getVal(r, 'PERMITDATE', '수입면장일자', '구매일자'));
            if (!d) return false;
            if (inFrom && d < inFrom) return false;
            if (inTo && d > inTo) return false;
            return true;
          });
          const billHit = sRows.some(r => {
            const d = cleanString(getVal(r, 'BILLDATE', '청구일자', '판매일자', '일자'));
            if (!d) return false;
            if (billFrom && d < billFrom) return false;
            if (billTo && d > billTo) return false;
            return true;
          });
          if (!inHit && !billHit) return; // 두 기준 어디에도 걸리지 않으면 제외
        }
        if (pRows === lot.pRows && sRows === lot.sRows) { out.push(lot); return; }
        out.push(recalcLot(lot, pRows, sRows)); // 좁힌 행으로 합계·수익 재계산
      });
      return out;
    }, [allRows, appliedFilters]);
    const {
      tree: treeData,
      summary
    } = React.useMemo(() => {
      if (!filteredRows) return {
        tree: null,
        summary: null
      };
      return buildTreeFromRows(filteredRows);
    }, [filteredRows, itemAllocVer]);

    // 💡 계산된 요약(총 수익 등)을 공용 허브에 발행 → "수익 배분" 화면에서 기준값으로 사용
    React.useEffect(() => {
      if (summary && window.KJHub) {
        window.KJHub.results = Object.assign({}, window.KJHub.results, {
          purchaseSummary: summary
        });
        window.dispatchEvent(new CustomEvent('kjhub:results'));
      }
    }, [summary]);
    // ★ 새 화면(React)용 브리지 — 상태·동작을 공개하고, 변경 때마다 알림
    React.useEffect(() => {
      try {
        window.KJHub = window.KJHub || {};
        window.KJHub.trade = {
          TreeNode, treeData, summary, allRows, filteredRows, filterOptions, draftFilters, appliedFilters, isProcessing, errorMsg, lastLoadedAt, collapseSignal, isFilterActive,
          setDraft: patch => setDraftFilters(f => Object.assign({}, f, patch)),
          search: handleSearch, reset: handleResetFilters,
          collapse: () => setCollapseSignal(s => s + 1),
        };
        window.dispatchEvent(new CustomEvent('kjhub:trade'));
      } catch (e) {}
    });
    return /*#__PURE__*/React.createElement("div", {
      className: "max-w-[1600px] mx-auto space-y-6 pb-20"
    }, errorMsg && /*#__PURE__*/React.createElement("div", {
      className: "bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-3 fade-in"
    }, /*#__PURE__*/React.createElement(AlertCircle, {
      size: 20,
      className: "text-red-500 flex-shrink-0"
    }), /*#__PURE__*/React.createElement("span", {
      className: "text-sm font-medium"
    }, errorMsg)), allRows && /*#__PURE__*/React.createElement("div", {
      className: "bg-white p-4 rounded-xl shadow-sm border border-slate-200 fade-in"
    }, /*#__PURE__*/React.createElement("h3", {
      className: "font-semibold text-slate-700 text-sm mb-3"
    }, "조회조건"), /*#__PURE__*/React.createElement("div", {
      className: "grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2.5"
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      className: "block text-[11px] font-semibold text-slate-500 mb-0.5"
    }, "사업단위"), /*#__PURE__*/React.createElement("select", {
      value: draftFilters.bizUnit,
      onChange: updateDraft('bizUnit'),
      className: "w-full bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500 transition"
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "전체"), filterOptions.bizUnits.map(v => /*#__PURE__*/React.createElement("option", {
      key: v,
      value: v
    }, v)))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      className: "block text-[11px] font-semibold text-slate-500 mb-0.5"
    }, "부서"), /*#__PURE__*/React.createElement("select", {
      value: draftFilters.dept,
      onChange: updateDraft('dept'),
      className: "w-full bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500 transition"
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "전체"), filterOptions.depts.map(v => /*#__PURE__*/React.createElement("option", {
      key: v,
      value: v
    }, v)))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      className: "block text-[11px] font-semibold text-slate-500 mb-0.5"
    }, "담당자"), /*#__PURE__*/React.createElement("select", {
      value: draftFilters.buyer,
      onChange: updateDraft('buyer'),
      className: "w-full bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500 transition"
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "전체"), filterOptions.buyers.map(v => /*#__PURE__*/React.createElement("option", {
      key: v,
      value: v
    }, v)))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      className: "block text-[11px] font-semibold text-slate-500 mb-0.5"
    }, "품목"), /*#__PURE__*/React.createElement("input", {
      type: "text",
      value: draftFilters.itemQuery,
      onChange: updateDraft('itemQuery'),
      placeholder: "품번 또는 품목명",
      className: "w-full bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500 transition"
    })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      className: "block text-[11px] font-semibold text-slate-500 mb-0.5"
    }, "LOTNO"), /*#__PURE__*/React.createElement("input", {
      type: "text",
      value: draftFilters.lotNoQuery,
      onChange: updateDraft('lotNoQuery'),
      placeholder: "LOTNO 검색",
      className: "w-full bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500 transition"
    })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      className: "block text-[11px] font-semibold text-slate-500 mb-0.5"
    }, "수입처"), /*#__PURE__*/React.createElement("input", {
      type: "text",
      value: draftFilters.vendorQuery,
      onChange: updateDraft('vendorQuery'),
      placeholder: "수입처 코드 또는 명",
      className: "w-full bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500 transition"
    })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      className: "block text-[11px] font-semibold text-slate-500 mb-0.5"
    }, "청구처"), /*#__PURE__*/React.createElement("input", {
      type: "text",
      value: draftFilters.custQuery,
      onChange: updateDraft('custQuery'),
      placeholder: "청구처 코드 또는 명",
      className: "w-full bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500 transition"
    })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      className: "block text-[11px] font-semibold text-slate-500 mb-0.5"
    }, "BL번호"), /*#__PURE__*/React.createElement("input", {
      type: "text",
      value: draftFilters.blNoQuery,
      onChange: updateDraft('blNoQuery'),
      placeholder: "BL번호 검색",
      className: "w-full bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500 transition"
    })), /*#__PURE__*/React.createElement("div", {
      className: "col-span-2"
    }, /*#__PURE__*/React.createElement("label", {
      className: "block text-[11px] font-semibold text-slate-500 mb-0.5"
    }, "입고일"), /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-2"
    }, /*#__PURE__*/React.createElement("input", {
      type: "date",
      min: "2025-01-01",
      value: draftFilters.inDateFrom,
      onChange: updateDraft('inDateFrom'),
      onBlur: clampMinDate('inDateFrom'),
      className: "w-full bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500 transition"
    }), /*#__PURE__*/React.createElement("span", {
      className: "text-slate-400 text-sm"
    }, "~"), /*#__PURE__*/React.createElement("input", {
      type: "date",
      min: "2025-01-01",
      value: draftFilters.inDateTo,
      onChange: updateDraft('inDateTo'),
      onBlur: clampMinDate('inDateTo'),
      className: "w-full bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500 transition"
    }))), /*#__PURE__*/React.createElement("div", {
      className: "col-span-2"
    }, /*#__PURE__*/React.createElement("label", {
      className: "block text-[11px] font-semibold text-slate-500 mb-0.5"
    }, "발행일"), /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-2"
    }, /*#__PURE__*/React.createElement("input", {
      type: "date",
      min: "2025-01-01",
      value: draftFilters.billDateFrom,
      onChange: updateDraft('billDateFrom'),
      onBlur: clampMinDate('billDateFrom'),
      className: "w-full bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500 transition"
    }), /*#__PURE__*/React.createElement("span", {
      className: "text-slate-400 text-sm"
    }, "~"), /*#__PURE__*/React.createElement("input", {
      type: "date",
      min: "2025-01-01",
      value: draftFilters.billDateTo,
      onChange: updateDraft('billDateTo'),
      onBlur: clampMinDate('billDateTo'),
      className: "w-full bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500 transition"
    }))), /*#__PURE__*/React.createElement("div", {
      className: "col-span-2"
    }, /*#__PURE__*/React.createElement("label", {
      className: "block text-[11px] font-semibold text-slate-500 mb-0.5"
    }, "입고일 · 발행일 결합"), /*#__PURE__*/React.createElement("select", {
      value: draftFilters.dateMode,
      onChange: updateDraft('dateMode'),
      title: "두 날짜를 모두 지정했을 때만 적용됩니다. OR: 둘 중 하나라도 걸리는 LOT 표시 · AND: 두 조건에 맞는 행만 표시",
      className: "w-full bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500 transition"
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "OR (합집합) — 둘 중 하나라도 해당"), /*#__PURE__*/React.createElement("option", {
      value: "and"
    }, "AND (교집합) — 두 조건 모두 해당"))), /*#__PURE__*/React.createElement("div", {
      className: "col-span-2"
    }, /*#__PURE__*/React.createElement("label", {
      className: "block text-[11px] font-semibold text-slate-500 mb-0.5"
    }, "판매가 설정"), /*#__PURE__*/React.createElement("select", {
      value: draftFilters.unsetPrice,
      onChange: updateDraft('unsetPrice'),
      title: "판매가(구매·합성)가 등록되지 않아 수익이 계산되지 않는 LOT만 골라 볼 수 있습니다.",
      className: "w-full bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500 transition"
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "전체"), /*#__PURE__*/React.createElement("option", {
      value: "y"
    }, "판매가 미설정만")))), /*#__PURE__*/React.createElement("div", {
      className: "mt-4 flex justify-end gap-2"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: handleResetFilters,
      className: "px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
    }, "초기화"), /*#__PURE__*/React.createElement("button", {
      onClick: handleSearch,
      className: "flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
    }, "조회"))), summary && /*#__PURE__*/React.createElement("div", {
      className: "grid grid-cols-1 md:grid-cols-4 gap-4 fade-in"
    }, /*#__PURE__*/React.createElement(KPICard, {
      title: "총 매출액 (A)",
      amount: summary.sales,
      borderClass: "border-l-emerald-500",
      iconBg: "bg-emerald-50",
      iconColor: "text-emerald-600",
      icon: /*#__PURE__*/React.createElement(TrendingUp, {
        size: 24
      })
    }), /*#__PURE__*/React.createElement(KPICard, {
      title: "총 매출 원가 (B)",
      amount: summary.cogs,
      borderClass: "border-l-amber-500",
      iconBg: "bg-amber-50",
      iconColor: "text-amber-600",
      icon: /*#__PURE__*/React.createElement(Receipt, {
        size: 24
      })
    }), /*#__PURE__*/React.createElement(KPICard, {
      title: "총 실현 수익 (A-B)",
      amount: summary.margin,
      borderClass: "border-l-indigo-600",
      iconBg: "bg-indigo-50",
      iconColor: "text-indigo-600",
      valueClass: summary.margin >= 0 ? 'text-indigo-700' : 'text-red-600',
      icon: /*#__PURE__*/React.createElement(Coins, {
        size: 24
      })
    })), treeData && /*#__PURE__*/React.createElement("div", {
      className: "bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto custom-scrollbar fade-in w-full"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-white"
    }, /*#__PURE__*/React.createElement("h3", {
      className: "font-semibold text-sm text-slate-700"
    }, "분석 구조"), /*#__PURE__*/React.createElement("button", {
      onClick: () => setCollapseSignal(c => c + 1),
      title: "펼쳐진 항목 모두 접기",
      className: "flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-full transition-colors"
    }, /*#__PURE__*/React.createElement(ChevronsDownUp, {
      size: 14
    }), " 전체 접기")), isFilterActive && /*#__PURE__*/React.createElement("div", {
      className: "px-4 py-2 bg-indigo-50/70 border-b border-indigo-100 text-xs font-medium text-indigo-700"
    }, "조회조건 적용됨 · ", formatNumber(filteredRows.length), "건 / 전체 ", formatNumber(allRows.length), "건"), /*#__PURE__*/React.createElement("table", {
      className: "w-full text-left border-collapse table-fixed"
    }, /*#__PURE__*/React.createElement("thead", {
      className: "bg-slate-50 border-b border-slate-200 text-slate-500 text-sm"
    }, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
      className: "p-3 pl-6 font-semibold",
      style: { width: '28%' }
    }, "분석 구조 (사업단위 ▸ 부서 ▸ 담당자 ▸ 품목 ▸ 수입처(생산처) ▸ BL번호(상세내역))"), /*#__PURE__*/React.createElement("th", {
      className: "p-3 font-semibold text-right",
      style: { width: '24%' }
    }, "매출액"), /*#__PURE__*/React.createElement("th", {
      className: "p-3 font-semibold text-right",
      style: { width: '24%' }
    }, "매출 원가"), /*#__PURE__*/React.createElement("th", {
      className: "p-3 pr-6 font-semibold text-right text-indigo-700",
      style: { width: '24%' }
    }, "실현 수익"))), /*#__PURE__*/React.createElement("tbody", {
      className: "text-sm"
    }, Object.keys(treeData).length === 0 ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
      colSpan: 4,
      className: "text-center p-8 text-slate-500"
    }, isFilterActive ? '조회조건에 해당하는 데이터가 없습니다.' : '분석할 수 있는 데이터가 존재하지 않습니다.')) : Object.entries(treeData).map(([key, node]) => /*#__PURE__*/React.createElement(TreeNode, {
      key: key,
      node: node,
      depth: 0,
      collapseSignal: collapseSignal
    }))))));
  }

  // ============================================================================
  // 트리 노드 렌더링 (병렬 데이터 출력 구조 도입 및 병합 처리 개선)
  // ============================================================================
  const TreeNode = React.memo(function TreeNode({
    node,
    depth,
    collapseSignal,
    extra,        // (새 화면) 행 끝에 덧붙일 칸 렌더 함수
    extraCount    // (새 화면) 덧붙인 칸 수 — 상세 행 colSpan 보정
  }) {
    const [isOpen, setIsOpen] = useState(false);
    useEffect(() => {
      setIsOpen(false);
    }, [collapseSignal]);
    const hasChildren = Object.keys(node.children || {}).length > 0;
    const isLeaf = node.type === 'blNo';
    const showExpense = isLeaf && !!node.showExpense;
    const isLocalNode = isLeaf && (node.name === '상세 내역 (내수/생산입고)' || node.name === '상세 내역');
    const toggle = () => setIsOpen(!isOpen);
    const getMarginColor = m => m > 0 ? 'text-indigo-600' : m < 0 ? 'text-red-500' : 'text-slate-600';
    const getVal = (row, ...keys) => {
      for (let k of keys) if (row && row[k] != null && row[k] !== '') return row[k];
      return '';
    };

    // ── 정렬 상태 ────────────────────────────────────────────────
    // 판매행 정렬 (LOT 내부): 기본값 발행일(BILLDATE) 오름차순
    const [sortConfig, setSortConfig] = useState({
      key: 'BILLDATE',
      dir: 'asc'
    });
    const requestSort = key => setSortConfig(prev => prev.key === key ? {
      key,
      dir: prev.dir === 'asc' ? 'desc' : 'asc'
    } : {
      key,
      dir: 'asc'
    });
    // LOT 그룹 정렬 (입고/구매 컬럼): 기본값 LOTNO 오름차순 (판매행은 발행일 오름차순)
    const [lotSortConfig, setLotSortConfig] = useState({
      key: 'P_LOTNO',
      dir: 'asc'
    });
    const requestLotSort = key => setLotSortConfig(prev => prev.key === key ? {
      key,
      dir: prev.dir === 'asc' ? 'desc' : 'asc'
    } : {
      key,
      dir: 'asc'
    });
    // 정렬 가능한 헤더에 붙일 클릭 이벤트 (판매행 / LOT 그룹)
    const saleTh = key => ({
      onClick: e => {
        e.stopPropagation();
        requestSort(key);
      },
      title: '클릭하여 정렬',
      'data-sortkey': key
    });
    const lotTh = key => ({
      onClick: e => {
        e.stopPropagation();
        requestLotSort(key);
      },
      title: '클릭하여 정렬',
      'data-sortkey': key
    });
    // 표기(삼각형/밑줄) 없이 클릭 가능한 느낌만 부여
    const sortableCls = 'cursor-pointer select-none hover:bg-black/5 transition-colors';

    // 판매행에서 정렬 기준값 추출 (숫자/문자/날짜)
    const getSortValue = (s, key, unitCost, expPerUnit, cogsUnit) => {
      const sQty = parseNum(getVal(s, 'QTY', '수량'));
      switch (key) {
        case 'BILLDATE':
          return cleanString(getVal(s, 'BILLDATE', '청구일자', '판매일자', '일자')).replace(/[^0-9]/g, '');
        case 'QTY':
          return sQty;
        case 'CUSTNAME':
          return getVal(s, 'CUSTNAME', '청구처') || '';
        case 'EMPNAME':
          return getVal(s, 'EMPNAME', '담당자') || '';
        case 'S_CURR':
          return getVal(s, 'CURRNAME', '통화') || '';
        case 'S_FPRICE':
          return parseNum(getVal(s, 'PRICE', '단가'));
        case 'S_EXRATE':
          return parseNum(getVal(s, 'EXRATE', '환율'));
        case 'S_KRWPRICE':
          return parseNum(getVal(s, 'PRICE')) * parseNum(getVal(s, 'EXRATE'));
        case 'DOMAMT':
          return parseNum(getVal(s, 'DOMAMT', '판매금액', '원화금액'));
        case 'MARGIN':
          return parseNum(s._margin);
        case 'ALLOC_EXP':
          return sQty * expPerUnit;
        case 'COGS':
          return sQty * (cogsUnit != null ? cogsUnit : unitCost); // 매출원가 = 제조원가 × 판매수량
        default:
          return '';
      }
    };
    // 판매행 배열 정렬 (원본 불변, 복사본 반환)
    const sortSalesRows = (rows, unitCost, expPerUnit, cogsUnit) => {
      const dir = sortConfig.dir === 'asc' ? 1 : -1;
      return [...rows].sort((a, b) => {
        const va = getSortValue(a, sortConfig.key, unitCost, expPerUnit, cogsUnit);
        const vb = getSortValue(b, sortConfig.key, unitCost, expPerUnit, cogsUnit);
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va).localeCompare(String(vb), 'ko') * dir;
      });
    };
    // LOT 그룹에서 정렬 기준값 추출 (입고/구매 컬럼)
    const getLotSortValue = (g, key) => {
      const p0 = g.pRows && g.pRows[0] ? g.pRows[0] : null;
      switch (key) {
        case 'P_LOTNO':
          return g.lotNo || '';
        case 'P_QTY':
          return parseNum(g.totalPQty);
        case 'P_INDATE':
          return cleanString(g.pDateRaw).replace(/[^0-9]/g, '');
        case 'P_CURR':
          return p0 ? getVal(p0, 'CURRNAME', '통화') || '' : '';
        case 'P_FPRICE':
          return p0 ? parseNum(getVal(p0, 'PRICE', '단가')) : 0;
        case 'P_EXRATE':
          return p0 ? parseNum(getVal(p0, 'EXRATE', '환율')) : 0;
        case 'P_KRWPRICE':
          return p0 ? parseNum(getVal(p0, 'PRICE', '단가')) * parseNum(getVal(p0, 'EXRATE', '환율')) : 0;
        case 'P_PROCPRICE': {
          const __m = (window.__kjItemAlloc && window.__kjItemAlloc.mfgOf) ? window.__kjItemAlloc.mfgOf((g.searchKeywords && g.searchKeywords.itemNo) || '', String(g.pDateRaw || '').replace(/[^0-9]/g, '').slice(0, 6)) : null;
          if (__m && __m.proc != null) return __m.proc;
          return p0 ? parseNum(getVal(p0, 'PROCPRICE', '제조원가')) : 0;
        }
        case 'P_AMT':
          return parseNum(g.totalPAmt);
        default:
          return '';
      }
    };
    // LOT 그룹 배열 정렬 (원본 불변, 복사본 반환)
    const sortLotGroups = groups => {
      if (!lotSortConfig.key) return groups;
      const dir = lotSortConfig.dir === 'asc' ? 1 : -1;
      return [...groups].sort((a, b) => {
        const va = getLotSortValue(a, lotSortConfig.key);
        const vb = getLotSortValue(b, lotSortConfig.key);
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va).localeCompare(String(vb), 'ko') * dir;
      });
    };
    const getIcon = () => {
      switch (node.type) {
        case 'bizUnit':
          return /*#__PURE__*/React.createElement(Building, {
            className: "text-indigo-500 flex-shrink-0"
          });
        case 'dept':
          return /*#__PURE__*/React.createElement(Users, {
            className: "text-blue-500 flex-shrink-0"
          });
        case 'buyer':
          return /*#__PURE__*/React.createElement(User, {
            className: "text-emerald-500 flex-shrink-0"
          });
        case 'item':
          return /*#__PURE__*/React.createElement(Package, {
            className: "text-orange-500 flex-shrink-0"
          });
        case 'vendor':
          return /*#__PURE__*/React.createElement(Factory, {
            className: "text-slate-500 flex-shrink-0"
          });
        case 'blNo':
          return isLocalNode ? /*#__PURE__*/React.createElement(Box, {
            className: "text-slate-400 flex-shrink-0"
          }) : /*#__PURE__*/React.createElement(ClipboardList, {
            className: "text-slate-400 flex-shrink-0"
          });
        default:
          return null;
      }
    };
    const PAGE_SIZE = 20;
    const lotGroups = node.lotGroups || [];
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    // 💡 LOT 그룹을 현재 입고컬럼 정렬 기준으로 정렬한 뒤 페이지네이션 적용
    const sortedLotGroups = sortLotGroups(lotGroups);
    const visibleLotGroups = sortedLotGroups.slice(0, visibleCount);
    const hasMore = lotGroups.length > visibleCount;
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("tr", {
      className: "tree-row border-b border-slate-100 cursor-pointer " + (depth === 0 ? 'bg-slate-50/70' : ''),
      onClick: toggle
    }, /*#__PURE__*/React.createElement("td", {
      className: "p-3 py-3.5 whitespace-nowrap overflow-hidden text-ellipsis",
      style: {
        paddingLeft: 1.5 + depth * 1.5 + "rem"
      },
      title: node.name
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-2"
    }, /*#__PURE__*/React.createElement("span", {
      className: "w-4 text-slate-400 transition-transform flex-shrink-0 " + (isOpen ? 'rotate-90' : '')
    }, /*#__PURE__*/React.createElement(ChevronRight, {
      size: 16
    })), getIcon(), /*#__PURE__*/React.createElement("span", {
      className: "font-medium truncate " + (depth === 0 ? 'text-slate-800' : isLocalNode ? 'text-slate-400' : 'text-slate-700')
    }, node.name), isLeaf && /*#__PURE__*/React.createElement("span", {
      className: "ml-2 text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full border border-slate-200"
    }, lotGroups.length, " LOT"))), /*#__PURE__*/React.createElement("td", {
      className: "p-3 text-right text-slate-600"
    }, formatNumber(node.sales)), /*#__PURE__*/React.createElement("td", {
      className: "p-3 text-right text-slate-600"
    }, formatNumber(node.cogs)), /*#__PURE__*/React.createElement("td", {
      className: "p-3 pr-6 text-right font-bold " + getMarginColor(node.margin)
    }, formatNumber(node.margin)), extra ? extra(node) : null), isOpen && (hasChildren ? Object.entries(node.children).sort((a, b) => (
      // 품목 노드는 품목명(라벨) 기준 정렬 — 그 외 계층은 기존 순서 유지
      (a[1] && a[1].type === 'item' && b[1] && b[1].type === 'item')
        ? String(a[0]).localeCompare(String(b[0]), 'ko') : 0
    )).map(([key, child]) => /*#__PURE__*/React.createElement(TreeNode, {
      key: key,
      node: child,
      depth: depth + 1,
      collapseSignal: collapseSignal,
      extra: extra,
      extraCount: extraCount
    })) : isLeaf ? /*#__PURE__*/React.createElement("tr", {
      className: "bg-slate-50/80 border-b border-slate-200"
    }, /*#__PURE__*/React.createElement("td", {
      colSpan: 4 + (extraCount || 0),
      className: "p-3 px-4 md:pl-16"
    }, /*#__PURE__*/React.createElement("div", {
      className: "space-y-4 fade-in w-full"
    }, showExpense && node.blExpenseItems && node.blExpenseItems.length > 0 && /*#__PURE__*/React.createElement("div", {
      className: "bg-white border border-orange-100 rounded-lg shadow-sm"
    }, /*#__PURE__*/React.createElement("h4", {
      className: "bg-orange-50/50 px-3 py-1.5 border-b border-orange-100 text-orange-800 font-semibold flex items-center gap-2 text-xs"
    }, "부대비용 상세", React.createElement(HelpQ, { id: "trade.lotExpense" })), /*#__PURE__*/React.createElement("div", {
      className: "p-2"
    }, /*#__PURE__*/React.createElement("div", {
      className: "overflow-x-auto rounded border border-slate-200 custom-scrollbar"
    }, /*#__PURE__*/React.createElement("table", {
      className: "w-full text-[11px] text-left whitespace-nowrap"
    }, /*#__PURE__*/React.createElement("thead", {
      className: "bg-slate-50 text-slate-600 border-b border-slate-200"
    }, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
      className: "py-1.5 px-2 font-medium"
    }, "비용 항목명"), /*#__PURE__*/React.createElement("th", {
      className: "py-1.5 px-2 font-medium border-l border-slate-200"
    }, "지급처 (거래처)"), /*#__PURE__*/React.createElement("th", {
      className: "py-1.5 px-2 font-medium border-l border-slate-200 text-center"
    }, "청구일자"), /*#__PURE__*/React.createElement("th", {
      className: "py-1.5 px-2 font-medium text-right border-l border-slate-200 text-orange-700"
    }, "발생 금액 (원화)"))), /*#__PURE__*/React.createElement("tbody", {
      className: "divide-y divide-slate-100"
    }, node.blExpenseItems.map((exp, i) => /*#__PURE__*/React.createElement("tr", {
      key: i,
      className: "hover:bg-orange-50/30 transition-colors"
    }, /*#__PURE__*/React.createElement("td", {
      className: "py-1 px-2 text-slate-700"
    }, exp.name || '-'), /*#__PURE__*/React.createElement("td", {
      className: "py-1 px-2 text-slate-600 border-l border-slate-100"
    }, exp.vendor || '-'), /*#__PURE__*/React.createElement("td", {
      className: "py-1 px-2 text-slate-500 border-l border-slate-100 text-center"
    }, exp.date || '-'), /*#__PURE__*/React.createElement("td", {
      className: "py-1 px-2 text-right font-medium text-orange-600 border-l border-slate-100"
    }, formatNumber(exp.amt)))), /*#__PURE__*/React.createElement("tr", {
      className: "bg-orange-50 text-orange-800"
    }, /*#__PURE__*/React.createElement("td", {
      colSpan: 3,
      className: "py-1.5 px-2 text-right font-bold border-t border-orange-100"
    }, "총 부대비용 합계"), /*#__PURE__*/React.createElement("td", {
      className: "py-1.5 px-2 text-right font-bold border-t border-orange-100"
    }, formatNumber(node.blExpenseTotal)))))))), /*#__PURE__*/React.createElement("div", {
      className: "bg-white border border-indigo-100 rounded-lg shadow-sm overflow-hidden w-full"
    }, /*#__PURE__*/React.createElement("div", {
      className: "bg-indigo-50/60 px-3 py-1.5 border-b border-indigo-100 text-indigo-800 font-semibold text-xs flex items-center gap-2"
    }, "비용 상세", React.createElement(HelpQ, { id: "trade.lotDetail" }), /*#__PURE__*/React.createElement("span", {
      className: "font-normal text-[10px] text-indigo-400"
    }, "· 컬럼 헤더 클릭 시 정렬 (재클릭 시 오름/내림 전환)")), /*#__PURE__*/React.createElement("div", {
      className: "overflow-x-auto custom-scrollbar w-full pb-1"
    }, /*#__PURE__*/React.createElement("table", {
      className: "w-full text-[11px] leading-tight text-left whitespace-nowrap"
    }, /*#__PURE__*/React.createElement("thead", {
      className: "text-slate-500 border-b border-slate-200"
    }, /*#__PURE__*/React.createElement("tr", {
      className: "bg-slate-100/80"
    }, /*#__PURE__*/React.createElement("th", {
      className: "py-1.5 px-1.5 font-medium border-b border-slate-200 " + sortableCls,
      rowSpan: 2,
      ...lotTh('P_LOTNO')
    }, "LOTNO"), /*#__PURE__*/React.createElement("th", {
      className: "py-1.5 px-1.5 font-medium text-right border-l border-b border-slate-200 " + sortableCls,
      rowSpan: 2,
      ...lotTh('P_QTY')
    }, "총 구매수량"), /*#__PURE__*/React.createElement("th", {
      className: "py-1 px-1.5 font-semibold text-center border-l border-slate-200 bg-slate-50 text-slate-600",
      colSpan: 7
    }, "입고 (구매/생산)"), /*#__PURE__*/React.createElement("th", {
      className: "py-1.5 px-1.5 font-semibold text-right border-l border-b border-slate-200 text-cyan-700 bg-cyan-50/40",
      rowSpan: 2,
      title: "[배분 비율 설정(품목)]의 판매가(구매) — 입고월 기준"
    }, "\uB0B4 \uB2E8\uAC00", /*#__PURE__*/React.createElement("br", null), "(\uC6D0)"), /*#__PURE__*/React.createElement("th", {
      className: "py-1.5 px-1.5 font-semibold text-right border-l border-b border-slate-200 text-cyan-800 bg-cyan-50/40",
      rowSpan: 2,
      title: "[배분 비율 설정(품목)]의 판매가(합성) — 입고월 기준"
    }, "\uB0B4 \uC81C\uC870", /*#__PURE__*/React.createElement("br", null), "\uC6D0\uAC00"), /*#__PURE__*/React.createElement("th", {
      className: "py-1.5 px-1.5 font-medium text-right border-l border-b border-slate-200 text-orange-700 bg-orange-50/40 " + sortableCls,
      rowSpan: 2,
      ...saleTh('ALLOC_EXP')
    }, "부대비용", /*#__PURE__*/React.createElement("br", null), "배부액"), /*#__PURE__*/React.createElement("th", {
      className: "py-1.5 px-1.5 font-semibold text-right border-l border-b border-slate-200 text-slate-700 bg-slate-100/50 " + sortableCls,
      rowSpan: 2,
      ...saleTh('COGS'),
      title: "제조원가(입고월 ProcPrice) × 판매수량 · 클릭하여 정렬"
    }, "매출 원가(원)"), /*#__PURE__*/React.createElement("th", {
      className: "py-1 px-1.5 font-semibold text-center border-l border-emerald-100 bg-emerald-50 text-emerald-700",
      colSpan: 9
    }, "판매"),
    // ── 이윤 9종 (부서별) ──
    ...PROFIT_COLS.map(pc => /*#__PURE__*/React.createElement("th", {
      key: 'ph-' + pc.key,
      className: "py-1.5 px-1.5 font-bold text-center border-l border-b border-slate-200 whitespace-nowrap",
      style: { color: pc.color },
      rowSpan: 2,
      title: pc.title
    }, "수익", /*#__PURE__*/React.createElement("br", null), "(" + pc.short + ")")), /*#__PURE__*/React.createElement("th", {
      className: "py-1.5 px-1.5 font-bold text-center border-l border-b border-slate-200 text-indigo-700 " + sortableCls,
      rowSpan: 2,
      ...saleTh('MARGIN')
    }, "실현 수익")), /*#__PURE__*/React.createElement("tr", {
      className: "bg-slate-50"
    }, /*#__PURE__*/React.createElement("th", {
      className: "py-1 px-1.5 font-medium text-center border-l border-b border-slate-200 text-slate-500 " + sortableCls,
      ...lotTh('P_INDATE')
    }, "입고일"), /*#__PURE__*/React.createElement("th", {
      className: "py-1 px-1.5 font-medium text-center border-b border-slate-200 text-slate-500 " + sortableCls,
      ...lotTh('P_CURR')
    }, "통화"), /*#__PURE__*/React.createElement("th", {
      className: "py-1 px-1.5 font-medium text-right border-b border-slate-200 text-slate-500 " + sortableCls,
      ...lotTh('P_FPRICE')
    }, "외화단가"), /*#__PURE__*/React.createElement("th", {
      className: "py-1 px-1.5 font-medium text-right border-b border-slate-200 text-slate-500 " + sortableCls,
      ...lotTh('P_EXRATE')
    }, "환율"), /*#__PURE__*/React.createElement("th", {
      className: "py-1 px-1.5 font-medium text-right border-b border-slate-200 text-slate-800 bg-slate-100/50 " + sortableCls,
      ...lotTh('P_KRWPRICE')
    }, "단가(원)"), /*#__PURE__*/React.createElement("th", {
      className: "py-1 px-1.5 font-medium text-right border-l border-b border-indigo-100 text-indigo-700 bg-indigo-50/40 " + sortableCls,
      ...lotTh('P_PROCPRICE')
    }, "제조원가"), /*#__PURE__*/React.createElement("th", {
      className: "py-1 px-1.5 font-semibold text-right border-b border-slate-200 text-slate-800 bg-slate-100/50 " + sortableCls,
      ...lotTh('P_AMT')
    }, "금액(원)"), /*#__PURE__*/React.createElement("th", {
      className: "py-1 px-1.5 font-medium text-right border-l border-b border-emerald-100 text-emerald-600 bg-emerald-50/50 " + sortableCls,
      ...saleTh('QTY')
    }, "판매수량"), /*#__PURE__*/React.createElement("th", {
      className: "py-1 px-1.5 font-medium text-left border-l border-b border-emerald-100 text-emerald-600 bg-emerald-50/50 max-w-[120px] truncate " + sortableCls,
      ...saleTh('CUSTNAME')
    }, "청구처"), /*#__PURE__*/React.createElement("th", {
      className: "py-1 px-1.5 font-medium text-center border-b border-emerald-100 text-emerald-600 bg-emerald-50/50 " + sortableCls,
      ...saleTh('EMPNAME')
    }, "영업담당"), /*#__PURE__*/React.createElement("th", {
      className: "py-1 px-1.5 font-medium text-center border-b border-emerald-100 text-emerald-600 bg-emerald-50/50 " + sortableCls,
      ...saleTh('BILLDATE')
    }, "발행일"), /*#__PURE__*/React.createElement("th", {
      className: "py-1 px-1.5 font-medium text-center border-b border-emerald-100 border-l text-emerald-600 bg-emerald-50/50 " + sortableCls,
      ...saleTh('S_CURR')
    }, "통화"), /*#__PURE__*/React.createElement("th", {
      className: "py-1 px-1.5 font-medium text-right border-b border-emerald-100 text-emerald-600 bg-emerald-50/50 " + sortableCls,
      ...saleTh('S_FPRICE')
    }, "외화단가"), /*#__PURE__*/React.createElement("th", {
      className: "py-1 px-1.5 font-medium text-right border-b border-emerald-100 text-emerald-600 bg-emerald-50/50 " + sortableCls,
      ...saleTh('S_EXRATE')
    }, "환율"), /*#__PURE__*/React.createElement("th", {
      className: "py-1 px-1.5 font-medium text-right border-b border-emerald-100 text-emerald-800 bg-emerald-100/50 " + sortableCls,
      ...saleTh('S_KRWPRICE')
    }, "단가(원)"), /*#__PURE__*/React.createElement("th", {
      className: "py-1 px-1.5 font-semibold text-right border-b border-emerald-100 text-emerald-800 bg-emerald-100/50 " + sortableCls,
      ...saleTh('DOMAMT')
    }, "금액(원)"))), /*#__PURE__*/React.createElement("tbody", {
      className: "divide-y divide-slate-100"
    }, visibleLotGroups.map((lotObj, lotIdx) => {
      const {
        pRows,
        sRows,
        disposals,
        unitCost,
        totalPQty,
        totalPAmt,
        totalAllocExp,
        pDateRaw,
        inventoryQty,
        inventory
      } = lotObj;
      // 💡 판매행이 많을 때, 병합된 구매 정보 하나와 판매 내역들을 깔끔하게 나열
      // 💡 [수정] 재고 잔량이 있으면 마지막에 재고 행 1줄 추가 (트리의 재고 열에서 이동)
      const __noSaleLot0 = isNoSaleAsset(pRows[0]); // AssetSeq 36/37 — 판매 영역 전체 공백
      const hasInvRow = false; // 재고 잔량 행 미표기
      const maxRows = Math.max(1, pRows.length, __noSaleLot0 ? 0 : (sRows.length + disposals.length + (hasInvRow ? 1 : 0)));
      // 💡 [수정] 행별 배분: 단위당 부대비용 배분액 (총 부대비용 배분액 / 총 구매수량)
      const __buyQ = lotObj.totalBuyQty != null ? lotObj.totalBuyQty : totalPQty; // 구매 행 수량 (기타입고 제외)
      const expPerUnit = __buyQ > 0 ? totalAllocExp / __buyQ : 0;
      // 매출원가 단가 = 제조원가(입고월 ProcPrice → 이전 마지막 월 → 구매행 ProcPrice → 기존 구매 단가) — 제조원가 열과 동일 기준
      const cogsUnit = (() => {
        const ia0 = window.__kjItemAlloc;
        const ym0 = String(lotObj.pDateRaw || '').replace(/[^0-9]/g, '').slice(0, 6);
        const p0v = (ia0 && ia0.ready && ia0.mfgOf) ? ia0.mfgOf((lotObj.searchKeywords && lotObj.searchKeywords.itemNo) || '', ym0).proc : null;
        if (p0v != null) return p0v;
        const pr0 = pRows[0] ? getVal(pRows[0], 'PROCPRICE', '제조원가') : '';
        return pr0 !== '' ? parseNum(pr0) : unitCost;
      })();
      // 💡 [추가] 현재 정렬 기준으로 판매행 정렬 (기본: 발행일 오름차순)
      // ★ AssetSeq 36/37(자재성 입고): 판매내역을 비우고 이윤만 구매수량 기준으로 산출
      const __noSaleLot = __noSaleLot0;
      const sortedSRows = __noSaleLot ? [] : sortSalesRows(sRows, unitCost, expPerUnit, cogsUnit);
      const dispRows = []; // 폐기 행은 표기하지 않음
      // ★ 선입先出(FIFO) 매칭: 입고(구매) 수량을 입고일 순서대로 판매 수량에 소진시켜 행을 구성
      //    한 판매가 여러 입고에 걸치면 행이 나뉘고, 남은 입고 수량은 재고 행이 됩니다.
      const __segs = (() => {
        const dOf = (r, ks) => cleanString(getVal(r, ...ks));
        // ★ 기타입고 행도 입고 건으로 함께 배정 (입고일 순, 같으면 구매 행 먼저)
        const ps = pRows.map((p, ix) => ({ p: p, ix: ix, left: parseNum(getVal(p, 'QTY', '수량')) }))
          .concat((lotObj.inRows || []).map((p, ix) => ({ p: p, ix: 1e6 + ix, left: Math.abs(parseNum(getVal(p, 'QTY', '수량'))) })))
          .sort((a, b) => { const da = dOf(a.p, ['PERMITDATE', '수입면장일자', '구매일자']) || '', db = dOf(b.p, ['PERMITDATE', '수입면장일자', '구매일자']) || ''; return (da < db ? -1 : da > db ? 1 : a.ix - b.ix); });
        const ss = sortedSRows.map((x, ix) => ({ s: x, ix: ix, left: parseNum(getVal(x, 'QTY', '수량')), tot: parseNum(getVal(x, 'QTY', '수량')) }));
        const out = [];
        let pi = 0;
        ss.forEach(so => {
          if (so.left <= 0) { out.push({ p: null, s: so.s, qty: so.left, tot: so.tot }); return; }
          while (so.left > 1e-9) {
            while (pi < ps.length && ps[pi].left <= 1e-9) pi++;
            if (pi >= ps.length) { out.push({ p: null, s: so.s, qty: so.left, tot: so.tot }); break; } // 입고 부족분
            const po = ps[pi];
            const q = Math.min(po.left, so.left);
            out.push({ p: po.p, s: so.s, qty: q, tot: so.tot });
            po.left -= q; so.left -= q;
          }
        });
        // ★ 반품 분: 판매 다음 순서로 구매 건에서 차감해 "반품" 행으로 표시 (부서별 이윤·실현 수익 없음)
        (lotObj.retRows || []).forEach(o => {
          let left = Math.abs(parseNum(getVal(o, 'QTY', '수량')));
          const __rq = left;
          ps.forEach(po => { if (left <= 1e-9 || po.left <= 1e-9 || (lotObj.inRows || []).indexOf(po.p) >= 0) return; const q = Math.min(po.left, left); out.push({ p: po.p, s: null, qty: q, tot: 0, retUsed: true, oRow: o, rq: __rq }); po.left -= q; left -= q; });
          if (left > 1e-9) out.push({ p: null, s: null, qty: left, tot: 0, retUsed: true, oRow: o, rq: __rq });
        });
        // 생산 투입(실자재투입) 분: 판매 다음 순서로 입고 건에서 차감해 "생산 투입" 행으로 표시
        let __mLeft = lotObj.totalMatQty || 0;
        ps.forEach(po => { if (__mLeft <= 1e-9 || po.left <= 1e-9) return; const q = Math.min(po.left, __mLeft); out.push({ p: po.p, s: null, qty: q, tot: 0, matUsed: true }); po.left -= q; __mLeft -= q; });
        // ★ 기타출고 분: 판매 다음 순서로 입고 건에서 차감해 "기타출고" 행으로 표시 (구매 부서 이윤만)
        (lotObj.outRows || []).slice().sort((a, b) => (dOf(a, ['PERMITDATE', '수입면장일자', '구매일자']) || '').localeCompare(dOf(b, ['PERMITDATE', '수입면장일자', '구매일자']) || '')).forEach(o => {
          let left = Math.abs(parseNum(getVal(o, 'QTY', '수량')));
          ps.forEach(po => { if (left <= 1e-9 || po.left <= 1e-9) return; const q = Math.min(po.left, left); out.push({ p: po.p, s: null, qty: q, tot: 0, outUsed: true, oRow: o }); po.left -= q; left -= q; });
          if (left > 1e-9) out.push({ p: null, s: null, qty: left, tot: 0, outUsed: true, oRow: o }); // 입고 부족분
        });
        // 미판매 잔량 행: 폐기와 수량이 일치하면 표시하지 않음 (총 구매수량·금액은 그대로 유지)
        const __disp = lotObj.disposalInfo;
        ps.forEach(po => { if (po.left > 1e-9) out.push({ p: po.p, s: null, qty: po.left, tot: 0, rest: true }); });
        if (__disp && __disp.matched) {
          const kept = out.filter(o => !o.rest);
          if (__disp.all && !kept.length) return [{ p: (pRows[0] || null), s: null, qty: 0, tot: 0, disposedAll: true }]; // 전량 폐기
          return kept.length ? kept : [{ p: (pRows[0] || null), s: null, qty: 0, tot: 0, disposedAll: true }];
        }
        if (!out.length && pRows.length) pRows.forEach(p => out.push({ p: p, s: null, qty: parseNum(getVal(p, 'QTY', '수량')), tot: 0, rest: true }));
        return out;
      })();
      const __segCount = Math.max(1, __segs.length + dispRows.length);
      return Array.from({
        length: __segCount
      }).map((_, i) => {
        const seg = i < __segs.length ? __segs[i] : null;
        const s = seg ? seg.s : null;
        const segQty = seg ? seg.qty : 0;                 // 이 행에 배정된 수량(FIFO)
        const segRatio = (seg && seg.tot > 0) ? seg.qty / seg.tot : 1; // 판매금액 안분 비율
        const d = i >= __segs.length && i < __segs.length + dispRows.length ? dispRows[i - __segs.length] : null;
        const inv = !!(seg && seg.rest); // 남은 입고분 = 재고
        const isFirst = i === 0;
        const __inRowSet = new Set(lotObj.inRows || []);
        const __segIsIn = !!(seg && seg.p && __inRowSet.has(seg.p));   // 기타입고 건에 배정된 행 → 부서별 이윤 없음
        // 자산순번 36·37 LOT 의 이윤(LOT 전체 1회)을 표시할 행: 기타출고가 아닌 첫 행 (없으면 첫 행)
        const __pvRow = (() => { const ix = __segs.findIndex(x => !x.outUsed && !x.retUsed && (lotObj.inRows || []).indexOf(x.p) < 0); return ix < 0 ? 0 : ix; })();
        const isLast = i === __segCount - 1;
        const rowSpan = __segCount;
        // 실현 수익(구매)/(합성) — LOT 값 산출 후 판매내역 행별로 판매수량 비례 안분 표시
        const __ia = window.__kjItemAlloc;
        const __lotYm = String(lotObj.pDateRaw || '').replace(/[^0-9]/g, '').slice(0, 6); // 입고월
        let lotEstMargin = null;
        let lotEstSynth = null;
        if (__ia && __ia.ready && (lotObj.totalPQty || 0) !== 0) {
          const __code = (lotObj.searchKeywords && lotObj.searchKeywords.itemNo) || '';
          const __price = __ia.priceOf(__code, __lotYm);
          if (__price != null) {
            lotEstMargin = Math.round((lotObj.totalPQty || 0) * __price * __ia.pctOf(__code) / 100);
          }
          const __sr = (window.KJHub && window.KJHub.data && window.KJHub.data.synth) || [];
          if (__sr.length) {
            const __kw = lotObj.searchKeywords || {};
            const __key = String(__kw.itemNo || '').trim().toUpperCase() + '|' + String(__kw.lotNo || '').trim().toUpperCase();
            for (let __i = 0; __i < __sr.length; __i++) {
              const __r = __sr[__i];
              const __it = String(getVal(__r, 'ITEMNO', 'ItemNo', '품번') || '').trim().toUpperCase();
              const __lt = String(getVal(__r, 'LOTNO', 'LotNo', 'LOT번호', 'LOT') || '').trim().toUpperCase();
              if (__it && __lt && (__it + '|' + __lt) === __key) {
                lotEstSynth = Math.round((lotObj.totalPAmt || 0) * (__ia.pctSynthOf ? __ia.pctSynthOf(__kw.itemNo || '') : 100) / 100);
                break;
              }
            }
          }
        }
        const __mfgUnit = mfgUnitOfLot(lotObj);
        const __totSQty = lotObj.totalSQty || 0;
        const __kwL = lotObj.searchKeywords || {};
        const __isSynLot = __isSynLotOf(__kwL.itemNo, __kwL.lotNo);
        const __pctB = (__ia && __ia.ready) ? __ia.pctOf(__kwL.itemNo || '') : 0;
        const __pctS = (__ia && __ia.ready && __ia.pctSynthOf) ? __ia.pctSynthOf(__kwL.itemNo || '') : 0;
        // [배분 비율 설정(품목)] 판매가(구매)=內 단가 · 판매가(합성)=內 제조원가
        const __sellBuy = (__ia && __ia.ready && __ia.sellBuyOf) ? __ia.sellBuyOf(__kwL.itemNo || '', __lotYm) : null;
        const __sellSyn = (__ia && __ia.ready && __ia.sellSynOf) ? __ia.sellSynOf(__kwL.itemNo || '', __lotYm) : null;
        // 월별품목별제조원가: 제조원가(입고월 ProcPrice) · 內단가(InputMatUnit 3개월) · 內제조원가(ProcPrice 3개월)
        const __mfg = (__ia && __ia.ready && __ia.mfgOf) ? __ia.mfgOf((lotObj.searchKeywords && lotObj.searchKeywords.itemNo) || '', __lotYm) : { proc: null, mat3: null, proc3: null };
        // 內 제조원가: 합성 대상 데이터(ItemNo|LotNo 일치)만 새 계산식(proc3), 비합성 품목은 內 단가(mat3)와 동일
        const __proc3Eff = __sellSyn; // 內 제조원가 = 판매가(합성)
        const bottomBorder = isLast ? 'border-b border-slate-200' : '';
        return /*#__PURE__*/React.createElement("tr", {
          key: lotObj.lotNo + "-" + i,
          className: "hover:bg-indigo-50/40 transition-colors",
          onDoubleClick: () => { // 생산계획 품목이면 더블클릭으로 실자재투입내역 이동
            const __c = (lotObj.searchKeywords && lotObj.searchKeywords.itemNo) || '';
            if (!__isPlanItem(__c)) return;
            if (window.KJHub && window.KJHub.openMatInput) window.KJHub.openMatInput({ itemNo: __c, itemName: (lotObj.searchKeywords && lotObj.searchKeywords.itemName) || '', lotNo: lotObj.lotNo || '', ym: String(lotObj.pDateRaw || '').replace(/[^0-9]/g, '').slice(0, 6) });
          }
        }, isFirst && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("td", {
          rowSpan: rowSpan,
          className: "py-1 px-1.5 font-mono text-slate-700 font-medium align-middle border-b border-slate-200"
        }, /*#__PURE__*/React.createElement("div", {
          className: "flex items-center gap-1.5"
        }, /*#__PURE__*/React.createElement("span", null, lotObj.lotNo || '-'),
          __isPlanItem((lotObj.searchKeywords && lotObj.searchKeywords.itemNo) || '') && /*#__PURE__*/React.createElement("button", {
            onClick: e => {
              e.stopPropagation();
              const __c = (lotObj.searchKeywords && lotObj.searchKeywords.itemNo) || '';
              if (window.KJHub && window.KJHub.openMatInput) window.KJHub.openMatInput({ itemNo: __c, itemName: (lotObj.searchKeywords && lotObj.searchKeywords.itemName) || '', lotNo: lotObj.lotNo || '', ym: String(lotObj.pDateRaw || '').replace(/[^0-9]/g, '').slice(0, 6) });
            },
            title: "실자재투입내역 보기 (행 더블클릭도 가능)",
            className: "text-[10px] font-sans font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 rounded px-1.5 py-0.5 whitespace-nowrap"
          }, "실자재"))), /*#__PURE__*/React.createElement("td", {
          rowSpan: rowSpan,
          className: "py-1 px-1.5 text-right border-l border-b border-slate-200 align-middle font-medium text-slate-700"
        }, formatFloat(totalPQty), " ", pRows[0] ? getVal(pRows[0], 'UNITNAME', '단위') : ((lotObj.inRows && lotObj.inRows[0]) ? getVal(lotObj.inRows[0], 'UNITNAME', '단위') : 'KG'),
          (lotObj.totalRetQty || 0) !== 0 && /*#__PURE__*/React.createElement("div", { className: "text-[10px] text-rose-700 font-normal", title: "반품 수량 " + formatFloat(lotObj.totalRetQty) + " · 금액 " + formatNumber(lotObj.totalRetAmt || 0) + "원 (구매 수량·금액에 더함)" }, "반품 " + formatFloat(lotObj.totalRetQty) + " 포함"),
          (lotObj.totalInQty || 0) > 0 && /*#__PURE__*/React.createElement("div", { className: "text-[10px] text-teal-700 font-normal", title: "구매 " + formatFloat(lotObj.totalBuyQty || 0) + " + 기타입고 " + formatFloat(lotObj.totalInQty) }, "기타입고 " + formatFloat(lotObj.totalInQty) + " 포함"))),
        // ★ 입고(구매) 행별 상세 — 같은 LOT에 입고 건이 여러 개면 각 행으로 표시
        (() => {
          const p = seg ? seg.p : null; // FIFO 로 이 행에 배정된 입고 건
          const pb = (i === __segCount - 1) ? 'border-b border-slate-200' : '';
          const cell = (cls, val) => /*#__PURE__*/React.createElement("td", { className: "py-1 px-1.5 " + cls + " " + pb }, val);
          if (!p) return /*#__PURE__*/React.createElement(React.Fragment, null,
            cell("text-center text-slate-300 border-l border-slate-200", '-'),
            cell("text-center text-slate-300", '-'),
            cell("text-right text-slate-300", '-'),
            cell("text-right text-slate-300", '-'),
            cell("text-right text-slate-300 bg-slate-50/50", '-'),
            cell("text-right text-slate-300 bg-indigo-50/30 border-l border-slate-200", '-'),
            cell("text-right text-slate-300 bg-slate-50/50", '-'));
          const pQtyAll = parseNum(getVal(p, 'QTY', '수량'));
          const pAmtAll = Math.round(parseNum(getVal(p, 'DOMAMT', '원화금액')));
          const pRatio = pQtyAll > 0 ? segQty / pQtyAll : 1;   // 이 행에 배정된 비율
          const pAmtRow = Math.round(pAmtAll * pRatio);        // 금액도 배정 수량 비례
          const pDt = cleanString(getVal(p, 'PERMITDATE', '수입면장일자', '구매일자'));
          return /*#__PURE__*/React.createElement(React.Fragment, null,
            /*#__PURE__*/React.createElement("td", {
              className: "py-1 px-1.5 text-center text-slate-500 border-l border-slate-200 " + pb,
              title: "이 행 배정 " + formatFloat(segQty) + " / 이 입고 건 수량 " + formatFloat(pQtyAll) + " · LOT 입고 " + pRows.length + "건 (선입선출 배정)"
            }, /*#__PURE__*/React.createElement("span", null, pDt ? formatDate(pDt) : '-'),
              __segIsIn && /*#__PURE__*/React.createElement("span", { className: "ml-1 text-[10px] font-bold text-teal-700 bg-teal-50 border border-teal-100 rounded px-1", title: "기타입고 (수입구분/SMImpTypeName) — 같은 LOT·품번(Chk)에 수량만 더함 · 이 입고분 판매는 부서별 이윤 없이 실현 수익만" }, "기타입고"),
              /*#__PURE__*/React.createElement("span", { className: "ml-1 text-[10px] text-slate-400" }, "(" + formatFloat(segQty) + ")")),
            cell("text-center text-slate-500", getVal(p, 'CURRNAME', '통화') || '-'),
            cell("text-right text-slate-600", formatFloat(getVal(p, 'PRICE', '단가'))),
            cell("text-right text-slate-500", formatFloat(getVal(p, 'EXRATE', '환율'))),
            cell("text-right text-slate-800 bg-slate-50/50", formatNumber(parseNum(getVal(p, 'PRICE', '단가')) * parseNum(getVal(p, 'EXRATE', '환율')))),
            cell("text-right text-indigo-700 bg-indigo-50/30 border-l border-slate-200",
              getVal(p, 'PROCPRICE', '제조원가') !== '' ? formatNumber(parseNum(getVal(p, 'PROCPRICE', '제조원가')))
                : (__mfg.proc != null ? formatNumber(__mfg.proc) : '-')),
            cell("text-right text-slate-800 bg-slate-50/50 font-medium", formatNumber(pAmtRow)));
        })(), (() => {
          const sQty = s ? segQty : 0; // FIFO 배정 수량
          const rowQty = s ? sQty : d ? d.qty : inv ? segQty : 0;
          const rowExp = expPerUnit > 0 && rowQty !== 0 ? rowQty * expPerUnit : null;
          return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("td", {
            className: "py-1 px-1.5 text-right border-l border-slate-100 " + bottomBorder + " text-cyan-700 bg-cyan-50/20 font-medium"
          }, __sellBuy != null ? formatNumber(__sellBuy) : '-'), /*#__PURE__*/React.createElement("td", {
            className: "py-1 px-1.5 text-right border-l border-slate-100 " + bottomBorder + " text-cyan-800 bg-cyan-50/20 font-medium"
          }, __proc3Eff != null ? formatNumber(__proc3Eff) : '-'), /*#__PURE__*/React.createElement("td", {
            className: "py-1 px-1.5 text-right border-l border-slate-100 " + bottomBorder + " " + (rowExp !== null ? 'text-orange-600 bg-orange-50/30 font-medium' : 'text-slate-300 bg-orange-50/10')
          }, rowExp !== null ? formatNumber(rowExp) : '-'), /*#__PURE__*/React.createElement("td", {
            className: "py-1 px-1.5 text-right border-l border-slate-100 bg-slate-100/50 " + bottomBorder + " " + (s ? 'text-slate-800 font-medium' : 'text-slate-300')
          }, s ? formatNumber(sQty * cogsUnit) : '-'));
        })(), s ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("td", {
          className: "py-1 px-1.5 text-right text-emerald-700 border-l border-slate-100 bg-emerald-50/10 " + bottomBorder
        }, formatFloat(segQty) + " " + getVal(s, 'UNITNAME', '단위', pRows[0] ? getVal(pRows[0], 'UNITNAME', '단위') : 'KG')), /*#__PURE__*/React.createElement("td", {
          className: "py-1 px-1.5 text-left text-emerald-700 bg-emerald-50/10 max-w-[120px] truncate " + bottomBorder,
          title: getVal(s, 'CUSTNAME') ? getVal(s, 'CUSTNAME') + " (" + getVal(s, 'CUSTNO') + ")" : '-'
        }, getVal(s, 'CUSTNAME', '청구처') || '-'), /*#__PURE__*/React.createElement("td", {
          className: "py-1 px-1.5 text-center text-emerald-600 bg-emerald-50/10 " + bottomBorder
        }, getVal(s, 'EMPNAME', '담당자') || '-'), /*#__PURE__*/React.createElement("td", {
          className: "py-1 px-1.5 text-center text-emerald-600 bg-emerald-50/10 " + bottomBorder
        }, formatDate(getVal(s, 'BILLDATE', '청구일자', '판매일자', '일자'))), /*#__PURE__*/React.createElement("td", {
          className: "py-1 px-1.5 text-center text-emerald-600 border-l border-slate-100 bg-emerald-50/10 " + bottomBorder
        }, getVal(s, 'CURRNAME', '통화') || '-'), /*#__PURE__*/React.createElement("td", {
          className: "py-1 px-1.5 text-right text-emerald-600 bg-emerald-50/10 " + bottomBorder
        }, formatFloat(getVal(s, 'PRICE', '단가'))), /*#__PURE__*/React.createElement("td", {
          className: "py-1 px-1.5 text-right text-emerald-600 bg-emerald-50/10 " + bottomBorder
        }, formatFloat(getVal(s, 'EXRATE', '환율'))), /*#__PURE__*/React.createElement("td", {
          className: "py-1 px-1.5 text-right text-emerald-800 bg-emerald-100/50 " + bottomBorder
        }, formatNumber(parseNum(getVal(s, 'PRICE')) * parseNum(getVal(s, 'EXRATE')))), /*#__PURE__*/React.createElement("td", {
          className: "py-1 px-1.5 text-right text-emerald-800 bg-emerald-100/50 font-medium " + bottomBorder
        }, formatNumber(Math.round(parseNum(getVal(s, 'DOMAMT', '판매금액', '원화금액')) * segRatio)))) : (seg && seg.matUsed) ? /*#__PURE__*/React.createElement("td", {
          colSpan: 9,
          className: "py-1 px-1.5 text-center text-indigo-600 bg-indigo-50/30 border-l border-slate-100 " + bottomBorder + " font-medium",
          title: "실자재투입 내역에서 이 LOT(같은 품번)이 생산에 투입된 수량 — 재고에서 뺌. 원료 수익은 생산된 제품 LOT 에서 원료 부서로 계산합니다 (여기서 또 계산하면 중복)."
        }, "생산 투입 " + formatFloat(segQty) + " " + (pRows[0] ? getVal(pRows[0], 'UNITNAME', '단위') || '' : '')) : (seg && seg.retUsed) ? /*#__PURE__*/React.createElement("td", {
          colSpan: 9,
          className: "py-1 px-1.5 text-center text-rose-700 bg-rose-50/40 border-l border-slate-100 " + bottomBorder + " font-medium",
          title: "구매 데이터의 수입구분(또는 SMImpTypeName) '반품' 행 (같은 LOTNo + ItemNoChk) — 수량·금액(음수)을 구매에 더함 · 부서별 이윤 없음"
        }, "반품 -" + formatFloat(segQty) + " " + (pRows[0] ? getVal(pRows[0], 'UNITNAME', '단위') || '' : '') + (seg.oRow ? " · " + formatNumber(Math.round(parseNum(getVal(seg.oRow, 'DOMAMT', '원화금액')) * (seg.rq > 0 ? segQty / seg.rq : 1))) + "원" + (cleanString(getVal(seg.oRow, 'PERMITDATE', '수입면장일자', '구매일자')) ? " (" + cleanString(getVal(seg.oRow, 'PERMITDATE', '수입면장일자', '구매일자')) + ")" : "") : "")) : (seg && seg.outUsed) ? /*#__PURE__*/React.createElement("td", {
          colSpan: 9,
          className: "py-1 px-1.5 text-center text-amber-700 bg-amber-50/40 border-l border-slate-100 " + bottomBorder + " font-medium",
          title: "구매 데이터의 SMImpTypeName '기타출고' 행 (같은 LOTNo + ItemNoChk) — 재고에서 뺌 · 구매 부서 이윤만 계산, 실현 수익 없음"
        }, "기타출고 " + formatFloat(segQty) + " " + (pRows[0] ? getVal(pRows[0], 'UNITNAME', '단위') || '' : '') + (seg.oRow && cleanString(getVal(seg.oRow, 'PERMITDATE', '수입면장일자', '구매일자')) ? " (" + cleanString(getVal(seg.oRow, 'PERMITDATE', '수입면장일자', '구매일자')) + ")" : "")) : (seg && seg.disposedAll) ? /*#__PURE__*/React.createElement("td", {
          colSpan: 9,
          className: "py-1 px-1.5 text-center text-red-500 bg-red-50/30 border-l border-slate-100 " + bottomBorder + " font-medium"
        }, "전량 폐기") : /*#__PURE__*/React.createElement("td", {
          // 잔량 행은 표기하지 않음 (재고는 [Lot별 재고조회] 화면에서 확인)
          colSpan: 9,
          className: "py-1 px-1.5 bg-slate-50/20 border-l border-slate-100 " + bottomBorder
        }), ...(() => {
          // ── 이윤 9종: 판매 행에만 계산 ──
          const __procW = __mfg.proc != null ? __mfg.proc
            : (pRows[0] && getVal(pRows[0], 'PROCPRICE', '제조원가') !== '' ? parseNum(getVal(pRows[0], 'PROCPRICE', '제조원가')) : null);
          // ★ 이윤은 이 행에 배정된 '그 입고 건' 기준으로 계산
          //    (같은 LOT이라도 입고 건마다 부서·단가·입고월이 다를 수 있음)
          const __pSeg = (seg && seg.p) || pRows[0] || null;
          const __ymSeg = __pSeg
            ? (cleanString(getVal(__pSeg, 'PERMITDATE', '수입면장일자', '구매일자')).replace(/[^0-9]/g, '').slice(0, 6) || __lotYm)
            : __lotYm;
          const __deptSeg = __pSeg ? (cleanString(getVal(__pSeg, 'DEPTNAME', '부서')) || lotObj.dept || '') : (lotObj.dept || '');
          const __sellBuySeg = (__ia && __ia.ready && __ia.sellBuyOf) ? __ia.sellBuyOf(__kwL.itemNo || '', __ymSeg) : __sellBuy;
          const __sellSynSeg = (__ia && __ia.ready && __ia.sellSynOf) ? __ia.sellSynOf(__kwL.itemNo || '', __ymSeg) : __sellSyn;
          const __procSeg = (__ia && __ia.ready && __ia.mfgOf) ? __ia.mfgOf(__kwL.itemNo || '', __ymSeg).proc
            : (__pSeg && getVal(__pSeg, 'PROCPRICE', '제조원가') !== '' ? parseNum(getVal(__pSeg, 'PROCPRICE', '제조원가')) : __procW);
          const __unitWonSeg = __pSeg ? parseNum(getVal(__pSeg, 'PRICE', '단가')) * parseNum(getVal(__pSeg, 'EXRATE', '환율')) : 0;
          const __pv = (__noSaleLot && i === __pvRow) ? computeProfits({
            noSales: true, tradeAsset: isTradeAsset(__pSeg), itemNo: (lotObj.searchKeywords && lotObj.searchKeywords.itemNo) || '', lotNo: lotObj.lotNo || '',
            ym: __ymSeg, isSynth: __isSynLot, lotDept: __deptSeg, sellBuy: __sellBuySeg, sellSyn: __sellSynSeg,
            proc: __procSeg != null ? __procSeg : __procW, unitWon: __unitWonSeg, saleQty: totalPQty - (lotObj.totalInQty || 0) - (lotObj.totalRetQty || 0), saleAmt: 0
          }) : (__segIsIn || (seg && seg.retUsed)) ? null : (seg && seg.outUsed) ? ((__isSynLot || __noSaleLot) ? null : computeProfits({
            noSales: true, tradeAsset: true, isSynth: false,
            itemNo: (lotObj.searchKeywords && lotObj.searchKeywords.itemNo) || '', lotNo: lotObj.lotNo || '', ym: __ymSeg,
            lotDept: __deptSeg, sellBuy: __sellBuySeg, sellSyn: __sellSynSeg, proc: __procW,
            unitWon: __unitWonSeg, saleQty: segQty, saleAmt: 0
          })) : s ? computeProfits({
            noSales: __noSaleLot,
            tradeAsset: isTradeAsset(__pSeg),
            saleDeptAsset: s ? isSaleDeptAsset(s) : false,
            saleDept: s ? cleanString(getVal(s, 'DEPTNAME', '부서')) : '',
            itemNo: (lotObj.searchKeywords && lotObj.searchKeywords.itemNo) || '',
            lotNo: lotObj.lotNo || '',
            ym: __ymSeg,
            isSynth: __isSynLot,
            lotDept: __deptSeg,
            sellBuy: __sellBuySeg,
            sellSyn: __sellSynSeg,
            proc: __procSeg != null ? __procSeg : __procW,
            unitWon: __unitWonSeg,
            saleQty: __noSaleLot ? totalPQty : segQty,
            saleAmt: __noSaleLot ? 0 : Math.round(parseNum(getVal(s, 'DOMAMT', '판매금액', '원화금액')) * segRatio)
          }) : null;
          return PROFIT_COLS.map(pc => /*#__PURE__*/React.createElement("td", {
            key: 'pv-' + pc.key,
            className: "py-1 px-1.5 text-center font-semibold border-l border-slate-100 " + bottomBorder,
            style: { color: (__pv && __pv[pc.key] != null) ? pc.color : undefined },
            title: pc.title
          }, (__pv && __pv[pc.key] != null) ? formatNumber(__pv[pc.key]) : '-'));
        })(), /*#__PURE__*/React.createElement("td", {
          className: "py-1 px-1.5 text-center font-bold border-l border-slate-100 " + bottomBorder + " " + (s ? getMarginColor(s._margin) : 'text-slate-400')
        }, s ? formatNumber(s._margin) : "-"));
      });
    })))), hasMore && /*#__PURE__*/React.createElement("div", {
      className: "flex justify-center items-center gap-2 py-2 bg-slate-50 border-t border-slate-200"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => setVisibleCount(c => c + PAGE_SIZE),
      className: "text-xs font-medium text-slate-600 hover:text-indigo-600 px-3 py-1 rounded border border-slate-200 bg-white hover:border-indigo-300 transition-colors"
    }, PAGE_SIZE + "건 더 보기 (" + visibleCount + "/" + lotGroups.length + ")"), /*#__PURE__*/React.createElement("button", {
      onClick: () => setVisibleCount(lotGroups.length),
      className: "text-xs font-medium text-indigo-600 hover:text-indigo-800 px-3 py-1 rounded border border-indigo-200 bg-white hover:border-indigo-400 transition-colors"
    }, "전체 보기 (" + lotGroups.length + "건)")))))) : null));
  });
  function KPICard({
    title,
    amount,
    borderClass,
    iconBg,
    iconColor,
    icon,
    valueClass = "text-slate-900"
  }) {
    return /*#__PURE__*/React.createElement("div", {
      className: "bg-white rounded-xl border border-slate-200 border-l-4 " + borderClass + " shadow-sm p-4 flex justify-between items-center"
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
      className: "text-xs font-semibold text-slate-500 mb-0.5"
    }, title), /*#__PURE__*/React.createElement("div", {
      className: "text-xl font-bold " + valueClass
    }, formatNumber(amount), " ", /*#__PURE__*/React.createElement("span", {
      className: "text-xs font-normal text-slate-500"
    }, "원"))), /*#__PURE__*/React.createElement("div", {
      className: "p-2.5 rounded-lg " + iconBg + " " + iconColor
    }, icon));
  }
  const root = ReactDOM.createRoot(document.getElementById('legacy-root'));
  root.render(/*#__PURE__*/React.createElement(App, null));
})();
  
}
