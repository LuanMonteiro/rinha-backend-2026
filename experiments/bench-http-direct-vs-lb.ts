import { readFileSync } from "fs";
import { join } from "path";

type BenchResult = {
  name: string;
  url: string;
  warmup: number;
  requests: number;
  samples: number;
  non2xx: number;
  errors: number;
  stats: ReturnType<typeof stats>;
};

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    p999: percentile(sorted, 99.9),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  };
}

function fmtMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(1)}μs`;
  return `${ms.toFixed(3)}ms`;
}

async function benchTarget(name: string, url: string, bodies: string[]): Promise<BenchResult> {
  const warmup = Number(process.env.HTTP_WARMUP || 50);
  const requests = Number(process.env.HTTP_REQS || 1000);
  const headers = { "Content-Type": "application/json" };

  console.log(`\n=== ${name} (${url}) ===`);
  console.log(`Warmup: ${warmup}, Requests: ${requests}`);

  for (let i = 0; i < warmup; i++) {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: bodies[i % bodies.length],
    });
    await res.text();
  }

  const latencies: number[] = [];
  let non2xx = 0;
  let errors = 0;

  for (let i = 0; i < requests; i++) {
    const body = bodies[i % bodies.length];
    const t0 = performance.now();

    try {
      const res = await fetch(url, { method: "POST", headers, body });
      await res.text();
      const t1 = performance.now();
      if (!res.ok) non2xx++;
      latencies.push(t1 - t0);
    } catch {
      errors++;
    }
  }

  if (latencies.length === 0) {
    throw new Error(`${name}: no successful samples`);
  }

  const result: BenchResult = {
    name,
    url,
    warmup,
    requests,
    samples: latencies.length,
    non2xx,
    errors,
    stats: stats(latencies),
  };

  console.log(`samples=${result.samples} non2xx=${result.non2xx} errors=${result.errors}`);
  console.log(
    `p50=${fmtMs(result.stats.p50)} p95=${fmtMs(result.stats.p95)} p99=${fmtMs(result.stats.p99)} p999=${fmtMs(result.stats.p999)} max=${fmtMs(result.stats.max)}`,
  );

  return result;
}

function printComparison(api: BenchResult, lb: BenchResult): void {
  const lbMinusApiP99 = lb.stats.p99 - api.stats.p99;
  console.log("\n=== Comparison ===");
  console.log(`api.p99=${fmtMs(api.stats.p99)} lb.p99=${fmtMs(lb.stats.p99)} lb-api=${fmtMs(lbMinusApiP99)}`);
  console.log(`api.max=${fmtMs(api.stats.max)} lb.max=${fmtMs(lb.stats.max)}`);
}

async function main() {
  const payloads = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "dataset", "example-payloads.json"), "utf-8"),
  );
  const bodies = payloads.map((p: unknown) => JSON.stringify(p));

  const apiUrl = process.env.API_URL || "http://localhost:9998/fraud-score";
  const lbUrl = process.env.LB_URL || "http://localhost:9999/fraud-score";

  const api = await benchTarget("API direct", apiUrl, bodies);
  const lb = await benchTarget("LB", lbUrl, bodies);

  printComparison(api, lb);
}

main();
