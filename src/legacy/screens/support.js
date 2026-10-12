// 기존 화면 모듈 (Apps Script 판에서 그대로 이전) — 셸 API(KJHub)와 google.script.run 셈을 통해 Supabase 와 연결
/* eslint-disable */
export default function init() {
  const __onReady = fn => fn();

(function () {
  // ==========================================================================
  // 🤝 지원 내역 설정
  //   지원 부서가 어느 부서의 어떤 업무를 지원하는지와 그 비용을 기준월별로 설정
  //   형식: 인원별(금액×대상 인원수) / 부서별(금액×대상 부서수) / 직접입력(부서별 금액)
  // ==========================================================================
  const $s = id => document.getElementById(id);
  const hub = () => window.KJHub || {};
  const nrm = v => String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase();
  const fmt = n => (Math.round(Number(n) || 0)).toLocaleString('ko-KR');
  const mIdx = m => { const t = String(m); return parseInt(t.slice(0, 4), 10) * 12 + parseInt(t.slice(4, 6), 10) - 1; };
  const mStr = i => String(Math.floor(i / 12)) + ('0' + (i % 12 + 1)).slice(-2);
  const mLbl = m => String(m).slice(0, 4) + '-' + String(m).slice(4, 6);
  const curMonth = () => { const d = new Date(); return String(d.getFullYear()) + ('0' + (d.getMonth() + 1)).slice(-2); };

  let selMonth = ((window.KJHub && window.KJHub.closeMonth) ? window.KJHub.closeMonth() : curMonth()); // 기본 기준월 = 마감월
  let selDepts = null; // 표시할 지원 부서 (null = 전체)
  let openGroups = null;           // 펼친 부서 (null = 최초 판단)
  let taskQuery = '';              // 업무 검색어
  const TASK_PAGE = 20;            // 부서별 최초 표시 업무 수
  let taskLimit = Object.create(null); // 부서별 표시 개수
  let cfg = { byMonth: {} };   // 서버 저장본
  let draft = [];              // 선택 기준월 편집본
  let dirty = false;

  // ── 부서 목록 / 인원수 ──
  const deptRows = () => (hub().data && hub().data.dept) || [];
  const headRows = () => (hub().data && hub().data.headcount) || [];
  const pick = (row, cands) => {
    for (const k in row) { const n = nrm(k); for (const c of cands) if (n === nrm(c)) return row[k]; }
    for (const k in row) { const n = nrm(k); for (const c of cands) if (n.indexOf(nrm(c)) >= 0) return row[k]; }
    return '';
  };
  function deptList() {
    const out = [], seen = Object.create(null);
    deptRows().forEach(r => {
      const d = String(pick(r, ['DeptName', '부서명', '부서'])).trim();
      if (d && !seen[d]) { seen[d] = 1; out.push(d); }
    });
    if (!out.length) headRows().forEach(r => {
      const d = String(pick(r, ['DeptName', '부서명', '부서'])).trim();
      if (d && !seen[d]) { seen[d] = 1; out.push(d); }
    });
    return out.sort((a, b) => a.localeCompare(b, 'ko'));
  }
  // 부서별 인원 (선택 기준월 기준, 없으면 이전 최근 월)
  //   월/부서별 인원 데이터 컬럼: DeptName / WorkDate(년월) / EmpCnt(부서인원)
  //   기준월 이하에서 가장 최근 월의 인원을 사용
  function headcountOf(dept) {
    const want = nrm(dept);
    let best = 0, bestM = -1, anyM = -1, any = 0;
    headRows().forEach(r => {
      const d = nrm(r['DeptName'] || r['부서명'] || r['부서'] || '');
      if (d !== want) return;
      const m = String(r['WorkDate'] || r['기준월'] || r['월'] || '').replace(/[^0-9]/g, '').slice(0, 6);
      const n = Number(String(r['EmpCnt'] == null ? '' : r['EmpCnt']).replace(/[^0-9.\-]/g, '')) || 0;
      if (m.length !== 6) { if (!best) best = n; return; }
      const mi = mIdx(m);
      if (mi > anyM) { anyM = mi; any = n; }                       // 전체 중 최신
      if (mi <= mIdx(selMonth) && mi > bestM) { bestM = mi; best = n; } // 기준월 이하 최신
    });
    return best || (bestM < 0 ? any : 0) || 0;
  }
  const ALL = '전체';
  function targetsOf(row) {
    const t = row.targets || [];
    if (t.length === 1 && t[0] === ALL) return deptList();
    return t;
  }
  function totalOf(row) {
    const tg = targetsOf(row);
    if (row.mode === 'head') return (Number(row.amount) || 0) * tg.reduce((s, d) => s + headcountOf(d), 0);
    if (row.mode === 'dept') return (Number(row.amount) || 0) * tg.length;
    return (row.detail || []).reduce((s, x) => s + (Number(x.amount) || 0), 0); // 직접입력
  }

  // ── 저장본 ↔ 편집본 ──
  //   해당 월 저장값이 있으면 그것을, 없으면 이전 월을 승계
  function sourceMonth(ym) {
    const bm = cfg.byMonth || {};
    if (bm[ym]) return ym;
    const ks = Object.keys(bm).filter(k => mIdx(k) <= mIdx(ym)).map(mIdx).sort((a, b) => b - a);
    return ks.length ? mStr(ks[0]) : null;
  }
  function ratiosForMonth(ym) {
    const src = sourceMonth(ym);
    return src ? ((cfg.byMonth || {})[src] || []) : [];
  }
  // 임의 payload 저장 (이 달 저장값 삭제 등)
  function saveRaw(payload) {
    const msg = $s('spSaveMsg');
    const isAS = typeof google !== 'undefined' && google.script && google.script.run;
    const tk = hub().getToken ? hub().getToken() : null;
    if (!isAS || !tk) { cfg = payload.support; seed(); render(); return; }
    google.script.run.withSuccessHandler(saved => {
      if (saved && saved.support) cfg = saved.support;
      if (msg) { msg.className = 'text-xs font-semibold text-emerald-600'; msg.innerText = '저장 완료 (' + new Date().toLocaleString('ko-KR') + ')'; }
      seed(); render(); announce();
    }).withFailureHandler(err => {
      if (msg) { msg.className = 'text-xs font-semibold text-red-600'; msg.innerText = (err && err.message) ? err.message : String(err); }
    }).saveAllocation(tk, payload);
  }
  function seed() {
    draft = JSON.parse(JSON.stringify(ratiosForMonth(selMonth) || []));
    draft.sort((a, b) => String(a.dept || '').localeCompare(String(b.dept || ''), 'ko'));
    draft.forEach(g => {
      if (!g.tasks) g.tasks = [];
      g.tasks.sort((a, b) => String(a.task || '').localeCompare(String(b.task || ''), 'ko'));
      g.tasks.forEach(t => {
        if (!t.scope) t.scope = 'all';
        if (!t.buNames) t.buNames = [];
        if (!t.deptNames) t.deptNames = [];
        if (!t.split) t.split = 'unit';
        if (!t.detail) t.detail = {};
        if (!t.excludes) t.excludes = [];
        if (t.desc == null) t.desc = '';
      });
    });
    dirty = false;
  }
  function markDirty() { dirty = true; const b = $s('spDirtyBadge'); if (b) b.classList.remove('hidden'); }

  // ── 사업단위/부서 매핑 ──
  function buList() {
    const out = [], seen = Object.create(null);
    deptRows().forEach(r => {
      const b = String(pick(r, ['BizUnitName', '사업단위명', '사업단위'])).trim();
      if (b && !seen[b]) { seen[b] = 1; out.push(b); }
    });
    return out.sort((a, b) => a.localeCompare(b, 'ko'));
  }
  function deptsOfBU(bu) {
    const out = [];
    deptRows().forEach(r => {
      const b = String(pick(r, ['BizUnitName', '사업단위명', '사업단위'])).trim();
      const d = String(pick(r, ['DeptName', '부서명', '부서'])).trim();
      if (d && b === bu && out.indexOf(d) < 0) out.push(d);
    });
    return out.sort((a, b) => a.localeCompare(b, 'ko'));
  }
  // 업무 하나의 대상 부서 목록 (전체 / 사업단위 / 부서)
  function taskDepts(t) {
    let ds;
    if (t.scope === 'all') ds = deptList();
    else if (t.scope === 'bu') ds = (t.buNames || []).reduce((a, b) => a.concat(deptsOfBU(b)), []);
    else ds = (t.deptNames || []).slice();
    const ex = t.excludes || []; // 전체·사업단위로 불러온 뒤 개별 제외한 부서
    return ds.filter(d => ex.indexOf(d) < 0);
  }
  // 부서별 배분액 산출
  function taskShares(t) {
    const ds = taskDepts(t).sort((a, b) => a.localeCompare(b, 'ko'));
    const amt = Number(t.amount) || 0;
    if (t.split === 'direct') return ds.map(d => ({ dept: d, amount: Number((t.detail || {})[d]) || 0 }));
    if (t.split === 'head') {
      const tot = ds.reduce((s2, d) => s2 + headcountOf(d), 0);
      return ds.map(d => ({ dept: d, amount: tot > 0 ? Math.round(amt * headcountOf(d) / tot) : 0 }));
    }
    if (t.split === 'dept') { // 부서별 균등 배분
      const n = ds.length || 1;
      return ds.map(d => ({ dept: d, amount: Math.round(amt / n) }));
    }
    // 인원별 단가 (금액 × 인원수)
    return ds.map(d => ({ dept: d, amount: amt * headcountOf(d) }));
  }
  const taskTotal = t => taskShares(t).reduce((s2, x) => s2 + x.amount, 0);

  // ── 렌더 ──
  // 표시할 지원 부서 선택 (부서별 수익 화면과 동일한 방식)
  function renderDeptChk() {
    const box = $s('spDeptChk'); if (!box) return;
    const ds = draft.map(g => g.dept).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a.localeCompare(b, 'ko'));
    if (ds.length <= 1) { box.className = 'hidden'; selDepts = null; return; }
    box.className = 'flex flex-wrap gap-1.5 mb-3 pb-3 border-b border-slate-100';
    const allOn = !selDepts || ds.every(d => selDepts.has(d));
    box.innerHTML = '<span class="text-[11px] font-semibold text-slate-400 mr-1" style="align-self:center">표시할 부서:</span>'
      + ds.map(d => {
        const on = !selDepts || selDepts.has(d);
        return '<label class="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border cursor-pointer transition-all '
          + (on ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-400 border-slate-200') + '">'
          + '<input type="checkbox" class="sp-deptchk accent-indigo-600" data-dept="' + d + '"' + (on ? ' checked' : '') + '>' + d + '</label>';
      }).join('')
      + '<button id="spChkAll" class="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 rounded-lg px-2.5 py-1 ml-1">' + (allOn ? '전체 해제' : '전체 선택') + '</button>';
    box.querySelectorAll('.sp-deptchk').forEach(chk => chk.addEventListener('change', () => {
      selDepts = new Set(Array.from(box.querySelectorAll('.sp-deptchk:checked')).map(c => c.dataset.dept));
      render();
    }));
    const ab = box.querySelector('#spChkAll');
    if (ab) ab.addEventListener('click', () => { selDepts = allOn ? new Set() : null; render(); });
  }
  // 화면 권한: admin = 전체 / 그 외 = 허용부서의 지원 내역만
  function allowedDepts() {
    try { return hub().screenDepts ? hub().screenDepts('지원 내역 설정') : null; } catch (e) { return null; }
  }
  function canEditDept(d) {
    const a = allowedDepts();
    if (a === null) return true;
    return a.some(x => nrm(x) === nrm(d));
  }
  function render() {
    const body = $s('spBody'); if (!body) return;
    const depts = deptList(), bus = buList();
    const allow = allowedDepts();
    if (allow !== null) draft = draft.filter(g => !g.dept || canEditDept(g.dept));
    const isAdminUser = allow === null;
    const addBtn = $s('spAddBtn'); if (addBtn) addBtn.classList.toggle('hidden', !isAdminUser && !allow.length);
    // 최초 진입 시: 업무가 많으면 접힌 상태로 시작 (부담 감소)
    if (openGroups === null) {
      openGroups = new Set();
      const total = draft.reduce((a, g) => a + ((g.tasks || []).length), 0);
      if (draft.length <= 2 && total <= 20) draft.forEach((g, i) => openGroups.add(g.dept || ('#' + i)));
    }
    renderDeptChk();
    const visibleIdx = draft.map((g, ix) => ix).filter(ix => !selDepts || !draft[ix].dept || selDepts.has(draft[ix].dept));
    const SCOPES = [['all', '전체'], ['bu', '사업단위별'], ['dept', '부서별']];
    const SPLITS = [['unit', '인원별(단가)'], ['head', '인원별 배분'], ['dept', '부서별 배분'], ['direct', '직접입력']];
    const opts = (arr, sel) => arr.map(v => '<option value="' + v + '"' + (sel === v ? ' selected' : '') + '>' + v + '</option>').join('');
    const pairOpts = (arr, sel) => arr.map(v => '<option value="' + v[0] + '"' + (sel === v[0] ? ' selected' : '') + '>' + v[1] + '</option>').join('');

    body.innerHTML = visibleIdx.map(gi => { const g = draft[gi];
      const gTot = (g.tasks || []).reduce((s2, t) => s2 + taskTotal(t), 0);
      // 접힘 상태에서는 표 자체를 그리지 않음 (DOM 급증 방지)
      const isOpen = openGroups.has(g.dept || ('#' + gi));
      const allTasks = (g.tasks || []).map((t, ti) => ({ t: t, ti: ti }));
      // 검색: 업무명 또는 대상 부서명에 포함
      const q = nrm(taskQuery);
      const hitTasks = !q ? allTasks : allTasks.filter(o =>
        nrm(o.t.task).indexOf(q) >= 0 || taskDepts(o.t).some(d => nrm(d).indexOf(q) >= 0));
      const lim = taskLimit[gi] || TASK_PAGE;
      const shownTasks = hitTasks.slice(0, lim);
      const restTasks = hitTasks.length - shownTasks.length;
      // ★ 배열 순서 그대로 렌더 (정렬된 사본을 쓰면 인덱스가 어긋나 편집이 엉킴)
      const rows = !isOpen ? '' : shownTasks.map(o => {
        const t = o.t, ti = o.ti;
        const shares = taskShares(t);
        const tgt = t.scope === 'all' ? '전체'
          : t.scope === 'bu' ? ((t.buNames || []).join(', ') || '사업단위 선택')
          : ((t.deptNames || []).join(', ') || '부서 선택');
        const picker = t.scope === 'bu'
          ? '<select class="sp-add-bu" data-g="' + gi + '" data-t="' + ti + '" style="font-size:11px;border:1px solid #cbd5e1;border-radius:6px;padding:3px 6px"><option value="">+ 사업단위</option>' + opts(bus, '') + '</select>'
          : t.scope === 'dept'
          ? '<select class="sp-add-dept" data-g="' + gi + '" data-t="' + ti + '" style="font-size:11px;border:1px solid #cbd5e1;border-radius:6px;padding:3px 6px"><option value="">+ 부서</option>' + opts(depts, '') + '</select>'
          : '';
        // 부서 카드 (부서명 + 인원 / 직접입력이면 금액 입력)
        const shareMap = Object.create(null);
        shares.forEach(x => { shareMap[x.dept] = x.amount; });
        const exList = t.excludes || [];
        const isEx = d => exList.indexOf(d) >= 0;
        // 제외된 부서는 회색+취소선으로 남겨두고, 되돌림(↺) 버튼으로 복구
        const card = d => {
          const ex = isEx(d);
          const amt = shareMap[d] || 0;
          return '<span title="' + d + ' (' + fmt(headcountOf(d)) + '명)' + (ex ? ' · 제외됨' : ' · ' + fmt(amt) + '원') + '" '
            + 'style="display:flex;align-items:center;justify-content:space-between;gap:6px;background:' + (ex ? '#f8fafc' : '#fff')
            + ';border:1px solid #e2e8f0;' + (ex ? 'border-style:dashed;' : '') + 'border-radius:8px;padding:5px 6px 5px 10px;min-width:0">'
            + '<span style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1 1 auto;min-width:0;'
            + (ex ? 'color:#94a3b8;text-decoration:line-through' : 'color:#334155') + '">' + d
            + ' <span style="color:#94a3b8">(' + fmt(headcountOf(d)) + ')</span></span>'
            + (ex
                ? '<span style="font-size:10.5px;font-weight:700;color:#cbd5e1;flex:0 0 auto">제외</span>'
                : (t.split === 'direct'
                    ? '<input type="text" inputmode="numeric" class="sp-dtl" data-g="' + gi + '" data-t="' + ti + '" data-d="' + d + '" value="' + fmt(amt) + '" style="width:96px;flex:0 0 auto;text-align:right;font-size:11px;border:1px solid #cbd5e1;border-radius:6px;padding:2px 6px">'
                    : '<span style="font-size:11.5px;font-weight:700;color:#334155;flex:0 0 auto;font-variant-numeric:tabular-nums">' + fmt(amt) + '</span>'))
            + '<button class="' + (ex ? 'sp-ex-one' : 'sp-ex') + '" data-g="' + gi + '" data-t="' + ti + '" data-d="' + d + '" title="' + (ex ? '다시 포함' : '이 부서 제외') + '" '
            + 'style="font-size:' + (ex ? '11' : '12') + 'px;line-height:1;flex:0 0 auto;color:' + (ex ? '#f59e0b' : '#cbd5e1') + ';padding:0 2px">' + (ex ? '↺' : '×') + '</button>'
            + '</span>';
        };
        const grid = arr => '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(235px,1fr));gap:6px;margin-top:6px">' + arr.map(card).join('') + '</div>';
        let detail = '';
        if (t.scope === 'all') {
          // 전체 = 사업단위별로 묶어서 표시 (본부명(인원) + 소속 부서 카드)
          const ds = deptList();
          const head = '<div style="font-size:12px;font-weight:800;color:#334155;margin-bottom:4px">전체(' + fmt(ds.reduce((a, d) => a + headcountOf(d), 0)) + ')</div>';
          const seen = Object.create(null);
          const blocks = bus.map(b => {
            const bd = deptsOfBU(b);
            bd.forEach(d => { seen[d] = 1; });
            if (!bd.length) return '';
            return '<div style="margin-top:8px"><div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:2px">' + b + '(' + fmt(bd.reduce((a, d) => a + headcountOf(d), 0)) + ')</div>' + grid(bd) + '</div>';
          }).join('');
          const rest = ds.filter(d => !seen[d]);
          const restHtml = rest.length
            ? '<div style="margin-top:8px"><div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:2px">미지정(' + fmt(rest.reduce((a, d) => a + headcountOf(d), 0)) + ')</div>' + grid(rest) + '</div>'
            : '';
          detail = '<div style="margin-top:8px">' + head + blocks + restHtml + '</div>';
        } else if (t.scope === 'bu') {
          const bl = (t.buNames || []).slice().sort((a, b) => a.localeCompare(b, 'ko'));
          detail = bl.length ? bl.map(b => {
            const ds = deptsOfBU(b);
            return '<div style="margin-top:8px"><div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:2px">' + b + '(' + fmt(ds.reduce((a, d) => a + headcountOf(d), 0)) + ')</div>' + grid(ds) + '</div>';
          }).join('') : '<div style="margin-top:6px;font-size:11px;color:#94a3b8">사업단위를 선택하세요.</div>';
        } else {
          const ds = (t.deptNames || []).slice().sort((a, b) => a.localeCompare(b, 'ko'));
          detail = ds.length ? grid(ds) : '<div style="margin-top:6px;font-size:11px;color:#94a3b8">부서를 선택하세요.</div>';
        }
        return '<tr class="border-b border-slate-100 align-top">'
          // 업무 / 설명
          + '<td class="py-2 px-3">'
            + '<input class="sp-task" data-g="' + gi + '" data-t="' + ti + '" value="' + (t.task || '') + '" placeholder="업무명" style="width:100%;font-size:12px;font-weight:600;border:1px solid #cbd5e1;border-radius:7px;padding:5px 8px">'
            + '<input class="sp-desc" data-g="' + gi + '" data-t="' + ti + '" value="' + String(t.desc || '').replace(/"/g, '&quot;') + '" placeholder="설명 (선택)" style="width:100%;margin-top:4px;font-size:11px;color:#475569;border:1px solid #e2e8f0;border-radius:7px;padding:4px 8px">'
          + '</td>'
          // 대상 구분 / 형식 / 금액 (세로 3단)
          + '<td class="py-2 px-3">'
            + '<div style="display:flex;flex-direction:column;gap:4px">'
            + '<div style="display:flex;align-items:center;gap:6px"><span style="font-size:10px;font-weight:700;color:#94a3b8;width:52px;flex:0 0 auto">대상 구분</span>'
              + '<select class="sp-scope" data-g="' + gi + '" data-t="' + ti + '" style="flex:1 1 auto;min-width:0;font-size:11.5px;border:1px solid #cbd5e1;border-radius:7px;padding:4px 6px">' + pairOpts(SCOPES, t.scope) + '</select></div>'
            + '<div style="display:flex;align-items:center;gap:6px"><span style="font-size:10px;font-weight:700;color:#94a3b8;width:52px;flex:0 0 auto">형식</span>'
              + '<select class="sp-split" data-g="' + gi + '" data-t="' + ti + '" style="flex:1 1 auto;min-width:0;font-size:11.5px;border:1px solid #cbd5e1;border-radius:7px;padding:4px 6px">' + pairOpts(SPLITS, t.split) + '</select></div>'
            + '<div style="display:flex;align-items:center;gap:6px"><span style="font-size:10px;font-weight:700;color:#94a3b8;width:52px;flex:0 0 auto">금액</span>'
              + (t.split === 'direct'
                  ? '<span style="flex:1 1 auto;font-size:11px;color:#94a3b8">부서별 입력</span>'
                  : '<input type="text" inputmode="numeric" class="sp-amt" data-g="' + gi + '" data-t="' + ti + '" value="' + fmt(t.amount || 0) + '" style="flex:1 1 auto;min-width:0;text-align:right;font-size:11.5px;border:1px solid #cbd5e1;border-radius:7px;padding:4px 6px">')
            + '</div></div>'
          + '</td>'
          // 지원 받는 부서
          + '<td class="py-2 px-3"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span style="font-size:12px;font-weight:600;color:#334155">' + tgt + '</span>' + picker
            + ((t.scope !== 'all' && (t.buNames || t.deptNames || []).length) ? '<button class="sp-clr" data-g="' + gi + '" data-t="' + ti + '" style="font-size:11px;color:#64748b;text-decoration:underline">비우기</button>' : '')
            + ((t.excludes || []).length ? '<span title="제외: ' + t.excludes.join(', ') + '" style="font-size:11px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:2px 6px">제외 ' + t.excludes.slice(0, 3).join(', ') + (t.excludes.length > 3 ? ' 외 ' + (t.excludes.length - 3) + '개' : '') + ' <button class="sp-ex-undo" data-g="' + gi + '" data-t="' + ti + '" style="text-decoration:underline;color:#b45309">전체 되돌리기</button></span>' : '')
            + '</div>' + detail + '</td>'
          + '<td class="py-2 px-3 text-right font-bold text-indigo-700" style="font-variant-numeric:tabular-nums"><span data-g="' + gi + '" data-tot="' + ti + '">' + fmt(taskTotal(t)) + '</span></td>'
          + '<td class="py-2 px-3 text-center"><button class="sp-task-del" data-g="' + gi + '" data-t="' + ti + '" style="font-size:11px;color:#ef4444">삭제</button></td>'
          + '</tr>';
      }).join('') || '<tr><td colspan="5" class="py-5 text-center text-slate-400 text-xs">' + (q ? '검색 결과가 없습니다.' : '등록된 업무가 없습니다. [+ 업무 추가]를 눌러 주세요.') + '</td></tr>';

      return '<div class="bg-white border border-slate-200 rounded-xl" style="overflow:hidden">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;flex-wrap:wrap">'
        + '<div style="display:flex;align-items:center;gap:10px">'
        + '<button class="sp-toggle" data-g="' + gi + '" title="' + (isOpen ? '접기' : '펼치기') + '" style="font-size:12px;width:22px;height:22px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#475569;line-height:1">' + (isOpen ? '−' : '+') + '</button>'
        + '<span style="font-size:11px;font-weight:700;color:#64748b">지원 부서</span>'
        + '<select class="sp-dept" data-g="' + gi + '" style="font-size:13px;font-weight:700;color:#1e293b;border:1px solid #cbd5e1;border-radius:7px;padding:5px 10px;min-width:150px"><option value="">선택</option>' + opts(depts, g.dept) + '</select>'
        + '<button class="sp-task-add" data-g="' + gi + '" style="font-size:11px;font-weight:700;color:#047857;background:#ecfdf5;border:1px solid #d1fae5;border-radius:7px;padding:5px 10px">+ 업무 추가</button>'
        + '</div>'
        + '<div style="display:flex;align-items:center;gap:12px">'
        + '<span style="font-size:11px;color:#64748b">업무 <b style="color:#334155">' + hitTasks.length + '</b>건' + (q && hitTasks.length !== allTasks.length ? ' / 전체 ' + allTasks.length : '') + '</span>'
        + '<span style="font-size:12px;color:#475569">합계 <b style="color:#1e293b" data-gtot="' + gi + '">' + fmt(gTot) + '</b>원</span>'
        + '<button class="sp-dept-del" data-g="' + gi + '" style="font-size:11px;color:#ef4444">부서 삭제</button>'
        + '</div></div>'
        + (!isOpen ? '' : '<div style="overflow-x:auto"><table class="w-full text-sm" style="min-width:1050px"><thead class="bg-white text-slate-500 text-[11px] border-b border-slate-200"><tr>'
        + '<th class="py-2 px-3 text-left font-semibold" style="width:260px">업무 / 설명</th>'
        + '<th class="py-2 px-3 text-left font-semibold" style="width:210px">대상 구분 / 형식 / 금액</th>'
        + '<th class="py-2 px-3 text-left font-semibold">지원 받는 부서</th>'
        + '<th class="py-2 px-3 text-right font-semibold" style="width:140px">총 금액</th>'
        + '<th class="py-2 px-3 text-center font-semibold" style="width:56px"></th>'
        + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
          + (restTasks > 0
              ? '<div style="padding:8px 14px;border-top:1px solid #f1f5f9;text-align:center">'
                + '<button class="sp-more" data-g="' + gi + '" style="font-size:11px;font-weight:700;color:#4338ca;background:#eef2ff;border:1px solid #e0e7ff;border-radius:7px;padding:5px 14px">더보기 (' + Math.min(TASK_PAGE, restTasks) + '건 · 남은 ' + restTasks + '건)</button></div>'
              : ''))
        + '</div>';
    }).join('') || '<div class="bg-white border border-slate-200 rounded-xl py-10 text-center text-slate-400 text-sm">등록된 지원 부서가 없습니다. [+ 부서 추가]로 시작하세요.</div>';

    const sum = draft.reduce((s2, g) => s2 + (g.tasks || []).reduce((a, t) => a + taskTotal(t), 0), 0);
    const srcM = sourceMonth(selMonth);
    const savedM = !!(cfg.byMonth && cfg.byMonth[selMonth]);
    if ($s('spCount')) {
      $s('spCount').innerHTML = mLbl(selMonth) + ' 기준 · 지원 부서 ' + draft.length + '개 · 총 ' + fmt(sum) + '원 &nbsp;|&nbsp; '
        + (savedM
            ? '<span style="color:#0369a1;font-weight:700">이 달 저장값</span> <button id="spClearMonth" style="margin-left:6px;font-size:11px;color:#b45309;text-decoration:underline">이 달 저장값 삭제(이전 월 승계로)</button>'
            : (srcM ? '<span style="color:#b45309;font-weight:700">' + mLbl(srcM) + ' 승계본</span> (이 달 저장값 없음)' : '<span style="color:#94a3b8">저장된 내역 없음</span>'));
      const cb = $s('spClearMonth');
      if (cb) cb.addEventListener('click', () => {
        hub().confirm({
          title: '이 달 저장값 삭제',
          message: mLbl(selMonth) + ' 에 저장된 지원 내역을 삭제합니다.\n삭제하면 이전 월 내역을 그대로 승계합니다.',
          okText: '삭제하고 승계'
        }).then(ok => {
          if (!ok) return;
          const bm = JSON.parse(JSON.stringify(cfg.byMonth || {}));
          delete bm[selMonth];
          saveRaw({ support: { byMonth: bm } });
        });
      });
    }
    bind();
  }

  // 입력 중에는 총 금액/합계 숫자만 다시 계산해 표시 (DOM 재생성 없이 커서 유지)
  function refreshTotals() {
    document.querySelectorAll('#spBody [data-tot]').forEach(el => {
      const g = +el.dataset.g, t = +el.dataset.tot;
      const task = (draft[g] && draft[g].tasks) ? draft[g].tasks[t] : null;
      if (task) el.textContent = fmt(taskTotal(task));
    });
    document.querySelectorAll('#spBody [data-gtot]').forEach(el => {
      const g = +el.dataset.gtot;
      const grp = draft[g];
      if (grp) el.textContent = fmt((grp.tasks || []).reduce((a, t) => a + taskTotal(t), 0));
    });
    const sum = draft.reduce((s2, g) => s2 + (g.tasks || []).reduce((a, t) => a + taskTotal(t), 0), 0);
    if ($s('spCount')) $s('spCount').innerText = mLbl(selMonth) + ' 기준 · 지원 부서 ' + draft.length + '개 · 총 ' + fmt(sum) + '원';
  }
  function bind() {
    const on = (cls, ev, fn) => document.querySelectorAll('#spBody .' + cls).forEach(el => el.addEventListener(ev, fn));
    const T = e => draft[+e.target.dataset.g].tasks[+e.target.dataset.t];
    const TC = e => draft[+e.currentTarget.dataset.g].tasks[+e.currentTarget.dataset.t];
    on('sp-toggle', 'click', e => {
      const gi = +e.currentTarget.dataset.g;
      const key = draft[gi] && (draft[gi].dept || ('#' + gi));
      if (openGroups.has(key)) openGroups.delete(key); else openGroups.add(key);
      render();
    });
    on('sp-more', 'click', e => {
      const gi = +e.currentTarget.dataset.g;
      taskLimit[gi] = (taskLimit[gi] || TASK_PAGE) + TASK_PAGE;
      render();
    });
    on('sp-dept', 'change', e => { draft[+e.target.dataset.g].dept = e.target.value; markDirty(); render(); });
    on('sp-dept-del', 'click', e => {
      const gi = +e.currentTarget.dataset.g;
      const g = draft[gi] || {};
      hub().confirm({
        title: '지원 부서 삭제',
        message: '[' + (g.dept || '미지정') + ']의 지원 내역 ' + ((g.tasks || []).length) + '건을 모두 삭제합니다.\n저장하기 전까지는 되돌리기로 취소할 수 있습니다.',
        okText: '삭제'
      }).then(ok => { if (!ok) return; draft.splice(gi, 1); markDirty(); render(); });
    });
    on('sp-task-add', 'click', e => {
      const gi2 = +e.currentTarget.dataset.g;
      draft[gi2].tasks.push({ task: '', desc: '', scope: 'all', buNames: [], deptNames: [], excludes: [], split: 'unit', amount: 0, detail: {} });
      openGroups.add(draft[gi2].dept || ('#' + gi2));
      taskLimit[gi2] = Math.max(taskLimit[gi2] || TASK_PAGE, draft[gi2].tasks.length); // 새 업무가 바로 보이도록
      markDirty(); render();
    });
    on('sp-task-del', 'click', e => {
      const gi = +e.currentTarget.dataset.g, ti = +e.currentTarget.dataset.t;
      const t = (draft[gi] && draft[gi].tasks) ? draft[gi].tasks[ti] : null;
      hub().confirm({
        title: '업무 삭제',
        message: '[' + ((t && t.task) || '미지정') + '] 업무를 삭제합니다.\n저장하기 전까지는 되돌리기로 취소할 수 있습니다.',
        okText: '삭제'
      }).then(ok => { if (!ok) return; draft[gi].tasks.splice(ti, 1); markDirty(); render(); });
    });
    on('sp-task', 'input', e => { T(e).task = e.target.value; markDirty(); });
    on('sp-desc', 'input', e => { T(e).desc = e.target.value; markDirty(); });
    on('sp-scope', 'change', e => { const t = T(e); t.scope = e.target.value; t.buNames = []; t.deptNames = []; markDirty(); render(); });
    on('sp-split', 'change', e => { T(e).split = e.target.value; markDirty(); render(); });
    // 금액은 입력 중 화면을 다시 그리지 않음 (커서 유지). 합계만 즉시 갱신하고, 입력을 마치면(blur) 재렌더
    on('sp-amt', 'input', e => {
      const el = e.target;
      const n = Number(String(el.value).replace(/[^0-9]/g, '')) || 0;
      T(e).amount = n;
      el.value = n.toLocaleString('ko-KR');
      markDirty(); refreshTotals();
    });
    on('sp-amt', 'change', () => render());
    on('sp-amt', 'blur', () => render());
    on('sp-add-bu', 'change', e => { const t = T(e), v = e.target.value; if (v && (t.buNames || []).indexOf(v) < 0) t.buNames.push(v); markDirty(); render(); });
    on('sp-add-dept', 'change', e => { const t = T(e), v = e.target.value; if (v && (t.deptNames || []).indexOf(v) < 0) t.deptNames.push(v); markDirty(); render(); });
    on('sp-clr', 'click', e => { const t = TC(e); t.buNames = []; t.deptNames = []; t.excludes = []; markDirty(); render(); });
    on('sp-ex', 'click', e => {
      const t = TC(e), d = e.currentTarget.dataset.d;
      if (!t.excludes) t.excludes = [];
      if (t.scope === 'dept') t.deptNames = (t.deptNames || []).filter(x => x !== d);
      else if (t.excludes.indexOf(d) < 0) t.excludes.push(d);
      markDirty(); render();
    });
    on('sp-ex-undo', 'click', e => { const t = TC(e); t.excludes = []; markDirty(); render(); });
    on('sp-ex-one', 'click', e => { // 제외 해제 (개별)
      const t = TC(e), d = e.currentTarget.dataset.d;
      t.excludes = (t.excludes || []).filter(x => x !== d);
      markDirty(); render();
    });
    on('sp-dtl', 'input', e => { // 천단위 콤마 유지
      const t = T(e), el = e.target;
      const n = Number(String(el.value).replace(/[^0-9]/g, '')) || 0;
      if (!t.detail) t.detail = {};
      t.detail[el.dataset.d] = n;
      el.value = n.toLocaleString('ko-KR');
      markDirty(); refreshTotals();
    });
    on('sp-dtl', 'blur', () => render());
  }

  // ── 저장 ──
  function payloadFor(scope) {
    const bm = JSON.parse(JSON.stringify(cfg.byMonth || {}));
    const clean = draft.filter(g => g.dept).map(g => ({
      dept: g.dept,
      tasks: (g.tasks || []).filter(t => t.task).map(t => ({
        task: t.task, desc: t.desc || '', scope: t.scope || 'all',
        buNames: t.buNames || [], deptNames: t.deptNames || [],
        split: t.split || 'unit', amount: Number(t.amount) || 0,
        excludes: t.excludes || [], detail: t.detail || {}
      }))
    }));
    if (scope === 'all') {
      const now = mIdx(curMonth());
      for (let i = now; i > now - 24; i--) bm[mStr(i)] = JSON.parse(JSON.stringify(clean));
    } else bm[selMonth] = clean;
    return { support: { byMonth: bm } };
  }
  function save(scope) {
    const msg = $s('spSaveMsg'), btn = $s('spSaveBtn');
    const isAS = typeof google !== 'undefined' && google.script && google.script.run;
    const tk = hub().getToken ? hub().getToken() : null;
    const payload = payloadFor(scope);
    if (!isAS || !tk) {
      cfg = payload.support;
      if (msg) { msg.className = 'text-xs font-semibold text-amber-600'; msg.innerText = '보안 서버 모드가 아니라 이 브라우저에서만 임시 적용되었습니다.'; }
      seed(); render(); return;
    }
    if (btn) { btn.disabled = true; btn.innerText = '저장 중...'; }
    google.script.run.withSuccessHandler(saved => {
      if (saved && saved.support) cfg = saved.support;
      if (btn) { btn.disabled = false; btn.innerText = '저장'; }
      if (msg) { msg.className = 'text-xs font-semibold text-emerald-600'; msg.innerText = '저장 완료 (' + new Date().toLocaleString('ko-KR') + ')'; }
      const b = $s('spDirtyBadge'); if (b) b.classList.add('hidden');
      seed(); render(); announce();
    }).withFailureHandler(err => {
      if (btn) { btn.disabled = false; btn.innerText = '저장'; }
      if (msg) { msg.className = 'text-xs font-semibold text-red-600'; msg.innerText = (err && err.message) ? err.message : String(err); }
    }).saveAllocation(tk, payload);
  }
  function load() {
    const isAS = typeof google !== 'undefined' && google.script && google.script.run;
    const tk = hub().getToken ? hub().getToken() : null;
    if (!isAS || !tk) { seed(); render(); return; }
    google.script.run.withSuccessHandler(c => {
      if (c && c.support) cfg = c.support;
      seed(); render(); announce();
    }).withFailureHandler(() => { seed(); render(); }).getAllocation(tk);
  }

  __onReady(() => {
    const sel = $s('spMonth');
    if (sel) {
      const now = mIdx(curMonth()), out = [];
      for (let i = now; i > now - 24; i--) out.push(mStr(i));
      sel.innerHTML = out.map(m => '<option value="' + m + '"' + (m === selMonth ? ' selected' : '') + '>' + mLbl(m) + '</option>').join('');
      sel.addEventListener('change', () => { selMonth = sel.value; seed(); render(); });
    }
    if ($s('spSearch')) $s('spSearch').addEventListener('input', () => {
      taskQuery = $s('spSearch').value || '';
      taskLimit = Object.create(null);
      if (taskQuery) draft.forEach((g, i) => openGroups.add(g.dept || ('#' + i))); // 검색 시 자동 펼침
      render();
    });
    if ($s('spExpandAll')) $s('spExpandAll').addEventListener('click', () => { draft.forEach((g, i) => openGroups.add(g.dept || ('#' + i))); render(); });
    if ($s('spCollapseAll')) $s('spCollapseAll').addEventListener('click', () => { openGroups = new Set(); render(); });
    if ($s('spAddBtn')) $s('spAddBtn').addEventListener('click', () => {
      draft.push({ dept: '', tasks: [] });
      if (openGroups) openGroups.add('#' + (draft.length - 1));
      markDirty(); render();
    });
    if ($s('spSaveBtn')) $s('spSaveBtn').addEventListener('click', () => save('month'));
    if ($s('spRevertBtn')) $s('spRevertBtn').addEventListener('click', () => { seed(); render(); const b = $s('spDirtyBadge'); if (b) b.classList.add('hidden'); });
    if ($s('spApplyEveryBtn')) $s('spApplyEveryBtn').addEventListener('click', () => {
      hub().confirm({
        title: '전체 일괄 적용',
        message: '현재 지원 내역을 최근 24개월 전체에 적용하고 저장합니다.\n각 월에 이미 저장된 내역도 모두 덮어쓰며, 이후 그 달들은 이전 월을 승계하지 않습니다.',
        okText: '적용하고 저장'
      }).then(ok => { if (ok) save('all'); });
    });
    load(); render();
  });
  // ── 외부 공개: 부서별 지원 순액 (수익 합산용) ──
  //   지원 부서: +총액(지원비 수취) / 지원 받는 부서: −배분액(지원비 부담)
  // 월별 집계 캐시 — 부서마다 전체를 다시 훑지 않도록 (월 1회 계산 후 조회)
  let netCache = Object.create(null), netCacheKey = '';
  function monthIndex(ym) {
    const key = JSON.stringify(cfg.byMonth ? Object.keys(cfg.byMonth) : []) + '|' + (cfg.__v || 0);
    if (netCacheKey !== key) { netCache = Object.create(null); netCacheKey = key; }
    if (netCache[ym]) return netCache[ym];
    const give = Object.create(null), recv = Object.create(null);
    (ratiosForMonth(ym) || []).forEach(g => {
      (g.tasks || []).forEach(t => {
        const sh = taskShares(t);
        let tot = 0;
        sh.forEach(x => { tot += x.amount; recv[x.dept] = (recv[x.dept] || 0) + x.amount; });
        if (g.dept) give[g.dept] = (give[g.dept] || 0) + tot;
      });
    });
    netCache[ym] = { give: give, recv: recv };
    return netCache[ym];
  }
  const bumpCache = () => { cfg.__v = (cfg.__v || 0) + 1; netCache = Object.create(null); netCacheKey = ''; };
  window.__kjSupport = {
    ready: true,
    // 지원한 금액(수취) — 수익에 가산
    giveOf: function (dept, ym) { return monthIndex(String(ym || selMonth)).give[dept] || 0; },
    // 지원받은 금액(부담) — 비용으로 계상
    recvOf: function (dept, ym) { return monthIndex(String(ym || selMonth)).recv[dept] || 0; },
    netOf: function (dept, ym) { return this.giveOf(dept, ym) - this.recvOf(dept, ym); },
    // 받는 부서 기준 상세 — [부서별 지원 내역] 화면용
    detailsFor: function (dept, ym) {
      const want = nrm(dept);
      const out = [];
      (ratiosForMonth(String(ym || selMonth)) || []).forEach(g => {
        (g.tasks || []).forEach(t => {
          const hit = taskShares(t).filter(x => nrm(x.dept) === want);
          if (!hit.length) return;
          const amt = hit.reduce((a, x) => a + x.amount, 0);
          if (!amt) return;
          out.push({
            from: g.dept || '(미지정)',
            task: t.task || '(미지정)',
            desc: t.desc || '',
            split: t.split || 'unit',
            scope: t.scope || 'all',
            targetCount: taskDepts(t).length,
            total: taskShares(t).reduce((a, x) => a + x.amount, 0),
            amount: amt
          });
        });
      });
      return out.sort((a, b) => String(a.from).localeCompare(String(b.from), 'ko') || String(a.task).localeCompare(String(b.task), 'ko'));
    },
    // 저장된 기준월 목록 (승계 기준월 선택용)
    monthsOf: function () { return Object.keys((cfg && cfg.byMonth) || {}).sort(); },
    deptsOf: function (ym) {
      const ix = monthIndex(String(ym || selMonth));
      const out = Object.create(null);
      for (const d in ix.give) out[d] = true;
      for (const d in ix.recv) out[d] = true;
      return Object.keys(out);
    }
  };
  function announce() { bumpCache(); try { window.dispatchEvent(new CustomEvent('kjsupport:ready')); } catch (e) {} }
  window.addEventListener('kjhub:login', load);
  window.addEventListener('kjhub:data', () => { render(); announce(); });
  window.addEventListener('kjhub:closemonth', e => { // 마감월 변경 → 기준월 동기화
    selMonth = (e.detail && e.detail.month) || selMonth;
    const sm = $s('spMonth'); if (sm) { if (!Array.from(sm.options).some(o => o.value === selMonth)) sm.insertBefore(new Option(mLbl(selMonth), selMonth), sm.firstChild); sm.value = selMonth; }
    seed(); render(); announce();
  });
})();
  
}
