/**
 * S3 Searcher: Grid-based bounding box pruning + exact rerank
 *
 * For the query's partition:
 * 1. Compute lb distance from query to each cell's bounding box
 * 2. Sort cells by lb
 * 3. Search cells in order, pruning where lb >= topD4
 * 4. Within each cell: sequential scan with early termination
 *
 * Vectors are contiguous per cell (reordered at load time by grid.ts).
 */
import type { LoadedDataset } from "./loader";
import type { GridIndex, PartitionGrid } from "./grid";
import { computeQueryKey } from "./loader";
import { KNN_K } from "./config";

const K = KNN_K;
const DIMS = 14;

export function knn5_s3(
  query: Int16Array,
  ds: LoadedDataset,
  grid: GridIndex,
): number {
  const key = computeQueryKey(query);
  const pg = grid.partitions[key];
  if (!pg || pg.numCells === 0) return 0;

  const { numCells, cellStarts, cellCounts, bboxMinFlat, bboxMaxFlat } = pg;
  const vectors = ds.vectors;
  const labels = ds.labels;

  const q0 = query[0], q1 = query[1], q2 = query[2], q3 = query[3];
  const q4 = query[4], q5 = query[5], q6 = query[6], q7 = query[7];
  const q8 = query[8], q9 = query[9], q10 = query[10], q11 = query[11];
  const q12 = query[12], q13 = query[13];

  let topD0 = Infinity, topD1 = Infinity, topD2 = Infinity, topD3 = Infinity, topD4 = Infinity;
  let topI0 = -1, topI1 = -1, topI2 = -1, topI3 = -1, topI4 = -1;

  // Compute lb for each cell
  // Using flat arrays for cache-friendly access
  const cellLBs = new Float64Array(numCells);
  for (let ci = 0; ci < numCells; ci++) {
    const mi = ci * DIMS;
    const xi = ci * DIMS;
    let lb = 0;
    // Dim 0
    if (q0 < bboxMinFlat[mi]) { const d = q0 - bboxMinFlat[mi]; lb += d * d; }
    else if (q0 > bboxMaxFlat[xi]) { const d = q0 - bboxMaxFlat[xi]; lb += d * d; }
    // Dim 1
    if (q1 < bboxMinFlat[mi+1]) { const d = q1 - bboxMinFlat[mi+1]; lb += d * d; }
    else if (q1 > bboxMaxFlat[xi+1]) { const d = q1 - bboxMaxFlat[xi+1]; lb += d * d; }
    // Dim 2
    if (q2 < bboxMinFlat[mi+2]) { const d = q2 - bboxMinFlat[mi+2]; lb += d * d; }
    else if (q2 > bboxMaxFlat[xi+2]) { const d = q2 - bboxMaxFlat[xi+2]; lb += d * d; }
    // Dim 3
    if (q3 < bboxMinFlat[mi+3]) { const d = q3 - bboxMinFlat[mi+3]; lb += d * d; }
    else if (q3 > bboxMaxFlat[xi+3]) { const d = q3 - bboxMaxFlat[xi+3]; lb += d * d; }
    // Dim 4
    if (q4 < bboxMinFlat[mi+4]) { const d = q4 - bboxMinFlat[mi+4]; lb += d * d; }
    else if (q4 > bboxMaxFlat[xi+4]) { const d = q4 - bboxMaxFlat[xi+4]; lb += d * d; }
    // Dim 5
    if (q5 < bboxMinFlat[mi+5]) { const d = q5 - bboxMinFlat[mi+5]; lb += d * d; }
    else if (q5 > bboxMaxFlat[xi+5]) { const d = q5 - bboxMaxFlat[xi+5]; lb += d * d; }
    // Dim 6
    if (q6 < bboxMinFlat[mi+6]) { const d = q6 - bboxMinFlat[mi+6]; lb += d * d; }
    else if (q6 > bboxMaxFlat[xi+6]) { const d = q6 - bboxMaxFlat[xi+6]; lb += d * d; }
    // Dim 7
    if (q7 < bboxMinFlat[mi+7]) { const d = q7 - bboxMinFlat[mi+7]; lb += d * d; }
    else if (q7 > bboxMaxFlat[xi+7]) { const d = q7 - bboxMaxFlat[xi+7]; lb += d * d; }
    // Dim 8
    if (q8 < bboxMinFlat[mi+8]) { const d = q8 - bboxMinFlat[mi+8]; lb += d * d; }
    else if (q8 > bboxMaxFlat[xi+8]) { const d = q8 - bboxMaxFlat[xi+8]; lb += d * d; }
    // Dim 9
    if (q9 < bboxMinFlat[mi+9]) { const d = q9 - bboxMinFlat[mi+9]; lb += d * d; }
    else if (q9 > bboxMaxFlat[xi+9]) { const d = q9 - bboxMaxFlat[xi+9]; lb += d * d; }
    // Dim 10
    if (q10 < bboxMinFlat[mi+10]) { const d = q10 - bboxMinFlat[mi+10]; lb += d * d; }
    else if (q10 > bboxMaxFlat[xi+10]) { const d = q10 - bboxMaxFlat[xi+10]; lb += d * d; }
    // Dim 11
    if (q11 < bboxMinFlat[mi+11]) { const d = q11 - bboxMinFlat[mi+11]; lb += d * d; }
    else if (q11 > bboxMaxFlat[xi+11]) { const d = q11 - bboxMaxFlat[xi+11]; lb += d * d; }
    // Dim 12
    if (q12 < bboxMinFlat[mi+12]) { const d = q12 - bboxMinFlat[mi+12]; lb += d * d; }
    else if (q12 > bboxMaxFlat[xi+12]) { const d = q12 - bboxMaxFlat[xi+12]; lb += d * d; }
    // Dim 13
    if (q13 < bboxMinFlat[mi+13]) { const d = q13 - bboxMinFlat[mi+13]; lb += d * d; }
    else if (q13 > bboxMaxFlat[xi+13]) { const d = q13 - bboxMaxFlat[xi+13]; lb += d * d; }

    cellLBs[ci] = lb;
  }

  // Sort cells by lb (ascending) — search closest cells first
  const sortedCells = new Uint16Array(numCells);
  for (let i = 0; i < numCells; i++) sortedCells[i] = i;
  sortedCells.sort((a, b) => cellLBs[a] - cellLBs[b]);

  // Search cells in lb order with pruning
  for (let si = 0; si < numCells; si++) {
    const ci = sortedCells[si];
    if (cellLBs[ci] >= topD4) break;

    const start = cellStarts[ci];
    const count = cellCounts[ci];
    const end = start + count;

    // Sequential scan with early termination — contiguous memory!
    for (let i = start; i < end; i++) {
      const base = i * DIMS;

      const d0 = q0 - vectors[base];
      let dist = d0 * d0;
      if (dist >= topD4) continue;
      const d1 = q1 - vectors[base + 1]; dist += d1 * d1;
      if (dist >= topD4) continue;
      const d2 = q2 - vectors[base + 2]; dist += d2 * d2;
      if (dist >= topD4) continue;
      const d3 = q3 - vectors[base + 3]; dist += d3 * d3;
      if (dist >= topD4) continue;
      const d4 = q4 - vectors[base + 4]; dist += d4 * d4;
      if (dist >= topD4) continue;
      const d5 = q5 - vectors[base + 5]; dist += d5 * d5;
      if (dist >= topD4) continue;
      const d6 = q6 - vectors[base + 6]; dist += d6 * d6;
      if (dist >= topD4) continue;
      const d7 = q7 - vectors[base + 7]; dist += d7 * d7;
      if (dist >= topD4) continue;
      const d8 = q8 - vectors[base + 8]; dist += d8 * d8;
      if (dist >= topD4) continue;
      const d9 = q9 - vectors[base + 9]; dist += d9 * d9;
      if (dist >= topD4) continue;
      const d10 = q10 - vectors[base + 10]; dist += d10 * d10;
      if (dist >= topD4) continue;
      const d11 = q11 - vectors[base + 11]; dist += d11 * d11;
      if (dist >= topD4) continue;
      const d12 = q12 - vectors[base + 12]; dist += d12 * d12;
      if (dist >= topD4) continue;
      const d13 = q13 - vectors[base + 13]; dist += d13 * d13;

      if (dist < topD4) {
        if (dist < topD0) {
          topD4 = topD3; topI4 = topI3;
          topD3 = topD2; topI3 = topI2;
          topD2 = topD1; topI2 = topI1;
          topD1 = topD0; topI1 = topI0;
          topD0 = dist;  topI0 = i;
        } else if (dist < topD1) {
          topD4 = topD3; topI4 = topI3;
          topD3 = topD2; topI3 = topI2;
          topD2 = topD1; topI2 = topI1;
          topD1 = dist;  topI1 = i;
        } else if (dist < topD2) {
          topD4 = topD3; topI4 = topI3;
          topD3 = topD2; topI3 = topI2;
          topD2 = dist;  topI2 = i;
        } else if (dist < topD3) {
          topD4 = topD3; topI4 = topI3;
          topD3 = dist;  topI3 = i;
        } else {
          topD4 = dist;  topI4 = i;
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
