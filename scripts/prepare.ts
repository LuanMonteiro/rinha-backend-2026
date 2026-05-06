/**
 * Build-time script: prepares dataset.bin (partitioned + dim0-sorted) and expected-results.json
 * 
 * Binary format:
 * [4B magic] [4B count] [4B num_partitions]
 * [num_partitions * 4B starts] [num_partitions * 4B counts]
 * [count * 14 * 2B int16 vectors (partition order, sorted by dim 0 within partition)]
 * [count * 1B labels (partition order)]
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { TransactionPayload } from "../src/types";
import { vectorize } from "../src/vectorizer";
import { MAGIC, QUANT_SCALE, SENTINEL_INT16 } from "../src/config";

const DATASET_DIR = join(import.meta.dir, "..", "dataset");
const DIMS = 14;
const K = 5;
const NUM_PARTITIONS = 32;

function computeKey(values: number[]): number {
  let key = 0;
  if (values[9] !== 0) key |= 1;
  if (values[10] !== 0) key |= 2;
  if (values[11] !== 0) key |= 4;
  if (values[5] === -1) key |= 8;
  if (values[6] === -1) key |= 16;
  return key;
}

interface ExpectedResult {
  id: string;
  approved: boolean;
  fraud_score: number;
}

function main() {
  const startTime = performance.now();
  console.log("=== Rinha Backend 2026 — Dataset Preparation ===\n");

  const binPath = join(DATASET_DIR, "..", "dataset.bin");
  const payloadsPath = join(DATASET_DIR, "example-payloads.json");

  console.log("Loading example payloads...");
  const payloads: TransactionPayload[] = JSON.parse(
    readFileSync(payloadsPath, "utf-8")
  );
  const numQueries = payloads.length;
  console.log(`  ${numQueries} example payloads loaded`);

  const queryVectors = new Float64Array(numQueries * DIMS);
  for (let i = 0; i < numQueries; i++) {
    vectorize(payloads[i], queryVectors.subarray(i * DIMS, (i + 1) * DIMS));
  }

  console.log("\nReading references.json...");
  const text = readFileSync(join(DATASET_DIR, "references.json"), "utf-8");
  console.log(`  ${(text.length / 1024 / 1024).toFixed(1)} MB text loaded`);

  // === Pass 1: Count entries per partition ===
  console.log("Counting entries...");
  const ENTRY_RE = /\{"vector":\[([^\]]+)\],"label":"([^"]+)"\}/g;
  let totalCount = 0;
  const partitionCounts = new Uint32Array(NUM_PARTITIONS);
  let match: RegExpExecArray | null;

  while ((match = ENTRY_RE.exec(text)) !== null) {
    const parts = match[1].split(",");
    const vec: number[] = [];
    for (let d = 0; d < DIMS; d++) vec.push(parseFloat(parts[d]));
    partitionCounts[computeKey(vec)]++;
    totalCount++;
  }
  console.log(`  ${totalCount.toLocaleString()} entries in ${NUM_PARTITIONS} partitions`);

  // Partition starts
  const partitionStarts = new Uint32Array(NUM_PARTITIONS);
  for (let p = 1; p < NUM_PARTITIONS; p++) {
    partitionStarts[p] = partitionStarts[p - 1] + partitionCounts[p - 1];
  }

  // === Allocate output ===
  const headerBytes = 12 + NUM_PARTITIONS * 8;
  const vectorBytes = totalCount * DIMS * 2;
  const labelBytes = totalCount;
  const totalBytes = headerBytes + vectorBytes + labelBytes;
  console.log(`  Binary: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);

  const buf = new ArrayBuffer(totalBytes);
  const dv = new DataView(buf);
  dv.setUint32(0, MAGIC, false);
  dv.setUint32(4, totalCount, false);
  dv.setUint32(8, NUM_PARTITIONS, false);
  for (let p = 0; p < NUM_PARTITIONS; p++) {
    dv.setUint32(12 + p * 4, partitionStarts[p], false);
    dv.setUint32(12 + NUM_PARTITIONS * 4 + p * 4, partitionCounts[p], false);
  }

  const outVectors = new Int16Array(buf, headerBytes, totalCount * DIMS);
  const outLabels = new Uint8Array(buf, headerBytes + vectorBytes, totalCount);

  // === Pass 2: Quantize + ground truth ===
  console.log("\nProcessing entries...");
  const writePos = new Uint32Array(partitionStarts);
  const topDists = new Float64Array(numQueries * K);
  const topFraud = new Uint8Array(numQueries * K);
  topDists.fill(Infinity);

  ENTRY_RE.lastIndex = 0;
  let idx = 0;
  let fraudCount = 0;
  const floatVec = new Float64Array(DIMS);

  while ((match = ENTRY_RE.exec(text)) !== null) {
    const vecStr = match[1];
    const label = match[2];
    const isFraud = label === "fraud" ? 1 : 0;

    const parts = vecStr.split(",");
    let key = 0;
    for (let d = 0; d < DIMS; d++) {
      const v = parseFloat(parts[d]);
      floatVec[d] = v;
      if (d === 9 && v !== 0) key |= 1;
      if (d === 10 && v !== 0) key |= 2;
      if (d === 11 && v !== 0) key |= 4;
      if (d === 5 && v === -1) key |= 8;
      if (d === 6 && v === -1) key |= 16;
    }

    const pos = writePos[key]++;
    const base = pos * DIMS;
    for (let d = 0; d < DIMS; d++) {
      const v = floatVec[d];
      outVectors[base + d] = v === -1 ? SENTINEL_INT16 : Math.round(v * QUANT_SCALE);
    }
    outLabels[pos] = isFraud;
    if (isFraud) fraudCount++;

    // Ground truth
    for (let q = 0; q < numQueries; q++) {
      const qBase = q * DIMS;
      let dist = 0;
      for (let d = 0; d < DIMS; d++) {
        const diff = queryVectors[qBase + d] - floatVec[d];
        dist += diff * diff;
      }
      const kBase = q * K;
      let maxIdx = 0, maxDist = topDists[kBase];
      for (let k = 1; k < K; k++) {
        if (topDists[kBase + k] > maxDist) { maxDist = topDists[kBase + k]; maxIdx = k; }
      }
      if (dist < maxDist) { topDists[kBase + maxIdx] = dist; topFraud[kBase + maxIdx] = isFraud; }
    }

    idx++;
    if (idx % 500000 === 0) {
      console.log(`  ${idx.toLocaleString()} entries (${((performance.now() - startTime) / 1000).toFixed(1)}s)`);
    }
  }

  console.log(`  Total: ${idx.toLocaleString()} (${fraudCount.toLocaleString()} fraud)`);

  // === Sort each partition by dim 0 ===
  console.log("\nSorting partitions by dim 0...");
  for (let p = 0; p < NUM_PARTITIONS; p++) {
    const pCount = partitionCounts[p];
    if (pCount <= 1) continue;
    const pStart = partitionStarts[p];

    // Sort indices by dim 0
    const sortIndices = new Uint32Array(pCount);
    for (let i = 0; i < pCount; i++) sortIndices[i] = i;
    const vecBase = pStart * DIMS;
    sortIndices.sort((a, b) => outVectors[vecBase + a * DIMS] - outVectors[vecBase + b * DIMS]);

    // Apply permutation in-place using cycle sort
    const visited = new Uint8Array(pCount);
    for (let i = 0; i < pCount; i++) {
      if (visited[i]) continue;
      let j = i;
      while (!visited[j]) {
        visited[j] = 1;
        const next = sortIndices[j];
        if (next === j) break;
        // Swap vectors
        const bJ = (pStart + j) * DIMS;
        const bN = (pStart + next) * DIMS;
        for (let d = 0; d < DIMS; d++) {
          const tmp = outVectors[bJ + d];
          outVectors[bJ + d] = outVectors[bN + d];
          outVectors[bN + d] = tmp;
        }
        // Swap label
        const tmpL = outLabels[pStart + j];
        outLabels[pStart + j] = outLabels[pStart + next];
        outLabels[pStart + next] = tmpL;
        j = next;
      }
    }

    if (pCount > 100000) {
      console.log(`  Partition #${p}: sorted ${pCount.toLocaleString()} vectors`);
    }
  }

  // Write dataset.bin
  writeFileSync(binPath, Buffer.from(buf));
  console.log(`\nWritten: dataset.bin`);

  // Expected results
  const results: ExpectedResult[] = [];
  for (let q = 0; q < numQueries; q++) {
    const kBase = q * K;
    let frauds = 0;
    for (let k = 0; k < K; k++) frauds += topFraud[kBase + k];
    const fraudScore = frauds / 5;
    results.push({ id: payloads[q].id, approved: fraudScore < 0.6, fraud_score: fraudScore });
  }
  writeFileSync(join(DATASET_DIR, "expected-results.json"), JSON.stringify(results, null, 2));
  console.log(`Written: expected-results.json`);

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Done in ${elapsed}s ===`);
}

main();
