import { readFileSync } from "fs";
import { join } from "path";

import { FRAUD_THRESHOLD, PROD_DIM_BINS } from "../src/config";
import { fastVectorizeAndQuantize } from "../src/fast-json";
import { buildGridV2 } from "../src/grid-v2";
import { loadDataset } from "../src/loader";
import { knn5 } from "../src/search-prod";
import type { FraudScoreResponse, TransactionPayload } from "../src/types";

type ExpectedResult = {
  id: string;
  approved: boolean;
  fraud_score: number;
};

type PhaseStats = {
  p50: number;
  p95: number;
  p99: number;
  max: number;
};

type PayloadProfile = {
  id: string;
  partitionKey: number;
  parseOnly: PhaseStats;
  searchOnly: PhaseStats;
  parseSearch: PhaseStats;
};

const REPS = Number(process.env.REPS ?? 300);

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function buildStats(samples: number[]): PhaseStats {
  samples.sort((a, b) => a - b);
  return {
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    p99: percentile(samples, 0.99),
    max: samples[samples.length - 1] ?? 0,
  };
}

function partitionKeyFor(query: Int16Array): number {
  let key = 0;
  if (query[9] !== 0) key |= 1;
  if (query[10] !== 0) key |= 2;
  if (query[11] !== 0) key |= 4;
  if (query[5] === -32000) key |= 8;
  if (query[6] === -32000) key |= 16;
  return key;
}

function fmtMicros(ms: number): string {
  return (ms * 1000).toFixed(2);
}

function toApiResult(fraudCount: number): FraudScoreResponse {
  const fraudScore = fraudCount / 5;
  return {
    approved: fraudScore < FRAUD_THRESHOLD,
    fraud_score: fraudScore,
  };
}

function assertEqualResult(id: string, got: FraudScoreResponse, exp: ExpectedResult): void {
  if (got.approved !== exp.approved || got.fraud_score !== exp.fraud_score) {
    throw new Error(
      `${id}: got approved=${got.approved} fraud_score=${got.fraud_score}, expected approved=${exp.approved} fraud_score=${exp.fraud_score}`,
    );
  }
}

async function main() {
  const datasetDir = join(import.meta.dir, "..", "dataset");
  const payloads: TransactionPayload[] = JSON.parse(readFileSync(join(datasetDir, "example-payloads.json"), "utf-8"));
  const expected: ExpectedResult[] = JSON.parse(readFileSync(join(datasetDir, "expected-results.json"), "utf-8"));

  if (payloads.length !== expected.length) {
    throw new Error(`payload/expected length mismatch: ${payloads.length} vs ${expected.length}`);
  }

  const expectedById = new Map(expected.map((e) => [e.id, e]));

  const ds = loadDataset();
  const dimBins = new Map<number, number>(PROD_DIM_BINS);
  const grid = buildGridV2(ds, dimBins);

  const bufferBodies = payloads.map((p) => Buffer.from(JSON.stringify(p)));
  const uint8Bodies = bufferBodies.map((b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
  if (uint8Bodies.length !== payloads.length) {
    throw new Error("internal body array length mismatch");
  }

  const queryScratch = new Int16Array(14);
  const precomputedQueries = bufferBodies.map((body) => {
    const q = new Int16Array(14);
    fastVectorizeAndQuantize(body, q);
    return q;
  });

  for (let i = 0; i < payloads.length; i++) {
    const exp = expectedById.get(payloads[i].id);
    if (!exp) throw new Error(`missing expected result for id=${payloads[i].id}`);
    const fraudCount = knn5(precomputedQueries[i], ds, grid);
    assertEqualResult(payloads[i].id, toApiResult(fraudCount), exp);
  }

  const profiles: PayloadProfile[] = [];

  for (let i = 0; i < payloads.length; i++) {
    const parseOnlySamples: number[] = [];
    const searchOnlySamples: number[] = [];
    const parseSearchSamples: number[] = [];

    const searchQuery = precomputedQueries[i];

    for (let r = 0; r < REPS; r++) {
      let t0 = performance.now();
      fastVectorizeAndQuantize(bufferBodies[i], queryScratch);
      let t1 = performance.now();
      parseOnlySamples.push(t1 - t0);

      t0 = performance.now();
      knn5(searchQuery, ds, grid);
      t1 = performance.now();
      searchOnlySamples.push(t1 - t0);

      t0 = performance.now();
      fastVectorizeAndQuantize(bufferBodies[i], queryScratch);
      knn5(queryScratch, ds, grid);
      t1 = performance.now();
      parseSearchSamples.push(t1 - t0);
    }

    profiles.push({
      id: payloads[i].id,
      partitionKey: partitionKeyFor(searchQuery),
      parseOnly: buildStats(parseOnlySamples),
      searchOnly: buildStats(searchOnlySamples),
      parseSearch: buildStats(parseSearchSamples),
    });
  }

  const top10 = profiles
    .slice()
    .sort((a, b) => b.parseSearch.p99 - a.parseSearch.p99)
    .slice(0, 10)
    .map((p) => ({
      id: p.id,
      partitionKey: p.partitionKey,
      parse_p50_us: fmtMicros(p.parseOnly.p50),
      parse_p95_us: fmtMicros(p.parseOnly.p95),
      parse_p99_us: fmtMicros(p.parseOnly.p99),
      parse_max_us: fmtMicros(p.parseOnly.max),
      search_p50_us: fmtMicros(p.searchOnly.p50),
      search_p95_us: fmtMicros(p.searchOnly.p95),
      search_p99_us: fmtMicros(p.searchOnly.p99),
      search_max_us: fmtMicros(p.searchOnly.max),
      parse_search_p50_us: fmtMicros(p.parseSearch.p50),
      parse_search_p95_us: fmtMicros(p.parseSearch.p95),
      parse_search_p99_us: fmtMicros(p.parseSearch.p99),
      parse_search_max_us: fmtMicros(p.parseSearch.max),
    }));

  console.log(`validated payloads=${payloads.length} reps=${REPS}`);
  console.table(top10);
}

await main();
