/**
 * Benchmark script — Parts A (search), B (HTTP)
 */
import { readFileSync } from "fs";
import { join } from "path";
import { loadDataset } from "../src/loader";
import { vectorize, quantize } from "../src/vectorizer";
import { fastVectorize } from "../src/fast-json";
import { buildGridV2 as buildGrid, type GridIndexV2 as GridIndex } from "../src/grid-v2";
import { resolveStrategy, runStrategy, type SearchStrategy } from "../src/search/strategy-runner";
import type { TransactionPayload } from "../src/types";

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const PREBUILT_STRINGS = [
  '{"approved":true,"fraud_score":0}',
  '{"approved":true,"fraud_score":0.2}',
  '{"approved":true,"fraud_score":0.4}',
  '{"approved":false,"fraud_score":0.6}',
  '{"approved":false,"fraud_score":0.8}',
  '{"approved":false,"fraud_score":1}',
];

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    p999: percentile(sorted, 99.9),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  };
}

function fmtMs(ms: number): string {
  if (ms < 1) return (ms * 1000).toFixed(1) + "μs";
  return ms.toFixed(3) + "ms";
}

async function main() {
  const datasetDir = join(import.meta.dir, "..", "dataset");
  const payloads: TransactionPayload[] = JSON.parse(
    readFileSync(join(datasetDir, "example-payloads.json"), "utf-8")
  );
  console.log(`Loaded ${payloads.length} example payloads`);

  const ds = loadDataset();

  const strategy: SearchStrategy = resolveStrategy(process.env.SEARCH_STRATEGY);
  let grid: GridIndex | null = null;
  console.log(`Search strategy: ${strategy}`);

  if (strategy !== "S0") {
    const gridStart = performance.now();
    const dimBins = new Map<number, number>();
    dimBins.set(0, 4);
    dimBins.set(1, 4);
    dimBins.set(2, 4);
    grid = buildGrid(ds, dimBins);
    console.log(`Grid built in ${(performance.now() - gridStart).toFixed(0)}ms`);
  }
  // Log partition distribution
  console.log("\nPartition distribution:");
  for (let p = 0; p < ds.numPartitions; p++) {
    if (ds.partitionCounts[p] > 0) {
      console.log(`  #${p}: ${ds.partitionCounts[p].toLocaleString()} vectors`);
    }
  }

  // Part A: Search-only benchmark
  console.log("\n=== Part A: Search-only benchmark ===");
  const SEARCH_REPS = 200;
  const totalSearches = payloads.length * SEARCH_REPS;
  const searchTimes: number[] = [];
  const vecTimes: number[] = [];

  const floatBuf = new Float64Array(14);
  const int16Buf = new Int16Array(14);

  // Warmup
  for (let i = 0; i < 50; i++) {
    vectorize(payloads[i % payloads.length], floatBuf);
    quantize(floatBuf, int16Buf);
    runStrategy(strategy, int16Buf, ds, grid);
  }

  console.log(`Running ${totalSearches.toLocaleString()} searches...`);

  for (let rep = 0; rep < SEARCH_REPS; rep++) {
    for (let p = 0; p < payloads.length; p++) {
      const t0 = performance.now();
      vectorize(payloads[p], floatBuf);
      quantize(floatBuf, int16Buf);
      const t1 = performance.now();
      runStrategy(strategy, int16Buf, ds, grid);
      const t2 = performance.now();

      vecTimes.push(t1 - t0);
      searchTimes.push(t2 - t1);
    }
  }

  const searchStats = stats(searchTimes);
  const vecStats = stats(vecTimes);
  const totalTimes = searchTimes.map((s, i) => s + vecTimes[i]);
  const totalStats = stats(totalTimes);

  console.log("\n--- Vectorization ---");
  console.log(`  p50: ${fmtMs(vecStats.p50)}, p95: ${fmtMs(vecStats.p95)}, p99: ${fmtMs(vecStats.p99)}`);

  console.log("\n--- KNN-5 Search ---");
  console.log(`  p50: ${fmtMs(searchStats.p50)}, p95: ${fmtMs(searchStats.p95)}, p99: ${fmtMs(searchStats.p99)}, p999: ${fmtMs(searchStats.p999)}`);

  console.log("\n--- Total (vectorize + search) ---");
  console.log(`  p50: ${fmtMs(totalStats.p50)}, p95: ${fmtMs(totalStats.p95)}, p99: ${fmtMs(totalStats.p99)}, p999: ${fmtMs(totalStats.p999)}`);

  const totalSec = totalTimes.reduce((a, b) => a + b, 0) / 1000;
  console.log(`  ops/sec: ${(totalSearches / totalSec).toFixed(0)}`);

  // Part B: HTTP benchmark
  console.log("\n=== Part B: HTTP benchmark ===");

  const { FRAUD_THRESHOLD } = await import("../src/config");
  const floatBuf2 = new Float64Array(14);
  const int16Buf2 = new Int16Array(14);

  const apiServer = Bun.serve({
    port: 9996,
    async fetch(req) {
      const body = await req.arrayBuffer();
      const buf = new Uint8Array(body);
      fastVectorize(buf, floatBuf2);
      quantize(floatBuf2, int16Buf2);
      const fraudCount = runStrategy(strategy, int16Buf2, ds, grid);
      const resStr = PREBUILT_STRINGS[fraudCount];
      return new Response(resStr, { headers: { "Content-Type": "application/json" } });
    },
  });

  const apiUrl = `http://localhost:${apiServer.port}`;

  // Warmup
  for (let i = 0; i < 20; i++) {
    await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloads[i % payloads.length]),
    });
  }

  const HTTP_REPS = 5000;
  const httpTimes: number[] = [];
  let httpErrors = 0;

  console.log(`Running ${HTTP_REPS} HTTP requests...`);
  for (let i = 0; i < HTTP_REPS; i++) {
    const body = JSON.stringify(payloads[i % payloads.length]);
    const t0 = performance.now();
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const t1 = performance.now();
    if (!res.ok) httpErrors++;
    await res.text();
    httpTimes.push(t1 - t0);
  }

  const httpStats = stats(httpTimes);
  console.log("\n--- HTTP Latency ---");
  console.log(`  p50: ${fmtMs(httpStats.p50)}, p95: ${fmtMs(httpStats.p95)}, p99: ${fmtMs(httpStats.p99)}, p999: ${fmtMs(httpStats.p999)}`);
  const httpSec = httpTimes.reduce((a, b) => a + b, 0) / 1000;
  console.log(`  req/s: ${(HTTP_REPS / httpSec).toFixed(0)}`);
  console.log(`  errors: ${httpErrors}`);

  apiServer.stop();

  console.log(`\nMemory: ${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)} MB RSS`);
}

main();
