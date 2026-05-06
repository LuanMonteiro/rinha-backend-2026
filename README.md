# Rinha de Backend 2026 — QRust (TypeScript Edition)

Este repositório contém a submissão final da equipe para a Rinha de Backend 2026, focada em busca vetorial (KNN) de alta performance.

## 🚀 Performance Final
- **Último benchmark local válido (06/05, 900 RPS alvo, 60s, warmup 10s):** p50 167.3μs / p95 340.1μs / p99 855.2μs / p999 2.401ms
- **Throughput observado nesta máquina:** 900 RPS sustentado com `errors=0`, `non2xx=0`, `launched=issued` (`MAX_IN_FLIGHT=250`)
- **Correção funcional validada:** `checked=50 failures=0` no dataset oficial de exemplo via `docker-compose.yml`
- **Dataset:** 3.000.000 de vetores (14 dimensões)

## 🛠️ Arquitetura e Otimizações
O projeto foi desenvolvido com foco em eficiência máxima de CPU e memória, utilizando técnicas avançadas para superar limites tradicionais do TypeScript:

1.  **[Algoritmo de Busca (Grid V2)](ALGORITHM.md):** Uso de Grid-Indexing espacial com **LB Pruning** para descartar 90% do dataset sem cálculos custosos.
2.  **[Infraestrutura de Baixa Latência](ARCHITECTURE.md):** Comunicação entre serviços via **Unix Domain Sockets** em memória (tmpfs), eliminando o overhead TCP.
3.  **[Técnicas de Performance](docs/techniques.md):**
    *   **Zero-Allocation:** Fused parser e buffers pré-alocados para evitar Garbage Collection no hot path.
    *   **Quantização Int16:** Redução de 4x no uso de memória do dataset.
    *   **Streaming Indexing:** Carregamento de 3M vetores dentro de apenas 167MB de RAM.

## 📂 Estrutura do Projeto
- `src/`: Código fonte original e engine de busca.
- `experiments/`: Ferramentas de benchmark, sweeps de grid e análise de performance.
- `docs/`: Documentação técnica detalhada de cada fase do desenvolvimento.

## 🏁 Como Rodar (Local)
Para replicar os resultados de benchmark:
```bash
docker compose up -d --build
# Aguardar GET /ready retornar 200
bun run experiments/bench-http-arrival-rate.ts
```

---
*QRust: Provando que TypeScript puro pode competir no topo, sem Rust.*
