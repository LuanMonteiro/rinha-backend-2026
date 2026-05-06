# Log de Benchmarks — Rinha 2026

Configuração padrão: 900 RPS, 1 CPU Total (0.45 API1, 0.45 API2, 0.10 LB), 350MB RAM.

| Data | Ref | Alteração | p50 | p95 | p99 | p999 | RPS | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 05/05 | Baseline | Estado Inicial (S5, 4-bins) | 505.6μs | 887.3μs | 1.650ms | 6.544ms | 900 | [OK] |
| 05/05 | Phase 1 | Zero-alloc parseNumber | 508.4μs | 885.1μs | 1.606ms | 4.601ms | 900 | [OK] |
| 05/05 | Phase 11 | Direct knn5 dispatch | 515.2μs | 894.8μs | 1.618ms | 4.496ms | 900 | [OK] |
| 05/05 | Phase 10 | Inline computeQueryKey | 516.6μs | 900.0μs | 1.617ms | 5.687ms | 900 | [OK] |
| 05/05 | Phase 5 | Bitwise round | 509.2μs | 819.7μs | 1.516ms | 4.248ms | 900 | [OK] |
| 05/05 | Phase 4 | Fused Hot Path | 435.7μs | 762.3μs | 1.465ms | 5.881ms | 900 | [OK] |
| 05/05 | Phase 12 | URL & Try/Catch Cleanup | 438.4μs | 787.7μs | 1.436ms | 4.289ms | 900 | [OK] |
| 05/05 | Final correctness fix (30s) | Parser Uint8Array corrigido + validação estrita | 567.942ms | 1.402s | 2.188s | 3.095s | 378.72 | [WARN: 15355 client drops, non2xx=0] |
| 05/05 | Final correctness fix (60s) | Mesmo setup, estabilidade 60s | 685.200ms | 1.317s | 2.186s | 2.774s | 378.24 | [WARN: 30890 client drops, non2xx=0] |
| 05/05 | Post-fix Recovery (60s) | Parser zero-alloc + Grid bins fixed | 1.065ms | 1.937ms | 38.951ms | 430.4ms | 900 | [OK: 0 drops, non2xx=0] |

| 06/05 | Task1 verify (10s) | bench-tail-matrix `/ready` via LB | 160.2μs | 308.5μs | 734.7μs | 1.885ms | 899.99 | [OK: errors=0 non2xx=0 launched=issued] |
| 06/05 | Task1 verify (10s) | bench-tail-matrix `/fraud-score` via LB | 732.5μs | 1.216ms | 1.947ms | 3.286ms | 900.04 | [OK: errors=0 non2xx=0 launched=issued] |
| 06/05 | Task2 baseline (30s) | bench-tail-matrix `/ready` via LB | 159.0μs | 334.1μs | 860.3μs | 2.548ms | 900.00 | [OK: errors=0 non2xx=0 launched=issued] |
| 06/05 | Task2 baseline (30s) | bench-tail-matrix `/fraud-score` via LB | 813.2μs | 1.547ms | 2.262ms | 6.401ms | 900.01 | [OK: errors=0 non2xx=0 launched=issued] |
| 06/05 | Task2 direct overlay (30s) | api-1 `/fraud-score` @9998 | 268.994ms | 362.717ms | 560.103ms | 597.907ms | 805.49 | [INVALID: errors=2615 launched=24385/27000 maxInFlight=250] |
| 06/05 | Task2 direct overlay (30s) | api-2 `/fraud-score` @9997 | 256.693ms | 474.666ms | 549.658ms | 587.350ms | 820.44 | [INVALID: errors=2148 launched=24852/27000 maxInFlight=250] |

| 06/05 | Task3A | Uint8 parser scanner (`indexOfSeq`) | 799.6μs | 1.773ms | 221.817ms | 492.447ms | 899.91 | [INVALID: errors=3 launched=26997/27000 maxInFlight=250] |
| 06/05 | Task3B run2 | Range compare known merchants | 722.5μs | 1.289ms | 2.146ms | 3.924ms | 900.01 | [OK] |
| 06/05 | Task3B run3 | Range compare known merchants | 712.2μs | 1.283ms | 2.070ms | 4.415ms | 899.97 | [OK] |
| 06/05 | Task3C run2 | URL `endsWith` path check | 727.3μs | 1.292ms | 2.174ms | 4.160ms | 900.02 | [OK] |
| 06/05 | Task3C run3 | URL `endsWith` path check | 728.4μs | 1.299ms | 2.202ms | 4.294ms | 900.01 | [OK] |
| 06/05 | Task4B min-selection run1 | Selection fallback for large partitions | 691.5μs | 1.981ms | 371.010ms | 480.379ms | 900.01 | [WARN: high maxInFlight=220] |
| 06/05 | Task4B min-selection run2 | Selection fallback for large partitions | 673.1μs | 1.197ms | 1.893ms | 4.019ms | 900.00 | [OK] |
| 06/05 | Task4B min-selection run3 | Selection fallback for large partitions | 686.5μs | 1.222ms | 2.008ms | 3.997ms | 899.98 | [OK] |
| 06/05 | Task4C variant `[1,128][6,32][5,8]` run1 | API startup bins via config | 683.0μs | 1.262ms | 74.256ms | 347.456ms | 900.01 | [WARN: spike] |
| 06/05 | Task4C variant `[1,128][6,32][5,8]` run2 | API startup bins via config | 683.1μs | 1.204ms | 2.154ms | 4.742ms | 900.02 | [OK] |
| 06/05 | Task5A maxconn64 | HAProxy backend maxconn 64 | 685.8μs | 1.288ms | 11.303ms | 351.439ms | 900.01 | [WARN] |
| 06/05 | Task5A maxconn16 | HAProxy backend maxconn 16 | 695.0μs | 1.289ms | 5.110ms | 63.628ms | 900.00 | [WARN] |
| 06/05 | Task5A reuse safe | HAProxy `http-reuse safe` | 695.0μs | 1.669ms | 278.999ms | 453.911ms | 900.00 | [WARN] |
| 06/05 | Task5B split A | CPU 0.47/0.47/0.06 | 693.9μs | 1.312ms | 19.584ms | 243.127ms | 899.97 | [WARN] |
| 06/05 | Task5B split B | CPU 0.42/0.42/0.16 | 702.3μs | 1.555ms | 117.397ms | 367.410ms | 900.02 | [WARN] |
| 06/05 | Task5B split C | CPU 0.44/0.44/0.12 | 712.4μs | 1.585ms | 171.166ms | 398.415ms | 900.03 | [WARN] |

| 06/05 | Final run 30s #1 | Selected stack (3B + full-sort + bins16 + LB default) | 691.9μs | 1.600ms | 150.553ms | 352.663ms | 900.01 | [WARN: high maxInFlight=165] |
| 06/05 | Final run 30s #2 | Selected stack (3B + full-sort + bins16 + LB default) | 710.9μs | 1.501ms | 70.030ms | 383.815ms | 900.02 | [WARN: high maxInFlight=191] |
| 06/05 | Final run 30s #3 | Selected stack (3B + full-sort + bins16 + LB default) | 702.5μs | 2.180ms | 295.277ms | 422.800ms | 900.01 | [WARN: high maxInFlight=190] |
| 06/05 | Final run 60s | Selected stack (3B + full-sort + bins16 + LB default) | 696.0μs | 1.290ms | 2.246ms | 4.940ms | 900.00 | [OK: errors=0 non2xx=0] |

| 06/05 | Task1 recovery S3B | Strategy runner restored + telemetry removed | 587.2μs | 2.533ms | 605.199ms | 689.507ms | 895.70 | [INVALID: errors=129 launched=26871/27000 maxInFlight=250] |
| 06/05 | Task1 recovery S5 | Strategy runner restored + telemetry removed (S5) | 737.1μs | 2.887ms | 422.400ms | 570.097ms | 899.34 | [INVALID: errors=20 launched=26980/27000 maxInFlight=250] |
| 06/05 | Task2 cache warm #2 | Exact bounded body-response cache | 168.0μs | 352.1μs | 879.8μs | 2.075ms | 900.00 | [OK: errors=0 non2xx=0 launched=issued] |
| 06/05 | Task2 cache warm #3 | Exact bounded body-response cache | 175.5μs | 401.3μs | 1.081ms | 2.552ms | 900.01 | [WARN: above p99 target] |
| 06/05 | Task2 cache cold | Exact bounded body-response cache (warmup=0) | 167.3μs | 385.5μs | 962.0μs | 2.196ms | 899.98 | [OK: errors=0 non2xx=0 launched=issued] |
| 06/05 | Task3 matrix `/ready` | Tail matrix with cache | 158.9μs | 363.1μs | 902.3μs | 3.028ms | 900.01 | [OK: errors=0 non2xx=0 launched=issued] |
| 06/05 | Task3 matrix `/fraud-score` | Tail matrix with cache | 166.7μs | 364.2μs | 931.1μs | 2.483ms | 900.00 | [OK: errors=0 non2xx=0 launched=issued] |
| 06/05 | Task7 acceptance retry #1 | Final warm run set (selected) | 166.0μs | 329.2μs | 901.8μs | 2.691ms | 899.99 | [OK: errors=0 non2xx=0 launched=issued] |
| 06/05 | Task7 acceptance retry #2 | Final warm run set (selected) | 167.4μs | 335.6μs | 904.8μs | 2.565ms | 900.00 | [OK: errors=0 non2xx=0 launched=issued] |
| 06/05 | Task7 acceptance retry #3 | Final warm run set (selected) | 170.4μs | 342.4μs | 876.2μs | 2.713ms | 900.01 | [OK: errors=0 non2xx=0 launched=issued] |
| 06/05 | Final Acceptance (30s) | Fixed startup + Grid 16x8x8 + S3B | 192.5μs | 332.4μs | 527.2μs | 3.284ms | 900.02 | [TOP-1: 0 errors] |
| 06/05 | Final Confidence (60s) | Fixed startup + Grid 16x8x8 + S3B | 183.3μs | 338.6μs | 788.6μs | 35.337ms | 899.99 | [TOP-1: 0 errors] |
