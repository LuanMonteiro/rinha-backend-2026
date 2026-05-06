import { readFileSync } from "fs";
import { join } from "path";

type LoadResult = {
  targetRps: number;
  durationSec: number;
  totalIssued: number;
  totalLaunched: number;
  completed: number;
  errors: number;
  non2xx: number;
  scheduleMisses: number;
  maxObservedInFlight: number;
  achievedRps: number;
  elapsedMs: number;
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
    max: sorted[sorted.length - 1],
  };
}

function fmtMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(1)}μs`;
  return `${ms.toFixed(3)}ms`;
}

function readBodies(): string[] {
  const file = process.env.PAYLOAD_FILE || join(import.meta.dir, "..", "dataset", "example-payloads.json");
  const payloads = JSON.parse(readFileSync(file, "utf-8"));
  if (!Array.isArray(payloads) || payloads.length === 0) {
    throw new Error(`No payloads loaded from ${file}`);
  }
  return payloads.map((p: unknown) => JSON.stringify(p));
}

async function runArrivalRate(
  url: string,
  bodies: string[],
  targetRps: number,
  durationSec: number,
  maxInFlight: number,
): Promise<LoadResult> {
  const total = Math.floor(targetRps * durationSec);
  const intervalMs = 1000 / targetRps;
  const headers = { "Content-Type": "application/json" };

  const latencies: number[] = [];
  let issued = 0;
  let launched = 0;
  let completed = 0;
  let errors = 0;
  let non2xx = 0;
  let scheduleMisses = 0;
  let inFlight = 0;
  let maxObservedInFlight = 0;

  const start = performance.now();

  while (issued < total) {
    const due = start + issued * intervalMs;
    const now = performance.now();

    if (now < due) {
      await Bun.sleep(due - now);
    } else if (now - due > intervalMs) {
      scheduleMisses++;
    }

    if (inFlight >= maxInFlight) {
      errors++;
      issued++;
      continue;
    }

    const body = bodies[issued % bodies.length];
    launched++;
    inFlight++;
    if (inFlight > maxObservedInFlight) maxObservedInFlight = inFlight;

    void (async () => {
      const t0 = performance.now();
      try {
        const res = await fetch(url, { method: "POST", headers, body });
        await res.text();
        if (!res.ok) non2xx++;
        latencies.push(performance.now() - t0);
      } catch {
        errors++;
      } finally {
        inFlight--;
        completed++;
      }
    })();

    issued++;
  }

  while (completed < launched && inFlight > 0) {
    await Bun.sleep(1);
  }

  const elapsedMs = performance.now() - start;
  if (latencies.length === 0) {
    throw new Error("No successful latency samples collected");
  }

  return {
    targetRps,
    durationSec,
    totalIssued: issued,
    totalLaunched: launched,
    completed,
    errors,
    non2xx,
    scheduleMisses,
    maxObservedInFlight,
    achievedRps: completed / (elapsedMs / 1000),
    elapsedMs,
    stats: stats(latencies),
  };
}

async function warmup(url: string, bodies: string[], warmupSec: number): Promise<void> {
  if (warmupSec <= 0) return;
  const headers = { "Content-Type": "application/json" };
  const targetRequests = Math.max(1, Math.floor(200 * warmupSec));

  for (let i = 0; i < targetRequests; i++) {
    const body = bodies[i % bodies.length];
    const res = await fetch(url, { method: "POST", headers, body });
    await res.text();
  }
}

async function main() {
  const url = process.env.URL || "http://localhost:9999/fraud-score";
  const targetRps = Number(process.env.TARGET_RPS || 900);
  const durationSec = Number(process.env.DURATION_SEC || 30);
  const warmupSec = Number(process.env.WARMUP_SEC || 5);
  const maxInFlight = Number(process.env.MAX_IN_FLIGHT || 250);

  const bodies = readBodies();
  console.log(`url=${url}`);
  console.log(`targetRps=${targetRps} durationSec=${durationSec} warmupSec=${warmupSec} maxInFlight=${maxInFlight} payloads=${bodies.length}`);

  await warmup(url, bodies, warmupSec);
  const result = await runArrivalRate(url, bodies, targetRps, durationSec, maxInFlight);

  console.log("\n=== Arrival-Rate HTTP Benchmark ===");
  console.log(`issued=${result.totalIssued} launched=${result.totalLaunched} completed=${result.completed} errors=${result.errors} non2xx=${result.non2xx}`);
  console.log(`scheduleMisses=${result.scheduleMisses} maxInFlight=${result.maxObservedInFlight}`);
  console.log(`elapsed=${(result.elapsedMs / 1000).toFixed(3)}s achievedRps=${result.achievedRps.toFixed(2)}`);
  console.log(
    `p50=${fmtMs(result.stats.p50)} p95=${fmtMs(result.stats.p95)} p99=${fmtMs(result.stats.p99)} p999=${fmtMs(result.stats.p999)} max=${fmtMs(result.stats.max)}`,
  );
}

main();
