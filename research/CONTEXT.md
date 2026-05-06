# Rinha de Backend 2026 — QRust/Bun (TypeScript puro)

## O que é

Participação na Rinha de Backend 2026 usando stack 100% TypeScript/Bun: Bun.serve como HTTP server e load balancer, TypedArrays para busca vetorial, zero Rust, zero nginx, zero dependências externas.

**Sem Rust.** QRust é TypeScript. Se a solução for Rust, não é QRust.

## Repositório oficial da rinha

https://github.com/zanfranceschi/rinha-de-backend-2026

## Status atual

Fase de planejamento. Nenhuma linha de código escrita. Este diretório contém toda a documentação e contexto necessários para implementar a solução.

## Estrutura dos documentos

| Arquivo | Conteúdo |
|---------|----------|
| `CONTEXT.md` | Este arquivo. Visão geral, motivação, stack. |
| `TECHNOLOGY.md` | Stack TS puro, sem Rust. Por que funciona em TypeScript. |
| `SCORE.md` | Sistema de pontuação, cenários, metas numéricas. |
| `ARCHITECTURE.md` | Arquitetura da solução, serviços, fluxo de request. |
| `ALGORITHM.md` | Algoritmo de busca vetorial, estratégia de contagem/bucketing. |
| `MEMORY.md` | Dados de benchmark do QRust que fundamentam a viabilidade. |
| `REFERENCES.md` | Links, regras da rinha, constantes, formatos de arquivo. |
| `IMPLEMENTATION-PLAN.md` | Plano de implementação faseado. |
| `dataset/` | Arquivos de referência da rinha. |

## Stack

Toda a lógica em TypeScript no Bun. Sem Rust FFI. Ver [TECHNOLOGY.md](TECHNOLOGY.md) para detalhes.

| Componente | Tecnologia | Papel |
|------------|-----------|-------|
| Runtime | Bun | HTTP server, JSON parse, TypedArrays |
| Load balancer | Bun.serve (~20 linhas) | Round-robin entre API-1 e API-2 |
| API server | Bun.serve | 2 endpoints: GET /ready, POST /fraud-score |
| Vetorização | TypeScript | 14 dimensões, normalização, clamp |
| Busca vetorial | TypeScript + Float32Array | KNN-5 / bucketing, zero Rust |
| Memória | Float32Array + Uint8Array | Dataset em TypedArrays, mínimo GC |
| Containerização | Docker (linux-amd64) | 3 serviços: lb, api-1, api-2 |

## Por que esta stack

1. **QRust é TypeScript** — participar com Rust seria esconder o framework
2. **Bun/JSC JIT compila TypedArray loops para nativo** — performance competitiva
3. **Channel batch sync a 260M ops/sec** — evidência de que Bun escala em tight loops
4. **SmartMutex a 1.27M ops/sec** — extends sem decorator, padrão QRust
5. **445 testes passando, 0 fail** no OML/QRust framework
6. **Bun.serve** é um dos HTTP servers mais rápidos em JS-land
7. **Bun.fetch** nativo (não polyfill) para proxy no LB

## Meta

**Top 5 (fallback)**: p99 ≤ 1.50ms, 0 erros de detecção → score ≥ 5824
**Top 1 (objetivo principal)**: p99 ≤ 1.00ms, 0 erros de detecção → score = 6000
**Top 3 (objetivo secundário)**: p99 ≤ 1.44ms, 0 erros de detecção → score ≥ 5843

## Orçamento de tempo por request (p99 ≤ 1.0ms para top 1)

| Etapa | Orçamento | Nota |
|-------|-----------|------|
| LB proxy (Bun.fetch) | 0.05-0.15ms | Round-robin stateless |
| JSON parse request | 0.05-0.10ms | Bun JSON nativo |
| Vetorização (14 dims) | 0.005-0.01ms | 14 multiplicações + clamp |
| Busca vetorial (TS) | 0.01-0.60ms | **A batalha está aqui** — depende do algoritmo |
| JSON response | 0.02-0.05ms | Objeto pequeno |
| **Total** | **0.15-0.91ms** | Margem para top 1 |
