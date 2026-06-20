/**
 * Minimal typed event emitter. Used by the input layer and engine so modules
 * stay decoupled (touch + keyboard both emit the same input events, etc.).
 */
export type Handler<T> = (payload: T) => void;

export class Emitter<Events> {
  private map = new Map<keyof Events, Set<Handler<any>>>();

  on<K extends keyof Events>(type: K, fn: Handler<Events[K]>): () => void {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  off<K extends keyof Events>(type: K, fn: Handler<Events[K]>): void {
    this.map.get(type)?.delete(fn);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.map.get(type);
    if (!set) return;
    // copy to allow handlers to unsubscribe during dispatch
    for (const fn of [...set]) fn(payload);
  }

  clear(): void {
    this.map.clear();
  }
}
