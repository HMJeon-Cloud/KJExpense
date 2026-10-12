// 기존 화면 모듈 (Apps Script 판에서 그대로 이전) — 셸 API(KJHub)와 google.script.run 셈을 통해 Supabase 와 연결
/* eslint-disable */
export default function init() {
  const __onReady = fn => fn();

(function () {
  // ==========================================================================
  // 📦 Lot별 재고조회 — 사업장 단위로 묶어 표시, 열 정렬·조회 조건 지원
  // ==========================================================================
  const $l = id => document.getElementById(id);
  const hub = () => window.KJHub || {};
  const nrm = v => String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase();
  const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isNaN(n) ? 0 : n; };
  const fmt = n => (Math.round(Number(n) || 0)).toLocaleString('ko-KR');
  const fmtF = n => { const v = Number(n) || 0; return (Math.round(v * 10000) / 10000).toLocaleString('ko-KR'); };
  const d8 = v => String(v == null ? '' : v).replace(/[^0-9]/g, '').slice(0, 8);
  const fmtD = v => { const d = d8(v); return d.length === 8 ? d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6) : (v ? String(v) : '-'); };
  const today8 = () => { const d = new Date(); return String(d.getFullYear()) + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); };
  const daysBetween = (a, b) => { // a,b: YYYYMMDD
    const p = t => new Date(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8));
    return Math.round((p(b) - p(a)) / 86400000);
  };

  let openBiz = null;                 // 펼친 사업장
  let sortKey = '', sortDir = 'asc';  // 열 정렬
  const COLS = [
    { k: 'biz', label: '사업장', align: 'left', w: '110px' },
    { k: 'itemNo', label: '품번', align: 'left', w: '110px' },
    { k: 'itemName', label: '품명', align: 'left', w: '190px', clip: true, small: true }, // 길면 말줄임(마우스 오버로 전체 확인)
    { k: 'lotNo', label: '제조번호', align: 'left', w: '120px', clip: true },
    { k: 'regDate', label: '입고일', align: 'center', w: '96px', date: true },
    { k: 'createDate', label: '제조일', align: 'center', w: '96px', date: true },
    { k: 'valiDate', label: '유효일자', align: 'center', w: '116px', date: true },
    { k: 'qty', label: '수량', align: 'right', w: '92px', num: true, float: true },
    { k: 'unit', label: '단위', align: 'center', w: '56px' },
    { k: 'exRate', label: '환율', align: 'right', w: '68px', num: true, float: true },
    { k: 'price', label: '단가', align: 'right', w: '104px', num: true, float: true },
    { k: 'amt', label: '재고금액', align: 'right', w: '124px', num: true }
  ];
  const pick = (row, cands) => {
    for (const k in row) { const n = nrm(k); for (const c of cands) if (n === nrm(c)) return row[k]; }
    return '';
  };
  function allRows() {
    const src = (hub().data && hub().data.stock) || [];
    return src.map(r => ({
      biz: String(pick(r, ['BizName', '사업장'])).trim() || '(미지정)',
      itemNo: String(pick(r, ['ItemNo', '품번'])).trim(),
      itemName: String(pick(r, ['ItemName', '품명'])).trim(),
      lotNo: String(pick(r, ['LotNo', '제조번호'])).trim(),
      regDate: d8(pick(r, ['RegDate', '입고일'])),
      createDate: d8(pick(r, ['CreateDate', '제조일'])),
      valiDate: d8(pick(r, ['ValiDate', '유효일자'])),
      qty: num(pick(r, ['StockQty', '수량'])),
      unit: String(pick(r, ['UnitName', '단위'])).trim(),
      exRate: num(pick(r, ['ExRate', '환율'])),
      price: num(pick(r, ['Price', '단가'])),
      amt: num(pick(r, ['StockAmt', '재고금액']))
    }));
  }
  function filtered() {
    const qItem = nrm($l('lsItem') ? $l('lsItem').value : '');
    const qLot = nrm($l('lsLot') ? $l('lsLot').value : '');
    const from = ($l('lsFrom') ? $l('lsFrom').value : '').replace(/-/g, '');
    const to = ($l('lsTo') ? $l('lsTo').value : '').replace(/-/g, '');
    const exp = $l('lsExpire') && $l('lsExpire').value !== '' ? Number($l('lsExpire').value) : null;
    const t0 = today8();
    return allRows().filter(r => {
      if (qItem && nrm(r.itemNo).indexOf(qItem) < 0 && nrm(r.itemName).indexOf(qItem) < 0) return false;
      if (qLot && nrm(r.lotNo).indexOf(qLot) < 0) return false;
      if (from) { if (!r.regDate || r.regDate < from) return false; }
      if (to) { if (!r.regDate || r.regDate > to) return false; }
      if (exp != null) { // 유효일자가 오늘부터 N일 이내(이미 지난 것 포함)
        if (!r.valiDate) return false;
        const left = daysBetween(t0, r.valiDate);
        if (left > exp) return false;
      }
      return true;
    });
  }
  function sortRows(arr) {
    if (!sortKey) return arr;
    const c = COLS.find(x => x.k === sortKey) || {};
    return arr.slice().sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      const r = c.num ? (Number(va) - Number(vb)) : String(va || '').localeCompare(String(vb || ''), 'ko');
      return sortDir === 'asc' ? r : -r;
    });
  }

  function render() {
    const body = $l('lsBody'), empty = $l('lsEmpty');
    if (!body || !empty) return;
    const src = (hub().data && hub().data.stock) || null;
    if (!src) {
      body.innerHTML = ''; empty.classList.remove('hidden');
      empty.innerText = 'LOT별 재고 데이터가 아직 로드되지 않았습니다. 데이터 패널에서 시트 연결을 확인해 주세요.';
      if ($l('lsCount')) $l('lsCount').innerText = '';
      return;
    }
    const rows = sortRows(filtered());
    if (!rows.length) {
      body.innerHTML = ''; empty.classList.remove('hidden');
      empty.innerText = '조회 조건에 해당하는 재고가 없습니다.';
      if ($l('lsCount')) $l('lsCount').innerText = '';
      return;
    }
    empty.classList.add('hidden');
    // 사업장별 묶기
    const groups = Object.create(null), order = [];
    rows.forEach(r => { if (!groups[r.biz]) { groups[r.biz] = []; order.push(r.biz); } groups[r.biz].push(r); });
    order.sort((a, b) => a.localeCompare(b, 'ko'));
    if (openBiz === null) { openBiz = new Set(); if (order.length <= 3) order.forEach(b => openBiz.add(b)); }

    const arrow = k => sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    const thead = '<thead class="bg-white text-slate-500 text-[11px] border-b border-slate-200"><tr>'
      + COLS.filter(c => c.k !== 'biz').map(c => '<th data-sk="' + c.k + '" class="ls-th py-2 px-2 text-' + c.align
        + ' font-semibold cursor-pointer select-none hover:bg-slate-100 whitespace-nowrap"'
        + (c.w ? ' style="width:' + c.w + '"' : '') + ' title="클릭하여 정렬">' + c.label + arrow(c.k) + '</th>').join('')
      + '</tr></thead>';
    const t0 = today8();
    body.innerHTML = order.map(biz => {
      const list = groups[biz];
      const isOpen = openBiz.has(biz);
      const sumAmt = list.reduce((a, r) => a + r.amt, 0);
      const tb = !isOpen ? '' : list.map(r => {
        const left = r.valiDate ? daysBetween(t0, r.valiDate) : null;
        const warn = left != null && left <= 30;
        return '<tr class="border-b border-slate-100 hover:bg-slate-50/60">'
          + COLS.filter(c => c.k !== 'biz').map(c => {
            const v = r[c.k];
            const txt = c.date ? fmtD(v) : c.num ? (c.float ? fmtF(v) : fmt(v)) : (v || '-');
            let cls = 'py-1 px-2 text-' + c.align + ' whitespace-nowrap ';
            if (c.k === 'amt') cls += 'font-bold text-indigo-700';
            else if (c.k === 'valiDate' && warn) cls += 'font-bold ' + (left < 0 ? 'text-red-600' : 'text-amber-600');
            else cls += 'text-slate-700';
            const st = (c.num ? 'font-variant-numeric:tabular-nums;' : '')
              + (c.small ? 'font-size:11px;' : '')
              + (c.clip ? 'max-width:' + c.w + ';overflow:hidden;text-overflow:ellipsis;' : '');
            const extra = (c.k === 'valiDate' && left != null) ? '<span style="font-size:10px;color:#94a3b8"> (' + (left < 0 ? '만료 ' + (-left) + '일' : 'D-' + left) + ')</span>' : '';
            return '<td class="' + cls + '"' + (st ? ' style="' + st + '"' : '') + (c.clip ? ' title="' + String(v || '').replace(/"/g, '&quot;') + '"' : '') + '>' + txt + extra + '</td>';
          }).join('') + '</tr>';
      }).join('');
      return '<div class="bg-white border border-slate-200 rounded-xl" style="overflow:hidden">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;flex-wrap:wrap">'
        + '<span style="display:flex;align-items:center;gap:10px">'
          + '<button class="ls-toggle" data-biz="' + biz + '" title="' + (isOpen ? '접기' : '펼치기') + '" style="font-size:12px;width:22px;height:22px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#475569;line-height:1">' + (isOpen ? '−' : '+') + '</button>'
          + '<span style="font-size:13px;font-weight:700;color:#1e293b">' + biz + '</span></span>'
        + '<span style="font-size:12px;color:#475569">' + list.length.toLocaleString() + '건 · 재고금액 <b style="color:#1e293b">' + fmt(sumAmt) + '</b>원</span>'
        + '</div>'
        + (!isOpen ? '' : '<div style="overflow-x:auto;max-height:560px;overflow-y:auto"><table class="w-full" style="min-width:1020px;font-size:12px;table-layout:fixed">' + thead + '<tbody>' + tb + '</tbody></table></div>')
        + '</div>';
    }).join('');

    body.querySelectorAll('.ls-th').forEach(h2 => h2.addEventListener('click', () => {
      const k = h2.dataset.sk;
      if (sortKey === k) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortKey = k; sortDir = (k === 'amt' || k === 'qty') ? 'desc' : 'asc'; }
      render();
    }));
    body.querySelectorAll('.ls-toggle').forEach(b => b.addEventListener('click', () => {
      const z = b.dataset.biz;
      if (openBiz.has(z)) openBiz.delete(z); else openBiz.add(z);
      render();
    }));
    const total = rows.reduce((a, r) => a + r.amt, 0);
    const totQty = rows.reduce((a, r) => a + r.qty, 0);
    if ($l('lsCount')) $l('lsCount').innerText = '사업장 ' + order.length + '개 · ' + rows.length.toLocaleString() + '건 · 수량 합계 ' + fmtF(totQty) + ' · 재고금액 합계 ' + fmt(total) + '원';
  }

  __onReady(() => {
    const on = (id, ev, fn) => { const el = $l(id); if (el) el.addEventListener(ev, fn); };
    on('lsSearchBtn', 'click', () => { openBiz = null; render(); });
    on('lsResetBtn', 'click', () => {
      ['lsItem', 'lsLot', 'lsFrom', 'lsTo', 'lsExpire'].forEach(id => { if ($l(id)) $l(id).value = ''; });
      openBiz = null; sortKey = ''; render();
    });
    on('lsExpandAll', 'click', () => { openBiz = new Set(allRows().map(r => r.biz)); render(); });
    on('lsCollapseAll', 'click', () => { openBiz = new Set(); render(); });
    ['lsItem', 'lsLot'].forEach(id => on(id, 'keydown', ev => { if (ev.key === 'Enter') { openBiz = null; render(); } }));
    render();
  });
  window.addEventListener('kjhub:data', render);
})();
  
}
