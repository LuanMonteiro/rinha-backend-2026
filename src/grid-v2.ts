/**
 * Grid v2: Configurable multi-bin gridding.
 * Supports 4 bins for selected dims (using quartile boundaries).
 * Reduces per-cell vector count → fewer vectors searched.
 */
import type { LoadedDataset } from "./loader";
import { SENTINEL_INT16 } from "./config";

const DIMS = 14;
const NUM_PARTITIONS = 32;

export interface PartitionGridV2 {
  numCells: number;
  cellStarts: Uint32Array;
  cellCounts: Uint32Array;
  bboxMinFlat: Int16Array;
  bboxMaxFlat: Int16Array;
  numGridDims: number;     // compatibility with PartitionGrid
  gridDims: number[];      // which dims are used for gridding
  binsPerDim: Uint16Array; // bins for each grid dim
  boundaries: Int16Array;  // (bins-1) boundaries per grid dim, packed
}

export interface GridIndexV2 {
  partitions: (PartitionGridV2 | null)[];
}

/**
 * Build grid with configurable bins per dimension.
 * dimBins: maps dimension index to number of bins (2 or 4).
 *          Dims not in the map get 2 bins.
 *          Sentinel dims (5,6) and constant dims (9,10,11) are auto-excluded.
 */
export function buildGridV2(ds: LoadedDataset, dimBins: Map<number, number> = new Map()): GridIndexV2 {
  const partitions: (PartitionGridV2 | null)[] = new Array(NUM_PARTITIONS).fill(null);
  const { vectors, labels, partitionStarts, partitionCounts } = ds;

  for (let p = 0; p < NUM_PARTITIONS; p++) {
    const pStart = partitionStarts[p];
    const pCount = partitionCounts[p];
    if (pCount === 0) continue;

    const hasSentinel5 = (p & 0x08) !== 0;
    const hasSentinel6 = (p & 0x10) !== 0;
    const excludeDims = new Set([9, 10, 11]);
    if (hasSentinel5) excludeDims.add(5);
    if (hasSentinel6) excludeDims.add(6);

    // Grid dims: all dims except excluded
    const gridDims: number[] = [];
    for (let d = 0; d < DIMS; d++) {
      if (!excludeDims.has(d)) gridDims.push(d);
    }
    const numGridDims = gridDims.length;

    // Bins per dim
    const binsPerDim = new Uint16Array(numGridDims);
    for (let gi = 0; gi < numGridDims; gi++) {
      binsPerDim[gi] = dimBins.get(gridDims[gi]) || 1;
    }

    // Compute boundaries (percentiles) for each grid dim
    let totalBoundaries = 0;
    for (let gi = 0; gi < numGridDims; gi++) totalBoundaries += binsPerDim[gi] - 1;
    const boundaries = new Int16Array(totalBoundaries);

    let bOff = 0;
    for (let gi = 0; gi < numGridDims; gi++) {
      const dim = gridDims[gi];
      const bins = binsPerDim[gi];
      const numBounds = bins - 1;
      const vals = new Int16Array(pCount);
      for (let j = 0; j < pCount; j++) vals[j] = vectors[(pStart + j) * DIMS + dim];
      vals.sort();
      for (let b = 0; b < numBounds; b++) {
        // For 2 bins: median (p50). For 4 bins: p25, p50, p75.
        const pctIdx = Math.floor(((b + 1) / bins) * (pCount - 1));
        boundaries[bOff + b] = vals[pctIdx];
      }
      bOff += numBounds;
    }

    // Compute cell key for each vector
    // Key is computed as: for each dim, find bin, then pack bins into a key
    const cellKeys = new Uint32Array(pCount);
    for (let j = 0; j < pCount; j++) {
      const base = (pStart + j) * DIMS;
      let key = 0;
      let bOff2 = 0;
      for (let gi = 0; gi < numGridDims; gi++) {
        const dim = gridDims[gi];
        const bins = binsPerDim[gi];
        const numBounds = bins - 1;
        const v = vectors[base + dim];
        let bin = 0;
        for (let b = 0; b < numBounds; b++) {
          if (v > boundaries[bOff2 + b]) bin = b + 1;
          else break;
        }
        key = key * bins + bin;
        bOff2 += numBounds;
      }
      cellKeys[j] = key;
    }

    // Sort by cell key
    const sortIndices = new Uint32Array(pCount);
    for (let j = 0; j < pCount; j++) sortIndices[j] = j;
    sortIndices.sort((a, b) => cellKeys[a] - cellKeys[b]);

    // Apply permutation (correct cycle sort)
    const visited = new Uint8Array(pCount);
    for (let i = 0; i < pCount; i++) {
      if (visited[i]) continue;
      let j = i;
      while (true) {
        visited[j] = 1;
        const next = sortIndices[j];
        if (next === i) break;
        if (next === j) break;
        const bJ = (pStart + j) * DIMS;
        const bN = (pStart + next) * DIMS;
        for (let d = 0; d < DIMS; d++) { const t = vectors[bJ+d]; vectors[bJ+d] = vectors[bN+d]; vectors[bN+d] = t; }
        const tL = labels[pStart + j]; labels[pStart + j] = labels[pStart + next]; labels[pStart + next] = tL;
        const tK = cellKeys[j]; cellKeys[j] = cellKeys[next]; cellKeys[next] = tK;
        j = next;
      }
    }

    // Build cell metadata
    const cells: { start: number; count: number }[] = [];
    let cs = 0;
    for (let j = 1; j <= pCount; j++) {
      if (j === pCount || cellKeys[j] !== cellKeys[cs]) {
        cells.push({ start: pStart + cs, count: j - cs });
        cs = j;
      }
    }

    const numCells = cells.length;
    const cellStarts = new Uint32Array(numCells);
    const cellCounts = new Uint32Array(numCells);
    const bboxMinFlat = new Int16Array(numCells * DIMS);
    const bboxMaxFlat = new Int16Array(numCells * DIMS);

    for (let ci = 0; ci < numCells; ci++) {
      const { start, count } = cells[ci];
      cellStarts[ci] = start;
      cellCounts[ci] = count;
      const mi = ci * DIMS;
      for (let d = 0; d < DIMS; d++) { bboxMinFlat[mi+d] = 32767; bboxMaxFlat[mi+d] = -32768; }
      for (let k = 0; k < count; k++) {
        const vBase = (start + k) * DIMS;
        for (let d = 0; d < DIMS; d++) {
          const v = vectors[vBase + d];
          if (v < bboxMinFlat[mi+d]) bboxMinFlat[mi+d] = v;
          if (v > bboxMaxFlat[mi+d]) bboxMaxFlat[mi+d] = v;
        }
      }
    }

    partitions[p] = { numCells, cellStarts, cellCounts, bboxMinFlat, bboxMaxFlat, numGridDims, gridDims, binsPerDim, boundaries };
  }
  return { partitions };
}
