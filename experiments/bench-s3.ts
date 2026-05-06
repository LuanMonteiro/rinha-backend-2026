/**
 * Benchmark: S0 (baseline) vs S3 (grid+bbox) search strategies
 * Tests correctness and measures performance.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { loadDataset, computeQueryKey } from "../src/loader";
import { vectorize, quantize } from "../src/vectorizer";
import { knn5 } from "../src/searcher";
import { buildGrid } from "../src/grid";
import { knn5_s3 } from "../src/search-s3";
import type { TransactionPayload, LoadedDataset } from "../src/types";
import type { GridIndex } from "../src/grid";
import { KNN_K, SENTINEL_INT16 } from "../src/config";

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function fmtUs(ms: number): string {
  if (ms < 0.001) return (ms * 1e6).toFixed(0) + "ns";
  if (ms < 1) return (ms * 1000).toFixed(1) + "μs";
  return ms.toFixed(3) + "ms";
}

async function main() {
  // === Phase 1: S0 Correctness ===
  console.log("=== S0 Baseline ===\n");

  // Load FRESH dataset for S0 (grid reorder hasn't happened yet)
  // Force reload by clearing the module cache
  const ds0 = loadDataset();
  const payloads: TransactionPayload[] = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "dataset", "example-payloads.json"), "utf-8")
  );
  const expected: { id: string; approved: boolean; fraud_score: number }[] = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "dataset", "expected-results.json"), "utf-8")
  );

  const floatBuf = new Float64Array(14);
  const int16Buf = new Int16Array(14);
  let s0Fails = 0;

  console.log("S0 Correctness...");
  for (let i = 0; i < payloads.length; i++) {
    vectorize(payloads[i], floatBuf);
    quantize(floatBuf, int16Buf);
    const frauds = knn5(int16Buf, ds0);
    if (frauds / 5 !== expected[i].fraud_score) {
      console.error(`  S0 MISMATCH ${payloads[i].id}: got ${frauds / 5}, expected ${expected[i].fraud_score}`);
      s0Fails++;
    }
  }
  console.log(`  ${s0Fails === 0 ? "ALL PASS" : `${s0Fails} FAILURES`}`);

  // S0 Benchmark
  console.log("\nS0 Benchmark...");
  // Warmup
  for (let i = 0; i < 200; i++) {
    vectorize(payloads[i % 50], floatBuf);
    quantize(floatBuf, int16Buf);
    knn5(int16Buf, ds0);
  }

  const REPS = 100;
  const s0Times: number[] = [];
  for (let rep = 0; rep < REPS; rep++) {
    for (let i = 0; i < payloads.length; i++) {
      vectorize(payloads[i], floatBuf);
      quantize(floatBuf, int16Buf);
      const t0 = performance.now();
      knn5(int16Buf, ds0);
      const t1 = performance.now();
      s0Times.push(t1 - t0);
    }
  }
  s0Times.sort((a, b) => a - b);
  console.log(`  p50: ${fmtUs(percentile(s0Times, 50))}, p99: ${fmtUs(percentile(s0Times, 99))}, p999: ${fmtUs(percentile(s0Times, 99.9))}`);

  // === Phase 2: S3 Grid Build + Correctness ===
  console.log("\n=== S3 Grid+BBox ===\n");

  // Reload dataset fresh (S0 test already used it, grid will modify it in-place)
  // Clear the cached dataset to force reload
  // @ts-ignore - accessing private module state
  const dsMod = await import("../src/loader.ts?t=" + Date.now());

  // Actually, the dataset is cached in module scope. Let me just reload manually.
  // For the benchmark, we need a FRESH dataset for S3 (since grid reorder is in-place)
  // Let's read dataset.bin again directly
  const buf = readFileSync(join(import.meta.dir, "..", "dataset.bin"));
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = view.getUint32(4, false);
  const numPartitions = view.getUint32(8, false);
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
  const ds3: LoadedDataset = { vectors, labels, count, partitionStarts, partitionCounts, numPartitions };

  console.log("Building grid index...");
  const gridStart = performance.now();
  const grid = buildGrid(ds3);
  const gridTime = performance.now() - gridStart;
  console.log(`  Built in ${gridTime.toFixed(0)}ms`);

  // Grid stats
  let totalCells = 0;
  for (let p = 0; p < 32; p++) {
    const pg = grid.partitions[p];
    if (!pg) continue;
    totalCells += pg.numCells;
    const maxCell = pg.cellCounts.reduce((a, b) => Math.max(a, b), 0);
    const avgCell = partitionCounts[p] / pg.numCells;
    if (partitionCounts[p] > 50000) {
      console.log(`  #${p} (${partitionCounts[p]?.toLocaleString()} vec, ${pg.numCells} cells): max=${maxCell}, avg=${avgCell.toFixed(0)}`);
    }
  }
  console.log(`  Total cells: ${totalCells}`);

  // S3 Correctness
  console.log("\nS3 Correctness...");
  let s3Fails = 0;
  for (let i = 0; i < payloads.length; i++) {
    vectorize(payloads[i], floatBuf);
    quantize(floatBuf, int16Buf);
    const frauds = knn5_s3(int16Buf, ds3, grid);
    if (frauds / 5 !== expected[i].fraud_score) {
      console.error(`  S3 MISMATCH ${payloads[i].id}: got ${frauds / 5}, expected ${expected[i].fraud_score}`);
      s3Fails++;
    }
  }
  console.log(`  ${s3Fails === 0 ? "ALL PASS" : `${s3Fails} FAILURES`}`);

  if (s3Fails > 0) {
    console.log("\nS3 correctness failed — aborting benchmark.");
    return;
  }

  // S3 Benchmark
  console.log("\nS3 Benchmark...");
  // Warmup
  for (let i = 0; i < 200; i++) {
    vectorize(payloads[i % 50], floatBuf);
    quantize(floatBuf, int16Buf);
    knn5_s3(int16Buf, ds3, grid);
  }

  const s3Times: number[] = [];
  const vecsSearched: number[] = [];
  const perPartTimes = new Map<number, number[]>();
  const perPartVecs = new Map<number, number[]>();

  for (let rep = 0; rep < REPS; rep++) {
    for (let i = 0; i < payloads.length; i++) {
      vectorize(payloads[i], floatBuf);
      quantize(floatBuf, int16Buf);
      const key = computeQueryKey(int16Buf);

      const t0 = performance.now();
      const frauds = knn5_s3(int16Buf, ds3, grid);
      const t1 = performance.now();

      s3Times.push(t1 - t0);

      if (!perPartTimes.has(key)) { perPartTimes.set(key, []); }
      perPartTimes.get(key)!.push(t1 - t0);
    }
  }

  s3Times.sort((a, b) => a - b);
  console.log(`  p50: ${fmtUs(percentile(s3Times, 50))}, p99: ${fmtUs(percentile(s3Times, 99))}, p999: ${fmtUs(percentile(s3Times, 99.9))}`);

  console.log("\nPer-partition (S3):");
  for (const [key, times] of [...perPartTimes.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const sorted = [...times].sort((a, b) => a - b);
    const p50 = percentile(sorted, 50);
    const p99 = percentile(sorted, 99);
    const pCount = partitionCounts[key];
    const numCells = grid.partitions[key]?.numCells || 0;
    console.log(`  #${key} (${pCount?.toLocaleString()} vec, ${numCells} cells, ${sorted.length} queries): p50=${fmtUs(p50)} p99=${fmtUs(p99)}`);
  }

  // === Summary ===
  console.log("\n=== Comparison ===");
  console.log(`  S0 p50: ${fmtUs(percentile(s0Times, 50))}, p99: ${fmtUs(percentile(s0Times, 99))}`);
  console.log(`  S3 p50: ${fmtUs(percentile(s3Times, 50))}, p99: ${fmtUs(percentile(s3Times, 99))}`);
  const speedup50 = percentile(s0Times, 50) / percentile(s3Times, 50);
  const speedup99 = percentile(s0Times, 99) / percentile(s3Times, 99);
  console.log(`  Speedup p50: ${speedup50.toFixed(1)}x, p99: ${speedup99.toFixed(1)}x`);
}

main();
