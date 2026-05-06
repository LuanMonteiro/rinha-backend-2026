import { loadDataset } from "../src/loader";
import { buildGridV2 } from "../src/grid-v2";
import { knn5_s3b } from "../src/search-s3b";
import { knn5 as knn5_prod } from "../src/search-prod";

async function main() {
  const ds = loadDataset();
  const dimBins = new Map<number, number>();
  dimBins.set(1, 128);
  dimBins.set(6, 16);
  dimBins.set(5, 8);
  
  const grid = buildGridV2(ds, dimBins);
  
  // Sample 1000 random vectors from dataset as queries
  const queries: Int16Array[] = [];
  for (let i = 0; i < 1000; i++) {
    const idx = Math.floor(Math.random() * ds.count);
    const q = new Int16Array(14);
    q.set(ds.vectors.subarray(idx * 14, idx * 14 + 14));
    queries.push(q);
  }

  console.log("=== Strategy Performance (No HTTP, No Cache) ===");
  
  // Warmup S3B
  for (let i = 0; i < 1000; i++) knn5_s3b(queries[i % 1000], ds, grid);
  
  const startS3B = performance.now();
  for (const q of queries) knn5_s3b(q, ds, grid);
  const endS3B = performance.now();
  console.log(`S3B: ${((endS3B - startS3B) / 1000).toFixed(3)}ms per query`);

  // Warmup Prod (S5)
  for (let i = 0; i < 1000; i++) knn5_prod(queries[i % 1000], ds, grid);
  
  const startProd = performance.now();
  for (const q of queries) knn5_prod(q, ds, grid);
  const endProd = performance.now();
  console.log(`Prod (S5): ${((endProd - startProd) / 1000).toFixed(3)}ms per query`);
}

main();
