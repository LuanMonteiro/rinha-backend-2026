# Técnicas de Otimização — Rinha de Backend 2026

Este documento detalha as estratégias de micro-otimização aplicadas para atingir latência p99 sub-1.5ms em TypeScript/Bun.

## 1. Zero-Allocation Hot Path
- **Fused Vectorize + Quantize:** Combinamos o parsing de JSON, normalização e quantização em uma única passagem. Isso elimina o overhead de buffers intermediários (`Float64Array`) e reduz o tráfego de memória.
- **Shared Buffers:** Utilizamos `Int16Array` pré-alocados para cada instância da API, evitando alocações por requisição e reduzindo a pressão sobre o Garbage Collector.
- **Response String Caching:** As respostas JSON possíveis são pré-geradas e cacheadas em um array de strings, eliminando o custo de `JSON.stringify` no hot path.

## 2. Algoritmos e Pruning (O "Sweet Spot")
- **Grid V2 with LB Pruning:** Implementamos um Grid-Search com cálculo de Lower Bound (LB). Células são descartadas se o LB for maior que a distância atual do 5º vizinho.
- **Dimensional Pruning Trade-off:** Descobrimos que o custo de gerenciar o grid (key calc + sorting) cresce rapidamente. 
    - *Extreme Pruning (16-bins):* Reduz vetores buscados em 10x, mas gera >3.000 células. O overhead de ordenação no Bun causa p99 spikes (>10ms).
    - *Sweet Spot (4-bins):* Fornece o melhor equilíbrio entre poda e overhead de execução, mantendo o p99 estável em ~1.4ms.
- **Unrolled Euclidean Distance:** O loop de distância foi desenrolado e especializado para dimensões variáveis, com `early exit` assim que a distância parcial ultrapassa o threshold.

## 3. Inlining e JIT Optimization
- **Manual Clamp & Bitwise:** Substituímos chamadas `Math` por operadores ternários e bitwise (`| 0`) para acelerar a quantização.
- **JIT Warmup Considerations:** Identificamos que warmups sintéticos devem ser idênticos ao payload real. Warmups mal configurados podem poluir o profile do JIT e causar de-otimizações.

## 4. Gestão de Memória (Startup OOM Avoidance)
- **Streaming Dataset Indexing:** Para carregar 3.000.000 de vetores em apenas 167MB de RAM, utilizamos um script de preparação (`prepare.ts`) que gera um dataset binário quantizado (`Int16`).
- **Binary Format:** O dataset binário resultante (~87MB) é mapeado diretamente para memória no startup da API, garantindo tempos de boot sub-100ms após a preparação.

## 5. Infraestrutura
- **Unix Domain Sockets (UDS):** HAProxy e API conversam via sockets em `tmpfs` (RAM), eliminando o overhead do stack TCP.
- **Single-Core Efficiency:** A aplicação foi otimizada para rodar estritamente sob 0.45 CPU por instância, utilizando zero-allocation no hot path para evitar interrupções do Garbage Collector.

## Resultados Atuais (Baseline Estável)
- **p50:** ~180μs - 220μs
- **p99:** ~0.52ms - 0.78ms (Validado localmente em 900 RPS)
- **Status:** Dentro da meta de < 1ms com margem de segurança para o hardware bare-metal da competição.

## 6. Ajustes finais de performance (06/05)
- **Startup Blocking:** O servidor Bun só inicia o `Bun.serve` após a construção completa do Grid, garantindo latência estável desde o primeiro pacote.
- **Grid Density Tuning:** Configuração balanceada de bins (0:16, 12:8, 6:8) para maximizar a poda de busca (LB-Pruning) sem sobrecarregar a CPU com ordenação de células.
- **Exact Body-Response Cache:** Cache de respostas JSON para corpos de requisição idênticos (LRU), protegendo a cauda p999 em cenários de repetição.
