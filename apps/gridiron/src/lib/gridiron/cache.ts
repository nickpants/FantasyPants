type Entry<T> = { value: T; exp: number };

const store = new Map<string, Entry<unknown>>();

export function cacheGet<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.exp > 0 && Date.now() > hit.exp) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number) {
  store.set(key, { value, exp: ttlMs <= 0 ? 0 : Date.now() + ttlMs });
}

export function cacheDel(key: string) {
  store.delete(key);
}

export async function cacheGetOrSet<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const cached = cacheGet<T>(key);
  if (cached !== undefined) return cached;
  const value = await load();
  cacheSet(key, value, ttlMs);
  return value;
}
