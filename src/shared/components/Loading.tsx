interface Props {
  text?: string;
  size?: 'sm' | 'md';
}

export default function Loading({ text, size = 'md' }: Props) {
  const dim = size === 'sm' ? 18 : 28;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: size === 'sm' ? 6 : 10, padding: size === 'sm' ? 8 : 16,
    }}>
      {/* Spinning compass rose */}
      <svg
        width={dim}
        height={dim}
        viewBox="0 0 24 24"
        fill="none"
        style={{ animation: 'spin 2s linear infinite' }}
      >
        {/* Outer ring */}
        <circle cx="12" cy="12" r="10" stroke="var(--gold-dark)" strokeWidth="1.5" opacity="0.5" />
        {/* Cardinal points */}
        <path d="M12 2 L13 6 L12 5 L11 6 Z" fill="var(--gold)" />
        <path d="M22 12 L18 13 L19 12 L18 11 Z" fill="var(--gold-dark)" />
        <path d="M12 22 L11 18 L12 19 L13 18 Z" fill="var(--gold-dark)" />
        <path d="M2 12 L6 11 L5 12 L6 13 Z" fill="var(--gold-dark)" />
        {/* Center diamond */}
        <path d="M12 8 L14 12 L12 16 L10 12 Z" fill="var(--gold)" opacity="0.7" />
        <circle cx="12" cy="12" r="1.5" fill="var(--ink)" />
      </svg>
      {text && (
        <span style={{
          fontFamily: "'IM Fell English', serif",
          fontStyle: 'italic',
          fontSize: size === 'sm' ? 'var(--fs-label)' : 'var(--fs-body)',
          color: 'var(--ink-faded)',
          letterSpacing: '0.03em',
        }}>
          {text}
        </span>
      )}
    </div>
  );
}
