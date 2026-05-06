import { KNN_K } from "./config";
import type { LoadedDataset } from "./types";
import { computeQueryKey } from "./loader";

const K = KNN_K;

/**
 * Partitioned KNN-5 with dim-0 sorted search + early termination.
 * Vectors are sorted by dim 0 within each partition (done at build time).
 * Binary search finds pivot, expand left/right with monotonic dim-0 pruning.
 * Full 13-dim early termination after dim 0 contribution.
 */
export function knn5(
  query: Int16Array,
  ds: LoadedDataset,
): number {
  const key = computeQueryKey(query);
  const startIdx = ds.partitionStarts[key];
  const count = ds.partitionCounts[key];

  if (count === 0) return 0;

  const vectors = ds.vectors;
  const labels = ds.labels;

  const q0 = query[0], q1 = query[1], q2 = query[2], q3 = query[3];
  const q4 = query[4], q5 = query[5], q6 = query[6], q7 = query[7];
  const q8 = query[8], q9 = query[9], q10 = query[10], q11 = query[11];
  const q12 = query[12], q13 = query[13];

  let topD0 = Infinity, topD1 = Infinity, topD2 = Infinity, topD3 = Infinity, topD4 = Infinity;
  let topI0 = -1, topI1 = -1, topI2 = -1, topI3 = -1, topI4 = -1;

  // Binary search for pivot (first vector with dim0 >= q0)
  let lo = 0, hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (vectors[(startIdx + mid) * 14] < q0) lo = mid + 1;
    else hi = mid;
  }
  const pivot = lo;

  let left = pivot - 1;
  let right = pivot;

  while (left >= 0 || right < count) {
    let candidate: number;
    let fromLeft: boolean;

    if (left < 0) {
      candidate = right++;
      fromLeft = false;
    } else if (right >= count) {
      candidate = left--;
      fromLeft = true;
    } else {
      const leftDiff = q0 - vectors[(startIdx + left) * 14];
      const rightDiff = vectors[(startIdx + right) * 14] - q0;
      if (leftDiff <= rightDiff) {
        candidate = left--;
        fromLeft = true;
      } else {
        candidate = right++;
        fromLeft = false;
      }
    }

    // Dim 0 monotonic pruning
    const dim0Diff = q0 - vectors[(startIdx + candidate) * 14];
    const dim0Dist = dim0Diff * dim0Diff;
    if (dim0Dist >= topD4) {
      if (fromLeft) left = -1;
      else right = count;
      continue;
    }

    // Full distance with early termination (dim 0 already computed)
    const base = (startIdx + candidate) * 14;
    let dist = dim0Dist;

    const dd1 = q1 - vectors[base + 1]; dist += dd1 * dd1;
    if (dist >= topD4) continue;
    const dd2 = q2 - vectors[base + 2]; dist += dd2 * dd2;
    if (dist >= topD4) continue;
    const dd3 = q3 - vectors[base + 3]; dist += dd3 * dd3;
    if (dist >= topD4) continue;
    const dd4 = q4 - vectors[base + 4]; dist += dd4 * dd4;
    if (dist >= topD4) continue;
    const dd5 = q5 - vectors[base + 5]; dist += dd5 * dd5;
    if (dist >= topD4) continue;
    const dd6 = q6 - vectors[base + 6]; dist += dd6 * dd6;
    if (dist >= topD4) continue;
    const dd7 = q7 - vectors[base + 7]; dist += dd7 * dd7;
    if (dist >= topD4) continue;
    const dd8 = q8 - vectors[base + 8]; dist += dd8 * dd8;
    if (dist >= topD4) continue;
    const dd9 = q9 - vectors[base + 9]; dist += dd9 * dd9;
    if (dist >= topD4) continue;
    const dd10 = q10 - vectors[base + 10]; dist += dd10 * dd10;
    if (dist >= topD4) continue;
    const dd11 = q11 - vectors[base + 11]; dist += dd11 * dd11;
    if (dist >= topD4) continue;
    const dd12 = q12 - vectors[base + 12]; dist += dd12 * dd12;
    if (dist >= topD4) continue;
    const dd13 = q13 - vectors[base + 13]; dist += dd13 * dd13;

    const cIdx = startIdx + candidate;
    if (dist < topD4) {
      if (dist < topD0) {
        topD4 = topD3; topI4 = topI3;
        topD3 = topD2; topI3 = topI2;
        topD2 = topD1; topI2 = topI1;
        topD1 = topD0; topI1 = topI0;
        topD0 = dist;  topI0 = cIdx;
      } else if (dist < topD1) {
        topD4 = topD3; topI4 = topI3;
        topD3 = topD2; topI3 = topI2;
        topD2 = topD1; topI2 = topI1;
        topD1 = dist;  topI1 = cIdx;
      } else if (dist < topD2) {
        topD4 = topD3; topI4 = topI3;
        topD3 = topD2; topI3 = topI2;
        topD2 = dist;  topI2 = cIdx;
      } else if (dist < topD3) {
        topD4 = topD3; topI4 = topI3;
        topD3 = dist;  topI3 = cIdx;
      } else {
        topD4 = dist;  topI4 = cIdx;
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
