import { readFileSync } from "fs";
import { join } from "path";
import type { TransactionPayload } from "../src/types";

type ExpectedResult = {
  id: string;
  approved: boolean;
  fraud_score: number;
};

type ApiResult = {
  approved: boolean;
  fraud_score: number;
};

async function main() {
  const url = process.env.URL || "http://localhost:9999/fraud-score";
  const datasetDir = join(import.meta.dir, "..", "dataset");

  const payloads: TransactionPayload[] = JSON.parse(
    readFileSync(join(datasetDir, "example-payloads.json"), "utf-8"),
  );
  const expected: ExpectedResult[] = JSON.parse(
    readFileSync(join(datasetDir, "expected-results.json"), "utf-8"),
  );

  if (payloads.length !== expected.length) {
    throw new Error(`payload/expected length mismatch: ${payloads.length} vs ${expected.length}`);
  }

  const failures: string[] = [];

  for (let i = 0; i < payloads.length; i++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloads[i]),
      });
    } catch (error) {
      failures.push(`${payloads[i].id}: fetch error ${String(error)}`);
      continue;
    }

    if (!res.ok) {
      failures.push(`${payloads[i].id}: non-2xx status ${res.status}`);
      continue;
    }

    let body: ApiResult;
    try {
      body = await res.json();
    } catch (error) {
      failures.push(`${payloads[i].id}: invalid JSON ${String(error)}`);
      continue;
    }

    const exp = expected[i];
    if (body.approved !== exp.approved || body.fraud_score !== exp.fraud_score) {
      failures.push(
        `${payloads[i].id}: got approved=${body.approved} fraud_score=${body.fraud_score}, expected approved=${exp.approved} fraud_score=${exp.fraud_score}`,
      );
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    console.error(`checked=${payloads.length} failures=${failures.length}`);
    process.exit(1);
  }

  console.log(`checked=${payloads.length} failures=0`);
}

await main();
