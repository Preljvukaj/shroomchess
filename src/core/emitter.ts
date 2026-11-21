/** Minimaler typisierter Event-Emitter ohne Abhängigkeiten. */
export class Emitter<E extends object> {
  private handlers: { [K in keyof E]?: Set<(payload: E[K]) => void> } = {};

  on<K extends keyof E>(event: K, fn: (payload: E[K]) => void): () => void {
    (this.handlers[event] ??= new Set()).add(fn);
    return () => this.handlers[event]?.delete(fn);
  }

  protected emit<K extends keyof E>(event: K, payload: E[K]): void {
    this.handlers[event]?.forEach((fn) => fn(payload));
  }
}
