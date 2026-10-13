// 앱으로 설치 (PWA)
//   · 안드로이드 크롬 / PC 크롬·엣지: 브라우저의 설치 창을 바로 띄움 (beforeinstallprompt)
//   · 아이폰·아이패드 사파리: 설치 버튼을 열어 주는 기능이 없어 "공유 → 홈 화면에 추가" 안내
//   · 카카오톡 등 앱 안의 브라우저: 설치가 안 되므로 크롬/사파리로 열도록 안내 (안드로이드 카카오톡은 바로 열기 지원)
import { useEffect, useState } from 'react';

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let deferred: BIPEvent | null = null;
const subs = new Set<() => void>();
const notify = () => subs.forEach(f => f());
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e as BIPEvent; notify(); });
window.addEventListener('appinstalled', () => { deferred = null; notify(); });

const ua = () => navigator.userAgent || '';
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const isIOS = () => /iPhone|iPad|iPod/i.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(ua());
const inApp = () => /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|; wv\)/i.test(ua());
const isMobile = () => isIOS() || isAndroid();

function useInstall() {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set(n => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return deferred;
}

export function InstallButton({ className, block }: { className?: string; block?: boolean }) {
  const prompt = useInstall();
  const [guide, setGuide] = useState(false);
  if (isStandalone()) return null;                     // 이미 앱으로 실행 중
  if (!prompt && !isMobile() && !block) return null;    // PC 에서 설치 불가 상태면 상단엔 숨김
  const onClick = async () => {
    if (prompt && !inApp()) { await prompt.prompt(); try { await prompt.userChoice; } catch { /* noop */ } deferred = null; notify(); return; }
    setGuide(true);
  };
  return (
    <>
      <button className={'btn ' + (block ? '' : 'sm ') + (className || '')} style={block ? { width: '100%' } : undefined} onClick={onClick}>
        <span aria-hidden="true" style={{ fontSize: 14 }}>⤓</span> 앱으로 설치
      </button>
      {guide && <InstallGuide onClose={() => setGuide(false)} />}
    </>
  );
}

function InstallGuide({ onClose }: { onClose: () => void }) {
  const url = location.href.split('#')[0];
  const kakaoAndroid = /KAKAOTALK/i.test(ua()) && isAndroid();
  const steps: { t: string; d: string }[] = inApp()
    ? [
      { t: '이 화면은 앱 안의 브라우저입니다', d: '카카오톡·네이버 등 앱 안에서 연 화면에서는 설치가 되지 않습니다.' },
      isIOS() ? { t: '사파리로 열기', d: '오른쪽 아래(또는 위) ⋯ / 공유 단추 → "Safari로 열기"를 누르세요.' } : { t: '크롬으로 열기', d: '오른쪽 위 ⋮ 단추 → "다른 브라우저로 열기" → Chrome 을 고르세요.' },
      { t: '거기서 다시 "앱으로 설치"', d: '열린 브라우저에서 로그인 후 메뉴의 "앱으로 설치"를 누르면 됩니다.' },
    ]
    : isIOS()
      ? [
        { t: '사파리에서 열었는지 확인', d: '아이폰은 Safari 에서만 홈 화면에 추가할 수 있습니다.' },
        { t: '공유 단추 누르기', d: '화면 아래(아이패드는 위)의 □↑ 모양 공유 단추를 누르세요.' },
        { t: '"홈 화면에 추가"', d: '목록을 아래로 내려 "홈 화면에 추가" → 오른쪽 위 "추가"를 누르면 홈 화면에 "KJ Expense" 아이콘이 생깁니다.' },
      ]
      : [
        { t: '크롬 메뉴 열기', d: '오른쪽 위 ⋮ 단추를 누르세요.' },
        { t: '"앱 설치" 또는 "홈 화면에 추가"', d: '메뉴에서 "앱 설치"(또는 "홈 화면에 추가 → 설치")를 누르세요. 삼성 인터넷은 메뉴 → "현재 페이지 추가 → 홈 화면".' },
        { t: '홈 화면에서 실행', d: '홈 화면의 "KJ Expense" 아이콘으로 열면 주소창 없이 앱처럼 열립니다.' },
      ];
  return (
    <div className="hlp-ov" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} style={{ zIndex: 260 }}>
      <div className="hlp" role="dialog" aria-modal="true" aria-label="앱으로 설치" style={{ maxWidth: 440 }}>
        <div className="hlp-hd"><h3>앱으로 설치</h3><button className="x" onClick={onClose} aria-label="닫기">×</button></div>
        <div className="hlp-bd">
          <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
            {steps.map((s, i) => (
              <li key={i} style={{ display: 'grid', gridTemplateColumns: '26px 1fr', gap: 10 }}>
                <span style={{ width: 24, height: 24, borderRadius: 999, background: 'var(--brand)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', font: '700 12px var(--font-num)' }}>{i + 1}</span>
                <div><b>{s.t}</b><div className="help" style={{ fontSize: 13 }}>{s.d}</div></div>
              </li>
            ))}
          </ol>
          {kakaoAndroid && <a className="btn pri" style={{ justifyContent: 'center' }} href={'kakaotalk://web/openExternal?url=' + encodeURIComponent(url)}>크롬(기본 브라우저)으로 바로 열기</a>}
          {inApp() && <button className="btn" onClick={() => { navigator.clipboard?.writeText(url).catch(() => {}); }}>주소 복사 ({url.replace(/^https?:\/\//, '')})</button>}
        </div>
      </div>
    </div>
  );
}
