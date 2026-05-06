import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import type { TransactionPayload, LoadedDataset } from "../src/types";

interface ExpectedResult {
  id: string;
  approved: boolean;
  fraud_score: number;
}

const TEST_PORT = 9997;

describe("API integration", () => {
  let server: ReturnType<typeof Bun.serve>;
  const baseUrl = `http://localhost:${TEST_PORT}`;

  beforeAll(async () => {
    const { loadDataset } = await import("../src/loader");
    const { vectorize, quantize } = await import("../src/vectorizer");
    const { knn5 } = await import("../src/searcher");
    const { FRAUD_THRESHOLD } = await import("../src/config");

    const ds: LoadedDataset = loadDataset();
    const floatBuf = new Float64Array(14);
    const int16Buf = new Int16Array(14);

    server = Bun.serve({
      port: TEST_PORT,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/ready") {
          return new Response("ok", { status: 200 });
        }

        if (url.pathname === "/fraud-score" && req.method === "POST") {
          const payload: TransactionPayload = await req.json();
          vectorize(payload, floatBuf);
          quantize(floatBuf, int16Buf);
          const fraudCount = knn5(int16Buf, ds);
          const fraudScore = fraudCount / 5;
          return Response.json({
            approved: fraudScore < FRAUD_THRESHOLD,
            fraud_score: fraudScore,
          });
        }

        return new Response("not found", { status: 404 });
      },
    });
  });

  afterAll(() => {
    server?.stop();
  });

  test("GET /ready returns 200", async () => {
    const res = await fetch(`${baseUrl}/ready`);
    expect(res.status).toBe(200);
  });

  test("POST /fraud-score returns correct shape", async () => {
    const payloads: TransactionPayload[] = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "dataset", "example-payloads.json"), "utf-8")
    );
    const res = await fetch(`${baseUrl}/fraud-score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloads[0]),
    });
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data).toHaveProperty("approved");
    expect(data).toHaveProperty("fraud_score");
    expect(typeof data.approved).toBe("boolean");
    expect(typeof data.fraud_score).toBe("number");
  });

  test("POST /fraud-score matches expected results for all examples", async () => {
    const datasetDir = join(import.meta.dir, "..", "dataset");
    const payloads: TransactionPayload[] = JSON.parse(
      readFileSync(join(datasetDir, "example-payloads.json"), "utf-8")
    );
    const expected: ExpectedResult[] = JSON.parse(
      readFileSync(join(datasetDir, "expected-results.json"), "utf-8")
    );

    const failures: string[] = [];
    for (let i = 0; i < payloads.length; i++) {
      const res = await fetch(`${baseUrl}/fraud-score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloads[i]),
      });
      const data: any = await res.json();
      if (data.fraud_score !== expected[i].fraud_score) {
        failures.push(
          `${payloads[i].id}: got fraud_score=${data.fraud_score}, expected=${expected[i].fraud_score}`
        );
      }
    }

    if (failures.length > 0) {
      console.error("API FAILURES:");
      for (const f of failures) console.error(`  ${f}`);
    }
    expect(failures.length).toBe(0);
  });
});
