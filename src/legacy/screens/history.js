// 기존 화면 모듈 (Apps Script 판에서 그대로 이전) — 셸 API(KJHub)와 google.script.run 셈을 통해 Supabase 와 연결
/* eslint-disable */
export default function init() {
  const __onReady = fn => fn();

(function () {
  // ==========================================================================
  // 🕘 설정 이력 · 복구
  //   서버(설정이력 시트)에 쌓인 저장 스냅샷을 조회하고, 원하는 시점으로 되돌림
  // ==========================================================================
  const $c = id => document.getElementById(id);
  const hub = () => window.KJHub || {};
  let rows = [], loaded = false;

  function render() {
    const wrap = $c('chWrap'), empty = $c('chEmpty'), body = $c('chBody');
    if (!wrap || !empty || !body) return;
    if (!rows.length) {
      wrap.classList.add('hidden'); empty.classList.remove('hidden');
      empty.innerText = loaded
        ? '기록된 이력이 없습니다. 설정을 저장하면 이곳에 쌓입니다.'
        : '이력을 불러오는 중입니다...';
      return;
    }
    empty.classList.add('hidden'); wrap.classList.remove('hidden');
    body.innerHTML = rows.map(r => '<tr class="border-b border-slate-100 hover:bg-slate-50/60">'
      + '<td class="py-2 px-3 text-slate-700 whitespace-nowrap">' + fmtTs(r.ts) + '</td>'
      + '<td class="py-2 px-3 text-slate-600 truncate" style="max-width:200px" title="' + (r.user || '') + '">' + (r.user || '-') + '</td>'
      + '<td class="py-2 px-3 text-slate-700">' + (r.screen || '-') + '</td>'
      + '<td class="py-2 px-3 text-center text-slate-500">' + (r.month ? String(r.month).slice(0, 4) + '-' + String(r.month).slice(4, 6) : '-') + '</td>'
      + '<td class="py-2 px-3 text-slate-600">' + (r.summary || '-') + '</td>'
      + '<td class="py-2 px-3 text-center">' + (r.ok === false
          ? '<span title="스냅샷이 손상되어 복구할 수 없습니다" style="font-size:11px;color:#cbd5e1">복구 불가</span>'
          : '<button class="ch-restore" data-row="' + r.row + '" data-ts="' + fmtTs(r.ts) + '" '
            + 'style="font-size:11px;font-weight:700;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:7px;padding:4px 10px">복구</button>') + '</td>'
      + '</tr>').join('');
    body.querySelectorAll('.ch-restore').forEach(b => b.addEventListener('click', () => doRestore(b.dataset.row, b.dataset.ts)));
  }
  function fmtTs(v) {
    if (!v) return '-';
    const s2 = String(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(s2)) return s2.replace('T', ' ').slice(0, 19);
    try { return new Date(v).toLocaleString('ko-KR'); } catch (e) { return s2; }
  }
  function doRestore(row, ts) {
    hub().confirm({
      title: '설정 복구',
      message: ts + ' 시점의 설정으로 되돌립니다.\n배분 비율(부서·품목·원자재)과 지원 내역이 모두 그 시점 상태가 됩니다.\n현재 설정은 복구 직전 상태로 이력에 남습니다.',
      okText: '복구'
    }).then(ok => {
      if (!ok) return;
      const tk = hub().getToken ? hub().getToken() : null;
      const isAS = typeof google !== 'undefined' && google.script && google.script.run;
      if (!isAS || !tk) { setMsg('보안 서버 모드에서만 복구할 수 있습니다.', 'red'); return; }
      setMsg('복구 중입니다...', 'slate');
      google.script.run.withSuccessHandler(() => {
        setMsg(ts + ' 시점으로 복구했습니다. 각 설정 화면에서 확인해 주세요.', 'emerald');
        load();
        try { window.dispatchEvent(new CustomEvent('kjhub:login')); } catch (e) {} // 설정 화면들 재로딩
      }).withFailureHandler(err => setMsg((err && err.message) ? err.message : String(err), 'red'))
        .restoreConfigHistory(tk, Number(row));
    });
  }
  function setMsg(t, tone) {
    const el = $c('chMsg'); if (!el) return;
    el.className = 'text-[11px] mt-2 font-semibold ' + (tone === 'red' ? 'text-red-600' : tone === 'emerald' ? 'text-emerald-600' : 'text-slate-400');
    el.innerText = t;
  }
  let loading = false;
  function load() {
    const tk = hub().getToken ? hub().getToken() : null;
    const isAS = typeof google !== 'undefined' && google.script && google.script.run;
    // ★ 로그인 전에는 loaded 를 확정하지 않음 (확정하면 이후 재조회가 막힘)
    if (!isAS || !tk) {
      rows = []; render();
      setMsg(isAS ? '로그인 후 이력을 불러옵니다.' : '보안 서버 모드에서만 이력을 볼 수 있습니다.', 'slate');
      return;
    }
    if (loading) return;
    loading = true;
    setMsg('이력을 불러오는 중입니다...', 'slate');
    google.script.run.withSuccessHandler(res => {
      loading = false; loaded = true;
      if (!res) { rows = []; render(); setMsg('서버 응답이 비어 있습니다. .gs 를 새 버전으로 배포했는지 확인해 주세요.', 'red'); return; }
      rows = res.rows || [];
      render();
      if (res.enabled === false) setMsg('서버의 LOG_SHEET_ID 가 설정되지 않아 이력이 기록되지 않습니다.', 'red');
      else {
        const bad = rows.filter(r => r.ok === false).length;
        setMsg(rows.length.toLocaleString() + '건 표시 (최근 200건)' + (bad ? ' · 손상된 이력 ' + bad + '건은 복구 불가' : ''), bad ? 'red' : 'slate');
      }
    }).withFailureHandler(err => {
      loading = false; loaded = true; rows = []; render();
      setMsg('불러오기 실패: ' + ((err && err.message) ? err.message : String(err)), 'red');
    }).listConfigHistory(tk);
  }
  __onReady(() => {
    if ($c('chReloadBtn')) $c('chReloadBtn').addEventListener('click', () => { loaded = false; load(); });
    render();
    // 탭이 열려 있는데 아직 못 불러왔으면 자동으로 조회 (로그인 시점과 무관하게 동작)
    setInterval(() => {
      const sec = document.getElementById('screen-config-history');
      if (!sec || sec.classList.contains('hidden')) return;
      if (loaded || loading) return;
      const tk = hub().getToken ? hub().getToken() : null;
      if (tk) load();
    }, 800);
  });
  window.addEventListener('kjhub:login', () => { loaded = false; load(); });
})();
  
}
