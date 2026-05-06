# Benchmark Results (Observed)

## Environment
- Bun 1.3.11
- Dataset: 3,000,000 vectors
- Arrival harness: `experiments/bench-http-arrival-rate.ts`
- Load shape used for comparisons: `TARGET_RPS=900 DURATION_SEC=30 WARMUP_SEC=5 MAX_IN_FLIGHT=250`

## Strategy correctness (global validator)
Command: `SEARCH_STRATEGY=<strategy> SAMPLE_SIZE=1000 bun run experiments/validate-partition-global.ts`

| Strategy | strategyFraudDivergences | partitionS0FraudDivergences |
|---|---:|---:|
| S3B | 0 | 19 |
| S5 (after scratch subarray fix) | 0 | 19 |

## Search benchmark (`bun run bench`)
- `SEARCH_STRATEGY=S3B`: search p99 `649.6μs`, HTTP p99 `762.3μs`
- `SEARCH_STRATEGY=S5`: search p99 `661.1μs`, HTTP p99 `775.2μs`

## Arrival-rate LB comparison

### Bun LB (compose default before cutover)
- `issued=27000 launched=26749 completed=26749 errors=17167 non2xx=0`
- `p99=60.910ms p999=95.882ms max=104.632ms`

### HAProxy (same CPU split 0.45/0.45/0.10)
- baseline (pre-tune): `p99=2.029ms p999=4.739ms max=23.023ms errors=0 non2xx=0`
- tuned `http-reuse always` + keepalive + `inter 5000`: `p99=2.090ms p999=3.648ms max=10.388ms errors=0 non2xx=0`
- tuned with `inter 1000`: `p99=2.195ms p999=33.136ms max=61.561ms errors=0 non2xx=0`

Chosen health-check interval: `inter 5000`.

## CPU split sweep (HAProxy default LB)

| api-1 | api-2 | lb | errors | non2xx | achievedRps | p99 | p999 | max | scheduleMisses |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.45 | 0.45 | 0.10 | 0 | 0 | 900.00 | 2.121ms | 4.137ms | 17.623ms | 11 |
| 0.46 | 0.46 | 0.08 | 0 | 0 | 899.98 | 4.063ms | 38.661ms | 143.258ms | 23 |
| 0.47 | 0.47 | 0.06 | 143 | 0 | 895.24 | 341.196ms | 1042.802ms | 1108.177ms | 24 |
| 0.475 | 0.475 | 0.05 | 221 | 0 | 887.94 | 760.187ms | 1949.536ms | 1977.976ms | 28 |

Chosen split: `0.45 / 0.45 / 0.10`.

## Arrival-rate strategy comparison on chosen split (HAProxy)
- `SEARCH_STRATEGY=S3B`: `errors=0 non2xx=0 p99=2.303ms p999=29.995ms max=58.099ms`
- `SEARCH_STRATEGY=S5`: `errors=0 non2xx=0 p99=2.348ms p999=30.016ms max=82.121ms`

Chosen default strategy: `S3B`.

## Target gap
Current best observed arrival p99 with zero non-2xx/errors is about `2.1ms`–`2.3ms`, still above the `≤1ms` target by roughly `1.1ms`–`1.3ms`.
