// KJ Expense — 서비스 워커 (앱 설치용 · 화면 파일 캐시)
//   · 화면 파일(HTML·JS·CSS·아이콘)만 캐시합니다. 데이터(Supabase)는 절대 캐시하지 않습니다.
//   · 페이지(HTML)는 항상 서버 우선 → 새 버전을 배포하면 바로 반영, 오프라인일 때만 캐시 사용.
const CACHE = 'kjhub-shell-v2';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('kjhub-shell-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // Supabase·글꼴 등 외부 요청은 건드리지 않음
  const scope = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scope)) return;
  if (req.mode === 'navigate') {                             // 페이지: 서버 우선
    e.respondWith(fetch(req).then(res => { const c = res.clone(); caches.open(CACHE).then(ca => ca.put(scope, c)); return res; })
      .catch(() => caches.match(scope).then(r => r || caches.match(req))));
    return;
  }
  if (/\/assets\/|\.(png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)) { // 빌드 파일(이름에 해시 포함)·아이콘: 캐시 우선
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(ca => ca.put(req, c)); } return res; })));
  }
});
