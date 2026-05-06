/**
 * Build-time script: prepares dataset.bin (partitioned + dim0-sorted)
 * Optimized for low memory (streams gzipped input)
 */
import { readFileSync, writeFileSync, existsSync, createReadStream } from "fs";
import { join } from "path";
import { createGunzip } from "zlib";
import { MAGIC, QUANT_SCALE, SENTINEL_INT16 } from "../src/config";

const DIMS = 14;
const NUM_PARTITIONS = 32;

const DATASET_DIR = existsSync("/resources") ? "/resources" : join(import.meta.dir, "..", "dataset");
const BIN_PATH = join(import.meta.dir, "..", "dataset.bin");

function computeKey(values: number[]): number {
  let key = 0;
  if (values[9] !== 0) key |= 1;
  if (values[10] !== 0) key |= 2;
  if (values[11] !== 0) key |= 4;
  if (values[5] === -1) key |= 8;
  if (values[6] === -1) key |= 16;
  return key;
}

async function processStream(path: string, callback: (vector: number[], label: string) => void) {
  const isGz = path.endsWith(".gz");
  let stream = createReadStream(path);
  if (isGz) {
    const gunzip = createGunzip();
    stream.pipe(gunzip);
    // @ts-ignore
    stream = gunzip;
  }

  let buffer = "";
  for await (const chunk of stream) {
    buffer += chunk.toString();
    while (true) {
      const start = buffer.indexOf('{"vector":[');
      if (start === -1) break;
      const end = buffer.indexOf("}", start);
      if (end === -1) break;

      const line = buffer.substring(start, end + 1);
      const match = /\{"vector":\[([^\]]+)\],"label":"([^"]+)"\}/.exec(line);
      if (match) {
        const parts = match[1].split(",");
        const vec = parts.map(p => parseFloat(p));
        callback(vec, match[2]);
      }
      buffer = buffer.substring(end + 1);
    }
  }
}

async function main() {
  const startTime = performance.now();
  console.log("=== Rinha Backend 2026 — Dataset Preparation (Streaming) ===\n");

  const gzPath = join(DATASET_DIR, "references.json.gz");
  const jsonPath = join(DATASET_DIR, "references.json");
  const inputPath = existsSync(gzPath) ? gzPath : jsonPath;

  if (!existsSync(inputPath)) {
    throw new Error("Dataset not found at " + inputPath);
  }

  // === Pass 1: Count entries per partition ===
  console.log("Pass 1: Counting entries...");
  let totalCount = 0;
  const partitionCounts = new Uint32Array(NUM_PARTITIONS);
  
  await processStream(inputPath, (vec) => {
    partitionCounts[computeKey(vec)]++;
    totalCount++;
  });
  
  console.log(`  ${totalCount.toLocaleString()} entries in ${NUM_PARTITIONS} partitions`);

  const partitionStarts = new Uint32Array(NUM_PARTITIONS);
  for (let p = 1; p < NUM_PARTITIONS; p++) {
    partitionStarts[p] = partitionStarts[p - 1] + partitionCounts[p - 1];
  }

  // === Allocate output ===
  const headerBytes = 12 + NUM_PARTITIONS * 8;
  const vectorBytes = totalCount * DIMS * 2;
  const labelBytes = totalCount;
  const totalBytes = headerBytes + vectorBytes + labelBytes;
  
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

  // === Pass 2: Quantize ===
  console.log("\nPass 2: Quantizing...");
  const writePos = new Uint32Array(partitionStarts);
  let idx = 0;

  await processStream(inputPath, (vec, label) => {
    const isFraud = label === "fraud" ? 1 : 0;
    let key = computeKey(vec);
    const pos = writePos[key]++;
    const base = pos * DIMS;
    for (let d = 0; d < DIMS; d++) {
      const v = vec[d];
      outVectors[base + d] = v === -1 ? SENTINEL_INT16 : Math.round(v * QUANT_SCALE);
    }
    outLabels[pos] = isFraud;
    idx++;
    if (idx % 1000000 === 0) {
      console.log(`  ${idx.toLocaleString()} entries processed...`);
    }
  });

  // === Sort each partition by dim 0 ===
  console.log("\nSorting partitions by dim 0...");
  for (let p = 0; p < NUM_PARTITIONS; p++) {
    const pCount = partitionCounts[p];
    if (pCount <= 1) continue;
    const pStart = partitionStarts[p];
    const sortIndices = new Uint32Array(pCount);
    for (let i = 0; i < pCount; i++) sortIndices[i] = i;
    const vecBase = pStart * DIMS;
    sortIndices.sort((a, b) => outVectors[vecBase + a * DIMS] - outVectors[vecBase + b * DIMS]);

    const visited = new Uint8Array(pCount);
    for (let i = 0; i < pCount; i++) {
      if (visited[i]) continue;
      let j = i;
      while (!visited[j]) {
        visited[j] = 1;
        const next = sortIndices[j];
        if (next === j) break;
        const bJ = (pStart + j) * DIMS;
        const bN = (pStart + next) * DIMS;
        for (let d = 0; d < DIMS; d++) {
          const tmp = outVectors[bJ + d];
          outVectors[bJ + d] = outVectors[bN + d];
          outVectors[bN + d] = tmp;
        }
        const tmpL = outLabels[pStart + j];
        outLabels[pStart + j] = outLabels[pStart + next];
        outLabels[pStart + next] = tmpL;
        j = next;
      }
    }
  }

  writeFileSync(BIN_PATH, Buffer.from(buf));
  console.log(`\nWritten: dataset.bin (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`=== Done in ${((performance.now() - startTime) / 1000).toFixed(1)}s ===`);
}

main();
