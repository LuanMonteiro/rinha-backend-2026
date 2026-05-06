/**
 * Production KNN-5 searcher: grid + bbox pruning with contiguous access.
 *
 * Optimizations over S3:
 * - Pre-allocated scratch arrays (no per-query allocations)
 * - Skip constant dims (9,10,11 always; 5,6 for sentinel partitions)
 * - Specialized inner loops for sentinel vs non-sentinel
 * - Unrolled lb computation
 */
import type { LoadedDataset } from "./loader";
import type { GridIndexV2 as GridIndex } from "./grid-v2";
import { SENTINEL_INT16, KNN_K } from "./config";

const K = KNN_K;
const DIMS = 14;


// Pre-allocated scratch arrays (max cells across all partitions)
let scratchCellLBs: Float64Array | null = null;
let scratchSortedCells: Uint32Array | null = null;
let scratchSize = 0;

function ensureScratch(size: number) {
  if (size <= scratchSize) return;
  scratchCellLBs = new Float64Array(size);
  scratchSortedCells = new Uint32Array(size);
  scratchSize = size;
}

function insertionSort(indices: Uint32Array, lbs: Float64Array, n: number) {
  for (let i = 1; i < n; i++) {
    let j = i;
    const idx = indices[i];
    const val = lbs[idx];
    while (j > 0 && lbs[indices[j - 1]] > val) {
      indices[j] = indices[j - 1];
      j--;
    }
    indices[j] = idx;
  }
}

export function knn5(
  query: Int16Array,
  ds: LoadedDataset,
  grid: GridIndex,
): number {
  let key = 0;
  if (query[9] !== 0) key |= 1;
  if (query[10] !== 0) key |= 2;
  if (query[11] !== 0) key |= 4;
  if (query[5] === SENTINEL_INT16) key |= 8;
  if (query[6] === SENTINEL_INT16) key |= 16;
  
  const pg = grid.partitions[key];
  if (!pg || pg.numCells === 0) return 0;

  const { numCells, cellStarts, cellCounts, bboxMinFlat, bboxMaxFlat } = pg;
  const vectors = ds.vectors;
  const labels = ds.labels;

  ensureScratch(numCells);
  const cellLBs = scratchCellLBs!;
  const sortedCells = scratchSortedCells!;

  const q0 = query[0], q1 = query[1], q2 = query[2], q3 = query[3];
  const q4 = query[4], q5 = query[5], q6 = query[6], q7 = query[7];
  const q8 = query[8], q12 = query[12], q13 = query[13];

  let topD0 = Infinity, topD1 = Infinity, topD2 = Infinity, topD3 = Infinity, topD4 = Infinity;
  let topI0 = -1, topI1 = -1, topI2 = -1, topI3 = -1, topI4 = -1;

  // Detect sentinel partition
  const isSentinel = (key & 0x18) !== 0;

  // === LB computation (skip constant dims) ===
  if (isSentinel) {
    // 9 variable dims: 0,1,2,3,4,7,8,12,13
    for (let ci = 0; ci < numCells; ci++) {
      const mi = ci * DIMS;
      let lb = 0;
      // Unrolled checks for 9 dims
      if (q0 < bboxMinFlat[mi]) { const d=q0-bboxMinFlat[mi]; lb+=d*d; } else if (q0 > bboxMaxFlat[mi]) { const d=q0-bboxMaxFlat[mi]; lb+=d*d; }
      if (q1 < bboxMinFlat[mi+1]) { const d=q1-bboxMinFlat[mi+1]; lb+=d*d; } else if (q1 > bboxMaxFlat[mi+1]) { const d=q1-bboxMaxFlat[mi+1]; lb+=d*d; }
      if (q2 < bboxMinFlat[mi+2]) { const d=q2-bboxMinFlat[mi+2]; lb+=d*d; } else if (q2 > bboxMaxFlat[mi+2]) { const d=q2-bboxMaxFlat[mi+2]; lb+=d*d; }
      if (q3 < bboxMinFlat[mi+3]) { const d=q3-bboxMinFlat[mi+3]; lb+=d*d; } else if (q3 > bboxMaxFlat[mi+3]) { const d=q3-bboxMaxFlat[mi+3]; lb+=d*d; }
      if (q4 < bboxMinFlat[mi+4]) { const d=q4-bboxMinFlat[mi+4]; lb+=d*d; } else if (q4 > bboxMaxFlat[mi+4]) { const d=q4-bboxMaxFlat[mi+4]; lb+=d*d; }
      // skip 5,6
      if (q7 < bboxMinFlat[mi+7]) { const d=q7-bboxMinFlat[mi+7]; lb+=d*d; } else if (q7 > bboxMaxFlat[mi+7]) { const d=q7-bboxMaxFlat[mi+7]; lb+=d*d; }
      if (q8 < bboxMinFlat[mi+8]) { const d=q8-bboxMinFlat[mi+8]; lb+=d*d; } else if (q8 > bboxMaxFlat[mi+8]) { const d=q8-bboxMaxFlat[mi+8]; lb+=d*d; }
      // skip 9,10,11
      if (q12 < bboxMinFlat[mi+12]) { const d=q12-bboxMinFlat[mi+12]; lb+=d*d; } else if (q12 > bboxMaxFlat[mi+12]) { const d=q12-bboxMaxFlat[mi+12]; lb+=d*d; }
      if (q13 < bboxMinFlat[mi+13]) { const d=q13-bboxMinFlat[mi+13]; lb+=d*d; } else if (q13 > bboxMaxFlat[mi+13]) { const d=q13-bboxMaxFlat[mi+13]; lb+=d*d; }
      cellLBs[ci] = lb;
    }
  } else {
    // 11 variable dims: 0-8,12,13
    for (let ci = 0; ci < numCells; ci++) {
      const mi = ci * DIMS;
      let lb = 0;
      if (q0 < bboxMinFlat[mi]) { const d=q0-bboxMinFlat[mi]; lb+=d*d; } else if (q0 > bboxMaxFlat[mi]) { const d=q0-bboxMaxFlat[mi]; lb+=d*d; }
      if (q1 < bboxMinFlat[mi+1]) { const d=q1-bboxMinFlat[mi+1]; lb+=d*d; } else if (q1 > bboxMaxFlat[mi+1]) { const d=q1-bboxMaxFlat[mi+1]; lb+=d*d; }
      if (q2 < bboxMinFlat[mi+2]) { const d=q2-bboxMinFlat[mi+2]; lb+=d*d; } else if (q2 > bboxMaxFlat[mi+2]) { const d=q2-bboxMaxFlat[mi+2]; lb+=d*d; }
      if (q3 < bboxMinFlat[mi+3]) { const d=q3-bboxMinFlat[mi+3]; lb+=d*d; } else if (q3 > bboxMaxFlat[mi+3]) { const d=q3-bboxMaxFlat[mi+3]; lb+=d*d; }
      if (q4 < bboxMinFlat[mi+4]) { const d=q4-bboxMinFlat[mi+4]; lb+=d*d; } else if (q4 > bboxMaxFlat[mi+4]) { const d=q4-bboxMaxFlat[mi+4]; lb+=d*d; }
      if (q5 < bboxMinFlat[mi+5]) { const d=q5-bboxMinFlat[mi+5]; lb+=d*d; } else if (q5 > bboxMaxFlat[mi+5]) { const d=q5-bboxMaxFlat[mi+5]; lb+=d*d; }
      if (q6 < bboxMinFlat[mi+6]) { const d=q6-bboxMinFlat[mi+6]; lb+=d*d; } else if (q6 > bboxMaxFlat[mi+6]) { const d=q6-bboxMaxFlat[mi+6]; lb+=d*d; }
      if (q7 < bboxMinFlat[mi+7]) { const d=q7-bboxMinFlat[mi+7]; lb+=d*d; } else if (q7 > bboxMaxFlat[mi+7]) { const d=q7-bboxMaxFlat[mi+7]; lb+=d*d; }
      if (q8 < bboxMinFlat[mi+8]) { const d=q8-bboxMinFlat[mi+8]; lb+=d*d; } else if (q8 > bboxMaxFlat[mi+8]) { const d=q8-bboxMaxFlat[mi+8]; lb+=d*d; }
      // skip 9,10,11
      if (q12 < bboxMinFlat[mi+12]) { const d=q12-bboxMinFlat[mi+12]; lb+=d*d; } else if (q12 > bboxMaxFlat[mi+12]) { const d=q12-bboxMaxFlat[mi+12]; lb+=d*d; }
      if (q13 < bboxMinFlat[mi+13]) { const d=q13-bboxMinFlat[mi+13]; lb+=d*d; } else if (q13 > bboxMaxFlat[mi+13]) { const d=q13-bboxMaxFlat[mi+13]; lb+=d*d; }
      cellLBs[ci] = lb;
    }
  }

  // === Sort cells by lb ===
  for (let i = 0; i < numCells; i++) sortedCells[i] = i;
  if (numCells < 256) {
    insertionSort(sortedCells, cellLBs, numCells);
  } else {
    const sub = sortedCells.subarray(0, numCells);
    sub.sort((a, b) => cellLBs[a] - cellLBs[b]);
  }

  // === Search cells (specialized inner loops) ===
  if (isSentinel) {
    // 9 variable dims: 0,1,2,3,4,7,8,12,13
    for (let si = 0; si < numCells; si++) {
      const ci = sortedCells[si];
      if (cellLBs[ci] >= topD4) break;
      if (topD4 < 25) break; // Aggressive early exit if we have near-perfect matches

      const start = cellStarts[ci], end = start + cellCounts[ci];
      for (let i = start; i < end; i++) {
        const base = i * DIMS;

        const d2=q2-vectors[base+2]; let dist=d2*d2; if(dist>=topD4)continue;
        const d0=q0-vectors[base];dist+=d0*d0;if(dist>=topD4)continue;
        const d1=q1-vectors[base+1];dist+=d1*d1;if(dist>=topD4)continue;
        const d3=q3-vectors[base+3];dist+=d3*d3;if(dist>=topD4)continue;
        const d4=q4-vectors[base+4];dist+=d4*d4;if(dist>=topD4)continue;
        const d7=q7-vectors[base+7];dist+=d7*d7;if(dist>=topD4)continue;
        const d8=q8-vectors[base+8];dist+=d8*d8;if(dist>=topD4)continue;
        const d12=q12-vectors[base+12];dist+=d12*d12;if(dist>=topD4)continue;
        const d13=q13-vectors[base+13];dist+=d13*d13;
        if(dist<topD4){if(dist<topD0){topD4=topD3;topI4=topI3;topD3=topD2;topI3=topI2;topD2=topD1;topI2=topI1;topD1=topD0;topI1=topI0;topD0=dist;topI0=i;}else if(dist<topD1){topD4=topD3;topI4=topI3;topD3=topD2;topI3=topI2;topD2=topD1;topI2=topI1;topD1=dist;topI1=i;}else if(dist<topD2){topD4=topD3;topI4=topI3;topD3=topD2;topI3=topI2;topD2=dist;topI2=i;}else if(dist<topD3){topD4=topD3;topI4=topI3;topD3=dist;topI3=i;}else{topD4=dist;topI4=i;}}
      }
    }
  } else {
    // 11 variable dims: 0-8,12,13
    for (let si = 0; si < numCells; si++) {
      const ci = sortedCells[si];
      if (cellLBs[ci] >= topD4) break;
      if (topD4 < 25) break; 

      const start = cellStarts[ci], end = start + cellCounts[ci];
      for (let i = start; i < end; i++) {
        const base = i * DIMS;

        const d2=q2-vectors[base+2];let dist=d2*d2;if(dist>=topD4)continue;
        const d5=q5-vectors[base+5];dist+=d5*d5;if(dist>=topD4)continue;
        const d6=q6-vectors[base+6];dist+=d6*d6;if(dist>=topD4)continue;
        const d0=q0-vectors[base];dist+=d0*d0;if(dist>=topD4)continue;
        const d1=q1-vectors[base+1];dist+=d1*d1;if(dist>=topD4)continue;
        const d3=q3-vectors[base+3];dist+=d3*d3;if(dist>=topD4)continue;
        const d4=q4-vectors[base+4];dist+=d4*d4;if(dist>=topD4)continue;
        const d7=q7-vectors[base+7];dist+=d7*d7;if(dist>=topD4)continue;
        const d8=q8-vectors[base+8];dist+=d8*d8;if(dist>=topD4)continue;
        const d12=q12-vectors[base+12];dist+=d12*d12;if(dist>=topD4)continue;
        const d13=q13-vectors[base+13];dist+=d13*d13;
        if(dist<topD4){if(dist<topD0){topD4=topD3;topI4=topI3;topD3=topD2;topI3=topI2;topD2=topD1;topI2=topI1;topD1=topD0;topI1=topI0;topD0=dist;topI0=i;}else if(dist<topD1){topD4=topD3;topI4=topI3;topD3=topD2;topI3=topI2;topD2=topD1;topI2=topI1;topD1=dist;topI1=i;}else if(dist<topD2){topD4=topD3;topI4=topI3;topD3=topD2;topI3=topI2;topD2=dist;topI2=i;}else if(dist<topD3){topD4=topD3;topI4=topI3;topD3=dist;topI3=i;}else{topD4=dist;topI4=i;}}
      }
    }
  }

  let frauds = 0;
  if(topI0>=0&&labels[topI0]===1)frauds++;
  if(topI1>=0&&labels[topI1]===1)frauds++;
  if(topI2>=0&&labels[topI2]===1)frauds++;
  if(topI3>=0&&labels[topI3]===1)frauds++;
  if(topI4>=0&&labels[topI4]===1)frauds++;
  return frauds;
}
