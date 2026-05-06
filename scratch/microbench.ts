import { loadDataset } from "../src/loader";
import { fastVectorizeAndQuantize } from "../src/fast-json";
import { knn5 } from "../src/search-prod";
import { buildGridV2 } from "../src/grid-v2";

const ds = loadDataset();
const dimBins = new Map<number, number>();
dimBins.set(6, 4);
dimBins.set(5, 4);
dimBins.set(2, 4);
const grid = buildGridV2(ds, dimBins);

const payload = Buffer.from(JSON.stringify({
  transaction: { amount: 100, installments: 1, requested_at: "2026-05-05T20:00:00Z" },
  customer: { avg_amount: 150, tx_count_24h: 2, known_merchants: ["M1", "M2"] },
  merchant: { id: "M1", mcc: "5411", avg_amount: 200 },
  terminal: { is_online: true, card_present: true, km_from_home: 5 },
  last_transaction: { timestamp: "2026-05-05T19:50:00Z", km_from_current: 2 }
}));

const out = new Int16Array(14);

// Warmup
for (let i = 0; i < 1000; i++) {
  fastVectorizeAndQuantize(payload, out);
  knn5(out, ds, grid);
}

const start = performance.now();
const iters = 10000;
for (let i = 0; i < iters; i++) {
  fastVectorizeAndQuantize(payload, out);
  knn5(out, ds, grid);
}
const end = performance.now();
console.log(`Avg time: ${((end - start) / iters * 1000).toFixed(2)}μs`);
