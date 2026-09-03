import { Component, type ReactNode } from 'react';
import i18n from '../../i18n';

interface Props {
  children: ReactNode;
  /** Reemplazo fijo. Para uno que pueda REINTENTAR, usá `fallbackRender`. */
  fallback?: ReactNode;
  /**
   * Igual que `fallback`, pero recibe el error y un `reset` que vuelve a montar
   * los hijos. `fallback` a secas no puede ofrecer «intentar de nuevo» —
   * es un nodo ya construido, sin acceso al estado del boundary—, así que un
   * widget roto quedaba roto hasta recargar la app entera.
   */
  fallbackRender?: (error: Error | null, reset: () => void) => ReactNode;
  /** Nombre para el log: sin esto, quince boundaries dicen todos lo mismo. */
  label?: string;
}
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
    console.error(`[ErrorBoundary${this.props.label ? ` ${this.props.label}` : ''}]`, error, info.componentStack);
  }

  private reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      if (this.props.fallbackRender) return this.props.fallbackRender(this.state.error, this.reset);
      return this.props.fallback ?? (
        <div className="rpg-card" style={{ margin: 24, textAlign: 'center', padding: 32 }}>
          <h3 style={{ marginBottom: 12, color: 'var(--rubric)' }}>{i18n.t('common.somethingWentWrong')}</h3>
          <p style={{ fontSize: 'var(--fs-quote)', marginBottom: 16 }}>
            {this.state.error?.message}
          </p>
          <button className="rpg-button" onClick={this.reset}>
            {i18n.t('common.tryAgain')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
