import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { fastVectorizeAndQuantize } from "../src/fast-json";
import { quantize, vectorize } from "../src/vectorizer";
import type { TransactionPayload } from "../src/types";

describe("fastVectorizeAndQuantize", () => {
  test("matches vectorize+quantize for official example payloads", () => {
    const payloads: TransactionPayload[] = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "dataset", "example-payloads.json"), "utf-8"),
    );

    const encoder = new TextEncoder();
    const floatBuf = new Float64Array(14);
    const ref = new Int16Array(14);
    const fast = new Int16Array(14);

    for (const payload of payloads) {
      vectorize(payload, floatBuf);
      quantize(floatBuf, ref);
      fastVectorizeAndQuantize(Buffer.from(JSON.stringify(payload)), fast);
      expect(Array.from(fast)).toEqual(Array.from(ref));
    }
  });
});
