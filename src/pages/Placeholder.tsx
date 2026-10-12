import { useLocation } from 'react-router-dom';
import { SCREENS } from '../components/Layout';

/** 3단계에서 기존 화면을 옮기기 전까지 쓰는 자리 */
export default function Placeholder() {
  const loc = useLocation();
  const s = SCREENS.flatMap(g => g.items).find(i => i.path === loc.pathname);
  return (
    <div className="page">
      <div className="page-head"><h1>{s?.title ?? loc.pathname}</h1><span className="tag y">3단계에서 이전 예정</span></div>
      <div className="card"><div className="empty">이 화면은 아직 새 구조로 옮기지 않았습니다.<br />그동안은 기존 Apps Script 화면을 그대로 쓰시면 됩니다.</div></div>
    </div>
  );
}
