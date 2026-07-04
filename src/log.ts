// Prefixed console logging. Never throws (old TV consoles can be flaky).

export function log(...args: unknown[]): void {
  try {
    console.log.apply(console, ['[MyShows]', ...args])
  } catch {
    /* noop */
  }
}
