import { readFileSync } from "fs";
import { join } from "path";
import { vectorize } from "../src/vectorizer";
import { fastVectorize } from "../src/fast-json";
import type { TransactionPayload } from "../src/types";

const payloads: TransactionPayload[] = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "dataset", "example-payloads.json"), "utf-8")
);

const fb1 = new Float64Array(14);
const fb2 = new Float64Array(14);

let failures = 0;

for (const p of payloads) {
  // Original
  vectorize(p, fb1);
  
  // Fast
  const buf = Buffer.from(JSON.stringify(p));
  fastVectorize(buf, fb2);
  
  for (let i = 0; i < 14; i++) {
    if (Math.abs(fb1[i] - fb2[i]) > 0.0001) {
      console.error(`Mismatch at dim ${i} for payload ${p.id}: exp ${fb1[i]}, got ${fb2[i]}`);
      failures++;
    }
  }
}

if (failures === 0) {
  console.log("SUCCESS: fastVectorize matches vectorize for all examples!");
} else {
  console.log(`FAILED: ${failures} mismatches found.`);
  process.exit(1);
}
