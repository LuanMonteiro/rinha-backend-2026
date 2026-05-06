# Arquitetura QRust: Bun + HAProxy + Unix Sockets

Esta arquitetura foi desenhada para extrair a performance máxima de uma stack TypeScript/Bun dentro dos limites estritos da Rinha de Backend 2026 (1 CPU, 350MB RAM).

## 1. Topologia de Rede (Zero-TCP Overhead)

Em vez de usar rede bridge TCP padrão (que introduz latência de ~100-200μs por salto), utilizamos **Unix Domain Sockets (UDS)** montados em um volume **tmpfs** (RAM).

```
Cliente → HAProxy (Porta 9999)
             │
             ├── /var/run/rinha/api1.sock (Unix Socket) → API-1 (Bun)
             └── /var/run/rinha/api2.sock (Unix Socket) → API-2 (Bun)
```

**Vantagens:**
- Elimina o overhead do stack TCP/IP (handshake, packet framing).
- Comunicação direta via memória compartilhada no kernel linux.
- HAProxy 3.0 lida com o gerenciamento de conexões e healthchecks de forma extremamente eficiente.

## 2. Componentes da Stack

### HAProxy 3.0-alpine (Load Balancer)
- **Papel:** Receber tráfego na porta 9999 e distribuir entre as instâncias da API via round-robin.
- **Healthcheck e roteamento:** Monitora `/ready` e só envia tráfego para APIs que já carregaram o dataset. Validação de payload e limite de 2KB acontecem no handler Bun para manter a configuração do HAProxy simples.
- **Healthcheck:** Monitora o endpoint `/ready` das APIs para garantir que o dataset foi carregado antes de enviar tráfego.

### API Bun (instâncias api-1 e api-2)
- **Runtime:** Bun 1.3 (escolhido pela velocidade do `Bun.serve` e otimizações JIT para operações matemáticas).
- **Processamento:** 
    1. **Parsing Híbrido:** `fast-json.ts` realiza o parsing e vetorização em um único passo, sem criar objetos intermediários.
    2. **Busca KNN:** `search-s3b.ts` executa a busca com Grid-Index e LB Pruning.
- **Startup real em container limitado:** cada instância roda `prepare.ts` no boot (~15.8-15.9s no ambiente local com limites da submissão) e só depois entra em estado `ready`.

## 3. Gestão de Recursos (1 CPU / 350MB RAM)

| Serviço | CPU Limit | RAM Limit | Detalhes |
|:---|:---|:---|:---|
| **HAProxy** | 0.1 | 16MB | Overhead mínimo, alto throughput. |
| **API-1** | 0.45 | 167MB | Dataset comprimido em Int16 + Runtime Bun. |
| **API-2** | 0.45 | 167MB | Dataset comprimido em Int16 + Runtime Bun. |
| **Tmpfs** | - | - | Volume em RAM para sockets (/var/run/rinha). |

## 4. Fluxo de Inicialização (Boot Sequence)

1. **Docker Compose Up:** Sobe as instâncias e monta o volume compartilhado.
2. **Dataset Indexing:** Cada instância API roda o script `prepare.ts` para carregar 3M vetores e construir o `dataset.bin` binário.
3. **Grid Building:** Em execução local com Docker/limits da submissão, o grid foi construído em ~4.2s a ~4.3s por instância (logs atuais: 4191ms e 4313ms).
4. **Ready:** O endpoint `/ready` passa a retornar 200 OK.
5. **HAProxy Open:** O LB detecta o status 200 e libera as conexões de tráfego real.
