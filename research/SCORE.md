# Sistema de Pontuação

## Fórmula

```
score_final = score_p99 + score_det
```

Cada componente varia de -3000 a +3000. Total: [-6000, +6000].
## Objetivo da competição neste projeto

**Meta oficial deste projeto: TOP 1 (score 6000).**  
Condição necessária: **p99 ≤ 1.00ms** e **0 erros de detecção**.


### Latência — score_p99

```
Se p99 > 2000ms:  score_p99 = -3000
Senão:            score_p99 = 1000 * log10(1000 / max(p99, 1))
```

- Cada 10x de melhoria = +1000 pontos
- Satura em +3000 quando p99 ≤ 1ms
- Corte em -3000 quando p99 > 2000ms

### Detecção — score_det

```
E         = 1*FP + 3*FN + 5*Err
ε         = E / N
tx_falhas = (FP + FN + Err) / N

Se tx_falhas > 15%:  score_det = -3000
Senão:               score_det = 1000*log10(1/max(ε,0.001)) - 300*log10(1+E)
```

- Pesos: FP=1, FN=3, Err=5 (HTTP 500 é o pior)
- Corte rígido em 15% de falhas

## Tabela p99 → score_p99

| p99 | score_p99 |
|-----|-----------|
| ≤ 1.00ms | 3000.00 |
| 1.17ms | 2931.81 |
| 1.44ms | 2841.64 |
| 1.50ms | 2823.91 |
| 1.73ms | 2761.95 |
| 2.00ms | 2698.97 |
| 2.84ms | 2546.68 |
| 3.00ms | 2522.88 |
| 5.00ms | 2301.03 |
| 10.00ms | 2000.00 |
| 50.00ms | 1301.03 |
| 100.00ms | 1000.00 |

## Leaderboard — Top 10 (4 mai 2026)

Todos com 0% erro de detecção (det_score = 3000). Competição inteira é p99.

| # | Participante | p99 | p99_score | Total |
|---|---|---|---|---|
| 1 | thiagorigonatti (C) | 1.00ms | 3000 | **6000** |
| 2 | jairoblatt (Rust) | 1.17ms | 2932 | **5932** |
| 3 | viniciusdsandrade (C++ IVF) | 1.44ms | 2842 | **5843** |
| 4 | athospugliese (Rust) | 1.45ms | 2839 | **5839** |
| 5 | joojf | 1.50ms | 2824 | **5824** |
| 6 | thetonbr (Zig) | 1.67ms | 2777 | **5777** |
| 7 | zanfranceschi (.NET) | 1.73ms | 2762 | **5761** |
| 8 | cleissonbarbosa | 2.39ms | 2622 | **5622** |
| 9 | vitortvale (C++) | 2.40ms | 2620 | **5619** |
| 10 | MuriloChianfa (C++) | 2.84ms | 2547 | **5546** |

**Média top 10:** p99 = 1.76ms, score = 5776

## Cenários QRust

### Com 0% erro (único caminho para top 10)

| Meta | p99 máximo necessário | Score resultante |
|------|-----------------------|------------------|
| #1 (empate) | ≤ 1.00ms | 6000 |
| #3 | ≤ 1.44ms | 5843 |
| #5 | ≤ 1.50ms | 5824 |
| #10 | ≤ 2.84ms | 5546 |

### Com erros (impacto devastador)

| FP | FN | det_score | Top 1 | Top 3 | Top 5 | Top 10 |
|----|----|-----------|-------|-------|-------|--------|
| 0 | 0 | 3000.0 | ≤1.00ms | ≤1.44ms | ≤1.50ms | ≤2.84ms |
| 3 | 0 | 2819.4 | impossível | impossível | impossível | ≤1.88ms |
| 5 | 0 | 2766.6 | impossível | impossível | impossível | ≤1.66ms |
| 10 | 2 | 2125.7 | impossível | impossível | impossível | impossível |
| 10 | 5 | 1876.5 | impossível | impossível | impossível | impossível |

**Conclusão:** Qualquer erro de detecção acima de ~5 FP torna top 5 impossível. Para **top 1**, o requisito prático é **0 erro**.

### Cenários simulados

| Cenário | p99 | FP | FN | p99_score | det_score | Total | Pos est. |
|---------|-----|----|----|-----------|-----------|-------|----------|
| A: Perfeito | 1.0ms | 0 | 0 | 3000 | 3000 | **6000** | #1 tied |
| B: 0 erro, 1.5ms | 1.5ms | 0 | 0 | 2824 | 3000 | **5824** | #5-6 |
| C: 0 erro, 2.0ms | 2.0ms | 0 | 0 | 2699 | 3000 | **5699** | #8 |
| D: 0 erro, 3.0ms | 3.0ms | 0 | 0 | 2523 | 3000 | **5523** | ~#10 |
| E: 0 erro, 5.0ms | 5.0ms | 0 | 0 | 2301 | 3000 | **5301** | ~#16 |
| G: 1ms, 3FP | 1.0ms | 3 | 0 | 3000 | 2819 | **5819** | #6 |
| H: 1ms, 5FP | 1.0ms | 5 | 0 | 3000 | 2767 | **5767** | #7 |
| I: 1ms, 10FP+2FN | 1.0ms | 10 | 2 | 3000 | 2126 | **5126** | >#10 |
