// ===== 국전 비용 현황 · 공용 셸 (Supabase 판) =====
// 기존 Apps Script 셸(block 4)의 KJHub API 를 그대로 제공하되, 데이터는 Supabase rows 테이블에서 읽습니다.
import { supabase, DATASETS, SUPABASE_URL, SUPABASE_ANON } from '../lib/supabase';

export const KJHub = {
    data: {},
    // { purchase: rows|null, expense, sale, voucher, ... }
    meta: {},
    // { 키: { state: idle|loading|ready|error, note } }
    publish() {
      const t0 = performance.now();
      window.dispatchEvent(new CustomEvent('kjhub:data', { detail: { data: this.data } }));
      console.log('[KJHub] 화면 계산(publish) ' + Math.round(performance.now() - t0) + 'ms');
    },
    // ── 화면별 권한: 이 화면에서 볼 수 있는 부서 목록 ──────────────────
    //   반환 null = 제한 없음(전체) / [] = 이 화면 권한 없음 / [부서..] = 그 부서만
    screenDepts(screenTitle) {
      const u = this.user;
      if (!u) return null; // file 모드 등 비로그인 → 제한 없음
      const role = String(u.role || '').toLowerCase();
      if (role === 'admin' || role === 'all' || role === '전체') return null;
      const rules = u.rules && u.rules.length ? u.rules : [{ screens: null, depts: u.depts || [] }];
      const nrm = s => String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
      // 화면 이름이 바뀌어도 기존 권한 설정이 계속 동작하도록 옛 이름을 함께 인정
      const ALIAS = {
        '국전 수익/비용': ['사업단위별 수익 및 사용 내역', '사업장별 수익 및 사용 내역'],
        '사업단위 수익/비용': ['사업단위 수익 및 사용 내역'],
        '부서별 수익/비용': ['부서별 수익 및 사용 내역', '부서별 마진 및 사용 내역'],
        '부서별 비용': ['부서별 사용 내역'],
        '구매/판매 내역': ['구매 및 판매 내역']
      };
      const keys = new Set();
      keys.add(nrm(screenTitle || ''));
      (ALIAS[screenTitle] || []).forEach(a => keys.add(nrm(a)));
      for (const k0 in ALIAS) { if (ALIAS[k0].some(a => nrm(a) === nrm(screenTitle || ''))) keys.add(nrm(k0)); }
      const sk = nrm(screenTitle || '');
      const seen = new Set();
      const out = [];
      for (const rl of rules) {
        const applies = !sk ? true : (!rl.screens ? true : (rl.screens || []).some(s => keys.has(nrm(s))));
        if (!applies) continue;
        for (const d of rl.depts || []) {
          const k = nrm(d);
          if (k && !seen.has(k)) { seen.add(k); out.push(d); }
        }
      }
      return this.__expandBizUnits(out); // 항목이 본부명(BizUnitName)이면 소속 부서로 확장
    },
    // 허용부서 전개: 본부명(BizUnitName) → 부서 마스터 기준 소속 전 부서 (서버 확장 규칙과 동일)
    __expandBizUnits(list) {
      const rows = this.data && this.data.dept;
      if (!Array.isArray(rows) || !rows.length || !list.length) return list;
      const nrm = s => String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
      const byBiz = Object.create(null);
      const deptSet = new Set();
      for (const r of rows) {
        const biz = nrm(r['BizUnitName']);
        const dn = String(r['DeptName'] || '').trim();
        if (dn) deptSet.add(nrm(dn));
        if (biz && dn) (byBiz[biz] = byBiz[biz] || []).push(dn);
      }
      const out = [];
      const seen = new Set();
      const push = d => { const k = nrm(d); if (k && !seen.has(k)) { seen.add(k); out.push(d); } };
      for (const t0 of list) {
        const t = String(t0 || '').trim();
        if (!t) continue;
        const k = nrm(t);
        if (t.endsWith('*') || deptSet.has(k)) { push(t); continue; }
        if (byBiz[k]) { byBiz[k].forEach(push); continue; }
        push(t);
      }
      return out;
    },
    // 화면 기준으로 좁혀진 행 반환 (데이터셋별 부서 컬럼 기준, 결과 캐시)
    rowsFor(key, screenTitle) {
      const rows = this.data[key];
      if (!Array.isArray(rows)) return rows;
      const allow = this.screenDepts(screenTitle);
      if (allow == null) return rows; // 제한 없음
      const DCOLS = { voucher: ['CostCCtrName', '코스트센터', '부서'], purchase: ['DEPTNAME', '부서'], sale: ['DEPTNAME', '부서'], expense: ['DEPTNAME', '부서'] };
      const cols = DCOLS[key];
      if (!cols) return rows; // 참조 데이터(dept 등)는 그대로
      const ck = '__sf_' + key + '_' + (screenTitle || '') + '_' + allow.join('|');
      this.__sfCache = this.__sfCache || {};
      const hit = this.__sfCache[ck];
      if (hit && hit.src === rows) return hit.out;
      const nrm = s => String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
      const exact = new Set();
      const prefixes = [];
      for (const d of allow) {
        const t = nrm(d);
        if (!t) continue;
        if (t.endsWith('*')) prefixes.push(t.slice(0, -1));
        else exact.add(t);
      }
      const out = allow.length === 0 ? [] : rows.filter(r => {
        for (const c of cols) {
          const v = nrm(r[c]);
          if (!v) continue;
          if (exact.has(v)) return true;
          for (const p of prefixes) if (p && v.indexOf(p) === 0) return true;
        }
        return false;
      });
      this.__sfCache[ck] = { src: rows, out: out };
      return out;
    },
  };
  Object.keys(DATASETS).forEach(k => {
    KJHub.data[k] = null;
    KJHub.meta[k] = {
      state: 'idle',
      note: ''
    };
  });
  // ===== 공용 확인 모달 =========================================
  //   브라우저 기본 confirm 대신 화면 톤에 맞춘 모달을 사용합니다.
  KJHub.confirm = function (opts) {
    const o = typeof opts === 'string' ? { message: opts } : (opts || {});
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.className = 'fixed inset-0 z-50 flex items-center justify-center px-4';
      ov.setAttribute('style', 'background:rgba(15,23,42,.45)');
      ov.innerHTML = '<div class="bg-white rounded-xl shadow-xl border border-slate-200" style="width:100%;max-width:400px;overflow:hidden">'
        + '<div style="padding:22px 22px 16px 22px;display:flex;align-items:flex-start;gap:12px">'
        + '<span style="flex:0 0 auto;width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:#fffbeb;color:#b45309"><i data-lucide="alert-triangle" style="width:17px;height:17px"></i></span>'
        + '<div style="min-width:0;padding-top:2px">'
        + '<h4 style="font-size:13.5px;font-weight:700;color:#1e293b;margin:0 0 6px 0;line-height:1.4">' + (o.title || '확인') + '</h4>'
        + '<p style="font-size:12px;color:#64748b;margin:0;line-height:1.75;white-space:pre-line">' + (o.message || '') + '</p>'
        + '</div></div>'
        + '<div style="padding:12px 22px 18px 22px;display:flex;align-items:center;justify-content:flex-end;gap:8px;border-top:1px solid #f1f5f9;background:#fafbfc">'
        + '<button data-act="cancel" style="font-size:12px;font-weight:600;color:#475569;background:#fff;border:1px solid #cbd5e1;padding:7px 16px;border-radius:8px;cursor:pointer">' + (o.cancelText || '취소') + '</button>'
        + '<button data-act="ok" style="font-size:12px;font-weight:600;color:#fff;background:#1e293b;border:1px solid #1e293b;padding:7px 16px;border-radius:8px;cursor:pointer">' + (o.okText || '계속') + '</button>'
        + '</div></div>';
      const done = v => { try { document.body.removeChild(ov); } catch (e) {} document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') done(false); if (e.key === 'Enter') done(true); };
      ov.addEventListener('click', e => {
        if (e.target === ov) return done(false);
        const b = e.target.closest('button');
        if (b) done(b.dataset.act === 'ok');
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(ov);
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
      const okb = ov.querySelector('[data-act="ok"]');
      if (okb) okb.focus();
    });
  };

Object.keys(DATASETS).forEach(k => { KJHub.data[k] = null; KJHub.meta[k] = { state: 'idle', note: '' }; });
window.KJHub = KJHub;

// ── 마감월 ─────────────────────────────────────────────
let closeMonth = '';
const curYm = () => { const d = new Date(); return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2); };
KJHub.closeMonth = () => closeMonth || curYm();
KJHub.closeMonthEnd = () => { const m = KJHub.closeMonth(); const y = +m.slice(0, 4), mo = +m.slice(4, 6); const last = new Date(y, mo, 0).getDate(); return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + last).slice(-2); };
KJHub.setCloseMonth = (v, opts) => {
  v = String(v || '').replace(/[^0-9]/g, '').slice(0, 6);
  if (!/^[0-9]{6}$/.test(v)) return;
  const changed = v !== closeMonth; closeMonth = v;
  if (changed || (opts && opts.force)) { try { window.dispatchEvent(new CustomEvent('kjhub:closemonth', { detail: { month: v } })); } catch (e) {} }
};

// ── 화면 전환 (React 라우터가 호출) ─────────────────────
let activeScreen = null;
let navHook = null; // (screenId) => void  — React 쪽 라우팅
export function setNavHook(fn) { navHook = fn; }
const SCROLL_POS = Object.create(null);
KJHub.showScreen = function (id, opts) {
  const o = opts || {};
  const prev = activeScreen;
  if (prev && prev !== id) SCROLL_POS[prev] = window.scrollY || 0;
  activeScreen = id;
  document.querySelectorAll('section.hub-screen').forEach(el => el.classList.toggle('hidden', el.id !== 'screen-' + id));
  const y = SCROLL_POS[id] || 0;
  requestAnimationFrame(() => window.scrollTo(0, y));
  if (!o.fromRouter && navHook) navHook(id);
};
KJHub.activeScreen = () => activeScreen;

// ── 사용자 ─────────────────────────────────────────────
// 신 권한 모델(employees.screen_depts: {경로: [부서]}) → 구 규칙([{screens:[제목], depts}])
const PATH_TITLE = {
  '/bu': '국전 수익/비용', '/bu-real': '국전 수익/비용(실현 수익)', '/bu-unit': '사업단위 수익/비용', '/dept': '부서별 수익/비용',
  '/dept-cost': '부서별 비용', '/dept-support': '부서별 지원 내역', '/trade': '구매/판매 내역', '/matinput': '실자재 투입 내역', '/stock': 'Lot별 재고조회',
};
export function setUser(emp) {
  if (!emp) { KJHub.user = null; return; }
  const sd = emp.screen_depts || {};
  const rules = Object.keys(sd).map(p => ({ screens: [PATH_TITLE[p] || p], depts: sd[p] || [] }));
  KJHub.user = { email: emp.login_id, name: emp.name, role: emp.role, depts: [], rules: rules.length ? rules : [{ screens: null, depts: [] }] };
  KJHub.getToken = () => 'supabase';
  try { window.dispatchEvent(new CustomEvent('kjhub:login')); } catch (e) {}
}

// ── 데이터 로딩 (Supabase rows) ─────────────────────────
const LOADING = {};
const listeners = new Set();
export function onMeta(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function setMeta(key, state, note) { KJHub.meta[key] = { state, note: note || '' }; listeners.forEach(f => f(KJHub.meta)); }

// ── 브라우저 캐시(IndexedDB): 업로드 버전이 같으면 다시 내려받지 않음 (무료 플랜 전송량 절약) ──
const DB_NAME = 'kjhub-cache', STORE = 'datasets';
function idb() {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}
async function cacheGet(key) { try { const db = await idb(); return await new Promise((res, rej) => { const t = db.transaction(STORE, 'readonly').objectStore(STORE).get(key); t.onsuccess = () => res(t.result || null); t.onerror = () => rej(t.error); }); } catch (e) { return null; } }
async function cachePut(key, val) { try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite').objectStore(STORE).put(val, key); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); } catch (e) { /* 캐시 실패는 무시 */ } }
export async function cacheClear() { try { const db = await idb(); await new Promise((res) => { const t = db.transaction(STORE, 'readwrite').objectStore(STORE).clear(); t.onsuccess = () => res(); t.onerror = () => res(); }); } catch (e) {} }

let versions = null; // { dataset: { ver, cnt } }
async function fetchVersions() {
  const { data, error } = await supabase.rpc('dataset_versions');
  if (error) { console.warn('dataset_versions 실패(0003 SQL 미실행?):', error.message); return {}; }
  const m = {}; (data || []).forEach(r => { m[r.dataset] = { ver: r.ver, cnt: Number(r.cnt) }; });
  return m;
}
// 데이터셋을 JSON "문자열" 그대로 받아 캐시에 저장 (객체를 IndexedDB 에 넣으면 복제 비용이 커서 화면이 멈춤)
async function fetchDatasetText(key) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/dataset_rows', {
    method: 'POST', headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + (session ? session.access_token : SUPABASE_ANON), 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_dataset: key }),
  });
  if (!res.ok) throw new Error('dataset_rows HTTP ' + res.status + ' (0003 SQL 실행 여부 확인)');
  return await res.text();
}
async function fetchDatasetPaged(key) {
  const PAGE = 1000; let from = 0; const out = [];
  for (;;) {
    const { data, error } = await supabase.from('rows').select('data').eq('dataset', key).order('id').range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data) out.push(r.data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function loadKeys(keys, force) {
  const need = (keys || []).filter(k => DATASETS[k] && (force || !KJHub.data[k]) && !LOADING[k]);
  if (!need.length) return;
  if (!versions || force) versions = await fetchVersions();
  need.forEach(k => { LOADING[k] = true; setMeta(k, 'loading'); });
  // 1) 네트워크는 병렬, 2) JSON 파싱은 순차(화면 멈춤 최소화), 3) 화면 갱신(publish)은 마지막에 한 번
  const tFetch = performance.now();
  const texts = await Promise.all(need.map(async k => {
    try {
      const v = versions[k];
      if (v && v.cnt === 0) return { k, text: '[]', src: '없음' };
      const cached = force ? null : await cacheGet(k);
      if (cached && v && cached.ver === v.ver && typeof cached.text === 'string') return { k, text: cached.text, src: '캐시' };
      try {
        const text = await fetchDatasetText(k);
        if (v) cachePut(k, { ver: v.ver, text }); // 문자열 저장 — 복제 비용 거의 없음
        return { k, text, src: '서버' };
      } catch (e) {
        console.warn('[KJHub] ' + k + ' 단일 요청 실패 → 페이지 방식:', e.message);
        return { k, rows: await fetchDatasetPaged(k), src: '서버(페이지)' };
      }
    } catch (e) { return { k, err: e }; }
  }));
  console.log('[KJHub] 수신 ' + need.join(',') + ' ' + Math.round(performance.now() - tFetch) + 'ms');
  for (const t of texts) {
    try {
      if (t.err) throw t.err;
      const tp = performance.now();
      const rows = t.rows || JSON.parse(t.text);
      console.log('[KJHub] 파싱 ' + t.k + ' ' + Math.round(performance.now() - tp) + 'ms, ' + Math.round((t.text || '').length / 1024) + 'KB');
      KJHub.data[t.k] = Array.isArray(rows) ? rows : [];
      setMeta(t.k, 'ready', KJHub.data[t.k].length.toLocaleString('ko-KR') + '건 · ' + t.src);
      console.log('[KJHub] ' + t.k + ' ' + KJHub.data[t.k].length + '건 (' + t.src + ')');
    } catch (e) { console.error('[KJHub] ' + t.k + ' 로딩 실패', e); setMeta(t.k, 'error', e.message || String(e)); }
    finally { LOADING[t.k] = false; }
    await sleep(0); // 파싱 사이에 화면이 숨 쉴 틈
  }
  KJHub.publish();
}
export const loadAll = force => loadKeys(Object.keys(DATASETS), force);

// 화면별 필요 데이터 (기존 셸의 SCREENS.datasets 와 동일)
export const SCREEN_DATASETS = {
  'bu-margin': ['purchase', 'expense', 'sale', 'voucher', 'dept', 'headcount'],
  'bu-margin-real': ['purchase', 'expense', 'sale', 'voucher', 'dept', 'headcount', 'synth', 'mfgcost', 'matinput'],
  'bu-margin-my': ['purchase', 'expense', 'sale', 'voucher', 'dept', 'headcount'],
  'margin-alloc': ['purchase', 'expense', 'sale', 'voucher', 'dept', 'headcount'],
  'purchase-sales': ['purchase', 'expense', 'sale', 'synth', 'mfgcost', 'matinput'],
  'mat-input': ['matinput', 'synth', 'purchase'],
  'dept-cost': ['voucher'],
  'dept-support': ['dept', 'headcount'],
  'lot-stock': ['stock'],
  'alloc-settings': ['purchase', 'expense', 'sale', 'voucher', 'dept'],
  'alloc-items': ['purchase', 'sale', 'mfgcost', 'synth'],
  'alloc-mats': ['purchase', 'matinput'],
  'support': ['dept', 'headcount'],
};
// 보고 있는 화면 것부터 받고, 나머지는 한가할 때 하나씩
let bgTimer = null;
export async function loadForScreen(screenId) {
  const first = SCREEN_DATASETS[screenId] || [];
  await loadKeys(first);
  clearTimeout(bgTimer);
  const rest = Object.keys(DATASETS).filter(k => !KJHub.data[k]);
  const step = async () => {
    const k = Object.keys(DATASETS).find(x => !KJHub.data[x] && !LOADING[x]);
    if (!k) return;
    await loadKeys([k]);
    bgTimer = setTimeout(step, 1500);
  };
  if (rest.length) bgTimer = setTimeout(step, 1500);
}

// 설정(마감월) 초기 로드
export async function loadCloseMonth() {
  const { data } = await supabase.from('config').select('value').eq('key', 'closeMonth').maybeSingle();
  const v = typeof data?.value === 'string' ? data.value : '';
  if (v) KJHub.setCloseMonth(v, { force: true });
  else { try { window.dispatchEvent(new CustomEvent('kjhub:closemonth', { detail: { month: KJHub.closeMonth() } })); } catch (e) {} }
}
