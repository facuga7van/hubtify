export default function TitleBar() {
  return (
    <div className="title-bar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <img src={new URL('../../assets/titleLeft.png', import.meta.url).href}
          alt="" style={{ height: 18, opacity: 0.5 }} />
        <span className="title-bar-text">Hubtify</span>
      </div>
      <div className="title-bar-controls">
        <button className="title-bar-btn" onClick={() => window.api.windowMinimize()}>
          <svg width="12" height="2" viewBox="0 0 12 2"><rect width="12" height="2" rx="1" fill="currentColor"/></svg>
        </button>
        <button className="title-bar-btn" onClick={() => window.api.windowMaximize()}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="1" width="9" height="9" rx="1.5"/></svg>
        </button>
        <button className="title-bar-btn title-bar-btn--close" onClick={() => window.api.windowClose()}>
          <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
        </button>
      </div>
    </div>
  );
}
