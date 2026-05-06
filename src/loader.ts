import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { MAGIC, SENTINEL_INT16 } from "./config";

export interface LoadedDataset {
  vectors: Int16Array;
  labels: Uint8Array;
  count: number;
  partitionStarts: Uint32Array;
  partitionCounts: Uint32Array;
  numPartitions: number;
}

let dataset: LoadedDataset | null = null;

export function loadDataset(): LoadedDataset {
  if (dataset) return dataset;

  const start = performance.now();
  const binPath = join(import.meta.dir, "..", "dataset.bin");

  if (!existsSync(binPath))
    return null as any;

  const buf = readFileSync(binPath);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // Validate magic
  const magic = view.getUint32(0, false);
  if (magic !== MAGIC) {
    throw new Error(`Invalid dataset magic: 0x${magic.toString(16)}`);
  }

  const count = view.getUint32(4, false);
  const numPartitions = view.getUint32(8, false);

  // Read partition metadata
  const partitionStarts = new Uint32Array(numPartitions);
  const partitionCounts = new Uint32Array(numPartitions);
  for (let p = 0; p < numPartitions; p++) {
    partitionStarts[p] = view.getUint32(12 + p * 4, false);
    partitionCounts[p] = view.getUint32(12 + numPartitions * 4 + p * 4, false);
  }

  const headerBytes = 12 + numPartitions * 8;
  const vectorBytes = count * 14 * 2;

  const vectors = new Int16Array(buf.buffer, buf.byteOffset + headerBytes, count * 14);
  const labels = new Uint8Array(buf.buffer, buf.byteOffset + headerBytes + vectorBytes, count);

  dataset = { vectors, labels, count, partitionStarts, partitionCounts, numPartitions };

  const elapsed = (performance.now() - start).toFixed(1);
  console.log(`Dataset loaded: ${count.toLocaleString()} vectors, ${numPartitions} partitions in ${elapsed}ms`);

  return dataset;
}

/**
 * Compute partition key from a quantized query vector.
 */
export function computeQueryKey(query: Int16Array): number {
  let key = 0;
  if (query[9] !== 0) key |= 1;
  if (query[10] !== 0) key |= 2;
  if (query[11] !== 0) key |= 4;
  if (query[5] === SENTINEL_INT16) key |= 8;
  if (query[6] === SENTINEL_INT16) key |= 16;
  return key;
}
