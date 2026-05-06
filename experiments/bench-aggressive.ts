import { readFileSync } from "fs";
import { join } from "path";
import { loadDataset } from "../src/loader";
import { vectorize, quantize } from "../src/vectorizer";
import { buildGridV2 } from "../src/grid-v2";
import { knn5 } from "../src/search-prod";

async function main() {
  const ds = loadDataset();
  const dimBins = new Map<number, number>([[6, 8], [5, 8], [2, 4], [0, 4]]);
  
  const grid = buildGridV2(ds, dimBins);
  const payloads = JSON.parse(readFileSync(join(import.meta.dir, "..", "dataset", "example-payloads.json"), "utf-8"));
  const fb = new Float64Array(14), ib = new Int16Array(14);

  console.log("=== Microbenchmark: More Aggressive (8-bins) ===");
  
  // Warmup
  for (let i = 0; i < 1000; i++) {
    vectorize(payloads[i % payloads.length], fb); quantize(fb, ib);
    knn5(ib, ds, grid);
  }

  const REPS = 500;
  const times: number[] = [];
  for (let r = 0; r < REPS; r++) {
    for (let i = 0; i < payloads.length; i++) {
      vectorize(payloads[i], fb); quantize(fb, ib);
      const t0 = performance.now();
      knn5(ib, ds, grid);
      const t1 = performance.now();
      times.push(t1 - t0);
    }
  }

  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)];
  const p99 = times[Math.floor(times.length * 0.99)];
  
  console.log(`p50: ${(p50 * 1000).toFixed(1)}μs`);
  console.log(`p99: ${(p99 * 1000).toFixed(1)}μs`);
}

main();
