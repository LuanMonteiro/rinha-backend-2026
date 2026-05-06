# Benchmark Memory — Dados do QRust que fundamentam a viabilidade

## Fonte

Todos os dados abaixo foram extraídos do workspace OML/QRust em `/home/openlabbox/workspace/`. Fontes primárias: `rust/oml-*/src/lib.rs`, `infra/packages/bun/src/packages/framework/docs/BENCHMARK-ANALYSIS.md`, `infra/packages/bun/src/packages/framework/tests/integration/Performance.test.ts`.

## FFI Rust — Performance medida

| Operação | Tempo | ops/sec | Fonte |
|----------|-------|---------|-------|
| `oml_try_lock` (uncontended) | ~5ns | 2.9M | rust/oml-mutex/src/lib.rs |
| SmartMutex lock/release (extends) | ~0.8µs | 1.27M | BENCHMARK-ANALYSIS.md Session 2 |
| Decorator @Mutex overhead | ~4µs | 252K | BENCHMARK-ANALYSIS.md Session 2 |
| Ratio extends/decorator | 5x | — | Session 2 benchmark |

**Lições:**
- FFI boundary é barato (~5ns). Não é gargalo.
- Decorators são proibidos (5x overhead). Usar extends ou chamadas diretas.
- SmartMutex fast path é ~0.8µs — mais que suficiente para nosso use case.

## Buffer Off-Heap — Zero GC

| Propriedade | Valor | Fonte |
|-------------|-------|-------|
| Alocação | `std::alloc::alloc` com align 8 | rust/oml-buffer/src/lib.rs |
| Zero-copy read | `ptr + offset` (subview) | rust/oml-buffer/src/lib.rs |
| Backpressure | CAS-based limit check | rust/oml-buffer/src/lib.rs |
| GC pressure | **ZERO** (off-heap) | ffi-interface.md |

**Código relevante (oml-buf-alloc):**
```rust
pub extern "C" fn oml_buf_alloc(len: usize) -> *mut u8 {
    // 8-byte aligned, off-heap allocation
    // CAS-based limit check against MAX_BYTES
    // Returns null on failure
}
```

**Aplicação na rinha:** Dataset de 3M vetores carregado via alocação off-heap. Zero impacto no GC do V8. O hot path (query) não aloca nada.

## Channel / Communication — Se necessário

| Tipo | ops/sec | p50 | p999 |
|------|---------|-----|------|
| Channel unbounded | 3.9M | 0µs | 23µs |
| Channel bounded(64) | 1.9M | 0µs | 10µs |
| Channel dropOldest(16) | 5.3M | 0µs | 8µs |
| Channel batch sync | 260M | — | — |
| Channel batch async | 29M | — | — |

**Provavelmente não precisaremos de Channel** — a API é request/response síncrono. Mas se precisarmos de comunicação entre workers, temos essa opção comprovada.

## Queue — Se necessário

| Operação | ops/sec | Nota |
|----------|---------|------|
| Enqueue | 943K | Com heap otimizado |
| Dequeue | 1.9M | Com heap otimizado |
| Burst dequeue | 2.3M | 10K items |

**Não precisaremos de Queue** — a rinha é stateless.

## Thread/Worker — Se necessário

| Operação | ops/sec | p50 | Nota |
|----------|---------|-----|------|
| Thread echo round-trip | ~53K | 10µs | Cross-isolate |
| Thread ping/pong | ~74K | 10µs | Cross-isolate |
| ThreadPool (4 workers) | 56K | 16µs | Parallel |

**Channel in-process é 74x mais rápido que Thread** (3.9M vs 53K ops/sec). Para a rinha, não precisamos de threads — o Rust FFI já roda na mesma thread do event loop (blocking call, mas rápido o suficiente).

## Comparação de latência por camada

| Camada | Custo | Exemplo |
|--------|-------|---------|
| In-process (Channel) | 0-2µs | 3.9M ops/sec |
| Decorator | 3-11µs | 252K ops/sec |
| Mutex local | 0-9µs | 1.27M ops/sec |
| TCP (distributed) | 22-53µs | 19K ops/sec |

## Testes — Status atual

| Data | pass | fail | skip | assertions | arquivos |
|------|------|------|------|------------|----------|
| Último medição | 445 | 0 | — | 4453 | 46 |

**Arquivos de teste relevantes:**
- `infra/packages/bun/src/packages/framework/tests/integration/Performance.test.ts` — 1491 linhas, benchmarks de todos os componentes
- `infra/packages/bun/src/packages/framework/tests/ffi/` — testes FFI contra Rust .so real
- `infra/packages/bun/src/packages/framework/tests/hardening/NativeTTLWatchdog.test.ts` — validação de watchdog Rust

## Componentes Rust existentes (compilados e testados)

| Crate | Arquivo | Funções exportadas |
|-------|---------|-------------------|
| oml-mutex | `rust/oml-mutex/src/lib.rs` | oml_try_lock, oml_release, oml_start_ttl, oml_key_hash_64, oml_gc_stale_keys |
| oml-buffer | `rust/oml-buffer/src/lib.rs` | oml_buf_alloc, oml_buf_free, oml_buf_subview, oml_buf_write, oml_buf_read |
| oml-vault | `rust/oml-vault/src/lib.rs` | oml_vault_store, oml_vault_compare, oml_vault_extract, oml_vault_destroy |

**Não reutilizaremos esses crates diretamente na rinha**, mas o padrão de FFI (dlopen/dlsym, extern "C", tipos de retorno) é idêntico ao que construiremos para `libqrust_vector.so`.

## Registro de hardware da rinha

Mac Mini Late 2014, 2.6 GHz, 8 GB RAM, Ubuntu 24.04.
- Arquitetura: amd64 (IMPORTANTE: cross-compile se desenvolvendo em ARM)
- CPU fraca para padrões atuais — otimizações SIMD menos eficazes
- 8 GB RAM total — com 350 MB limite, sobra RAM do host
