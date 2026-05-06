import { loadDataset } from "../src/loader";

const ds = loadDataset();
const DIMS = 14;
const counts = new Float64Array(DIMS);
const sums = new Float64Array(DIMS);
const sqSums = new Float64Array(DIMS);

for (let i = 0; i < ds.count; i++) {
  const base = i * DIMS;
  for (let d = 0; d < DIMS; d++) {
    const v = ds.vectors[base + d];
    sums[d] += v;
    sqSums[d] += v * v;
  }
}

console.log("Dimension Variance Analysis:");
const results = [];
for (let d = 0; d < DIMS; d++) {
  const avg = sums[d] / ds.count;
  const variance = (sqSums[d] / ds.count) - (avg * avg);
  results.push({ d, variance });
}

results.sort((a, b) => b.variance - a.variance);
for (const r of results) {
  console.log(`Dim ${r.d}: variance ${r.variance.toFixed(0)}`);
}
