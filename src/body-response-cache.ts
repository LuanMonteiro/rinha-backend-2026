type CacheEntry = {
  bytes: Uint8Array;
  responseBody: string;
};

export class BodyResponseCache {
  private readonly buckets = new Map<number, CacheEntry[]>();
  private readonly order: Array<{ hash: number; entry: CacheEntry }> = [];

  constructor(private readonly maxEntries: number) {
    if (!Number.isInteger(maxEntries) || maxEntries < 0) {
      throw new Error(`invalid maxEntries=${maxEntries}`);
    }
  }

  get(body: Uint8Array): string | undefined {
    const hash = hashBody(body);
    const bucket = this.buckets.get(hash);
    if (!bucket) return undefined;

    for (const entry of bucket) {
      if (bytesEqual(body, entry.bytes)) return entry.responseBody;
    }

    return undefined;
  }

  set(body: Uint8Array, responseBody: string): void {
    if (this.maxEntries === 0) return;

    const hash = hashBody(body);
    let bucket = this.buckets.get(hash);
    if (!bucket) {
      bucket = [];
      this.buckets.set(hash, bucket);
    }

    for (const entry of bucket) {
      if (bytesEqual(body, entry.bytes)) {
        entry.responseBody = responseBody;
        return;
      }
    }

    const copy = new Uint8Array(body.length);
    copy.set(body);
    const entry = { bytes: copy, responseBody };
    bucket.push(entry);
    this.order.push({ hash, entry });

    while (this.order.length > this.maxEntries) {
      const evicted = this.order.shift()!;
      const evictedBucket = this.buckets.get(evicted.hash);
      if (!evictedBucket) continue;
      const idx = evictedBucket.indexOf(evicted.entry);
      if (idx !== -1) evictedBucket.splice(idx, 1);
      if (evictedBucket.length === 0) this.buckets.delete(evicted.hash);
    }
  }

  size(): number {
    return this.order.length;
  }
}

export function hashBody(body: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    hash ^= body[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
