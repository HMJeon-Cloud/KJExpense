// 기존 화면 모듈 (Apps Script 판에서 그대로 이전) — 셸 API(KJHub)와 google.script.run 셈을 통해 Supabase 와 연결
/* eslint-disable */
export default function init() {
  const __onReady = fn => fn();

(function () {
  // ==========================================================================
  // 🧪 배분 비율 설정(원자재)
  //   - 목록: [실자재투입내역]의 MatItemNo / MatItemName (중복 제거)
  //   - 판매가(참고): 구매 데이터 기준 직전 3개월 ROUND(Σ(ExRate×Price×Qty)÷ΣQty)
  //   - 판매가(구매): 기준월별 저장값만 적용 (미설정 = 0)
  //   - 저장: ALLOC_CONFIG.items.byMat (품목 설정과 같은 저장소, 키만 분리)
  // ==========================================================================
  const $a = id => document.getElementById(id);
  const hub = () => window.KJHub || {};
  const nrm = s => String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase();
  const fmtN = n => (Number(n) || 0).toLocaleString('ko-KR');
  const mIdx = m => { const s = String(m); return parseInt(s.slice(0, 4), 10) * 12 + parseInt(s.slice(4, 6), 10) - 1; };
  const mStr = i => String(Math.floor(i / 12)) + ('0' + (i % 12 + 1)).slice(-2);
  const mLbl = m => String(m).slice(0, 4) + '-' + String(m).slice(4, 6);
  const curMonth = () => { const d = new Date(); return String(d.getFullYear()) + ('0' + (d.getMonth() + 1)).slice(-2); };

  const PAGE_SIZE = 100;
  let amLimit = PAGE_SIZE, lastRows = [], selMonth = ((window.KJHub && window.KJHub.closeMonth) ? window.KJHub.closeMonth() : curMonth()); // 기본 기준월 = 마감월
  let alloc = { items: { byMat: {} } }, draft = { defaultPct: 0, byMat: {} }, seeded = false, userEdited = false;

  const pick = (row, cands) => {
    for (const k in row) { const n = nrm(k); for (const c of cands) if (n === nrm(c)) return row[k]; }
    for (const k in row) { const n = nrm(k); for (const c of cands) if (n.indexOf(nrm(c)) >= 0) return row[k]; }
    return '';
  };
  const MAT_ASSETSEQ = { '31': true, '34': true, '35': true }; // 이 탭에서 관리할 자재 구분
  const MATNO = ['MatItemNo', '자재코드', '원료코드', 'MatCode'];
  const MATNM = ['MatItemName', '자재명', '원료명'];

  // ── 원자재 목록 (실자재투입내역에서 추출) ──
  let baseList = [], baseSrc = null;
  function ensureBase() {
    const rows = (hub().data && hub().data.matinput) || null;
    if (baseSrc === rows) return;
    baseSrc = rows;
    const map = Object.create(null);
    for (const r of (rows || [])) {
      // ★ AssetSeq 31 · 34 · 35 인 자재만 대상
      const aseq = String(pick(r, ['AssetSeq', '자산순번']) || '').trim();
      if (!MAT_ASSETSEQ[aseq]) continue;
      const name = String(pick(r, MATNM) || '').trim();
      const no = String(pick(r, MATNO) || '').trim();
      const code = nrm(no || name);
      if (!code) continue;
      const asset = String(pick(r, ['AssetName', '자산분류', '자산명']) || '').trim();
      if (!map[code]) map[code] = { code: code, no: no || name, name: name || no, asset: asset };
      else if (!map[code].asset && asset) map[code].asset = asset;
    }
    baseList = Object.values(map).sort((a, b) => String(a.no).localeCompare(String(b.no), 'ko'));
    // 자재별 월 집계 — 참고 판매가 산출용 Σ(InPrice×Qty), ΣQty (DelvInDate 기준 월)
    matMonths = Object.create(null);
    for (const r of (rows || [])) {
      if (!MAT_ASSETSEQ[String(pick(r, ['AssetSeq', '자산순번']) || '').trim()]) continue;
      const code = nrm(String(pick(r, MATNO) || '').trim() || String(pick(r, MATNM) || '').trim());
      if (!code) continue;
      const m = String(pick(r, ['DelvInDate', '입고일자', '입고일'])).replace(/[^0-9]/g, '').slice(0, 6);
      if (m.length !== 6) continue;
      const q = Number(String(pick(r, ['Qty', '투입수량'])).replace(/,/g, '')) || 0;
      const ip = Number(String(pick(r, ['InPrice', '입고단가'])).replace(/,/g, '')) || 0;
      if (!q) continue;
      const rec = matMonths[code] || (matMonths[code] = Object.create(null));
      const mm = rec[m] || (rec[m] = { q: 0, w: 0 });
      mm.q += q; mm.w += ip * q;
    }
  }
  // 참고 판매가 — 실자재투입내역 InPrice·Qty 기준 직전 3개월 수량가중평균 (없으면 구매 데이터로 폴백)
  let matMonths = Object.create(null);
  //   3개월 내 데이터가 없으면 그 이전 마지막 데이터 월 금액을 승계하고 년월(src)을 함께 반환
  const basePriceInfo = (code, ym) => {
    const c = nrm(code);
    const rec = matMonths[c];
    const m = (ym && String(ym).length === 6) ? String(ym) : curMonth();
    if (rec) {
      const yi = mIdx(m);
      let q = 0, w = 0;
      for (let k = yi - 1; k > yi - 4; k--) { const mm = rec[mStr(k)]; if (mm && mm.q > 0) { q += mm.q; w += mm.w; } }
      if (q > 0) return { v: Math.round(w / q), src: null };
      // 승계: 기준월을 포함해 데이터가 있는 가장 최근 월 (첫 입고월은 그 달 자신의 금액을 사용)
      const keys = Object.keys(rec).filter(k2 => mIdx(k2) <= yi && rec[k2].q > 0).map(mIdx).sort((a, b) => b - a);
      if (keys.length) { const lm = mStr(keys[0]); return { v: Math.round(rec[lm].w / rec[lm].q), src: lm }; }
    }
    const ia = window.__kjItemAlloc; // 폴백: 구매 데이터 기준(동일 승계 규칙)
    if (ia && ia.ready && ia.basePriceInfo) { const r = ia.basePriceInfo(c, m); return { v: r.v || 0, src: r.src || null }; }
    return { v: (ia && ia.ready && ia.basePriceOf) ? (ia.basePriceOf(c, m) || 0) : 0, src: null };
  };
  const basePriceOf = (code, ym) => basePriceInfo(code, ym).v;
  // 자재별 최초 입고월 (DelvInDate 기준) — 이전 기준월에서는 목록에서 제외
  const firstMonthOf = code => {
    const rec = matMonths[nrm(code)];
    if (!rec) return null;
    const ks = Object.keys(rec).filter(k => rec[k].q > 0).map(mIdx).sort((a, b) => a - b);
    return ks.length ? mStr(ks[0]) : null;
  };

  function normMats(src) {
    const out = {}; const b = (src && src.byMat) || {};
    for (const c in b) {
      const m = {}; const s2 = (b[c] && b[c].sellBuyByMonth) || {};
      for (const k in s2) if (s2[k] != null && s2[k] !== '') m[k] = Number(s2[k]);
      out[c] = { sellBuyByMonth: m };
    }
    return out;
  }
  function seedDraft() {
    draft.byMat = normMats(alloc.items || {});
    if (alloc.items && alloc.items.defaultPctMat != null) draft.defaultPct = Number(alloc.items.defaultPctMat) || 0;
    if ($a('amDefaultPct')) $a('amDefaultPct').value = draft.defaultPct;
    seeded = true; userEdited = false;
  }
  const ensureRec = code => draft.byMat[code] || (draft.byMat[code] = { sellBuyByMonth: {} });
  const pruneRec = code => { const r = draft.byMat[code]; if (r && !Object.keys(r.sellBuyByMonth || {}).length) delete draft.byMat[code]; };
  function isDirty() { return userEdited && JSON.stringify(draft.byMat) !== JSON.stringify(normMats(alloc.items || {})); }
  function syncDirty() { const el = $a('amDirtyBadge'); if (el) el.classList.toggle('hidden', !isDirty()); }

  function monthOptions() {
    const sel = $a('amMonth'); if (!sel) return;
    const now = mIdx(curMonth()); const out = [];
    for (let i = now; i > now - 24; i--) out.push(mStr(i));
    if (!out.includes(selMonth)) selMonth = out[0];
    sel.innerHTML = out.map(m => '<option value="' + m + '"' + (m === selMonth ? ' selected' : '') + '>' + mLbl(m) + '</option>').join('');
  }

  function render() {
    if (!seeded) seedDraft();
    ensureBase();
    const body = $a('amBody'); if (!body) return;
    const qNo = nrm($a('amSearchNo') ? $a('amSearchNo').value : '');
    const qNm = nrm($a('amSearchName') ? $a('amSearchName').value : '');
    let rows = baseList;
    if (qNo) rows = rows.filter(e => nrm(e.no).indexOf(qNo) >= 0);
    if (qNm) rows = rows.filter(e => nrm(e.name).indexOf(qNm) >= 0);
    // 자산분류 옵션 채우기(1회) + 필터
    const selA = $a('amSearchAsset');
    if (selA && selA.options.length <= 1 && baseList.length) {
      const set = [];
      baseList.forEach(e => { if (e.asset && set.indexOf(e.asset) < 0) set.push(e.asset); });
      set.sort((a, b) => a.localeCompare(b, 'ko'));
      selA.innerHTML = '<option value="">전체</option>' + set.map(v => '<option value="' + v + '">' + v + '</option>').join('');
    }
    const qA = selA ? selA.value : '';
    if (qA) rows = rows.filter(e => (e.asset || '') === qA);
    // ★ 최초 입고월 이전 기준월에서는 목록에 나오지 않음 (아직 존재하지 않는 자재)
    const yiSel = mIdx(selMonth);
    const notYet = rows.filter(e => { const f = firstMonthOf(e.code); return f && mIdx(f) > yiSel; });
    rows = rows.filter(e => { const f = firstMonthOf(e.code); return !f || mIdx(f) <= yiSel; });
    lastRows = rows;
    const shown = amLimit === Infinity ? rows : rows.slice(0, amLimit);
    const rest = rows.length - shown.length;
    if ($a('amCount')) $a('amCount').textContent = '표시 ' + shown.length.toLocaleString() + '개 / 조회 ' + rows.length.toLocaleString() + '개 / 전체 자재 ' + baseList.length.toLocaleString() + '개'
      + (rest > 0 ? ' — ' + rest.toLocaleString() + '개 더 있음' : '')
      + (notYet.length ? ' · 최초 입고월 이후 자재만 표시 (' + notYet.length.toLocaleString() + '개 제외)' : '')
      + (!baseList.length ? ' · 실자재투입내역 데이터가 없습니다' : '');
    if ($a('amMoreWrap')) $a('amMoreWrap').classList.toggle('hidden', rest <= 0);
    if ($a('amMoreBtn')) $a('amMoreBtn').textContent = '더보기 (' + Math.min(PAGE_SIZE, rest).toLocaleString() + '개 · 남은 ' + rest.toLocaleString() + '개)';

    body.innerHTML = shown.map(e => {
      const ov = draft.byMat[e.code] || {};
      const bpi = basePriceInfo(e.code, selMonth);
      const bp = bpi.v;
      const val = (ov.sellBuyByMonth && ov.sellBuyByMonth[selMonth] != null) ? ov.sellBuyByMonth[selMonth] : '';
      return '<tr class="border-b border-slate-100 hover:bg-slate-50/60" data-code="' + e.code + '">' +
        '<td class="py-1.5 px-3 font-semibold text-slate-700 whitespace-nowrap">' + e.no + '</td>' +
        '<td class="py-1.5 px-3 text-slate-600 truncate" style="max-width:280px" title="' + e.name + '">' + (e.name || '-') + '</td>' +
        '<td class="py-1.5 px-3 text-slate-500 truncate" style="max-width:160px" title="' + (e.asset || '') + '">' + (e.asset || '-') + '</td>' +
        '<td class="py-1.5 px-3 text-right ' + (bp > 0 ? 'text-slate-600' : 'text-slate-300') + ' bg-slate-50/60" style="font-variant-numeric:tabular-nums" title="' + (bpi.src ? '직전 3개월 데이터 없음 → ' + mLbl(bpi.src) + ' 금액 승계' : mLbl(selMonth) + ' 기준 직전 3개월 수량가중평균') + '">' + fmtN(bp)
          + (bpi.src ? ' <span class="text-[10px] font-semibold text-amber-600">(' + mLbl(bpi.src) + ')</span>' : '') + '</td>' +
        '<td class="py-1.5 px-3 text-right"><input type="number" step="1" min="0" class="am-sellbuy w-32 bg-white border border-slate-200 rounded-lg px-2 py-1 text-right text-sm outline-none focus:border-indigo-500" placeholder="0" value="' + val + '"></td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="5" class="py-6 text-center text-slate-400 text-sm">표시할 자재가 없습니다.'
      + (notYet.length
          ? '<br><span class="text-[11px] text-amber-600 font-semibold">'
            + notYet.slice(0, 5).map(e => e.no + ' — 최초 입고 ' + mLbl(firstMonthOf(e.code))).join(' · ')
            + (notYet.length > 5 ? ' 외 ' + (notYet.length - 5) + '건' : '')
            + '</span><br><span class="text-[11px] text-slate-400">기준월(' + mLbl(selMonth) + ')이 최초 입고월 이전이라 조회되지 않습니다.</span>'
          : '')
      + '</td></tr>';

    body.querySelectorAll('tr[data-code]').forEach(tr => {
      const code = tr.dataset.code;
      const inp = tr.querySelector('.am-sellbuy');
      if (!inp) return;
      inp.addEventListener('input', () => {
        userEdited = true;
        const rec = ensureRec(code);
        if (inp.value === '') delete rec.sellBuyByMonth[selMonth]; else rec.sellBuyByMonth[selMonth] = Number(inp.value);
        pruneRec(code); syncDirty();
      });
    });
    publish();
    syncDirty();
  }

  // ── 계산 화면으로 발행 ──
  function publish() {
    const b = draft.byMat;
    window.__kjMatAlloc = {
      ready: true,
      basePriceOf: basePriceOf,
      sellBuyOf: (code, ym) => { // 자재별 판매가(구매) — 저장값만 적용 (미설정 0)
        const c = nrm(code);
        const rec = b[c] || {};
        const m = (ym && String(ym).length === 6) ? String(ym) : curMonth();
        const st = rec.sellBuyByMonth || {};
        return st[m] != null ? Number(st[m]) : 0;
      }
    };
    window.dispatchEvent(new CustomEvent('kjmatalloc:ready'));
  }

  // 대상 자재 × 대상 월에 기본값(판매가 × (1+비율%))을 채우고 저장
  function monthsOfMat(code) {
    const rec = matMonths[nrm(code)];
    const out = [];
    if (!rec) return out;
    const ks = Object.keys(rec).filter(k => rec[k].q > 0).map(mIdx).sort((a, b) => a - b);
    if (!ks.length) return out;
    for (let i = ks[0]; i <= mIdx(curMonth()); i++) out.push(mStr(i));
    return out;
  }
  function applyBulk(targets, months, label, saveScope) {
    ensureBase();
    const pct = Number(draft.defaultPct) || 0;
    let n = 0, cells = 0;
    targets.forEach(e => {
      const rec = ensureRec(e.code);
      const ms = (months === 'all') ? monthsOfMat(e.code) : months;
      ms.forEach(m => {
        const v = Math.round(basePriceOf(e.code, m) * (1 + pct / 100));
        if (v) { rec.sellBuyByMonth[m] = v; cells++; } else delete rec.sellBuyByMonth[m];
      });
      pruneRec(e.code); n++;
    });
    userEdited = true; render();
    if ($a('amSaveMsg')) { $a('amSaveMsg').className = 'text-xs font-semibold text-slate-500'; $a('amSaveMsg').innerText = label + ' — 자재 ' + n.toLocaleString() + '개 / 값 ' + cells.toLocaleString() + '건에 기본값(비율 ' + pct + '%)을 적용했습니다. 저장 중...'; }
    save(saveScope); // ★ 적용 후 자동 저장
  }

  // ── 저장: 기준월 항목만 교체 ──
  function buildByMatForSave(scope) {
    if (scope === 'all') return JSON.parse(JSON.stringify(draft.byMat)); // 전체 월 저장
    const saved = normMats(alloc.items || {});
    const out = {}; const codes = Object.create(null);
    for (const c in saved) codes[c] = true;
    for (const c in draft.byMat) codes[c] = true;
    for (const c in codes) {
      const sv = saved[c] || { sellBuyByMonth: {} };
      const rec = { sellBuyByMonth: Object.assign({}, sv.sellBuyByMonth) };
      if (Object.prototype.hasOwnProperty.call(draft.byMat, c)) {
        const dv = (draft.byMat[c].sellBuyByMonth || {})[selMonth];
        if (dv != null) rec.sellBuyByMonth[selMonth] = Number(dv); else delete rec.sellBuyByMonth[selMonth];
      }
      if (Object.keys(rec.sellBuyByMonth).length) out[c] = rec;
    }
    return out;
  }
  function save(scope) {
    const btn = $a('amSaveBtn'), msg = $a('amSaveMsg');
    // ★ 이 탭은 items.byMat 만 전송 — groups·byItem 은 서버가 기존값을 그대로 유지합니다
    const items = { byMat: buildByMatForSave(scope), defaultPctMat: Number(draft.defaultPct) || 0 };
    const payload = { items: items };
    const isAS = typeof google !== 'undefined' && google.script && google.script.run;
    const tk = hub().getToken ? hub().getToken() : null;
    if (!isAS || !tk) {
      alloc.items = items;
      if (msg) { msg.className = 'text-xs font-semibold text-amber-600'; msg.innerText = '보안 서버 모드가 아니라 이 브라우저에서만 임시 적용되었습니다 (저장 안 됨).'; }
      seedDraft(); render(); return;
    }
    if (btn) { btn.disabled = true; btn.innerText = '저장 중...'; }
    google.script.run.withSuccessHandler(saved => {
      if (saved) alloc = saved;
      if (btn) { btn.disabled = false; btn.innerText = '저장'; }
      if (msg) { msg.className = 'text-xs font-semibold text-emerald-600'; msg.innerText = '저장 완료 (' + new Date().toLocaleString('ko-KR') + ')'; }
      seedDraft(); render();
    }).withFailureHandler(err => {
      if (btn) { btn.disabled = false; btn.innerText = '저장'; }
      if (msg) { msg.className = 'text-xs font-semibold text-red-600'; msg.innerText = err && err.message ? err.message : String(err); }
    }).saveAllocation(tk, payload);
  }
  function load() {
    const isAS = typeof google !== 'undefined' && google.script && google.script.run;
    const tk = hub().getToken ? hub().getToken() : null;
    if (!isAS || !tk) {
      // 아직 로그인 전 — 화면만 그리고 저장값은 로그인 후(kjhub:login) 다시 불러옵니다
      if (!seeded) seedDraft();
      render();
      return;
    }
    google.script.run.withSuccessHandler(cfg => {
      if (cfg) alloc = cfg;
      seedDraft(); render();
    }).withFailureHandler(err => {
      if (!seeded) seedDraft();
      render();
      if ($a('amSaveMsg')) { $a('amSaveMsg').className = 'text-xs font-semibold text-red-600'; $a('amSaveMsg').innerText = '설정을 불러오지 못했습니다: ' + (err && err.message ? err.message : String(err)); }
    }).getAllocation(tk);
  }

  __onReady(() => {
    monthOptions();
    const on = (id, ev, fn) => { const el = $a(id); if (el) el.addEventListener(ev, fn); };
    on('amMonth', 'change', () => { selMonth = $a('amMonth').value; render(); });
    on('amSearchBtn', 'click', () => { amLimit = PAGE_SIZE; render(); });
    on('amSearchAsset', 'change', () => { amLimit = PAGE_SIZE; render(); });
    on('amResetBtn', 'click', () => { if ($a('amSearchNo')) $a('amSearchNo').value = ''; if ($a('amSearchName')) $a('amSearchName').value = ''; if ($a('amSearchAsset')) $a('amSearchAsset').value = ''; amLimit = PAGE_SIZE; render(); });
    on('amMoreBtn', 'click', () => { if (amLimit !== Infinity) amLimit += PAGE_SIZE; render(); });
    on('amAllBtn', 'click', () => { amLimit = Infinity; render(); });
    on('amDefaultPct', 'input', () => { draft.defaultPct = Number($a('amDefaultPct').value) || 0; });
    on('amApplyAllBtn', 'click', () => applyBulk(baseList, [selMonth], mLbl(selMonth) + ' 기준월 적용', 'month'));
    on('amApplyEveryBtn', 'click', () => {
      window.KJHub.confirm({
        title: '전체 일괄 적용',
        message: '전체 자재의 모든 기준월에 기본값을 적용하고 저장합니다.\n기존에 입력한 값도 덮어씁니다.',
        okText: '적용하고 저장'
      }).then(ok => { if (ok) applyBulk(baseList, 'all', '전체 일괄 적용', 'all'); });
    });
    on('amApplyViewBtn', 'click', () => applyBulk(lastRows, [selMonth], '조회 내역 적용(' + mLbl(selMonth) + ')', 'month'));
    // 이전 월 적용: 기준월 이전에 입력된 값 중 '가장 최근 월'의 값을 가져와 적용 + 저장
    on('amPrevMonthBtn', 'click', () => {
      ensureBase();
      const yi = mIdx(selMonth);
      let n = 0;
      baseList.forEach(e => {
        const map = (draft.byMat[e.code] || {}).sellBuyByMonth || {};
        const ks = Object.keys(map).filter(m => mIdx(m) < yi && map[m] != null).map(mIdx).sort((a, b) => b - a);
        if (!ks.length) return;
        const v = Number(map[mStr(ks[0])]);
        if (!v) return;
        ensureRec(e.code).sellBuyByMonth[selMonth] = v; n++;
      });
      userEdited = true; render();
      if ($a('amSaveMsg')) { $a('amSaveMsg').className = 'text-xs font-semibold text-slate-500'; $a('amSaveMsg').innerText = '가장 최근에 입력된 값을 ' + mLbl(selMonth) + '로 복사했습니다 (' + n.toLocaleString() + '개). 저장 중...'; }
      save('month'); // ★ 적용 후 자동 저장
    });
    on('amRevertBtn', 'click', () => { seedDraft(); render(); });
    on('amSaveBtn', 'click', () => save('month'));
    load();
  });
  window.addEventListener('kjhub:data', () => { baseSrc = null; render(); });
  window.addEventListener('kjhub:closemonth', e => { selMonth = (e.detail && e.detail.month) || selMonth; monthOptions(); render(); }); // 마감월 변경 → 기준월 동기화
  // ★ 로그인 완료 시점에 서버 저장값(byMat)을 다시 불러옴 (이벤트명: kjhub:login)
  window.addEventListener('kjhub:login', () => { seeded = false; load(); });
})();
  
}
