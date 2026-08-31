/**
 * The tan disc + spinner that covers the avatar while the Pixi chunk, the base
 * textures or the hair spritesheets are still loading. Rendered both as the
 * <Suspense> fallback for the lazy canvas and as the in-canvas overlay, so the
 * user never sees the two swap for one another.
 *
 * Absolutely positioned — the parent supplies the sized, `position:relative` box.
 */
export default function CharacterPortraitFallback({ label }: { label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#c0a080', borderRadius: '50%', zIndex: 10,
      }}
    >
      <div style={{
        width: 20, height: 20, border: '2px solid var(--gold-dark)',
        borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite',
      }} />
    </div>
  );
}
