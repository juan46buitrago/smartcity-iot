import { RefreshCw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Nodo } from './Nodo';
import { Button } from './ui';

interface BoundaryProps {
  children: ReactNode;
  /** Al cambiar este valor (la ruta), la vista vuelve a intentarse. */
  resetKey?: string;
}

/**
 * Última barrera ante un fallo de render: en lugar de dejar la página en blanco, explica qué pasó y ofrece salida.
 * No usa contextos de la aplicación porque también envuelve a sus proveedores.
 */
export class ErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Fallo de interfaz', error, info.componentStack);
  }

  override componentDidUpdate(prev: BoundaryProps) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
        <Nodo mood="alert" size={72} bounce={false} />
        <h1 className="text-[20px] leading-snug font-semibold">Esta pantalla no se pudo mostrar</h1>
        <p className="text-sm text-ink-2">El servidor envió datos incompletos o hubo un error en la página. Tus datos y los dispositivos no se vieron afectados.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={() => window.location.reload()}>
            <RefreshCw className="size-4" aria-hidden />
            Recargar la página
          </Button>
          <Button variant="secondary" onClick={() => window.location.assign('/')}>
            Ir al panel
          </Button>
        </div>
      </div>
    );
  }
}

/** Contiene el fallo en la vista actual: la navegación sigue disponible y cambiar de ruta la reintenta. */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
}
