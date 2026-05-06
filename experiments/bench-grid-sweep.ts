/**
 * Grid config sweep: test different bin configurations to find optimal.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { computeQueryKey } from "../src/loader";
import { vectorize, quantize } from "../src/vectorizer";
import { buildGridV2 } from "../src/grid-v2";
import type { LoadedDataset } from "../src/types";
import type { GridIndexV2, PartitionGridV2 } from "../src/grid-v2";
import { KNN_K, SENTINEL_INT16 } from "../src/config";

const DIMS = 14;
const K = KNN_K;

function loadFresh(): LoadedDataset {
  const buf = readFileSync(join(import.meta.dir, "..", "dataset.bin"));
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = view.getUint32(4, false);
  const np = view.getUint32(8, false);
  const ps = new Uint32Array(np), pc = new Uint32Array(np);
  for (let p = 0; p < np; p++) { ps[p] = view.getUint32(12 + p * 4, false); pc[p] = view.getUint32(12 + np * 4 + p * 4, false); }
  const hb = 12 + np * 8;
  const vectors = new Int16Array(buf.buffer, buf.byteOffset + hb, count * 14);
  const labels = new Uint8Array(buf.buffer, buf.byteOffset + hb + count * 14 * 2, count);
  return { vectors, labels, count, partitionStarts: ps, partitionCounts: pc, numPartitions: np };
}

function pct(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function fmt(ms: number): string { return ms < 1 ? (ms * 1000).toFixed(1) + "μs" : ms.toFixed(3) + "ms"; }

function knn5_gridv2(query: Int16Array, ds: LoadedDataset, grid: GridIndexV2): number {
  const key = computeQueryKey(query);
  const pg = grid.partitions[key];
  if (!pg || pg.numCells === 0) return 0;
  const { numCells, cellStarts, cellCounts, bboxMinFlat, bboxMaxFlat } = pg;
  const vectors = ds.vectors, labels = ds.labels;
  const q0=query[0],q1=query[1],q2=query[2],q3=query[3],q4=query[4],q5=query[5],q6=query[6],q7=query[7],q8=query[8],q12=query[12],q13=query[13];
  const isSentinel = (key & 0x18) !== 0;
  let topD0=Infinity,topD1=Infinity,topD2=Infinity,topD3=Infinity,topD4=Infinity;
  let topI0=-1,topI1=-1,topI2=-1,topI3=-1,topI4=-1;

  // lb computation — skip constant dims
  const cellLBs = new Float64Array(numCells);
  for (let ci = 0; ci < numCells; ci++) {
    const mi = ci * DIMS;
    let lb = 0;
    const check = (qv: number, idx: number) => { if (qv < bboxMinFlat[idx]) { const d=qv-bboxMinFlat[idx]; lb+=d*d; } else if (qv > bboxMaxFlat[idx]) { const d=qv-bboxMaxFlat[idx]; lb+=d*d; } };
    check(q0, mi); check(q1, mi+1); check(q2, mi+2); check(q3, mi+3); check(q4, mi+4);
    if (!isSentinel) { check(q5, mi+5); check(q6, mi+6); }
    check(q7, mi+7); check(q8, mi+8);
    check(q12, mi+12); check(q13, mi+13);
    cellLBs[ci] = lb;
  }

  const sortedCells = new Uint32Array(numCells);
  for (let i = 0; i < numCells; i++) sortedCells[i] = i;
  sortedCells.sort((a, b) => cellLBs[a] - cellLBs[b]);

  // Search — specialized for sentinel vs non-sentinel
  if (isSentinel) {
    for (let si = 0; si < numCells; si++) {
      const ci = sortedCells[si]; if (cellLBs[ci] >= topD4) break;
      const start = cellStarts[ci], end = start + cellCounts[ci];
      for (let i = start; i < end; i++) {
        const base = i * DIMS;
        const d0=q0-vectors[base]; let dist=d0*d0; if(dist>=topD4)continue;
        const d1=q1-vectors[base+1];dist+=d1*d1;if(dist>=topD4)continue;
        const d2=q2-vectors[base+2];dist+=d2*d2;if(dist>=topD4)continue;
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
    for (let si = 0; si < numCells; si++) {
      const ci = sortedCells[si]; if (cellLBs[ci] >= topD4) break;
      const start = cellStarts[ci], end = start + cellCounts[ci];
      for (let i = start; i < end; i++) {
        const base = i * DIMS;
        const d0=q0-vectors[base];let dist=d0*d0;if(dist>=topD4)continue;
        const d1=q1-vectors[base+1];dist+=d1*d1;if(dist>=topD4)continue;
        const d2=q2-vectors[base+2];dist+=d2*d2;if(dist>=topD4)continue;
        const d3=q3-vectors[base+3];dist+=d3*d3;if(dist>=topD4)continue;
        const d4=q4-vectors[base+4];dist+=d4*d4;if(dist>=topD4)continue;
        const d5=q5-vectors[base+5];dist+=d5*d5;if(dist>=topD4)continue;
        const d6=q6-vectors[base+6];dist+=d6*d6;if(dist>=topD4)continue;
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

async function main() {
  const payloads = JSON.parse(readFileSync(join(import.meta.dir, "..", "dataset", "example-payloads.json"), "utf-8"));
  const expected = JSON.parse(readFileSync(join(import.meta.dir, "..", "dataset", "expected-results.json"), "utf-8"));
  const fb = new Float64Array(14), ib = new Int16Array(14);
  const REPS = 100;

  const configs: { name: string; dimBins: Map<number, number> }[] = [
    { name: "2bins-all (baseline S3)", dimBins: new Map() },
    { name: "4bins-dim0", dimBins: new Map([[0, 4]]) },
    { name: "4bins-dim0+dim2", dimBins: new Map([[0, 4], [2, 4]]) },
    { name: "4bins-dim0+dim1+dim2", dimBins: new Map([[0, 4], [1, 4], [2, 4]]) },
    { name: "8bins-dim0", dimBins: new Map([[0, 8]]) },
    { name: "8bins-dim0+4bins-dim2", dimBins: new Map([[0, 8], [2, 4]]) },
  ];

  for (const config of configs) {
    console.log(`\n=== ${config.name} ===`);
    const ds = loadFresh();

    const t0 = performance.now();
    const grid = buildGridV2(ds, config.dimBins);
    const buildTime = performance.now() - t0;

    // Stats for largest partition (#2)
    const pg2 = grid.partitions[2]!;
    const maxCell = pg2.cellCounts.reduce((a, b) => Math.max(a, b), 0);
    const avgCell = ds.partitionCounts[2] / pg2.numCells;
    console.log(`  Build: ${buildTime.toFixed(0)}ms, #2: ${pg2.numCells} cells, max=${maxCell}, avg=${avgCell.toFixed(0)}`);

    // Correctness
    let fails = 0;
    for (let i = 0; i < payloads.length; i++) {
      vectorize(payloads[i], fb); quantize(fb, ib);
      const f = knn5_gridv2(ib, ds, grid);
      if (f / 5 !== expected[i].fraud_score) { fails++; console.error(`  FAIL ${payloads[i].id}`); }
    }
    if (fails > 0) { console.log(`  ${fails} FAILURES — skipping benchmark`); continue; }
    console.log(`  Correctness: PASS`);

    // Benchmark
    for (let i = 0; i < 200; i++) { vectorize(payloads[i%50], fb); quantize(fb, ib); knn5_gridv2(ib, ds, grid); }
    const times: number[] = [];
    for (let r = 0; r < REPS; r++) for (let i = 0; i < payloads.length; i++) {
      vectorize(payloads[i], fb); quantize(fb, ib);
      const t0 = performance.now(); knn5_gridv2(ib, ds, grid); const t1 = performance.now();
      times.push(t1 - t0);
    }
    times.sort((a, b) => a - b);
    console.log(`  p50: ${fmt(pct(times, 50))}, p95: ${fmt(pct(times, 95))}, p99: ${fmt(pct(times, 99))}, p999: ${fmt(pct(times, 99.9))}`);
  }
}

main();
