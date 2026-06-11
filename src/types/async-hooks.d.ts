// Minimal declaration for the Workers runtime's AsyncLocalStorage
// (enabled via the nodejs_als compatibility flag) — @cloudflare/workers-types
// doesn't ship Node module declarations.
declare module 'node:async_hooks' {
  export class AsyncLocalStorage<T> {
    getStore(): T | undefined
    run<R>(store: T, callback: () => R): R
  }
}
