/**
 * S3 Prototype v2: Efficient grid + bbox pruning
 * Single-pass cell assignment, proper sentinel handling.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { loadDataset, computeQueryKey } from "../src/loader";
import { vectorize, quantize } from "../src/vectorizer";
import type { TransactionPayload, LoadedDataset } from "../src/types";
import { KNN_K, SENTINEL_INT16 } from "../src/config";

const K = KNN_K;
const DIMS = 14;

// Grid dims: use all dims EXCEPT the partition-key dims (9,10,11) which are constant within partition
// For sentinel partitions (5,6 are -32000), exclude those too
const GRID_DIMS_NON_SENTINEL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 13]; // 11 dims
const GRID_DIMS_SENTINEL = [0, 1, 2, 3, 4, 7, 8, 12, 13]; // 9 dims (excl 5,6)

interface Cell {
  count: number;
  indices: number[]; // global vector indices
  bboxMin: Int16Array;
  bboxMax: Int16Array;
}

interface PartitionGrid {
  cells: Cell[];
  gridDims: number[];
  boundaries: Float64Array;
}

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99), p999: percentile(sorted, 99.9) };
}

function fmtUs(ms: number): string {
  if (ms < 0.001) return (ms * 1000000).toFixed(0) + "ns";
  if (ms < 1) return (ms * 1000).toFixed(1) + "μs";
  return ms.toFixed(3) + "ms";
}

function isSentinelPartition(key: number): boolean {
  // Check if bit 3 or 4 is set (sentinel dims)
  return (key & 0x18) !== 0;
  // Actually: bit 3 = dim5 sentinel, bit 4 = dim6 sentinel
  // If either is set, at least one of dims 5,6 is sentinel
  // For partitions where BOTH are sentinel (key & 0x18 == 0x18), both dims are constant
  // For partitions where neither is sentinel (key & 0x18 == 0), both dims vary
  // For mixed (one sentinel, one not) — shouldn't happen per our vectorizer
}

function buildGrid(ds: LoadedDataset): Map<number, PartitionGrid> {
  const grids = new Map<number, PartitionGrid>();
  const vectors = ds.vectors;

  for (let p = 0; p < ds.numPartitions; p++) {
    const pStart = ds.partitionStarts[p];
    const pCount = ds.partitionCounts[p];
    if (pCount === 0) continue;

    const hasSentinel = (p & 0x18) !== 0; // bits 3 or 4 set
    const gridDims = hasSentinel ? GRID_DIMS_SENTINEL : GRID_DIMS_NON_SENTINEL;
    const numGridDims = gridDims.length;
    const maxCells = 1 << numGridDims;

    // Single pass: compute median and assign to cells
    // First: collect values per grid dim for median
    const dimValues: number[][] = Array.from({ length: numGridDims }, () => []);
    for (let j = 0; j < pCount; j++) {
      const base = (pStart + j) * DIMS;
      for (let gi = 0; gi < numGridDims; gi++) {
        dimValues[gi].push(vectors[base + gridDims[gi]]);
      }
    }
    
    const boundaries = new Float64Array(numGridDims);
    for (let gi = 0; gi < numGridDims; gi++) {
      dimValues[gi].sort((a, b) => a - b);
      boundaries[gi] = dimValues[gi][Math.floor(dimValues[gi].length / 2)];
    }

    // Single pass: assign each vector to a cell
    const cellMap = new Map<number, { indices: number[]; bboxMin: Int16Array; bboxMax: Int16Array }>();
    
    for (let j = 0; j < pCount; j++) {
      const globalIdx = pStart + j;
      const base = globalIdx * DIMS;
      
      let cellKey = 0;
      for (let gi = 0; gi < numGridDims; gi++) {
        if (vectors[base + gridDims[gi]] > boundaries[gi]) {
          cellKey |= (1 << gi);
        }
      }
      
      if (!cellMap.has(cellKey)) {
        cellMap.set(cellKey, {
          indices: [],
          bboxMin: new Int16Array(DIMS).fill(32767),
          bboxMax: new Int16Array(DIMS).fill(-32768),
        });
      }
      
      const cell = cellMap.get(cellKey)!;
      cell.indices.push(globalIdx);
      
      for (let d = 0; d < DIMS; d++) {
        const v = vectors[base + d];
        if (v < cell.bboxMin[d]) cell.bboxMin[d] = v;
        if (v > cell.bboxMax[d]) cell.bboxMax[d] = v;
      }
    }

    // Convert to Cell array
    const cells: Cell[] = [];
    for (const [, entry] of cellMap) {
      cells.push({
        count: entry.indices.length,
        indices: entry.indices,
        bboxMin: entry.bboxMin,
        bboxMax: entry.bboxMax,
      });
    }

    grids.set(p, { cells, gridDims, boundaries });
  }

  return grids;
}

function knn5_grid(
  query: Int16Array,
  ds: LoadedDataset,
  grid: PartitionGrid,
): { fraudCount: number; vecsSearched: number } {
  const key = computeQueryKey(query);
  const pStart = ds.partitionStarts[key];
  const pCount = ds.partitionCounts[key];
  if (pCount === 0) return { fraudCount: 0, vecsSearched: 0 };

  const vectors = ds.vectors;
  const labels = ds.labels;
  const cells = grid.cells;

  const q = new Int16Array(DIMS);
  for (let d = 0; d < DIMS; d++) q[d] = query[d];

  let topD0 = Infinity, topD1 = Infinity, topD2 = Infinity, topD3 = Infinity, topD4 = Infinity;
  let topI0 = -1, topI1 = -1, topI2 = -1, topI3 = -1, topI4 = -1;

  // Compute lb for each cell, sort, search in order
  const cellLBs: { ci: number; lb: number }[] = [];
  for (let ci = 0; ci < cells.length; ci++) {
    const min = cells[ci].bboxMin;
    const max = cells[ci].bboxMax;
    let lb = 0;
    for (let d = 0; d < DIMS; d++) {
      if (q[d] < min[d]) { const dd = q[d] - min[d]; lb += dd * dd; }
      else if (q[d] > max[d]) { const dd = q[d] - max[d]; lb += dd * dd; }
    }
    cellLBs.push({ ci, lb });
  }
  
  cellLBs.sort((a, b) => a.lb - b.lb);

  let vecsSearched = 0;

  for (const { ci, lb } of cellLBs) {
    if (lb >= topD4) break;

    const cell = cells[ci];
    vecsSearched += cell.count;

    for (let j = 0; j < cell.count; j++) {
      const i = cell.indices[j];
      const base = i * DIMS;

      const d0 = q[0] - vectors[base]; const d1 = q[1] - vectors[base+1];
      const d2 = q[2] - vectors[base+2]; const d3 = q[3] - vectors[base+3];
      const d4 = q[4] - vectors[base+4]; const d5 = q[5] - vectors[base+5];
      const d6 = q[6] - vectors[base+6]; const d7 = q[7] - vectors[base+7];
      const d8 = q[8] - vectors[base+8]; const d9 = q[9] - vectors[base+9];
      const d10 = q[10] - vectors[base+10]; const d11 = q[11] - vectors[base+11];
      const d12 = q[12] - vectors[base+12]; const d13 = q[13] - vectors[base+13];

      const dist = d0*d0 + d1*d1 + d2*d2 + d3*d3 + d4*d4 + d5*d5 + d6*d6 + d7*d7
                 + d8*d8 + d9*d9 + d10*d10 + d11*d11 + d12*d12 + d13*d13;

      if (dist < topD4) {
        if (dist < topD0) { topD4=topD3;topI4=topI3;topD3=topD2;topI3=topI2;topD2=topD1;topI2=topI1;topD1=topD0;topI1=topI0;topD0=dist;topI0=i; }
        else if (dist < topD1) { topD4=topD3;topI4=topI3;topD3=topD2;topI3=topI2;topD2=topD1;topI2=topI1;topD1=dist;topI1=i; }
        else if (dist < topD2) { topD4=topD3;topI4=topI3;topD3=topD2;topI3=topI2;topD2=dist;topI2=i; }
        else if (dist < topD3) { topD4=topD3;topI4=topI3;topD3=dist;topI3=i; }
        else { topD4=dist;topI4=i; }
      }
    }
  }

  let frauds = 0;
  if (topI0 >= 0 && labels[topI0] === 1) frauds++;
  if (topI1 >= 0 && labels[topI1] === 1) frauds++;
  if (topI2 >= 0 && labels[topI2] === 1) frauds++;
  if (topI3 >= 0 && labels[topI3] === 1) frauds++;
  if (topI4 >= 0 && labels[topI4] === 1) frauds++;
  return { fraudCount: frauds, vecsSearched };
}

async function main() {
  const ds = loadDataset();
  const payloads: TransactionPayload[] = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "dataset", "example-payloads.json"), "utf-8")
  );
  const expected: { id: string; approved: boolean; fraud_score: number }[] = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "dataset", "expected-results.json"), "utf-8")
  );

  console.log("Building grid index...");
  const buildStart = performance.now();
  const grids = buildGrid(ds);
  const buildTime = performance.now() - buildStart;
  console.log(`  Built in ${buildTime.toFixed(0)}ms`);

  let totalCells = 0;
  for (const [p, grid] of grids) {
    const pCount = ds.partitionCounts[p];
    const maxCell = grid.cells.reduce((a, b) => a.count > b.count ? a : b);
    const minCell = grid.cells.reduce((a, b) => a.count < b.count ? a : b);
    console.log(`  #${p} (${pCount?.toLocaleString()} vec, ${grid.cells.length} cells, ${grid.gridDims.length} grid dims): max=${maxCell.count} min=${minCell.count}`);
    totalCells += grid.cells.length;
  }
  console.log(`  Total cells: ${totalCells}`);

  // Correctness test
  console.log("\n=== Correctness Test ===");
  const floatBuf = new Float64Array(14);
  const int16Buf = new Int16Array(14);
  let failures = 0;

  for (let i = 0; i < payloads.length; i++) {
    vectorize(payloads[i], floatBuf);
    quantize(floatBuf, int16Buf);
    const key = computeQueryKey(int16Buf);
    const grid = grids.get(key);
    if (!grid) { console.error(`No grid for #${key}`); failures++; continue; }
    const { fraudCount } = knn5_grid(int16Buf, ds, grid);
    if (fraudCount / 5 !== expected[i].fraud_score) {
      console.error(`MISMATCH ${payloads[i].id}: got ${fraudCount / 5}, expected ${expected[i].fraud_score}`);
      failures++;
    }
  }
  console.log(`Result: ${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`}`);

  if (failures > 0) { console.log("Cannot proceed."); return; }

  // Benchmark
  console.log("\n=== Benchmark ===");
  for (let i = 0; i < 100; i++) {
    vectorize(payloads[i % 50], floatBuf);
    quantize(floatBuf, int16Buf);
    const key = computeQueryKey(int16Buf);
    knn5_grid(int16Buf, ds, grids.get(key)!);
  }

  const REPS = 200;
  const searchTimes: number[] = [];
  const vecsSearched: number[] = [];
  const perPartTimes = new Map<number, number[]>();
  const perPartVecs = new Map<number, number[]>();

  for (let rep = 0; rep < REPS; rep++) {
    for (let i = 0; i < payloads.length; i++) {
      vectorize(payloads[i], floatBuf);
      quantize(floatBuf, int16Buf);
      const key = computeQueryKey(int16Buf);
      const grid = grids.get(key)!;

      const t0 = performance.now();
      const result = knn5_grid(int16Buf, ds, grid);
      const t1 = performance.now();

      searchTimes.push(t1 - t0);
      vecsSearched.push(result.vecsSearched);
      
      if (!perPartTimes.has(key)) { perPartTimes.set(key, []); perPartVecs.set(key, []); }
      perPartTimes.get(key)!.push(t1 - t0);
      perPartVecs.get(key)!.push(result.vecsSearched);
    }
  }

  const s = stats(searchTimes);
  console.log(`Search times (${searchTimes.length} queries):`);
  console.log(`  p50: ${fmtUs(s.p50)}, p95: ${fmtUs(s.p95)}, p99: ${fmtUs(s.p99)}, p999: ${fmtUs(s.p999)}`);
  console.log(`  avg vecs searched: ${(vecsSearched.reduce((a,b) => a+b, 0) / vecsSearched.length).toFixed(0)}`);
  console.log(`  min: ${Math.min(...vecsSearched)}, max: ${Math.max(...vecsSearched)}`);

  console.log("\nPer-partition:");
  for (const [key, times] of [...perPartTimes.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const sorted = [...times].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const vecs = perPartVecs.get(key)!;
    const avgVecs = vecs.reduce((a, b) => a + b, 0) / vecs.length;
    const pCount = ds.partitionCounts[key];
    const numCells = grids.get(key)!.cells.length;
    console.log(`  #${key} (${pCount?.toLocaleString()} vec, ${numCells} cells, ${sorted.length} queries): p50=${fmtUs(p50)} p99=${fmtUs(p99)} avg_vecs=${avgVecs.toFixed(0)}`);
  }
}

main();
