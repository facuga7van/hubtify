import { Component, type ReactNode } from 'react';
import i18n from '../../i18n';

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="rpg-card" style={{ margin: 24, textAlign: 'center', padding: 32 }}>
          <h3 style={{ marginBottom: 12, color: 'var(--rpg-hp-red)' }}>{i18n.t('common.somethingWentWrong')}</h3>
          <p style={{ fontSize: '0.9rem', opacity: 0.7, marginBottom: 16 }}>
            {this.state.error?.message}
          </p>
          <button className="rpg-button" onClick={() => this.setState({ hasError: false, error: null })}>
            {i18n.t('common.tryAgain')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
