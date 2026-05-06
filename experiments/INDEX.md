# Experiment Index

## Core utilities
- `validate-partition-global.ts`
  - Compares strategy fraud count against global exact KNN-5 baseline.
  - Used for `SAMPLE_SIZE=50` and `SAMPLE_SIZE=1000` checks.

- `bench-http-arrival-rate.ts`
  - Official-shaped local load harness (arrival-time scheduled).
  - Defaults: `TARGET_RPS=900 DURATION_SEC=30 WARMUP_SEC=5 MAX_IN_FLIGHT=250`.
  - Reports `p50/p95/p99/p999/max`, `errors`, `non2xx`, achieved RPS, schedule misses.

- `bench-http-concurrency.ts`
  - Fixed-concurrency diagnostic helper (`LEVELS=1,2,4,8,16` etc).
  - Kept for diagnosis only; not primary decision metric.

- `bench-http-direct-vs-lb.ts`
  - Sequential direct-vs-lb comparison helper.
  - Useful for quick local smoke checks, not official-shaped load.

## Current decision-driving results
- S5 scratch sort bug fixed in `src/search-prod.ts`; post-fix `strategyFraudDivergences=0`.
- HAProxy default LB outperformed Bun LB substantially under arrival-rate load.
- Best CPU split in tested set: `api-1=0.45, api-2=0.45, lb=0.10`.
- S3B selected as default strategy after correctness+latency comparison.
