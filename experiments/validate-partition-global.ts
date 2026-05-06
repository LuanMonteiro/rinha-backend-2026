import { readFileSync } from "fs";
import { join } from "path";
import { loadDataset, computeQueryKey } from "../src/loader";
import { vectorize, quantize } from "../src/vectorizer";
import { knn5 } from "../src/searcher";
import { buildGrid, type GridIndex } from "../src/grid";
import { resolveStrategy, runStrategy, type SearchStrategy } from "../src/search/strategy-runner";
import { SENTINEL_INT16 } from "../src/config";
import type { LoadedDataset, TransactionPayload } from "../src/types";

type QueryCase = {
  id: string;
  query: Int16Array;
  source: "official" | "dataset";
};

type GlobalResult = {
  frauds: number;
  indices: [number, number, number, number, number];
  distances: [number, number, number, number, number];
};

function vectorKeyAt(ds: LoadedDataset, idx: number): number {
  const base = idx * 14;
  let key = 0;
  if (ds.vectors[base + 9] !== 0) key |= 1;
  if (ds.vectors[base + 10] !== 0) key |= 2;
  if (ds.vectors[base + 11] !== 0) key |= 4;
  if (ds.vectors[base + 5] === SENTINEL_INT16) key |= 8;
  if (ds.vectors[base + 6] === SENTINEL_INT16) key |= 16;
  return key;
}

function globalKnn5(query: Int16Array, ds: LoadedDataset): GlobalResult {
  const vectors = ds.vectors;
  const labels = ds.labels;

  const q0 = query[0], q1 = query[1], q2 = query[2], q3 = query[3];
  const q4 = query[4], q5 = query[5], q6 = query[6], q7 = query[7];
  const q8 = query[8], q9 = query[9], q10 = query[10], q11 = query[11];
  const q12 = query[12], q13 = query[13];

  let d0 = Infinity, d1 = Infinity, d2 = Infinity, d3 = Infinity, d4 = Infinity;
  let i0 = -1, i1 = -1, i2 = -1, i3 = -1, i4 = -1;

  for (let idx = 0; idx < ds.count; idx++) {
    const base = idx * 14;

    const dd0 = q0 - vectors[base];
    let dist = dd0 * dd0;
    if (dist >= d4) continue;

    const dd1 = q1 - vectors[base + 1]; dist += dd1 * dd1;
    if (dist >= d4) continue;
    const dd2 = q2 - vectors[base + 2]; dist += dd2 * dd2;
    if (dist >= d4) continue;
    const dd3 = q3 - vectors[base + 3]; dist += dd3 * dd3;
    if (dist >= d4) continue;
    const dd4 = q4 - vectors[base + 4]; dist += dd4 * dd4;
    if (dist >= d4) continue;
    const dd5 = q5 - vectors[base + 5]; dist += dd5 * dd5;
    if (dist >= d4) continue;
    const dd6 = q6 - vectors[base + 6]; dist += dd6 * dd6;
    if (dist >= d4) continue;
    const dd7 = q7 - vectors[base + 7]; dist += dd7 * dd7;
    if (dist >= d4) continue;
    const dd8 = q8 - vectors[base + 8]; dist += dd8 * dd8;
    if (dist >= d4) continue;
    const dd9 = q9 - vectors[base + 9]; dist += dd9 * dd9;
    if (dist >= d4) continue;
    const dd10 = q10 - vectors[base + 10]; dist += dd10 * dd10;
    if (dist >= d4) continue;
    const dd11 = q11 - vectors[base + 11]; dist += dd11 * dd11;
    if (dist >= d4) continue;
    const dd12 = q12 - vectors[base + 12]; dist += dd12 * dd12;
    if (dist >= d4) continue;
    const dd13 = q13 - vectors[base + 13]; dist += dd13 * dd13;

    if (dist < d0) {
      d4 = d3; i4 = i3;
      d3 = d2; i3 = i2;
      d2 = d1; i2 = i1;
      d1 = d0; i1 = i0;
      d0 = dist; i0 = idx;
    } else if (dist < d1) {
      d4 = d3; i4 = i3;
      d3 = d2; i3 = i2;
      d2 = d1; i2 = i1;
      d1 = dist; i1 = idx;
    } else if (dist < d2) {
      d4 = d3; i4 = i3;
      d3 = d2; i3 = i2;
      d2 = dist; i2 = idx;
    } else if (dist < d3) {
      d4 = d3; i4 = i3;
      d3 = dist; i3 = idx;
    } else {
      d4 = dist; i4 = idx;
    }
  }

  let frauds = 0;
  if (i0 >= 0 && labels[i0] === 1) frauds++;
  if (i1 >= 0 && labels[i1] === 1) frauds++;
  if (i2 >= 0 && labels[i2] === 1) frauds++;
  if (i3 >= 0 && labels[i3] === 1) frauds++;
  if (i4 >= 0 && labels[i4] === 1) frauds++;

  return {
    frauds,
    indices: [i0, i1, i2, i3, i4],
    distances: [d0, d1, d2, d3, d4],
  };
}

function loadOfficialQueries(): QueryCase[] {
  const payloads: TransactionPayload[] = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "dataset", "example-payloads.json"), "utf-8"),
  );
  const floatBuf = new Float64Array(14);
  const int16Buf = new Int16Array(14);

  return payloads.map((payload) => {
    vectorize(payload, floatBuf);
    quantize(floatBuf, int16Buf);
    return {
      id: payload.id,
      query: new Int16Array(int16Buf),
      source: "official",
    };
  });
}

function loadDatasetSampleQueries(ds: LoadedDataset, sampleSize: number): QueryCase[] {
  if (sampleSize <= 0) return [];

  const out: QueryCase[] = [];
  for (let i = 0; i < sampleSize; i++) {
    const idx = Math.floor((i * ds.count) / sampleSize);
    const base = idx * 14;
    const query = new Int16Array(14);
    for (let d = 0; d < 14; d++) query[d] = ds.vectors[base + d];
    out.push({ id: `dataset-${idx}`, query, source: "dataset" });
  }
  return out;
}

async function main() {
  const sampleSize = Number(process.env.SAMPLE_SIZE || 1000);
  const strategy: SearchStrategy = resolveStrategy(process.env.SEARCH_STRATEGY);

  const ds = loadDataset();
  let grid: GridIndex | null = null;
  if (strategy !== "S0") {
    const gridStart = performance.now();
    grid = buildGrid(ds);
    console.log(`Grid built for ${strategy} in ${(performance.now() - gridStart).toFixed(0)}ms`);
  }

  const official = loadOfficialQueries();
  const sampled = loadDatasetSampleQueries(ds, sampleSize);
  const queries = [...official, ...sampled];

  console.log(`Strategy: ${strategy}`);
  console.log(`Queries: official=${official.length}, sampled=${sampled.length}, total=${queries.length}`);

  let partitionKeyViolations = 0;
  let s0Divergences = 0;
  let strategyDivergences = 0;

  const violationExamples: string[] = [];
  const s0Examples: string[] = [];
  const strategyExamples: string[] = [];

  const start = performance.now();
  for (let i = 0; i < queries.length; i++) {
    const item = queries[i];
    const global = globalKnn5(item.query, ds);
    const partitionFrauds = knn5(item.query, ds);
    const strategyFrauds = runStrategy(strategy, item.query, ds, grid);
    const key = computeQueryKey(item.query);

    const allTopInPartition = global.indices.every((idx) => idx >= 0 && vectorKeyAt(ds, idx) === key);
    if (!allTopInPartition) {
      partitionKeyViolations++;
      if (violationExamples.length < 10) {
        violationExamples.push(
          `${item.id} (${item.source}) key=${key} globalTop=${global.indices.map((idx) => `${idx}:${vectorKeyAt(ds, idx)}`).join(",")}`,
        );
      }
    }

    if (global.frauds !== partitionFrauds) {
      s0Divergences++;
      if (s0Examples.length < 10) {
        s0Examples.push(
          `${item.id} (${item.source}) global=${global.frauds} partitionS0=${partitionFrauds} d=${global.distances.join(",")}`,
        );
      }
    }

    if (global.frauds !== strategyFrauds) {
      strategyDivergences++;
      if (strategyExamples.length < 10) {
        strategyExamples.push(
          `${item.id} (${item.source}) global=${global.frauds} strategy(${strategy})=${strategyFrauds} d=${global.distances.join(",")}`,
        );
      }
    }

    if ((i + 1) % 50 === 0 || i + 1 === queries.length) {
      const elapsed = ((performance.now() - start) / 1000).toFixed(1);
      console.log(`Processed ${i + 1}/${queries.length} in ${elapsed}s`);
    }
  }

  console.log("\n=== Global Validation Summary ===");
  console.log(`sampleSize=${sampleSize}`);
  console.log(`totalQueries=${queries.length}`);
  console.log(`partitionKeyViolations=${partitionKeyViolations}`);
  console.log(`partitionS0FraudDivergences=${s0Divergences}`);
  console.log(`strategyFraudDivergences=${strategyDivergences}`);

  if (violationExamples.length > 0) {
    console.log("\nPartition-key violation examples:");
    for (const line of violationExamples) console.log(`  - ${line}`);
  }

  if (s0Examples.length > 0) {
    console.log("\nPartition S0 divergence examples:");
    for (const line of s0Examples) console.log(`  - ${line}`);
  }

  if (strategyExamples.length > 0) {
    console.log(`\n${strategy} divergence examples:`);
    for (const line of strategyExamples) console.log(`  - ${line}`);
  }
}

main();
