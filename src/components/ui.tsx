import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

// ---------- 토스트 ----------
type Toast = { id: number; kind: 'ok' | 'err'; text: string; undo?: () => void };
type UICtx = {
  toast: (text: string, kind?: 'ok' | 'err', undo?: () => void) => void;
  confirm: (title: string, body: string, opts?: { danger?: boolean; okText?: string }) => Promise<boolean>;
};
const Ctx = createContext<UICtx>(null!);
export const useUI = () => useContext(Ctx);

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dlg, setDlg] = useState<{ title: string; body: string; danger?: boolean; okText?: string; resolve: (v: boolean) => void } | null>(null);

  const toast = useCallback((text: string, kind: 'ok' | 'err' = 'ok', undo?: () => void) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, kind, text, undo }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), undo ? 6000 : 3500);
  }, []);
  const confirm = useCallback((title: string, body: string, opts?: { danger?: boolean; okText?: string }) =>
    new Promise<boolean>(resolve => setDlg({ title, body, ...opts, resolve })), []);

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts">
        {toasts.map(t => (
          <div key={t.id} className={'toast ' + t.kind}>{t.text}{t.undo && <button onClick={() => { t.undo!(); setToasts(x => x.filter(y => y.id !== t.id)); }}>되돌리기</button>}</div>
        ))}
      </div>
      {dlg && (
        <div className="backdrop" onClick={() => { dlg.resolve(false); setDlg(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h4>{dlg.title}</h4>
            <p>{dlg.body}</p>
            <div className="row">
              <button className="btn ghost" onClick={() => { dlg.resolve(false); setDlg(null); }}>취소</button>
              <button className={'btn ' + (dlg.danger ? 'danger' : 'pri')} autoFocus onClick={() => { dlg.resolve(true); setDlg(null); }}>{dlg.okText ?? (dlg.danger ? '삭제' : '확인')}</button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export const fmt = (n: number | null | undefined) => (n == null || isNaN(n) ? '-' : Math.round(n).toLocaleString('ko-KR'));
export const ymLabel = (ym: string) => (ym && ym.length === 6 ? `${ym.slice(0, 4)}-${ym.slice(4)}` : ym || '-');
export const kst = (iso: string) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
