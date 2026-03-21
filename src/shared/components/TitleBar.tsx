export default function TitleBar() {
  return (
    <div className="title-bar">
      <span className="title-bar-text">Hubtify</span>
      <div className="title-bar-controls">
        <button className="title-bar-btn" onClick={() => window.api.windowMinimize()}>&#x2500;</button>
        <button className="title-bar-btn" onClick={() => window.api.windowMaximize()}>&#x25A1;</button>
        <button className="title-bar-btn title-bar-btn--close" onClick={() => window.api.windowClose()}>&#x2715;</button>
      </div>
    </div>
  );
}
