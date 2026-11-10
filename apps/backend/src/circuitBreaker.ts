export class CircuitOpenError extends Error {
  constructor() {
    super('Cortacircuitos abierto: la dependencia no se está consultando');
  }
}

interface CircuitBreakerOptions {
  /** Fallos consecutivos que abren el circuito. */
  failureThreshold: number;
  /** Tiempo que permanece abierto antes de probar de nuevo. */
  openMs: number;
  now?: () => number;
  /** Permite ignorar los errores que no indican una caída de la dependencia. */
  isFailure?: (err: unknown) => boolean;
}

/** Tras varios fallos seguidos responde al instante en vez de esperar el tiempo límite de cada petición. */
export class CircuitBreaker {
  private failures = 0;
  private openUntil: number | null = null;
  private trialRunning = false;
  private readonly now: () => number;
  private readonly isFailure: (err: unknown) => boolean;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? Date.now;
    this.isFailure = options.isFailure ?? (() => true);
  }

  async run<T>(call: () => Promise<T>): Promise<T> {
    const isTrial = this.openUntil !== null;
    if (isTrial && (this.now() < this.openUntil! || this.trialRunning)) throw new CircuitOpenError();
    if (isTrial) this.trialRunning = true;
    try {
      const result = await call();
      this.failures = 0;
      this.openUntil = null;
      return result;
    } catch (err) {
      if (this.isFailure(err) && ++this.failures >= this.options.failureThreshold) this.openUntil = this.now() + this.options.openMs;
      throw err;
    } finally {
      if (isTrial) this.trialRunning = false;
    }
  }
}
