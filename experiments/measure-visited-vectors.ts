import { readFileSync } from "fs";
import { join } from "path";
import { loadDataset } from "../src/loader";
import { vectorize, quantize } from "../src/vectorizer";
import { buildGridV2 } from "../src/grid-v2";
import { knn5 } from "../src/search-prod";

async function main() {
  const ds = loadDataset();
  const payloads = JSON.parse(readFileSync(join(import.meta.dir, "..", "dataset", "example-payloads.json"), "utf-8"));
  const fb = new Float64Array(14), ib = new Int16Array(14);

  const testConfigs = [
    { name: "Current Prod", dimBins: new Map([[6, 4], [5, 4], [2, 4]]) },
    { name: "More Aggressive", dimBins: new Map([[6, 8], [5, 8], [2, 4], [0, 4]]) },
    { name: "Extreme Pruning", dimBins: new Map([[6, 16], [5, 16], [2, 4], [0, 4], [1, 4]]) },
  ];

  let totalVisited = 0;
  const partVisited = new Map<number, number[]>();

  for (const config of testConfigs) {
    const grid = buildGridV2(ds, config.dimBins);
    console.log(`\n=== Measurement: ${config.name} ===`);
    console.log(`Config: ${JSON.stringify(Array.from(config.dimBins.entries()))}`);
    
    totalVisited = 0;
    partVisited.clear();

  // Mock implementation of knn5 that counts visits
  // (Logic copied from search-prod.ts with counters)
  function knn5_count(query: Int16Array): number {
    let key = 0;
    if (query[9] !== 0) key |= 1;
    if (query[10] !== 0) key |= 2;
    if (query[11] !== 0) key |= 4;
    if (query[5] === -32000) key |= 8;
    if (query[6] === -32000) key |= 16;
    
    const pg = grid.partitions[key];
    if (!pg || pg.numCells === 0) return 0;
    
    const { numCells, cellStarts, cellCounts, bboxMinFlat, bboxMaxFlat } = pg;
    const vectors = ds.vectors;
    
    const q0=query[0],q1=query[1],q2=query[2],q3=query[3],q4=query[4],q7=query[7],q8=query[8],q12=query[12],q13=query[13];
    const isSentinel = (key & 0x18) !== 0;

    // LB calculation
    const cellLBs = new Float64Array(numCells);
    for (let ci = 0; ci < numCells; ci++) {
      const mi = ci * 14;
      let lb = 0;
      const check = (qv: number, idx: number) => { if (qv < bboxMinFlat[idx]) { const d=qv-bboxMinFlat[idx]; lb+=d*d; } else if (qv > bboxMaxFlat[idx]) { const d=qv-bboxMaxFlat[idx]; lb+=d*d; } };
      check(q0, mi); check(q1, mi+1); check(q2, mi+2); check(q3, mi+3); check(q4, mi+4);
      if (!isSentinel) { check(query[5], mi+5); check(query[6], mi+6); }
      check(q7, mi+7); check(q8, mi+8);
      check(q12, mi+12); check(q13, mi+13);
      cellLBs[ci] = lb;
    }

    const sortedCells = new Uint32Array(numCells);
    for (let i = 0; i < numCells; i++) sortedCells[i] = i;
    sortedCells.sort((a, b) => cellLBs[a] - cellLBs[b]);

    let visitedInQuery = 0;
    let topD4 = Infinity;
    
    for (let si = 0; si < numCells; si++) {
      const ci = sortedCells[si];
      if (cellLBs[ci] >= topD4) break;
      const start = cellStarts[ci], end = start + cellCounts[ci];
      for (let i = start; i < end; i++) {
        visitedInQuery++;
        const base = i * 14;
        let dist = 0;
        for (let d = 0; d < 14; d++) { const delta = query[d] - vectors[base+d]; dist += delta * delta; }
        if (dist < topD4) topD4 = dist; // Simplification: just tracking best dist for pruning simulation
      }
    }
    
    if (!partVisited.has(key)) partVisited.set(key, []);
    partVisited.get(key)!.push(visitedInQuery);
    return visitedInQuery;
  }

  for (let i = 0; i < payloads.length; i++) {
    vectorize(payloads[i], fb); quantize(fb, ib);
    totalVisited += knn5_count(ib);
  }

  console.log(`Average visited vectors: ${(totalVisited / payloads.length).toFixed(0)}`);
  
  // Per-partition summary for largest partition (#2)
  if (partVisited.has(2)) {
    const counts2 = partVisited.get(2)!;
    const avg2 = counts2.reduce((a,b)=>a+b,0) / counts2.length;
    const numCells2 = grid.partitions[2]?.numCells || 0;
    console.log(`  Part #2: ${numCells2} cells, avg ${avg2.toFixed(0)} (max ${Math.max(...counts2)}, min ${Math.min(...counts2)})`);
  }
  }
}

main();
