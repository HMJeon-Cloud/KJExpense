// 기존 계산 모듈이 내보내는 화면 모델을 React 에서 받기 (kjhub:model 이벤트)
import { useEffect, useState } from 'react';
type Actions = { setBaseMonth: (v: string) => void; setMonths: (n: number) => void; get: () => { baseMonth: string; months: number } };
const KJ = () => (window as unknown as { KJHub?: { models?: Record<string, unknown>; actions?: Record<string, Actions> } }).KJHub;
export function useLegacyModel<T>(id: string) {
  const [model, setModel] = useState<T | null>(() => (KJ()?.models?.[id] as T) ?? null);
  const [ctl, setCtl] = useState({ baseMonth: '', months: 6 });
  useEffect(() => {
    const onModel = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.id === id) { setModel({ ...(KJ()!.models![id] as object) } as T); const a = KJ()?.actions?.[id]; if (a) setCtl(a.get()); } };
    window.addEventListener('kjhub:model', onModel);
    const a = KJ()?.actions?.[id]; if (a) { setCtl(a.get()); const m = KJ()?.models?.[id]; if (m) setModel({ ...(m as object) } as T); }
    return () => window.removeEventListener('kjhub:model', onModel);
  }, [id]);
  const act = KJ()?.actions?.[id];
  return {
    model, ctl,
    setBase: (v: string) => { setCtl(c => ({ ...c, baseMonth: v })); act?.setBaseMonth(v); },
    setMonths: (n: number) => { setCtl(c => ({ ...c, months: n })); act?.setMonths(n); },
  };
}
export const shiftMonth = (ym: string, d: number) => { const y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + d; const dt = new Date(y, m, 1); return dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2); };
