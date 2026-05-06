# Plano de Implementação

## Decisão tecnológica

Tudo em TypeScript/Bun. Sem Rust. Ver [TECHNOLOGY.md](TECHNOLOGY.md).

## Meta de resultado

**Objetivo principal: TOP 1 (score 6000).**  
Meta técnica: **p99 ≤ 1.00ms** e **0 erros de detecção**.

## Fase 0: Setup

- [ ] Dataset já baixado em `dataset/`
- [ ] Validar formato: parsear example-payloads.json e example-references.json
- [ ] `bun init` na raiz, configurar package.json

## Fase 1: Protótipo TS — Benchmark local do brute-force

**Objetivo:** Validar se TypeScript/Bun consegue fazer brute-force KNN-5 sobre 3M vetores com desempenho de **top 1**. Sem servidor HTTP. Apenas bench script.

### Passo 1.1: Loader

- [ ] `src/loader.ts` — carregar dataset
  - Descomprimir references.json.gz (Bun.gzipSync ou zlib)
  - Parsear JSON
  - Converter para Float32Array(3M × 14) + Uint8Array(3M) labels
  - Medir tempo de carregamento e memória usada (process.memoryUsage)
  - Carregar mcc_risk.json e normalization.json

### Passo 1.2: Brute-force KNN-5

- [ ] `src/searcher.ts` — função knn5
  - Receber Float32Array(14) como query
  - Percorrer todos os 3M vetores, calcular distância euclidiana²
  - Manter top-5 menores distâncias (5 variáveis locais, sem array)
  - Contar fraudes entre os 5
  - Retornar fraud_count

### Passo 1.3: Benchmark

- [ ] `test/bench-search.ts` — script de benchmark
  - Carregar dataset
  - Rodar 10.000 queries com vetores aleatórios (ou de example-payloads)
  - Medir p50, p99, p999, ops/sec
  - **Decisão point:** se p99 < 1.0ms → seguir para Fase 2 com brute-force (alvo top 1)
  - Se p99 1.0-1.5ms → seguir para Fase 2 com brute-force (alvo top 5)
  - Se p99 1.5-3.0ms → implementar partição (Passo 1.4)
  - Se p99 > 3ms → implementar bucketing (Passo 1.5)

### Passo 1.4 (condicional): Partição por bits

Se brute-force > 1.5ms:

- [ ] Particionar vetores pelos 3 bits (is_online, card_present, unknown_merchant) + 2 sentinelas
- [ ] Até 32 partições, ~100K vetores cada
- [ ] Na query: selecionar partição, brute-force só nela
- [ ] Re-benchmark

### Passo 1.5 (condicional): Bucketing / contagem

Se partição ainda > 1.5ms:

- [ ] Quantizar dimensões contínuas em N bins
- [ ] Contar fraud/legit por bucket
- [ ] Na query: lookup O(1) + fallback para buckets vizinhos
- [ ] Re-benchmark

### Passo 1.6: Validação de corretude

- [ ] Rodar sobre example-payloads.json
- [ ] Comparar resultados com expected (KNN-5 brute-force exato)
- [ ] Garantir FP=0, FN=0

## Fase 2: Servidor HTTP

### Passo 2.1: Vetorizador

- [ ] `src/vectorizer.ts` — função vectorize
  - Receber payload parseado
  - Calcular 14 dimensões com normalização
  - Escrever em Float32Array(14) pré-alocado (reutilizado)
  - Teste unitário com exemplos de REGRAS_DE_DETECCAO.md

### Passo 2.2: API server

- [ ] `src/api.ts` — Bun.serve com 2 endpoints
  - GET /ready — verifica se dataset carregado
  - POST /fraud-score — parse → vetorizar → knn5 → response
  - Teste manual com curl

### Passo 2.3: Load balancer

- [ ] `src/lb.ts` — Bun.serve round-robin
  - Teste: curl via LB → repassa para API

## Fase 3: Docker + Validação

### Passo 3.1: Dockerfile

- [ ] Simples: FROM oven/bun:latest, copiar src/ e dataset/
- [ ] Sem stage de build Rust
- [ ] Teste: docker build + docker run

### Passo 3.2: docker-compose.yml

- [ ] 3 serviços: lb, api-1, api-2
- [ ] Limites: total 1 CPU, 350 MB
- [ ] Teste: docker compose up → curl porta 9999

### Passo 3.3: Validação com k6

- [ ] Instalar k6
- [ ] Baixar script de teste e massa de dados do repo oficial
- [ ] Rodar teste local
- [ ] Verificar p99 e taxa de erros

## Fase 4: Otimização (se necessário)

**Critério:** Se p99 > 1.5ms ou detecção > 0 erros.

### Possíveis otimizações (todas em TS)

1. **Partição por bits** — reduzir de 3M para ~100K vetores por lookup
2. **Bucketing / contagem** — O(1) lookup, zero compute de distância
3. **Layout SoA** — 14 Float32Array(3M) em vez de 1 Float32Array(3M×14)
   - Melhor cache locality para acesso por dimensão
4. **Unroll do inner loop** — manualmente desenrolar o loop de 14 iterações
5. **avoid sqrt** — já planejado, usar distância²
6. **Bun.gc(true) no startup** — forçar GC após carregamento, liberar JSON parseado

## Fase 5: Submissão

- [ ] Criar repositório público no GitHub
- [ ] Branch main com código
- [ ] Branch submission com docker-compose.yml
- [ ] PR no repo oficial adicionando participants/
- [ ] Issue com rinha/test para teste oficial

## Ponto de decisão principal

**Fase 1 Step 1.3** é o gate. O benchmark local de brute-force KNN-5 em TS determina tudo:

| Resultado p99 | Ação |
|---------------|------|
| < 1.0ms | Ir direto pra Fase 2 com brute-force (top 1 possível) |
| 1.0-1.5ms | Ir pra Fase 2 com brute-force (top 5) |
| 1.5-3.0ms | Implementar partição antes de Fase 2 |
| > 3.0ms | Implementar bucketing antes de Fase 2 |

## Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| Brute-force TS lento (> 3ms) | Média | Alto | Partição por bits reduz pra ~100K |
| Bucketing com erros de detecção | Média | Crítico | Validar contra brute-force exato |
| Memória estourar 160 MB (brute-force) | Alta | Médio | Bucketing usa ~20 MB |
| GC spike no p99 | Baixa | Médio | TypedArrays, buffer reutilizado, Bun.gc no startup |
| JSC JIT não otimizar tight loop | Baixa | Médio | Unroll manual, SoA layout |
