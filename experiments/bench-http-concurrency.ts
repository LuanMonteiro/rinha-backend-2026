import { readFileSync } from "fs";
import { join } from "path";

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function fmtMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(1)}μs`;
  return `${ms.toFixed(3)}ms`;
}

async function runLevel(url: string, bodies: string[], total: number, concurrency: number) {
  const headers = { "Content-Type": "application/json" };
  const latencies: number[] = [];
  let errors = 0;
  let non2xx = 0;
  let issued = 0;

  async function worker() {
    while (true) {
      const idx = issued++;
      if (idx >= total) return;
      const body = bodies[idx % bodies.length];
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
  }

  const tStart = performance.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const elapsedMs = performance.now() - tStart;

  latencies.sort((a, b) => a - b);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const p999 = percentile(latencies, 99.9);

  return {
    concurrency,
    total,
    ok: latencies.length,
    errors,
    non2xx,
    reqPerSec: (latencies.length / (elapsedMs / 1000)),
    p50,
    p95,
    p99,
    p999,
    max: latencies[latencies.length - 1],
  };
}

async function main() {
  const payloads = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "dataset", "example-payloads.json"), "utf-8"),
  );
  const bodies = payloads.map((p: unknown) => JSON.stringify(p));

  const url = process.env.URL || "http://localhost:9999/fraud-score";
  const total = Number(process.env.HTTP_REQS || 5000);
  const warmup = Number(process.env.HTTP_WARMUP || 200);
  const levels = (process.env.LEVELS || "1,2,4,8,16").split(",").map((s) => Number(s.trim())).filter(Boolean);

  const headers = { "Content-Type": "application/json" };
  for (let i = 0; i < warmup; i++) {
    const res = await fetch(url, { method: "POST", headers, body: bodies[i % bodies.length] });
    await res.text();
  }

  console.log(`Target=${url} total=${total}`);
  for (const c of levels) {
    const r = await runLevel(url, bodies, total, c);
    console.log(`C=${r.concurrency} ok=${r.ok} err=${r.errors} non2xx=${r.non2xx} rps=${r.reqPerSec.toFixed(0)} p50=${fmtMs(r.p50)} p95=${fmtMs(r.p95)} p99=${fmtMs(r.p99)} p999=${fmtMs(r.p999)} max=${fmtMs(r.max)}`);
  }
}

main();
