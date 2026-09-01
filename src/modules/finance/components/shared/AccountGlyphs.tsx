import type { AccountKind } from '../../types';

/**
 * Small inline glyphs for the three account kinds — banknotes for cash, a
 * columned building for banks, a wallet for virtual wallets (Mercado Pago et
 * al.). Local to the finance module on purpose: the shared CodexIcons set is
 * outside this module's reach, and these three only ever appear next to an
 * account row. Stroke `currentColor` so they inherit the row's ink.
 */

function CashGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="2.5" y="7" width="19" height="11" rx="1.5" />
      <circle cx="12" cy="12.5" r="2.8" />
      <path d="M5.5 10v.01M18.5 15v.01" />
    </svg>
  );
}

function BankGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M3 9.5L12 4l9 5.5" />
      <path d="M4.5 9.5h15" />
      <path d="M6 9.5V17M10 9.5V17M14 9.5V17M18 9.5V17" />
      <path d="M3.5 19.5h17" />
    </svg>
  );
}

function WalletGlyph(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h12A1.5 1.5 0 0 1 19 7.5" />
      <rect x="3" y="7.5" width="18" height="11" rx="1.5" />
      <path d="M15.5 12h5.5v3h-5.5a1.5 1.5 0 0 1 0-3z" />
    </svg>
  );
}

/** The glyph for one account kind. Unknown kinds fall back to the wallet. */
export function AccountKindGlyph({ kind, ...props }: { kind: AccountKind | string } & React.SVGProps<SVGSVGElement>) {
  if (kind === 'cash') return <CashGlyph {...props} />;
  if (kind === 'bank') return <BankGlyph {...props} />;
  return <WalletGlyph {...props} />;
}
