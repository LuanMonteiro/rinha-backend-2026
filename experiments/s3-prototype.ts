/**
 * S3 Prototype: Grid-based bounding box pruning + exact rerank
 * 
 * Validates whether partitioning vectors into grid cells with bounding boxes
 * can reduce the search space enough for sub-1ms p99.
 * 
 * Approach:
 * 1. Within each primary partition, create a 2-bin grid over 9 continuous dims
 * 2. Compute bounding boxes for each grid cell
 * 3. At query time: compute lb distance to each cell, search cells in lb order
 * 4. Prune cells where lb >= current topD4
 */
import { readFileSync } from "fs";
import { join } from "path";
import { loadDataset, computeQueryKey } from "../src/loader";
import { vectorize, quantize } from "../src/vectorizer";
import type { TransactionPayload, LoadedDataset } from "../src/types";
import { KNN_K, SENTINEL_INT16 } from "../src/config";

const K = KNN_K;
const DIMS = 14;
// 9 continuous dimensions (excl binary dims 9,10,11 and sentinel dims 5,6)
// Actually dims 5,6 CAN be non-sentinel and vary, so include them
// Skip dims 9,10,11 (always constant within partition)
const GRID_DIMS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 13]; // 11 dims
const NUM_GRID_DIMS = GRID_DIMS.length;

interface Cell {
  startIdx: number; // start within partition (global index)
  count: number;
  bboxMin: Int16Array; // 14 dims
  bboxMax: Int16Array; // 14 dims
}

interface PartitionGrid {
  cells: Cell[];
  boundaries: Float64Array; // median value for each of NUM_GRID_DIMS dims
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

function fmtUs(ns: number): string {
  if (ns < 1) return (ns * 1000).toFixed(0) + "ns";
  if (ns < 1000) return ns.toFixed(1) + "μs";
  return (ns / 1000).toFixed(3) + "ms";
}

function buildGrid(ds: LoadedDataset): Map<number, PartitionGrid> {
  const grids = new Map<number, PartitionGrid>();
  const vectors = ds.vectors;

  for (let p = 0; p < ds.numPartitions; p++) {
    const pStart = ds.partitionStarts[p];
    const pCount = ds.partitionCounts[p];
    if (pCount === 0) continue;

    // Compute median for each grid dimension
    const boundaries = new Float64Array(NUM_GRID_DIMS);
    for (let gi = 0; gi < NUM_GRID_DIMS; gi++) {
      const dim = GRID_DIMS[gi];
      const vals: number[] = [];
      for (let j = 0; j < pCount; j++) {
        const v = vectors[(pStart + j) * DIMS + dim];
        if (v !== SENTINEL_INT16) { // skip sentinel values for median
          vals.push(v);
        }
      }
      vals.sort((a, b) => a - b);
      boundaries[gi] = vals[Math.floor(vals.length / 2)];
    }

    // Assign each vector to a cell
    const cellMap = new Map<number, number[]>();
    for (let j = 0; j < pCount; j++) {
      let cellKey = 0;
      for (let gi = 0; gi < NUM_GRID_DIMS; gi++) {
        const dim = GRID_DIMS[gi];
        const v = vectors[(pStart + j) * DIMS + dim];
        if (v > boundaries[gi]) cellKey |= (1 << gi);
      }
      if (!cellMap.has(cellKey)) cellMap.set(cellKey, []);
      cellMap.get(cellKey)!.push(j);
    }

    // Build cells with bounding boxes
    const cells: Cell[] = [];
    for (const [cellKey, indices] of cellMap) {
      const bboxMin = new Int16Array(DIMS).fill(32767);
      const bboxMax = new Int16Array(DIMS).fill(-32768);

      for (const j of indices) {
        const base = (pStart + j) * DIMS;
        for (let d = 0; d < DIMS; d++) {
          const v = vectors[base + d];
          if (v < bboxMin[d]) bboxMin[d] = v;
          if (v > bboxMax[d]) bboxMax[d] = v;
        }
      }

      cells.push({
        startIdx: -1, // will be filled after reorder
        count: indices.length,
        bboxMin,
        bboxMax,
      });
    }

    // Sort cells by size descending (largest first for debugging)
    // Actually, for search, we need to compute lb per query, so order doesn't matter here
    grids.set(p, { cells, boundaries });
  }

  return grids;
}

function knn5_grid(
  query: Int16Array,
  ds: LoadedDataset,
  grid: PartitionGrid,
): number {
  const key = computeQueryKey(query);
  const pStart = ds.partitionStarts[key];
  const pCount = ds.partitionCounts[key];
  if (pCount === 0) return 0;

  const vectors = ds.vectors;
  const labels = ds.labels;
  const cells = grid.cells;

  const q0 = query[0], q1 = query[1], q2 = query[2], q3 = query[3];
  const q4 = query[4], q5 = query[5], q6 = query[6], q7 = query[7];
  const q8 = query[8], q9 = query[9], q10 = query[10], q11 = query[11];
  const q12 = query[12], q13 = query[13];

  let topD0 = Infinity, topD1 = Infinity, topD2 = Infinity, topD3 = Infinity, topD4 = Infinity;
  let topI0 = -1, topI1 = -1, topI2 = -1, topI3 = -1, topI4 = -1;

  // Compute lb distance to each cell's bounding box
  const cellLBs: { idx: number; lb: number }[] = [];
  for (let ci = 0; ci < cells.length; ci++) {
    const cell = cells[ci];
    const bboxMin = cell.bboxMin;
    const bboxMax = cell.bboxMax;
    
    let lb = 0;
    // dim 0
    if (q0 < bboxMin[0]) { const d = q0 - bboxMin[0]; lb += d * d; }
    else if (q0 > bboxMax[0]) { const d = q0 - bboxMax[0]; lb += d * d; }
    // dim 1
    if (q1 < bboxMin[1]) { const d = q1 - bboxMin[1]; lb += d * d; }
    else if (q1 > bboxMax[1]) { const d = q1 - bboxMax[1]; lb += d * d; }
    // dim 2
    if (q2 < bboxMin[2]) { const d = q2 - bboxMin[2]; lb += d * d; }
    else if (q2 > bboxMax[2]) { const d = q2 - bboxMax[2]; lb += d * d; }
    // dim 3
    if (q3 < bboxMin[3]) { const d = q3 - bboxMin[3]; lb += d * d; }
    else if (q3 > bboxMax[3]) { const d = q3 - bboxMax[3]; lb += d * d; }
    // dim 4
    if (q4 < bboxMin[4]) { const d = q4 - bboxMin[4]; lb += d * d; }
    else if (q4 > bboxMax[4]) { const d = q4 - bboxMax[4]; lb += d * d; }
    // dim 5
    if (q5 < bboxMin[5]) { const d = q5 - bboxMin[5]; lb += d * d; }
    else if (q5 > bboxMax[5]) { const d = q5 - bboxMax[5]; lb += d * d; }
    // dim 6
    if (q6 < bboxMin[6]) { const d = q6 - bboxMin[6]; lb += d * d; }
    else if (q6 > bboxMax[6]) { const d = q6 - bboxMax[6]; lb += d * d; }
    // dim 7
    if (q7 < bboxMin[7]) { const d = q7 - bboxMin[7]; lb += d * d; }
    else if (q7 > bboxMax[7]) { const d = q7 - bboxMax[7]; lb += d * d; }
    // dim 8
    if (q8 < bboxMin[8]) { const d = q8 - bboxMin[8]; lb += d * d; }
    else if (q8 > bboxMax[8]) { const d = q8 - bboxMax[8]; lb += d * d; }
    // dim 9 (binary, should match partition, but check anyway)
    if (q9 < bboxMin[9]) { const d = q9 - bboxMin[9]; lb += d * d; }
    else if (q9 > bboxMax[9]) { const d = q9 - bboxMax[9]; lb += d * d; }
    // dim 10
    if (q10 < bboxMin[10]) { const d = q10 - bboxMin[10]; lb += d * d; }
    else if (q10 > bboxMax[10]) { const d = q10 - bboxMax[10]; lb += d * d; }
    // dim 11
    if (q11 < bboxMin[11]) { const d = q11 - bboxMin[11]; lb += d * d; }
    else if (q11 > bboxMax[11]) { const d = q11 - bboxMax[11]; lb += d * d; }
    // dim 12
    if (q12 < bboxMin[12]) { const d = q12 - bboxMin[12]; lb += d * d; }
    else if (q12 > bboxMax[12]) { const d = q12 - bboxMax[12]; lb += d * d; }
    // dim 13
    if (q13 < bboxMin[13]) { const d = q13 - bboxMin[13]; lb += d * d; }
    else if (q13 > bboxMax[13]) { const d = q13 - bboxMax[13]; lb += d * d; }

    cellLBs.push({ idx: ci, lb });
  }

  // Sort by lb (ascending) — search closest cells first
  cellLBs.sort((a, b) => a.lb - b.lb);

  // Search cells in lb order
  for (const { idx, lb } of cellLBs) {
    if (lb >= topD4) break; // all remaining cells are farther

    const cell = cells[idx];
    const cStart = pStart + cell.startIdx;
    const cEnd = cStart + cell.count;

    for (let i = cStart; i < cEnd; i++) {
      const base = i * DIMS;
      const d0 = q0 - vectors[base];
      const d1 = q1 - vectors[base + 1];
      const d2 = q2 - vectors[base + 2];
      const d3 = q3 - vectors[base + 3];
      const d4 = q4 - vectors[base + 4];
      const d5 = q5 - vectors[base + 5];
      const d6 = q6 - vectors[base + 6];
      const d7 = q7 - vectors[base + 7];
      const d8 = q8 - vectors[base + 8];
      const d9 = q9 - vectors[base + 9];
      const d10 = q10 - vectors[base + 10];
      const d11 = q11 - vectors[base + 11];
      const d12 = q12 - vectors[base + 12];
      const d13 = q13 - vectors[base + 13];

      const dist = d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3
                 + d4 * d4 + d5 * d5 + d6 * d6 + d7 * d7
                 + d8 * d8 + d9 * d9 + d10 * d10 + d11 * d11
                 + d12 * d12 + d13 * d13;

      if (dist < topD4) {
        if (dist < topD0) {
          topD4 = topD3; topI4 = topI3;
          topD3 = topD2; topI3 = topI2;
          topD2 = topD1; topI2 = topI1;
          topD1 = topD0; topI1 = topI0;
          topD0 = dist; topI0 = i;
        } else if (dist < topD1) {
          topD4 = topD3; topI4 = topI3;
          topD3 = topD2; topI3 = topI2;
          topD2 = topD1; topI2 = topI1;
          topD1 = dist; topI1 = i;
        } else if (dist < topD2) {
          topD4 = topD3; topI4 = topI3;
          topD3 = topD2; topI3 = topI2;
          topD2 = dist; topI2 = i;
        } else if (dist < topD3) {
          topD4 = topD3; topI4 = topI3;
          topD3 = dist; topI3 = i;
        } else {
          topD4 = dist; topI4 = i;
        }
      }
    }
  }

  let frauds = 0;
  if (topI0 >= 0 && labels[topI0] === 1) frauds++;
  if (topI1 >= 0 && labels[topI1] === 1) frauds++;
  if (topI2 >= 0 && labels[topI2] === 1) frauds++;
  if (topI3 >= 0 && labels[topI3] === 1) frauds++;
  if (topI4 >= 0 && labels[topI4] === 1) frauds++;
  return frauds;
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

  // Stats
  let totalCells = 0;
  for (const [p, grid] of grids) {
    console.log(`  Partition #${p}: ${grid.cells.length} cells, boundaries: ${Array.from(grid.boundaries).map(v => v.toFixed(0)).join(',')}`);
    totalCells += grid.cells.length;
    
    // Log cell size distribution
    const sizes = grid.cells.map(c => c.count).sort((a, b) => b - a);
    console.log(`    Sizes: max=${sizes[0]}, min=${sizes[sizes.length - 1]}, median=${sizes[Math.floor(sizes.length / 2)]}`);
    
    // Check bbox tightness for largest cell
    const largest = grid.cells.reduce((a, b) => a.count > b.count ? a : b);
    let maxRange = 0;
    for (let d = 0; d < DIMS; d++) {
      const range = largest.bboxMax[d] - largest.bboxMin[d];
      if (range > maxRange) maxRange = range;
    }
    console.log(`    Largest cell: ${largest.count} vec, max dim range: ${maxRange}`);
  }
  console.log(`  Total cells: ${totalCells}`);

  // For grid search to work, vectors need to be reordered by cell within each partition.
  // Since we can't reorder the existing dataset.bin in memory easily, 
  // we need to build an index mapping cell -> vector indices.
  // Let's build that now.
  
  console.log("\nBuilding cell index...");
  const cellIndices = new Map<number, { cellIdx: number; indices: Uint32Array }[]>();
  
  for (let p = 0; p < ds.numPartitions; p++) {
    const pStart = ds.partitionStarts[p];
    const pCount = ds.partitionCounts[p];
    if (pCount === 0) continue;
    
    const grid = grids.get(p)!;
    const vectors = ds.vectors;
    
    // Assign vectors to cells
    const cellVecs: Map<number, number[]> = new Map();
    for (let ci = 0; ci < grid.cells.length; ci++) cellVecs.set(ci, []);
    
    for (let j = 0; j < pCount; j++) {
      let cellKey = 0;
      for (let gi = 0; gi < NUM_GRID_DIMS; gi++) {
        const dim = GRID_DIMS[gi];
        const v = vectors[(pStart + j) * DIMS + dim];
        if (v > grid.boundaries[gi]) cellKey |= (1 << gi);
      }
      // Find the cell index for this cellKey
      // We need to map cellKey -> cellIdx
      // Let's store the cellKey with each cell
      break; // This approach won't work without storing cellKeys. Let me restructure.
    }
  }

  // Better approach: store cellKey with each cell during buildGrid
  console.log("\nRebuilding with cellKey tracking...");
  
  // Rebuild with cellKey
  interface CellWithKey extends Cell {
    cellKey: number;
  }
  
  interface PartitionGridWithKeys {
    cells: CellWithKey[];
    boundaries: Float64Array;
    cellKeyToIdx: Map<number, number>;
  }
  
  const gridsWithKeys = new Map<number, PartitionGridWithKeys>();
  
  for (let p = 0; p < ds.numPartitions; p++) {
    const pStart = ds.partitionStarts[p];
    const pCount = ds.partitionCounts[p];
    if (pCount === 0) continue;
    
    const grid = grids.get(p)!;
    const vectors = ds.vectors;
    
    // Assign vectors to cells and track which cellKey maps to which cell index
    const cellKeyMap = new Map<number, { indices: number[]; bboxMin: Int16Array; bboxMax: Int16Array }>();
    
    for (let j = 0; j < pCount; j++) {
      let cellKey = 0;
      for (let gi = 0; gi < NUM_GRID_DIMS; gi++) {
        const dim = GRID_DIMS[gi];
        const v = vectors[(pStart + j) * DIMS + dim];
        if (v > grid.boundaries[gi]) cellKey |= (1 << gi);
      }
      
      if (!cellKeyMap.has(cellKey)) {
        cellKeyMap.set(cellKey, {
          indices: [],
          bboxMin: new Int16Array(DIMS).fill(32767),
          bboxMax: new Int16Array(DIMS).fill(-32768),
        });
      }
      
      const entry = cellKeyMap.get(cellKey)!;
      entry.indices.push(j);
      
      const base = (pStart + j) * DIMS;
      for (let d = 0; d < DIMS; d++) {
        const v = vectors[base + d];
        if (v < entry.bboxMin[d]) entry.bboxMin[d] = v;
        if (v > entry.bboxMax[d]) entry.bboxMax[d] = v;
      }
    }
    
    // Build cells
    const cells: CellWithKey[] = [];
    const cellKeyToIdx = new Map<number, number>();
    
    for (const [cellKey, entry] of cellKeyMap) {
      const idx = cells.length;
      cellKeyToIdx.set(cellKey, idx);
      
      cells.push({
        cellKey,
        startIdx: -1,
        count: entry.indices.length,
        bboxMin: entry.bboxMin,
        bboxMax: entry.bboxMax,
      });
    }
    
    gridsWithKeys.set(p, { cells, boundaries: grid.boundaries, cellKeyToIdx });
  }
  
  // Now build index arrays for each cell (mapping to global vector indices)
  const cellIndexArrays = new Map<number, Uint32Array[]>();
  
  for (let p = 0; p < ds.numPartitions; p++) {
    const pStart = ds.partitionStarts[p];
    const pCount = ds.partitionCounts[p];
    if (pCount === 0) continue;
    
    const gridWK = gridsWithKeys.get(p)!;
    const vectors = ds.vectors;
    
    const arrays: Uint32Array[] = [];
    
    for (const cell of gridWK.cells) {
      // Collect all vector global indices for this cell
      const indices: number[] = [];
      
      for (let j = 0; j < pCount; j++) {
        let cellKey = 0;
        for (let gi = 0; gi < NUM_GRID_DIMS; gi++) {
          const dim = GRID_DIMS[gi];
          const v = vectors[(pStart + j) * DIMS + dim];
          if (v > gridWK.boundaries[gi]) cellKey |= (1 << gi);
        }
        
        if (cellKey === cell.cellKey) {
          indices.push(pStart + j);
        }
      }
      
      arrays.push(new Uint32Array(indices));
    }
    
    cellIndexArrays.set(p, arrays);
  }
  
  console.log("Index built.");

  // Correctness test
  console.log("\n=== Correctness Test ===");
  const floatBuf = new Float64Array(14);
  const int16Buf = new Int16Array(14);
  let failures = 0;
  
  // We need to use the index arrays for search instead of contiguous access
  // Let me write a proper search function
  
  function knn5_grid_indexed(
    query: Int16Array,
    key: number,
    gridWK: PartitionGridWithKeys,
    indexArrays: Uint32Array[],
  ): number {
    const vectors = ds.vectors;
    const labels = ds.labels;
    const cells = gridWK.cells;
    
    const q0 = query[0], q1 = query[1], q2 = query[2], q3 = query[3];
    const q4 = query[4], q5 = query[5], q6 = query[6], q7 = query[7];
    const q8 = query[8], q9 = query[9], q10 = query[10], q11 = query[11];
    const q12 = query[12], q13 = query[13];
    
    let topD0 = Infinity, topD1 = Infinity, topD2 = Infinity, topD3 = Infinity, topD4 = Infinity;
    let topI0 = -1, topI1 = -1, topI2 = -1, topI3 = -1, topI4 = -1;
    
    // Compute lb for each cell
    const cellLBs: { ci: number; lb: number }[] = [];
    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci];
      const min = cell.bboxMin;
      const max = cell.bboxMax;
      
      let lb = 0;
      // Unrolled for all 14 dims
      const check = (q: number, lo: number, hi: number) => {
        if (q < lo) { const d = q - lo; lb += d * d; }
        else if (q > hi) { const d = q - hi; lb += d * d; }
      };
      check(q0, min[0], max[0]);
      check(q1, min[1], max[1]);
      check(q2, min[2], max[2]);
      check(q3, min[3], max[3]);
      check(q4, min[4], max[4]);
      check(q5, min[5], max[5]);
      check(q6, min[6], max[6]);
      check(q7, min[7], max[7]);
      check(q8, min[8], max[8]);
      check(q9, min[9], max[9]);
      check(q10, min[10], max[10]);
      check(q11, min[11], max[11]);
      check(q12, min[12], max[12]);
      check(q13, min[13], max[13]);
      
      cellLBs.push({ ci, lb });
    }
    
    cellLBs.sort((a, b) => a.lb - b.lb);
    
    let vectorsSearched = 0;
    
    for (const { ci, lb } of cellLBs) {
      if (lb >= topD4) break;
      
      const indices = indexArrays[ci];
      vectorsSearched += indices.length;
      
      for (let j = 0; j < indices.length; j++) {
        const i = indices[j];
        const base = i * DIMS;
        
        const d0 = q0 - vectors[base]; const d1 = q1 - vectors[base + 1];
        const d2 = q2 - vectors[base + 2]; const d3 = q3 - vectors[base + 3];
        const d4 = q4 - vectors[base + 4]; const d5 = q5 - vectors[base + 5];
        const d6 = q6 - vectors[base + 6]; const d7 = q7 - vectors[base + 7];
        const d8 = q8 - vectors[base + 8]; const d9 = q9 - vectors[base + 9];
        const d10 = q10 - vectors[base + 10]; const d11 = q11 - vectors[base + 11];
        const d12 = q12 - vectors[base + 12]; const d13 = q13 - vectors[base + 13];
        
        const dist = d0*d0 + d1*d1 + d2*d2 + d3*d3 + d4*d4 + d5*d5 + d6*d6 + d7*d7
                   + d8*d8 + d9*d9 + d10*d10 + d11*d11 + d12*d12 + d13*d13;
        
        if (dist < topD4) {
          if (dist < topD0) {
            topD4=topD3;topI4=topI3;topD3=topD2;topI3=topI2;topD2=topD1;topI2=topI1;topD1=topD0;topI1=topI0;topD0=dist;topI0=i;
          } else if (dist < topD1) {
            topD4=topD3;topI4=topI3;topD3=topD2;topI3=topI2;topD2=topD1;topI2=topI1;topD1=dist;topI1=i;
          } else if (dist < topD2) {
            topD4=topD3;topI4=topI3;topD3=topD2;topI3=topI2;topD2=dist;topI2=i;
          } else if (dist < topD3) {
            topD4=topD3;topI4=topI3;topD3=dist;topI3=i;
          } else {
            topD4=dist;topI4=i;
          }
        }
      }
    }
    
    let frauds = 0;
    if (topI0 >= 0 && labels[topI0] === 1) frauds++;
    if (topI1 >= 0 && labels[topI1] === 1) frauds++;
    if (topI2 >= 0 && labels[topI2] === 1) frauds++;
    if (topI3 >= 0 && labels[topI3] === 1) frauds++;
    if (topI4 >= 0 && labels[topI4] === 1) frauds++;
    return { fraudCount: frauds, vectorsSearched };
  }

  for (let i = 0; i < payloads.length; i++) {
    vectorize(payloads[i], floatBuf);
    quantize(floatBuf, int16Buf);
    const key = computeQueryKey(int16Buf);
    const gridWK = gridsWithKeys.get(key);
    const indices = cellIndexArrays.get(key);
    if (!gridWK || !indices) {
      console.error(`No grid for partition #${key}`);
      failures++;
      continue;
    }
    const { fraudCount } = knn5_grid_indexed(int16Buf, key, gridWK, indices);
    const fraudScore = fraudCount / 5;
    if (fraudScore !== expected[i].fraud_score) {
      console.error(`MISMATCH ${payloads[i].id}: got ${fraudScore}, expected ${expected[i].fraud_score}`);
      failures++;
    }
  }
  console.log(`Result: ${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`}`);
  
  if (failures > 0) {
    console.log("\nCannot proceed with S3 — correctness failed.");
    return;
  }

  // Benchmark
  console.log("\n=== Benchmark ===");
  
  // Warmup
  for (let i = 0; i < 50; i++) {
    vectorize(payloads[i % 50], floatBuf);
    quantize(floatBuf, int16Buf);
    const key = computeQueryKey(int16Buf);
    const gridWK = gridsWithKeys.get(key)!;
    const indices = cellIndexArrays.get(key)!;
    knn5_grid_indexed(int16Buf, key, gridWK, indices);
  }

  const REPS = 200;
  const searchTimes: number[] = [];
  const vecsSearched: number[] = [];
  const cellsSearched: number[] = [];

  for (let rep = 0; rep < REPS; rep++) {
    for (let i = 0; i < payloads.length; i++) {
      vectorize(payloads[i], floatBuf);
      quantize(floatBuf, int16Buf);
      const key = computeQueryKey(int16Buf);
      const gridWK = gridsWithKeys.get(key)!;
      const indices = cellIndexArrays.get(key)!;
      
      const t0 = performance.now();
      const result = knn5_grid_indexed(int16Buf, key, gridWK, indices);
      const t1 = performance.now();
      
      searchTimes.push(t1 - t0);
      vecsSearched.push(result.vectorsSearched);
    }
  }

  const s = stats(searchTimes);
  console.log(`Search times (${searchTimes.length} queries):`);
  console.log(`  p50: ${fmtUs(s.p50 * 1000)}, p95: ${fmtUs(s.p95 * 1000)}, p99: ${fmtUs(s.p99 * 1000)}, p999: ${fmtUs(s.p999 * 1000)}`);
  console.log(`  avg vectors searched: ${(vecsSearched.reduce((a,b)=>a+b,0)/vecsSearched.length).toFixed(0)}`);
  console.log(`  min: ${Math.min(...vecsSearched)}, max: ${Math.max(...vecsSearched)}`);
  
  // Per-partition breakdown
  const partTimes = new Map<number, number[]>();
  const partVecs = new Map<number, number[]>();
  for (let rep = 0; rep < REPS; rep++) {
    for (let i = 0; i < payloads.length; i++) {
      vectorize(payloads[i], floatBuf);
      quantize(floatBuf, int16Buf);
      const key = computeQueryKey(int16Buf);
      const gridWK = gridsWithKeys.get(key)!;
      const indices = cellIndexArrays.get(key)!;
      
      const t0 = performance.now();
      const result = knn5_grid_indexed(int16Buf, key, gridWK, indices);
      const t1 = performance.now();
      
      if (!partTimes.has(key)) partTimes.set(key, []);
      if (!partVecs.has(key)) partVecs.set(key, []);
      partTimes.get(key)!.push(t1 - t0);
      partVecs.get(key)!.push(result.vectorsSearched);
    }
  }
  
  console.log("\nPer-partition:");
  for (const [key, times] of [...partTimes.entries()].sort((a,b) => b[1].length - a[1].length)) {
    const sorted = [...times].sort((a,b) => a-b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] * 1000;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] * 1000;
    const vecs = partVecs.get(key)!;
    const avgVecs = vecs.reduce((a,b)=>a+b,0)/vecs.length;
    const pCount = ds.partitionCounts[key];
    const numCells = gridsWithKeys.get(key)!.cells.length;
    console.log(`  #${key} (${pCount?.toLocaleString()} vec, ${numCells} cells, ${sorted.length} queries): p50=${fmtUs(p50)} p99=${fmtUs(p99)} avg_vecs=${avgVecs.toFixed(0)}`);
  }
}

main();
