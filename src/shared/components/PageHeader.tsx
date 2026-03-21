import type { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export default function PageHeader({ title, subtitle, actions }: Props) {
  return (
    <div className="page-header">
      <img
        src={new URL('../../assets/header.png', import.meta.url).href}
        alt=""
        className="page-header__banner"
      />
      <div className="page-header__content">
        <h2 className="page-header__title">{title}</h2>
        {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
    </div>
  );
}
