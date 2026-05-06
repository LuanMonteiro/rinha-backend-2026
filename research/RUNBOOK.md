# Runbook

## Prerequisites
- Bun >= 1.3
- Docker + Docker Compose

## Start clean
```bash
docker compose down --remove-orphans
```

## Default deployment (HAProxy + 2 APIs)
```bash
docker compose up -d --build
curl -fsS http://localhost:9999/ready
```

## Strategy selection
API instances use:
- `SEARCH_STRATEGY=${SEARCH_STRATEGY:-S3B}`

Available values:
- `S0`
- `S3`
- `S3B` (default)
- `S5`

## Benchmarks

### Search + HTTP micro bench
```bash
SEARCH_STRATEGY=S3B bun run bench
SEARCH_STRATEGY=S5 bun run bench
```

### Arrival-rate benchmark (official-shaped local harness)
```bash
TARGET_RPS=900 DURATION_SEC=30 WARMUP_SEC=5 MAX_IN_FLIGHT=250 bun run experiments/bench-http-arrival-rate.ts
```

Useful env:
- `URL` (default `http://localhost:9999/fraud-score`)
- `PAYLOAD_FILE` (default `dataset/example-payloads.json`)

### Strategy correctness validation
```bash
SEARCH_STRATEGY=S3B SAMPLE_SIZE=1000 bun run experiments/validate-partition-global.ts
SEARCH_STRATEGY=S5 SAMPLE_SIZE=1000 bun run experiments/validate-partition-global.ts
```

## Tests
```bash
bun test test/vectorizer.test.ts
bun test test/api.test.ts test/correctness.test.ts
```

## Optional dockerized k6
Current repo does not include `test/test.js`, so this command fails as-is:
```bash
docker run --rm --network host -v "$PWD/test:/scripts" grafana/k6 run /scripts/test.js
```

## Endpoints
- `GET /ready` -> `ok`
- `POST /fraud-score` -> `{ approved, fraud_score }`
