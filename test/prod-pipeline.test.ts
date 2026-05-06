import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { fastVectorizeAndQuantize } from "../src/fast-json";
import { buildGridV2 } from "../src/grid-v2";
import { loadDataset } from "../src/loader";
import { knn5 } from "../src/search-prod";
import { FRAUD_THRESHOLD, PROD_DIM_BINS } from "../src/config";
import type { TransactionPayload } from "../src/types";

type ExpectedResult = { id: string; approved: boolean; fraud_score: number };

describe("production hot path", () => {
  test("matches expected results for all official examples", () => {
    const datasetDir = join(import.meta.dir, "..", "dataset");
    const payloads: TransactionPayload[] = JSON.parse(
      readFileSync(join(datasetDir, "example-payloads.json"), "utf-8"),
    );
    const expected: ExpectedResult[] = JSON.parse(
      readFileSync(join(datasetDir, "expected-results.json"), "utf-8"),
    );

    const ds = loadDataset();
    const grid = buildGridV2(ds, new Map<number, number>(PROD_DIM_BINS));
    const encoder = new TextEncoder();
    const query = new Int16Array(14);

    for (let i = 0; i < payloads.length; i++) {
      const bytes = encoder.encode(JSON.stringify(payloads[i]));
      fastVectorizeAndQuantize(Buffer.from(bytes), query);
      const fraudCount = knn5(query, ds, grid);
      const fraudScore = fraudCount / 5;

      expect({
        approved: fraudScore < FRAUD_THRESHOLD,
        fraud_score: fraudScore,
      }).toEqual({
        approved: expected[i].approved,
        fraud_score: expected[i].fraud_score,
      });
    }
  });
});
