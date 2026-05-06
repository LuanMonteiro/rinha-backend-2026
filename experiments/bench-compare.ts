/**
 * Benchmark: S0 vs S3 vs S3b (optimized) search strategies
 */
import { readFileSync } from "fs";
import { join } from "path";
import { vectorize, quantize } from "../src/vectorizer";
import { knn5 } from "../src/searcher";
import { buildGrid } from "../src/grid";
import { knn5_s3 } from "../src/search-s3";
import { knn5_s3b } from "../src/search-s3b";
import type { TransactionPayload, LoadedDataset } from "../src/types";

function pct(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function fmt(ms: number): string {
  if (ms < 0.001) return (ms * 1e6).toFixed(0) + "ns";
  if (ms < 1) return (ms * 1000).toFixed(1) + "μs";
  return ms.toFixed(3) + "ms";
}
function loadFresh(): LoadedDataset {
  const buf = readFileSync(join(import.meta.dir, "..", "dataset.bin"));
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = view.getUint32(4, false);
  const np = view.getUint32(8, false);
  const ps = new Uint32Array(np), pc = new Uint32Array(np);
  for (let p = 0; p < np; p++) { ps[p] = view.getUint32(12 + p * 4, false); pc[p] = view.getUint32(12 + np * 4 + p * 4, false); }
  const hb = 12 + np * 8;
  const vectors = new Int16Array(buf.buffer, buf.byteOffset + hb, count * 14);
  const labels = new Uint8Array(buf.buffer, buf.byteOffset + hb + count * 14 * 2, count);
  return { vectors, labels, count, partitionStarts: ps, partitionCounts: pc, numPartitions: np };
}

async function main() {
  const payloads: TransactionPayload[] = JSON.parse(readFileSync(join(import.meta.dir, "..", "dataset", "example-payloads.json"), "utf-8"));
  const expected: { id: string; fraud_score: number }[] = JSON.parse(readFileSync(join(import.meta.dir, "..", "dataset", "expected-results.json"), "utf-8"));
  const fb = new Float64Array(14), ib = new Int16Array(14);
  const REPS = 200;

  // Helpers
  function correctness(searchFn: (q: Int16Array, ds: LoadedDataset, grid?: any) => number, ds: LoadedDataset, grid?: any): boolean {
    for (let i = 0; i < payloads.length; i++) {
      vectorize(payloads[i], fb); quantize(fb, ib);
      const f = grid ? searchFn(ib, ds, grid) : searchFn(ib, ds);
      if (f / 5 !== expected[i].fraud_score) { console.error(`  FAIL ${payloads[i].id}: got ${f/5} exp ${expected[i].fraud_score}`); return false; }
    }
    return true;
  }
  function bench(searchFn: (q: Int16Array, ds: LoadedDataset, grid?: any) => number, ds: LoadedDataset, grid?: any): number[] {
    // warmup
    for (let i = 0; i < 200; i++) { vectorize(payloads[i%50], fb); quantize(fb, ib); grid ? searchFn(ib, ds, grid) : searchFn(ib, ds); }
    const times: number[] = [];
    for (let r = 0; r < REPS; r++) for (let i = 0; i < payloads.length; i++) {
      vectorize(payloads[i], fb); quantize(fb, ib);
      const t0 = performance.now(); grid ? searchFn(ib, ds, grid) : searchFn(ib, ds); const t1 = performance.now();
      times.push(t1 - t0);
    }
    times.sort((a, b) => a - b);
    return times;
  }

  // S0
  console.log("=== S0 Baseline ===");
  const ds0 = loadFresh();
  console.log(`  Correctness: ${correctness(knn5, ds0) ? "PASS" : "FAIL"}`);
  const s0t = bench(knn5, ds0);
  console.log(`  p50: ${fmt(pct(s0t, 50))}, p95: ${fmt(pct(s0t, 95))}, p99: ${fmt(pct(s0t, 99))}, p999: ${fmt(pct(s0t, 99.9))}`);

  // S3
  console.log("\n=== S3 Grid+BBox ===");
  const ds3 = loadFresh();
  const g0 = performance.now();
  const grid = buildGrid(ds3);
  const g1 = performance.now();
  console.log(`  Grid built in ${(g1 - g0).toFixed(1)}ms`);
  console.log(`  Correctness: ${correctness(knn5_s3, ds3, grid) ? "PASS" : "FAIL"}`);
  const s3t = bench(knn5_s3, ds3, grid);
  console.log(`  p50: ${fmt(pct(s3t, 50))}, p95: ${fmt(pct(s3t, 95))}, p99: ${fmt(pct(s3t, 99))}, p999: ${fmt(pct(s3t, 99.9))}`);

  // S3b
  console.log("\n=== S3b Grid+BBox + constant-dim skip ===");
  const ds3b = loadFresh();
  const gb0 = performance.now();
  const gridB = buildGrid(ds3b);
  const gb1 = performance.now();
  console.log(`  Grid built in ${(gb1 - gb0).toFixed(1)}ms`);
  console.log(`  Correctness: ${correctness(knn5_s3b, ds3b, gridB) ? "PASS" : "FAIL"}`);
  const s3bt = bench(knn5_s3b, ds3b, gridB);
  console.log(`  p50: ${fmt(pct(s3bt, 50))}, p95: ${fmt(pct(s3bt, 95))}, p99: ${fmt(pct(s3bt, 99))}, p999: ${fmt(pct(s3bt, 99.9))}`);

  // Summary
  console.log("\n=== Summary ===");
  console.log(`  S0:  p50=${fmt(pct(s0t, 50))} p99=${fmt(pct(s0t, 99))}`);
  console.log(`  S3:  p50=${fmt(pct(s3t, 50))} p99=${fmt(pct(s3t, 99))} (${(pct(s0t,99)/pct(s3t,99)).toFixed(1)}x faster)`);
  console.log(`  S3b: p50=${fmt(pct(s3bt, 50))} p99=${fmt(pct(s3bt, 99))} (${(pct(s0t,99)/pct(s3bt,99)).toFixed(1)}x faster)`);
}

main();
