# TEST_MATRIX.md

## Strategy bench (`bun run bench`)

| Strategy | Correctness (`SAMPLE_SIZE=1000`) | Search p99 | HTTP p99 | Notes |
|---|---:|---:|---:|---|
| S0 | n/a baseline | (not rerun in this cycle) | (not rerun) | kept for reference only |
| S3B | `strategyFraudDivergences=0` | 649.6μs | 762.3μs | chosen default |
| S5 (fixed) | `strategyFraudDivergences=0` | 661.1μs | 775.2μs | scratch sort bug fixed |

## Arrival-rate benchmark (`TARGET_RPS=900 DURATION_SEC=30 WARMUP_SEC=5`)

### LB path comparison
| LB path | errors | non2xx | p99 | p999 | max |
|---|---:|---:|---:|---:|---:|
| Bun LB (old default) | 17167 | 0 | 60.910ms | 95.882ms | 104.632ms |
| HAProxy baseline | 0 | 0 | 2.029ms | 4.739ms | 23.023ms |

### HAProxy tuning (`http-reuse always`)
| health-check interval | errors | non2xx | p99 | p999 | max |
|---|---:|---:|---:|---:|---:|
| `inter 5000` | 0 | 0 | 2.090ms | 3.648ms | 10.388ms |
| `inter 1000` | 0 | 0 | 2.195ms | 33.136ms | 61.561ms |

### CPU split sweep (HAProxy)
| api-1 | api-2 | lb | errors | non2xx | p99 | p999 | max |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.45 | 0.45 | 0.10 | 0 | 0 | 2.121ms | 4.137ms | 17.623ms |
| 0.46 | 0.46 | 0.08 | 0 | 0 | 4.063ms | 38.661ms | 143.258ms |
| 0.47 | 0.47 | 0.06 | 143 | 0 | 341.196ms | 1042.802ms | 1108.177ms |
| 0.475 | 0.475 | 0.05 | 221 | 0 | 760.187ms | 1949.536ms | 1977.976ms |

### Strategy comparison on chosen split (0.45/0.45/0.10)
| Strategy | errors | non2xx | p99 | p999 | max |
|---|---:|---:|---:|---:|---:|
| S3B | 0 | 0 | 2.303ms | 29.995ms | 58.099ms |
| S5 | 0 | 0 | 2.348ms | 30.016ms | 82.121ms |
