/** 1s, 2s, 4s ... capped at 30s. */
export function backoffDelay(attempt: number, base = 1000, max = 30000): number {
  return Math.min(max, base * 2 ** attempt);
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
}
