export default function TitleBar() {
  return (
    <div className="title-bar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <img src={new URL('../../assets/titleLeft.png', import.meta.url).href}
          alt="" style={{ height: 18, opacity: 0.6 }} />
        <span className="title-bar-text">Hubtify</span>
      </div>
      <div className="title-bar-controls">
        <button className="title-bar-btn" onClick={() => window.api.windowMinimize()}>
          <img src={new URL('../../assets/minimize.png', import.meta.url).href}
            alt="Minimize" style={{ height: 12 }} />
        </button>
        <button className="title-bar-btn" onClick={() => window.api.windowMaximize()}>
          □
        </button>
        <button className="title-bar-btn title-bar-btn--close" onClick={() => window.api.windowClose()}>
          <img src={new URL('../../assets/close.png', import.meta.url).href}
            alt="Close" style={{ height: 14 }} />
        </button>
      </div>
    </div>
  );
}
