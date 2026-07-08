export async function poolAll<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
  label = 'poolAll',
): Promise<void> {
  let i = 0
  async function worker(): Promise<void> {
    while (i < items.length) {
      const idx = i++
      // Per-item failures must not abort the pool, but they should not vanish
      // either — log so intermittent failures across the batch are observable.
      await fn(items[idx]).catch((err) => {
        console.warn(`[${label}] item ${idx} failed:`, err)
      })
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker)
  await Promise.all(workers)
}
