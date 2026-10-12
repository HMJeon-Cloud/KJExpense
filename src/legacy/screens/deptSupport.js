// 기존 화면 모듈 (Apps Script 판에서 그대로 이전) — 셸 API(KJHub)와 google.script.run 셈을 통해 Supabase 와 연결
/* eslint-disable */
export default function init() {
  const __onReady = fn => fn();

(function () {
  // ==========================================================================
  // 🤝 부서별 지원 내역 — '지원 받는 부서' 기준으로 어떤 지원을 받고 얼마를 부담하는지
  //   admin: 전체 부서 / 그 외: 허용 부서만
  // ==========================================================================
  const $d = id => document.getElementById(id);
  const hub = () => window.KJHub || {};
  const nrm = v => String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase();
  const fmt = n => (Math.round(Number(n) || 0)).toLocaleString('ko-KR');
  const mIdx = m => { const t = String(m); return parseInt(t.slice(0, 4), 10) * 12 + parseInt(t.slice(4, 6), 10) - 1; };
  const mStr = i => String(Math.floor(i / 12)) + ('0' + (i % 12 + 1)).slice(-2);
  const mLbl = m => String(m).slice(0, 4) + '-' + String(m).slice(4, 6);
  const curMonth = () => { const d = new Date(); return String(d.getFullYear()) + ('0' + (d.getMonth() + 1)).slice(-2); };
  const SPLIT_LABEL = { unit: '인원별(단가)', head: '인원별 배분', dept: '부서별 배분', direct: '직접입력' };

  let selMonth = ((window.KJHub && window.KJHub.closeMonth) ? window.KJHub.closeMonth() : curMonth()); // 기본 기준월 = 마감월
  let selDepts = null;      // 표시할 부서 (null = 전체)
  let openDepts = null;     // 펼친 부서 (null = 최초 판단)
  let fromFilter = '';      // 지원 부서 필터 ('' = 전체)
  let sortKey = '', sortDir = 'asc'; // 열 정렬

  const pick = (row, cands) => {
    for (const k in row) { const n = nrm(k); for (const c of cands) if (n === nrm(c)) return row[k]; }
    return '';
  };
  function allDepts() {
    const rows = (hub().data && hub().data.dept) || [];
    const out = [], seen = Object.create(null);
    rows.forEach(r => {
      const d = String(pick(r, ['DeptName', '부서명', '부서'])).trim();
      if (d && !seen[d]) { seen[d] = 1; out.push(d); }
    });
    return out.sort((a, b) => a.localeCompare(b, 'ko'));
  }
  // 권한: null 이면 전체(admin)
  function allowed() {
    try { return hub().screenDepts ? hub().screenDepts('부서별 지원 내역') : null; } catch (e) { return null; }
  }
  function targetDepts() {
    const a = allowed();
    const all = allDepts();
    if (a === null) return all;
    const set = new Set(a.map(nrm));
    const pref = a.filter(x => String(x).endsWith('*')).map(x => nrm(String(x).slice(0, -1)));
    return all.filter(d => set.has(nrm(d)) || pref.some(p => p && nrm(d).indexOf(p) === 0));
  }

  function renderChk(depts) {
    const box = $d('dsDeptChk'); if (!box) return;
    if (depts.length <= 1) { box.className = 'hidden'; selDepts = null; return; }
    box.className = 'flex flex-wrap gap-1.5 mb-3 pb-3 border-b border-slate-100';
    const allOn = !selDepts || depts.every(d => selDepts.has(d));
    box.innerHTML = '<span class="text-[11px] font-semibold text-slate-400 mr-1" style="align-self:center">표시할 부서:</span>'
      + depts.map(d => {
        const on = !selDepts || selDepts.has(d);
        return '<label class="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border cursor-pointer transition-all '
          + (on ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-400 border-slate-200') + '">'
          + '<input type="checkbox" class="ds-chk accent-indigo-600" data-dept="' + d + '"' + (on ? ' checked' : '') + '>' + d + '</label>';
      }).join('')
      + '<button id="dsChkAll" class="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 rounded-lg px-2.5 py-1 ml-1">' + (allOn ? '전체 해제' : '전체 선택') + '</button>';
    box.querySelectorAll('.ds-chk').forEach(c => c.addEventListener('change', () => {
      selDepts = new Set(Array.from(box.querySelectorAll('.ds-chk:checked')).map(x => x.dataset.dept));
      render();
    }));
    const ab = box.querySelector('#dsChkAll');
    if (ab) ab.addEventListener('click', () => { selDepts = allOn ? new Set() : null; render(); });
  }

  function render() {
    const body = $d('dsBody'), empty = $d('dsEmpty'); if (!body || !empty) return;
    const sp = window.__kjSupport;
    const mine = targetDepts();
    renderChk(mine);
    if (!sp || !sp.ready) {
      body.innerHTML = ''; empty.classList.remove('hidden');
      empty.innerText = '지원 내역을 불러오는 중입니다...';
      return;
    }
    if (openDepts === null) { // 부서가 적으면 펼친 상태로 시작
      openDepts = new Set();
      if (mine.length <= 3) mine.forEach(d => openDepts.add(d));
    }
    const show = mine.filter(d => !selDepts || selDepts.has(d));
    // 지원 부서 목록 채우기 (현재 기준월·대상 부서 기준)
    const froms = [];
    mine.forEach(d => (sp.detailsFor(d, selMonth) || []).forEach(r => { if (froms.indexOf(r.from) < 0) froms.push(r.from); }));
    froms.sort((a, b) => a.localeCompare(b, 'ko'));
    const fsel = $d('dsFrom');
    if (fsel) {
      const cur = fromFilter;
      const want = '<option value="">전체</option>' + froms.map(f => '<option value="' + f + '">' + f + '</option>').join('');
      if (fsel.innerHTML !== want) fsel.innerHTML = want;
      if (froms.indexOf(cur) < 0 && cur) fromFilter = '';
      fsel.value = fromFilter;
    }
    const SORTS = { from: 'from', task: 'task', desc: 'desc', split: 'split', targetCount: 'targetCount', amount: 'amount' };
    const sortRows = arr => {
      if (!sortKey) return arr;
      const num = (sortKey === 'amount' || sortKey === 'targetCount');
      return arr.slice().sort((a, b) => {
        const va = a[sortKey], vb = b[sortKey];
        const r = num ? (Number(va) - Number(vb)) : String(va || '').localeCompare(String(vb || ''), 'ko');
        return sortDir === 'asc' ? r : -r;
      });
    };
    const arrow = k => sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    const th = (k, label, align, extra) => '<th data-sk="' + k + '" class="ds-th py-2 px-3 text-' + align
      + ' font-semibold cursor-pointer select-none hover:bg-slate-100 whitespace-nowrap" style="' + extra + '" title="클릭하여 정렬">' + label + arrow(k) + '</th>';
    const blocks = show.map(dept => {
      let rows = sp.detailsFor(dept, selMonth) || [];
      if (fromFilter) rows = rows.filter(r => r.from === fromFilter);
      rows = sortRows(rows);
      const sum = rows.reduce((a, r) => a + r.amount, 0);
      if (!rows.length) return { dept: dept, sum: 0, html: '' };
      const tr = rows.map(r => '<tr class="border-b border-slate-100">'
        + '<td class="py-2 px-3 text-slate-700 font-medium whitespace-nowrap">' + r.from + '</td>'
        + '<td class="py-2 px-3 text-slate-700">' + r.task + '</td>'
        + '<td class="py-2 px-3 text-slate-500">' + (r.desc || '-') + '</td>'
        + '<td class="py-2 px-3 text-slate-500">' + (SPLIT_LABEL[r.split] || r.split) + '</td>'
        + '<td class="py-2 px-3 text-center text-slate-500">' + r.targetCount + '개 부서</td>'
        + '<td class="py-2 px-3 text-right font-bold text-indigo-700" style="font-variant-numeric:tabular-nums">' + fmt(r.amount) + '</td>'
        + '</tr>').join('');
      const isOpen = openDepts.has(dept);
      return {
        dept: dept, sum: sum,
        html: '<div class="bg-white border border-slate-200 rounded-xl" style="overflow:hidden">'
          + '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;flex-wrap:wrap">'
          + '<span style="display:flex;align-items:center;gap:10px">'
            + '<button class="ds-toggle" data-dept="' + dept + '" title="' + (isOpen ? '접기' : '펼치기') + '" style="font-size:12px;width:22px;height:22px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#475569;line-height:1">' + (isOpen ? '−' : '+') + '</button>'
            + '<span style="font-size:13px;font-weight:700;color:#1e293b">' + dept + '</span></span>'
          + '<span style="font-size:12px;color:#475569">지원 ' + rows.length + '건 · 부담 합계 <b style="color:#1e293b">' + fmt(sum) + '</b>원</span>'
          + '</div>'
          + (!isOpen ? '' : '<div style="overflow-x:auto"><table class="w-full text-sm" style="min-width:820px">'
          + '<thead class="bg-white text-slate-500 text-[11px] border-b border-slate-200"><tr>'
          + th('from', '지원 부서', 'left', 'width:170px')
          + th('task', '업무', 'left', 'width:200px')
          + th('desc', '설명', 'left', '')
          + th('split', '형식', 'left', 'width:130px')
          + th('targetCount', '대상', 'center', 'width:110px')
          + th('amount', '우리 부담액', 'right', 'width:140px')
          + '</tr></thead><tbody>' + tr + '</tbody></table></div>') + '</div>'
      };
    }).filter(b => b.html);

    if (!blocks.length) {
      body.innerHTML = ''; empty.classList.remove('hidden');
      empty.innerText = mine.length
        ? mLbl(selMonth) + ' 기준으로 받는 지원 내역이 없습니다.'
        : '조회 권한이 있는 부서가 없습니다.';
      if ($d('dsCount')) $d('dsCount').innerText = '';
      return;
    }
    empty.classList.add('hidden');
    blocks.sort((a, b) => b.sum - a.sum); // 부담액 큰 순
    body.innerHTML = blocks.map(b => b.html).join('');
    body.querySelectorAll('.ds-th').forEach(h2 => h2.addEventListener('click', () => {
      const k = h2.dataset.sk;
      if (sortKey === k) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortKey = k; sortDir = k === 'amount' ? 'desc' : 'asc'; }
      render();
    }));
    body.querySelectorAll('.ds-toggle').forEach(b => b.addEventListener('click', () => {
      const d = b.dataset.dept;
      if (openDepts.has(d)) openDepts.delete(d); else openDepts.add(d);
      render();
    }));
    const total = blocks.reduce((a, b) => a + b.sum, 0);
    if ($d('dsCount')) $d('dsCount').innerText = mLbl(selMonth) + ' 기준 · 부서 ' + blocks.length + '개 · 부담 합계 ' + fmt(total) + '원'
      + (fromFilter ? ' · 지원 부서 [' + fromFilter + '] 만 표시' : '');
  }

  __onReady(() => {
    const sel = $d('dsMonth');
    if (sel) {
      const now = mIdx(curMonth()), out = [];
      for (let i = now; i > now - 24; i--) out.push(mStr(i));
      sel.innerHTML = out.map(m => '<option value="' + m + '"' + (m === selMonth ? ' selected' : '') + '>' + mLbl(m) + '</option>').join('');
      sel.addEventListener('change', () => { selMonth = sel.value; render(); });
    }
    if ($d('dsFrom')) $d('dsFrom').addEventListener('change', () => {
      fromFilter = $d('dsFrom').value || '';
      if (fromFilter) openDepts = new Set(targetDepts()); // 필터 시 자동 펼침
      render();
    });
    if ($d('dsExpandAll')) $d('dsExpandAll').addEventListener('click', () => { openDepts = new Set(targetDepts()); render(); });
    if ($d('dsCollapseAll')) $d('dsCollapseAll').addEventListener('click', () => { openDepts = new Set(); render(); });
    render();
  });
  window.addEventListener('kjhub:data', render);
  window.addEventListener('kjsupport:ready', render);
  window.addEventListener('kjhub:login', render);
  window.addEventListener('kjhub:closemonth', e => { // 마감월 변경 → 기준월 동기화
    selMonth = (e.detail && e.detail.month) || selMonth;
    const sm = $d('dsMonth'); if (sm) { if (!Array.from(sm.options).some(o => o.value === selMonth)) sm.insertBefore(new Option(mLbl(selMonth), selMonth), sm.firstChild); sm.value = selMonth; }
    render();
  });
})();
  
}
