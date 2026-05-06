# Referências e Regras

## Links da rinha

| Documento | URL |
|-----------|-----|
| README (regras gerais) | https://github.com/zanfranceschi/rinha-de-backend-2026/blob/main/docs/br/README.md |
| API (contrato endpoints) | https://github.com/zanfranceschi/rinha-de-backend-2026/blob/main/docs/br/API.md |
| Arquitetura (restrições infra) | https://github.com/zanfranceschi/rinha-de-backend-2026/blob/main/docs/br/ARQUITETURA.md |
| Regras de detecção (14 dims) | https://github.com/zanfranceschi/rinha-de-backend-2026/blob/main/docs/br/REGRAS_DE_DETECCAO.md |
| Busca vetorial (explicação) | https://github.com/zanfranceschi/rinha-de-backend-2026/blob/main/docs/br/BUSCA_VETORIAL.md |
| Dataset (formato arquivos) | https://github.com/zanfranceschi/rinha-de-backend-2026/blob/main/docs/br/DATASET.md |
| Avaliação (pontuação) | https://github.com/zanfranceschi/rinha-de-backend-2026/blob/main/docs/br/AVALIACAO.md |
| Submissão (processo) | https://github.com/zanfranceschi/rinha-de-backend-2026/blob/main/docs/br/SUBMISSAO.md |
| FAQ | https://github.com/zanfranceschi/rinha-de-backend-2026/blob/main/docs/br/FAQ.md |
| Leaderboard | https://rinhadebackend.com.br/ |

## Recursos do repo

| Arquivo | Descrição |
|---------|-----------|
| `resources/references.json.gz` | 3M vetores (~16 MB gzip, ~284 MB descomprimido) |
| `resources/mcc_risk.json` | Score de risco por MCC (< 1 KB) |
| `resources/normalization.json` | Constantes de normalização (< 1 KB) |
| `resources/example-payloads.json` | Payloads de exemplo para teste |
| `resources/example-references.json` | Subset pequeno para inspecionar formato |
| `test/` | Script k6 + massa de dados para teste local |

## mcc_risk.json — Conteúdo completo

```json
{
  "5411": 0.15,
  "5812": 0.30,
  "5912": 0.20,
  "5944": 0.45,
  "7801": 0.80,
  "7802": 0.75,
  "7995": 0.85,
  "4511": 0.35,
  "5311": 0.25,
  "5999": 0.50
}
```

**MCC não listado → usar 0.5 como padrão.**

## normalization.json — Conteúdo completo

```json
{
  "max_amount": 10000,
  "max_installments": 12,
  "amount_vs_avg_ratio": 10,
  "max_minutes": 1440,
  "max_km": 1000,
  "max_tx_count_24h": 20,
  "max_merchant_avg_amount": 10000
}
```

## Formato do references.json.gz

Descomprimir com `gunzip -k references.json.gz` → `references.json`.

```json
[
  { "vector": [0.01, 0.0833, ...14 floats], "label": "legit" },
  { "vector": [0.5796, 0.9167, ...14 floats], "label": "fraud" },
  ...
]
```

- 3.000.000 entradas
- Cada vector: array de 14 floats (f64 no JSON, armazenar como f32)
- label: "fraud" ou "legit"
- Índices 5 e 6 podem conter -1 (sentinela para ausência de last_transaction)

## Regras críticas

### Obrigatório

1. Porta 9999 no LB
2. Mínimo 1 LB + 2 APIs
3. LB não pode ter lógica de negócio
4. docker-compose.yml com linux-amd64
5. Total ≤ 1 CPU, ≤ 350 MB RAM
6. Rede bridge
7. Imagens Docker públicas

### Proibido

1. Usar payloads do teste como referência (lookup de fraudes)
2. LB com lógica de detecção
3. Rede host ou privileged
4. Esconder código fonte

### Permitido

1. Qualquer linguagem/framework/banco
2. Banco vetorial no compose (Qdrant, pgvector, etc.)
3. Pré-processamento no build ou startup
4. Qualquer técnica de classificação (KNN, ANN, etc.)

## Formato do teste

- k6 com cenário incremental
- 5000 requisições (aproximadamente)
- Cada requisição é um POST /fraud-score com payload individual
- Timeout HTTP: 2001ms
- Compara resposta com rótulo esperado (KNN-5 brute-force)
- Gera results.json com breakdown completo

## Submissão

1. Fork do repo oficial
2. Branch `main` com código-fonte
3. Branch `submission` com docker-compose.yml + arquivos necessários
4. PR adicionando arquivo em `participants/`
5. Issue com `rinha/test` na descrição para rodar o teste oficial
