# Tecnologia — TypeScript puro, sem Rust

## Decisão

Toda a lógica de negócio roda em TypeScript no Bun. Sem Rust FFI. Sem bun:ffi. Sem .so.

**Razão:** QRust é um framework TypeScript. A participação na rinha deve showcase o que QRust/Bun pode fazer em TypeScript. Usar Rust no hot path seria esconder o QRust atrás de FFI — o oposto do propósito.

## Stack revisada

| Componente | Tecnologia | Papel |
|------------|-----------|-------|
| Runtime | Bun | HTTP server, JSON parse, TypedArrays |
| Load balancer | Bun.serve (~20 linhas) | Round-robin entre API-1 e API-2 |
| API server | Bun.serve | 2 endpoints: GET /ready, POST /fraud-score |
| Vetorização | TypeScript | 14 dimensões, normalização, clamp |
| Busca vetorial | TypeScript + Float32Array | KNN-5 sobre dataset pré-carregado |
| Memória | Float32Array + Uint8Array | Dataset em TypedArrays, mínimo GC |
| Containerização | Docker (linux-amd64) | 3 serviços: lb, api-1, api-2 |

## Performance TS em TypedArrays — Por que funciona

Bun usa JavaScriptCore (JIT). TypedArrays com tight loops são compilados para código nativo:

| Operação TS | Estimativa | Racional |
|---|---|---|
| Float32Array tight loop (brute-force 3M×14) | ~0.3-1.0ms | JSC JIT ~100-300M float ops/sec em TypedArray |
| Map.get() (bucket lookup O(1)) | ~0.001-0.005ms | HashMap nativo do engine |
| Partição + brute-force (~100K vetores) | ~0.01-0.05ms | 1.4M ops em tight loop |
| JSON.parse (payload ~500 bytes) | ~0.05-0.1ms | Bun JSON nativo |
| JSON.stringify (response ~40 bytes) | ~0.01-0.02ms | Trivial |

**Referência do próprio QRust (medido):**
- Channel batch sync: **260M ops/sec** — mostra que Bun/JSC escala em tight loops
- Queue dequeue burst: **2.3M ops/sec** — heap operations nativas
- SmartMutex fast path: **1.27M ops/sec** — async overhead incluído

## Gerenciamento de memória — Sem GC no hot path

### Dataset carregado como TypedArrays (uma vez no startup)

```typescript
// Conceito
const vectors = new Float32Array(3_000_000 * 14);  // ~168 MB
const labels  = new Uint8Array(3_000_000);          // ~3 MB (0=legit, 1=fraud)
```

TypedArrays alocam memória contígua no heap do engine, não no object heap do GC. Uma vez carregados, não são coletados.

### Hot path — zero alocações

```typescript
// Conceito — hot path por request
const query = new Float32Array(14);  // pré-alocado, reutilizado

function fraudScore(payload: Payload): Result {
  vectorize(payload, query);           // escreve nos 14 slots, sem alloc
  const fraudCount = knn5(query);      // lê vectors/labels, sem alloc
  const score = fraudCount / 5;
  return { approved: score < 0.6, fraud_score: score };
}
```

- `query` pré-alocado, reutilizado a cada request
- `knn5` retorna u8, sem arrays intermediários
- Top-5 distâncias mantidas em 5 variáveis locais (não array)
- JSON response é o único objeto criado por request (~40 bytes, Young Gen, coletado em microtasks)

## Estrutura revisada

```
rinha-backend-2026/
├── src/
│   ├── lb.ts           ← load balancer (~20 linhas)
│   ├── api.ts          ← API server (2 endpoints)
│   ├── vectorizer.ts   ← 14 dimensões, normalização
│   ├── searcher.ts     ← KNN-5 brute-force + bucketing
│   └── loader.ts       ← carrega dataset, construção do índice
├── dataset/            ← arquivos de referência
├── docker-compose.yml
├── Dockerfile
└── test/
```

**Sem pasta `rust/`.** Sem `Cargo.toml`. Sem `.so`. Sem `ffi-bridge.ts`.
