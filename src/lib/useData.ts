// 데이터셋이 도착하거나 바뀌면 화면을 다시 그리게 하는 훅
//   기존 'kjhub:data' 이벤트는 계산 모듈용으로 걸러지므로(React 화면에는 안 올 수 있음), 데이터 상태 알림(onMeta)을 직접 봅니다.
import { useEffect, useState } from 'react';
import { loadKeys, onMeta } from '../legacy/hub';

type Hub = { data?: Record<string, unknown[] | null>; meta?: Record<string, { state: string; note: string }>; user?: unknown };
const hub = () => (window as unknown as { KJHub?: Hub }).KJHub;

/** ver = 데이터가 바뀔 때마다 달라지는 값(useMemo 의존값으로 사용), ready = keys 를 모두 받았는지 */
export function useData(keys: string[]) {
  const id = keys.join('|');
  const sig = () => { const k = hub(); return keys.map(x => (k?.data?.[x] ? (k.data[x] as unknown[]).length : -1) + ':' + (k?.meta?.[x]?.note || '')).join('|') + '|' + (k?.user ? 1 : 0); };
  const [ver, setVer] = useState(sig);
  useEffect(() => {
    loadKeys(keys);
    const chk = () => setVer(sig());
    chk(); const off = onMeta(chk);
    window.addEventListener('kjhub:login', chk);
    return () => { off(); window.removeEventListener('kjhub:login', chk); };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const k = hub();
  return { ver, ready: keys.every(x => k?.data?.[x] != null), error: keys.some(x => k?.meta?.[x]?.state === 'error') };
}
