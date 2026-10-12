// 기존 화면 모듈 (Apps Script 판에서 그대로 이전) — 셸 API(KJHub)와 google.script.run 셈을 통해 Supabase 와 연결
/* eslint-disable */
export default function init() {
  const __onReady = fn => fn();

(function () {
  // ==========================================================================
  // 🧪 실자재투입내역 — [구매 및 판매 내역]에서 넘어온 품목만 표시
  //    진입: KJHub.openMatInput({ itemNo, itemName, lotNo })
  // ==========================================================================
  const $m = id => document.getElementById(id);
  const nrm = s => String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase();
  let ctx = null; // { itemNo, itemName, lotNo }
  let sortKey = '', sortDir = 'asc'; // 컬럼 정렬 상태

  const rows = () => (window.KJHub && window.KJHub.data && window.KJHub.data.matinput) || [];
  // 컬럼명 후보 — 시트 헤더가 영문/한글 어느 쪽이어도 인식
  const pick = (row, cands) => {
    for (const k in row) { const n = nrm(k); for (const c of cands) if (n === nrm(c)) return row[k]; }
    for (const k in row) { const n = nrm(k); for (const c of cands) if (n.indexOf(nrm(c)) >= 0) return row[k]; }
    return '';
  };
  const ITEM_KEYS = ['GoodItemNo', '생산품번']; // 실자재투입내역의 생산품번
  const LOT_KEYS = ['RRealLotNo', '생산LotNo'];  // 실자재투입내역의 생산 LOT

  function matched() {
    if (!ctx || !ctx.itemNo) return [];
    const it = nrm(ctx.itemNo), lot = nrm(ctx.lotNo);
    return rows().filter(r => {
      if (nrm(pick(r, ITEM_KEYS)) !== it) return false;
      if (lot) { const rl = nrm(pick(r, LOT_KEYS)); if (rl && rl !== lot) return false; }
      return true;
    });
  }

  function render() {
    const wrap = $m('miTableWrap'), empty = $m('miEmpty'), ctxBox = $m('miContext'), cnt = $m('miCount');
    if (!wrap || !empty) return;
    if (ctxBox) {
      if (!ctx) ctxBox.className = 'hidden';
      else {
        ctxBox.className = 'mb-3 border border-slate-200 rounded-lg px-4 py-2.5';
        ctxBox.setAttribute('style', 'display:flex;flex-wrap:wrap;align-items:center;column-gap:40px;row-gap:8px;background:#f8fafc');
        const fld = (lab, val) => '<div style="display:flex;align-items:baseline;gap:10px">'
          + '<span class="text-[11px] font-semibold text-slate-400">' + lab + '</span>'
          + '<span class="text-sm font-bold text-slate-700">' + (val || '-') + '</span></div>';
        ctxBox.innerHTML = fld('품번', ctx.itemNo) + fld('품명', ctx.itemName) + fld('LOTNO', ctx.lotNo);
      }
    }
    const setEmpty = msg => { wrap.classList.add('hidden'); empty.classList.remove('hidden'); empty.innerText = msg; if (cnt) cnt.innerText = ''; };
    if (!ctx) return setEmpty('구매 및 판매 내역에서 품목을 선택해 주세요.');
    if (!rows().length) return setEmpty('실자재투입내역 데이터가 아직 로드되지 않았습니다. 데이터 패널에서 시트 연결을 확인해 주세요.');
    const data = matched();
    if (!data.length) return setEmpty('해당 품목(' + ctx.itemNo + ')의 실자재투입내역이 없습니다.');
    empty.classList.add('hidden'); wrap.classList.remove('hidden');
    // ★ 표시 컬럼 정의 (숨김 컬럼 제외 · 명칭 지정)
    const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isNaN(n) ? 0 : n; };
    const ma = window.__kjMatAlloc;
    const rows2 = data.map(r => {
      const code = nrm(pick(r, ['MatItemNo', '자재코드', '원료코드']) || pick(r, ['MatItemName', '자재명', '원료명']));
      const mym = String(pick(r, ['DelvInDate', '입고일자', '입고일'])).replace(/[^0-9]/g, '').slice(0, 6) || (ctx.ym || '');
      const sell = (ma && ma.ready && ma.sellBuyOf) ? ma.sellBuyOf(code, mym) : 0;
      const inp = num(pick(r, ['InPrice', '입고단가']));
      const qty = num(pick(r, ['Qty', '투입수량']));
      return {
        goodNo: String(pick(r, ['GoodItemNo', '생산품번']) || ''),
        goodNm: String(pick(r, ['GoodItemName', '제품명']) || ''),
        goodLot: String(pick(r, ['RRealLotNo', '생산LotNo']) || ''),
        matNo: String(pick(r, ['MatItemNo', '자재코드']) || ''),
        matNm: String(pick(r, ['MatItemName', '자재명']) || ''),
        asset: String(pick(r, ['AssetName', '자산분류']) || ''),
        matLot: String(pick(r, ['RealLotNo', '자재LotNo']) || ''),
        qty: qty,
        inDate: String(pick(r, ['DelvInDate', '입고일자', '입고일']) || ''),
        inPrice: inp,
        sell: sell,
        profit: Math.round((sell - inp) * qty),
        dept: String(pick(r, ['DeptName', '부서명']) || '')
      };
    });
    const COLS = [
      { key: 'goodNo', label: '제품번호', align: 'left' },
      { key: 'goodNm', label: '제품명', align: 'left', wide: true },
      { key: 'goodLot', label: '제품LotNo', align: 'left' },
      { key: 'matNo', label: '자재번호', align: 'left' },
      { key: 'matNm', label: '자재명', align: 'left', wide: true },
      { key: 'asset', label: '자산분류', align: 'left' },
      { key: 'matLot', label: '자재LotNo', align: 'left' },
      { key: 'qty', label: '수량', align: 'right', num: true },
      { key: 'inDate', label: '입고일', align: 'center', date: true },
      { key: 'inPrice', label: '입고금액', align: 'right', num: true },
      { key: 'sell', label: '판매가(구매)', align: 'right', num: true, hi: 'sky' },
      { key: 'profit', label: '수익 = 판매가(구매)−입고금액×수량', align: 'right', num: true, hi: 'indigo' }
    ];
    // 정렬 적용
    if (sortKey) {
      const c = COLS.find(x => x.key === sortKey) || {};
      rows2.sort((a, b) => {
        const va = a[sortKey], vb = b[sortKey];
        const r = c.num ? (va - vb) : String(va).localeCompare(String(vb), 'ko');
        return sortDir === 'asc' ? r : -r;
      });
    }
    const fmtD = v => { const d = String(v).replace(/[^0-9]/g, ''); return d.length === 8 ? d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6) : String(v || '-'); };
    const arrow = k => sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    $m('miHead').innerHTML = '<tr>' + COLS.map(c =>
      '<th data-sk="' + c.key + '" class="mi-th py-2 px-3 text-' + (c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left')
      + ' font-semibold whitespace-nowrap border-b border-slate-200 cursor-pointer select-none hover:bg-slate-100'
      + (c.hi === 'sky' ? ' text-sky-700 bg-sky-50/40' : c.hi === 'indigo' ? ' text-indigo-700 bg-indigo-50/40' : '')
      + '" title="클릭하여 정렬">' + c.label + arrow(c.key) + '</th>').join('') + '</tr>';
    $m('miBody').innerHTML = rows2.map(r => '<tr class="border-b border-slate-100 hover:bg-slate-50/60">'
      + COLS.map(c => {
        const v = r[c.key];
        const txt = c.date ? fmtD(v) : c.num ? Number(v || 0).toLocaleString('ko-KR') : (v || '-');
        const cls = 'py-1.5 px-3 text-' + (c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left')
          + (c.wide ? ' truncate' : ' whitespace-nowrap')
          + (c.key === 'profit' ? (Number(v) < 0 ? ' font-bold text-red-500 bg-indigo-50/20' : ' font-bold text-indigo-700 bg-indigo-50/20')
            : c.key === 'sell' ? (Number(v) ? ' font-semibold text-sky-700 bg-sky-50/20' : ' text-slate-300 bg-sky-50/20') : ' text-slate-700');
        return '<td class="' + cls + '"' + (c.wide ? ' style="max-width:220px" title="' + (v || '') + '"' : '') + '>' + txt + '</td>';
      }).join('') + '</tr>').join('');
    // 헤더 클릭 정렬
    $m('miHead').querySelectorAll('.mi-th').forEach(th => {
      th.addEventListener('click', () => {
        const k = th.dataset.sk;
        if (sortKey === k) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else { sortKey = k; sortDir = 'asc'; }
        render();
      });
    });
    const total = rows2.reduce((a, b) => a + b.profit, 0);
    const byDept = Object.create(null);
    rows2.forEach(c2 => { const d = c2.dept || '(부서없음)'; byDept[d] = (byDept[d] || 0) + c2.profit; });
    if (cnt) {
      cnt.innerHTML = rows2.length.toLocaleString() + '건 · 수익 합계 <b>' + total.toLocaleString('ko-KR') + '</b>'
        + ' &nbsp;|&nbsp; 부서별: ' + Object.keys(byDept).map(d => d + ' <b>' + byDept[d].toLocaleString('ko-KR') + '</b>').join(' · ')
        + '<br><span class="text-slate-400">판매가(구매)가 0이면 [배분 비율 설정(원자재)]에서 해당 기준월 값이 저장되지 않은 자재입니다.</span>';
    }
  }

  window.KJHub = window.KJHub || {};
  window.KJHub.openMatInput = c => {
    ctx = (c && c.itemNo) ? { itemNo: String(c.itemNo).trim(), itemName: c.itemName || '', lotNo: c.lotNo ? String(c.lotNo).trim() : '', ym: c.ym || '' } : null;
    window.KJHub.matInputCtx = ctx; // 새 화면(React)이 같은 문맥을 읽습니다
    window.dispatchEvent(new CustomEvent('kjhub:matinput'));
    if (window.KJHub.showScreen) window.KJHub.showScreen('mat-input');
    render();
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
  };
  // 합성 대상 품목 집합 — [구매 및 판매 내역]의 이동 버튼 노출 판단에 사용
  window.KJHub.prodPlanItems = () => {
    const set = Object.create(null);
    const pp = (window.KJHub.data && window.KJHub.data.synth) || [];
    for (const r of pp) {
      const k = nrm(pick(r, ['ItemNo', '품번', 'ItemCode']));
      if (k) set[k] = true;
    }
    return set;
  };
  window.addEventListener('kjhub:data', render);
  __onReady(() => {
    render();
  });
})();
  
}
