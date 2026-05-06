# Technical Decisions

## 1) S5 scratch-array sort bug fixed
- In `src/search-prod.ts`, scratch arrays were sorted at full scratch capacity, not active `numCells`.
- Fix: use `subarray(0, numCells)` for `cellLBs` and `sortedCells` before sorting.
- Result: `SEARCH_STRATEGY=S5 SAMPLE_SIZE=1000` now reports `strategyFraudDivergences=0`.

## 2) Keep S3B as default strategy
- Both S3B and fixed S5 now show `strategyFraudDivergences=0` at `SAMPLE_SIZE=1000`.
- Performance comparison favored S3B slightly:
  - `bun run bench` search p99: S3B `649.6μs` vs S5 `661.1μs`
  - arrival run p99: S3B `2.303ms` vs S5 `2.348ms`
- Decision: default remains `S3B`.

## 3) Cut over to HAProxy as default LB
- Bun LB under arrival-rate test showed severe tail and launch drops (`p99=60.910ms`, high `errors`).
- HAProxy under same test had zero errors/non-2xx and much lower tail (`p99≈2ms`).
- Decision: `docker-compose.yml` now uses HAProxy directly for `lb`.

## 4) HAProxy tuning choice
- Tested `inter 1000` vs `inter 5000` health-check intervals with `http-reuse always` and keep-alive timeout.
- `inter 5000` had better deep-tail stability (`p999=3.648ms` vs `33.136ms`).
- Decision: keep `inter 5000`.

## 5) CPU split decision
- Swept approved splits: 0.45/0.45/0.10, 0.46/0.46/0.08, 0.47/0.47/0.06, 0.475/0.475/0.05.
- Best zero-error profile was `0.45/0.45/0.10`.
- Lower LB CPU splits caused severe tail spikes and request launch failures.

## 6) Backpressure diagnostic not enabled
- Optional backpressure shortcut was not implemented as default because it can change detection behavior and hurt score semantics.
- Focus stayed on compliant zero-error forwarding path.

## 7) Current constraint
- Best observed arrival-rate p99 remains above 1ms (`~2.1ms–2.3ms`) despite correctness and LB/CPU tuning.
- Next gains likely require deeper algorithm/runtime changes, not JSON/path micro-optimizations.
