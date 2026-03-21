interface Props {
  text?: string;
  size?: 'sm' | 'md';
}

export default function Loading({ text, size = 'md' }: Props) {
  const dim = size === 'sm' ? 16 : 24;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: size === 'sm' ? 8 : 16, opacity: 0.6 }}>
      <div style={{
        width: dim, height: dim, border: '2px solid var(--rpg-gold-dark)',
        borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite',
      }} />
      {text && <span style={{ fontSize: size === 'sm' ? '0.8rem' : '0.9rem' }}>{text}</span>}
    </div>
  );
}
