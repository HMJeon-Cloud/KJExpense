// 도움말 — 제목 옆의 작은 (?) 를 누르면 뜻과 핵심 계산을 먼저 보여 주고, [자세히 보기]로 쓰는 데이터·세부 기준을 펼칩니다.
//   <HelpDot id="trade.verdict" />   ·   기존 화면(legacy)에서는 window.KJHub.openHelp('id')
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HELP } from '../lib/helpDocs';
import { useAuth } from '../lib/auth';

const EVT = 'kjhub:help';
export function openHelp(id: string) { window.dispatchEvent(new CustomEvent(EVT, { detail: { id } })); }

export function HelpDot({ id, style }: { id: string; style?: React.CSSProperties }) {
  if (!HELP[id]) return null;
  return (
    <button type="button" className="helpdot" aria-label={'도움말: ' + HELP[id].title} title="어떻게 계산한 값인가요?"
      onClick={e => { e.stopPropagation(); openHelp(id); }} style={style}>?</button>
  );
}

/** 앱에 한 번만 두는 도움말 창 */
export function HelpHost() {
  const [id, setId] = useState<string | null>(null);
  const nav = useNavigate();
  const { employee } = useAuth();
  const isAdmin = employee?.role === 'admin';
  useEffect(() => {
    const h = (e: Event) => setId((e as CustomEvent).detail?.id ?? null);
    window.addEventListener(EVT, h);
    const w = window as unknown as { KJHub?: Record<string, unknown> };
    w.KJHub = w.KJHub || {}; w.KJHub.openHelp = openHelp; // 기존 화면(구매 · 판매 LOT 내역)에서 사용
    return () => window.removeEventListener(EVT, h);
  }, []);
  useEffect(() => {
    if (!id) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setId(null); };
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k);
  }, [id]);
  const d = id ? HELP[id] : null;
  const [more, setMore] = useState(false);
  useEffect(() => { setMore(false); }, [id]);
  const KEY = 4;   // 먼저 보여 줄 계산 줄 수
  const rel = d?.related?.filter(r => isAdmin || !r.path.startsWith('/settings')) || [];
  return (
    <>
      <style>{`
        .helpdot{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:999px;border:1px solid var(--blue-line);background:var(--blue-soft);color:var(--blue-2);font-weight:700;font-size:11px;line-height:1;cursor:pointer;padding:0;margin-left:6px;vertical-align:middle;flex:none;transition:background .12s,border-color .12s}
        .helpdot:hover{border-color:var(--blue);background:#dbe9ff}
        .hlp-ov{position:fixed;inset:0;z-index:200;background:rgba(15,23,42,.42);display:flex;align-items:flex-start;justify-content:center;padding:7vh 16px;overflow:auto}
        .hlp{width:100%;max-width:640px;background:var(--surface);border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.22);overflow:hidden}
        .hlp-hd{display:flex;gap:10px;align-items:center;padding:16px 20px;border-bottom:1px solid var(--line)}
        .hlp-hd h3{margin:0;font-size:16.5px;font-weight:700}
        .hlp-hd .x{margin-left:auto;border:0;background:transparent;font-size:22px;line-height:1;color:var(--fg-3);cursor:pointer;padding:2px 8px;border-radius:8px}
        .hlp-hd .x:hover{background:var(--surface-3)}
        .hlp-bd{padding:18px 20px 20px;display:grid;gap:16px;font-size:14px;line-height:1.65}
        .hlp-what{margin:0;color:var(--fg)}
        .hlp-sec h4{margin:0 0 6px;font-size:12.5px;font-weight:700;color:var(--fg-3)}
        .hlp-src{width:100%;border-collapse:collapse;font-size:13px}
        .hlp-src td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
        .hlp-src td:first-child{white-space:nowrap;font-weight:600;width:1%}
        .hlp-src td:last-child{color:var(--fg-2)}
        .hlp-calc{margin:0;padding:12px 14px;background:var(--surface-2);border-radius:10px;display:grid;gap:5px;font-size:13px}
        .hlp-calc div{white-space:pre-wrap}
        .hlp-notes{margin:0;padding-left:18px;list-style:disc;color:var(--fg-2);font-size:13px;display:grid;gap:4px}
        .hlp-rel{display:flex;gap:6px;flex-wrap:wrap}
      `}</style>
      {d && (
        <div className="hlp-ov" onMouseDown={e => { if (e.target === e.currentTarget) setId(null); }}>
          <div className="hlp" role="dialog" aria-modal="true" aria-label={d.title}>
            <div className="hlp-hd"><h3>{d.title}</h3><button className="x" onClick={() => setId(null)} aria-label="닫기">×</button></div>
            <div className="hlp-bd">
              <p className="hlp-what">{d.what}</p>
              <div className="hlp-sec"><h4>계산</h4><div className="hlp-calc">{(more ? d.calc : d.calc.slice(0, KEY)).map((c, i) => <div key={i}>{c.startsWith('  ') ? c : '• ' + c}</div>)}</div></div>
              {!more && <div><button className="btn sm" onClick={() => setMore(true)}>자세히 보기{d.calc.length > KEY ? ` · 계산 ${d.calc.length - KEY}줄 더` : ''} · 쓰는 데이터{d.notes?.length ? ' · 세부 기준' : ''}</button></div>}
              {more && <>
                <div className="hlp-sec"><h4>쓰는 데이터</h4>
                  <table className="hlp-src"><tbody>{d.sources.map((s, i) => <tr key={i}><td>{s.ds}</td><td>{s.cols}</td></tr>)}</tbody></table>
                </div>
                {d.notes && d.notes.length > 0 && <div className="hlp-sec"><h4>세부 기준</h4><ul className="hlp-notes">{d.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>}
              </>}
              {rel.length > 0 && <div className="hlp-sec"><h4>관련 화면</h4><div className="hlp-rel">{rel.map(r => <button key={r.path} className="btn sm" onClick={() => { setId(null); nav(r.path); }}>{r.label} →</button>)}</div></div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
