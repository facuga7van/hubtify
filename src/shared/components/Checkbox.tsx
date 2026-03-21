interface Props {
  checked?: boolean;
  onChange: () => void;
  size?: number;
}

export default function Checkbox({ checked = false, onChange, size = 20 }: Props) {
  return (
    <svg
      onClick={onChange}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      style={{ cursor: 'pointer', flexShrink: 0 }}
      fill="none"
      stroke={checked ? 'var(--rpg-xp-green)' : 'var(--rpg-gold-dark)'}
      strokeWidth="1.5"
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(); } }}
    >
      <rect x="3" y="3" width="14" height="14" rx="2" />
      {checked && <path d="M6 10l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}
