# Algoritmo de Busca Vetorial: Grid-Index V2 + LB Pruning

Este documento descreve a implementação final do algoritmo de busca KNN-5 utilizado para atingir o Top 3 da Rinha de Backend 2026.

## 1. O Problema: KNN-5 em Alta Escala
O desafio consiste em encontrar os 5 vizinhos mais próximos de um vetor de 14 dimensões em um dataset de 3.000.000 de referências, com um limite de tempo estrito (p99 < 1ms) e restrição de 1 CPU.

## 2. Abordagem Híbrida: Particionamento + Indexação Espacial

### Fase A: Particionamento por Atributos (32 Partições)
O dataset é dividido em 32 partições baseadas em propriedades discretas da transação:
- **is_online** (bit 0)
- **card_present** (bit 1)
- **unknown_merchant** (bit 2)
- **last_transaction_sentinel** (bits 3 e 4 - indicam se timestamp ou km são nulos)

Isso reduz o espaço de busca de 3M para subsets de ~100k a 1M vetores, garantindo que vizinhos reais (que compartilham esses atributos) nunca sejam perdidos.

### Fase B: Grid-Index V2 (Indexação Espacial)
Dentro de cada partição, implementamos um grid multidimensional dinâmico:
1. **Seleção de Dimensões:** Identificamos as dimensões com maior variância (`amount`, `mcc_risk`, `avg_amount`) para criar os bins do grid.
2. **Bucketing:** Cada vetor é atribuído a uma célula do grid.
3. **Bounding Boxes:** Para cada célula, armazenamos o valor mínimo e máximo de cada uma das 14 dimensões (AABB - Axis-Aligned Bounding Box).

### Fase C: Busca com LB Pruning (Lower Bound)
Durante a query:
1. **Ordenação de Células:** Calculamos a distância mínima entre a query e a Bounding Box de cada célula (Lower Bound). As células são visitadas em ordem crescente de LB.
2. **Poda Agressiva:** Se o LB de uma célula for maior que a distância atual do 5º vizinho encontrado, essa célula (e todas as seguintes na lista ordenada) é descartada sem verificar seus vetores internos.
3. **Busca Local Otimizada:** Dentro das células não podadas, realizamos o cálculo de distância euclidiana² com `early exit` (interrompe o cálculo assim que a distância parcial excede o threshold do top-5).

## 3. Otimizações de Baixo Nível
- **Quantização Int16:** Vetores são armazenados como `Int16Array` (escala 0-32000), reduzindo o uso de memória e permitindo o uso de aritmética inteira rápida.
- **Zero-Allocation:** Todos os buffers de busca (distâncias, índices de células) são pré-alocados no startup.
- **Loop Unrolling:** O loop de 14 dimensões é desenrolado manualmente no código de produção para eliminar o overhead de iteração.

## 4. Eficiência (O "Sweet Spot")
Descobrimos que a densidade do grid é o fator crítico para o p99. A configuração final utiliza **16 bins** para o valor da transação e **8 bins** para risco MCC e distância, resultando em cerca de 1024 células potenciais por partição. Esse equilíbrio minimiza o overhead de ordenação de células enquanto maximiza a poda de vetores.

| Métrica | Valor |
|:---|:---|
| Vetores Visitados (Média) | ~180.000 |
| Células por Partição | ~1.024 (teórico) |
| Tempo de Build do Grid | ~8s |
| Precisão | 100% (Resultados idênticos ao Brute-Force) |
