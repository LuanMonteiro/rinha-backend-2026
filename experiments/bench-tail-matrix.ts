import { readFileSync } from "fs";

type Method = "GET" | "POST";

type RecordOut = {
  url: string;
  method: Method;
  issued: number;
  launched: number;
  completed: number;
  errors: number;
  non2xx: number;
  scheduleMisses: number;
  maxInFlight: number;
  achievedRps: number;
  p50: number;
  p95: number;
  p99: number;
  p999: number;
  max: number;
};

type RunResult = {
  issued: number;
  launched: number;
  completed: number;
  errors: number;
  non2xx: number;
  scheduleMisses: number;
  maxInFlight: number;
  achievedRps: number;
  latencies: number[];
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

function readBodies(filePath: string): string[] {
  const payloads = JSON.parse(readFileSync(filePath, "utf-8"));
  if (!Array.isArray(payloads) || payloads.length === 0) {
    throw new Error(`No payloads loaded from ${filePath}`);
  }
  return payloads.map((p: unknown) => JSON.stringify(p));
}

function parseUrls(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function methodForUrl(url: string): Method {
  return url.endsWith("/ready") ? "GET" : "POST";
}

async function runArrivalRate(
  url: string,
  method: Method,
  targetRps: number,
  durationSec: number,
  maxInFlight: number,
  bodies: string[],
  collectLatencies: boolean,
): Promise<RunResult> {
  const total = Math.floor(targetRps * durationSec);
  const intervalMs = 1000 / targetRps;
  const headers = method === "POST" ? { "Content-Type": "application/json" } : undefined;

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

    const body = method === "POST" ? bodies[issued % bodies.length] : undefined;
    launched++;
    inFlight++;
    if (inFlight > maxObservedInFlight) maxObservedInFlight = inFlight;

    void (async () => {
      const t0 = performance.now();
      try {
        const res = await fetch(url, { method, headers, body });
        await res.text();
        if (!res.ok) non2xx++;
        if (collectLatencies) latencies.push(performance.now() - t0);
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
  return {
    issued,
    launched,
    completed,
    errors,
    non2xx,
    scheduleMisses,
    maxInFlight: maxObservedInFlight,
    achievedRps: completed / (elapsedMs / 1000),
    latencies,
  };
}

async function main() {
  const urls = parseUrls(process.env.URLS || "http://localhost:9999/ready,http://localhost:9999/fraud-score");
  const targetRps = Number(process.env.TARGET_RPS || 900);
  const durationSec = Number(process.env.DURATION_SEC || 30);
  const warmupSec = Number(process.env.WARMUP_SEC || 5);
  const maxInFlight = Number(process.env.MAX_IN_FLIGHT || 250);
  const payloadFile = process.env.PAYLOAD_FILE || "dataset/example-payloads.json";

  if (urls.length === 0) {
    throw new Error("No URLs configured");
  }

  const bodies = readBodies(payloadFile);

  for (const url of urls) {
    const method = methodForUrl(url);

    if (warmupSec > 0) {
      await runArrivalRate(url, method, targetRps, warmupSec, maxInFlight, bodies, false);
    }

    const run = await runArrivalRate(url, method, targetRps, durationSec, maxInFlight, bodies, true);
    if (run.latencies.length === 0) {
      throw new Error(`No successful latency samples collected for ${url}`);
    }

    const s = stats(run.latencies);
    const out: RecordOut = {
      url,
      method,
      issued: run.issued,
      launched: run.launched,
      completed: run.completed,
      errors: run.errors,
      non2xx: run.non2xx,
      scheduleMisses: run.scheduleMisses,
      maxInFlight: run.maxInFlight,
      achievedRps: run.achievedRps,
      p50: s.p50,
      p95: s.p95,
      p99: s.p99,
      p999: s.p999,
      max: s.max,
    };
    console.log(JSON.stringify(out));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
