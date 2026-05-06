import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { loadDataset } from "../src/loader";
import { vectorize, quantize } from "../src/vectorizer";
import { knn5 } from "../src/searcher";
import type { TransactionPayload } from "../src/types";

interface ExpectedResult {
  id: string;
  approved: boolean;
  fraud_score: number;
}

describe("correctness: int16 vs float64 ground truth", () => {
  const datasetDir = join(import.meta.dir, "..", "dataset");

  test("all example payloads match expected results (zero tolerance)", () => {
    const expected: ExpectedResult[] = JSON.parse(
      readFileSync(join(datasetDir, "expected-results.json"), "utf-8")
    );
    const payloads: TransactionPayload[] = JSON.parse(
      readFileSync(join(datasetDir, "example-payloads.json"), "utf-8")
    );

    const ds = loadDataset();
    const floatBuf = new Float64Array(14);
    const int16Buf = new Int16Array(14);
    const failures: string[] = [];

    for (let i = 0; i < payloads.length; i++) {
      vectorize(payloads[i], floatBuf);
      quantize(floatBuf, int16Buf);
      const fraudCount = knn5(int16Buf, ds);
      const fraudScore = fraudCount / 5;
      const approved = fraudScore < 0.6;

      if (fraudScore !== expected[i].fraud_score) {
        failures.push(
          `${payloads[i].id}: got fraud_score=${fraudScore}, expected=${expected[i].fraud_score}`
        );
      }
      if (approved !== expected[i].approved) {
        failures.push(
          `${payloads[i].id}: got approved=${approved}, expected=${expected[i].approved}`
        );
      }
    }

    if (failures.length > 0) {
      console.error("FAILURES:");
      for (const f of failures) console.error(`  ${f}`);
    }
    expect(failures.length).toBe(0);
  });
});
