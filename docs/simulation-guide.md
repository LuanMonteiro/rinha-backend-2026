# Guia de Simulação de Hardware (Rinha 2026)

Para testar sua aplicação em um ambiente o mais próximo possível do hardware oficial da Rinha de Backend 2026.

## 1. Especificações do Hardware Real
- **Máquina:** Mac Mini 2014
- **CPU:** Intel Core i5-4278U (Dual Core @ 2.6GHz)
- **RAM:** 8GB (porém limitada a 350MB por stack na competição)
- **SO:** Ubuntu 24.04 LTS (Bare-metal)

## 2. Simulação via QEMU/KVM
Para simular as restrições de CPU e latência de memória de um core antigo, você pode usar o seguinte comando:

```bash
qemu-system-x86_64 \
  -m 350M \
  -smp 1,cores=1 \
  -cpu host,migratable=no \
  -enable-kvm \
  -drive file=SUA_IMAGEM_UBUNTU.qcow2,if=virtio \
  -net nic,model=virtio -net user,hostfwd=tcp::9999-:9999 \
  -display none -vga none
```

### Por que usar `-smp 1`?
A rinha restringe a stack inteira a **1.0 vCPU**. Ao usar uma VM com apenas 1 core, você simula o escalonamento real do kernel sem a ajuda de cores ociosos do seu host.

## 3. Simulação via Docker (CPU Pinning)
Se não quiser usar KVM, a forma mais fiel no Docker é o **CPU Pinning**. Isso evita que o SO mova o processo entre cores modernos (P-cores/E-cores), o que causa jitter de cache.

```bash
# Rodar no seu docker-compose ou comando docker
docker run --cpuset-cpus="0" --memory="350m" ...
```

## 4. Simulando Latência de Rede
A rinha oficial roda tudo na mesma máquina, mas o Docker/HAProxy adicionam overhead. Para simular a latência real de um Mac Mini antigo:
```bash
# Adicionar 0.1ms de latência na interface local
sudo tc qdisc add dev lo root netem delay 0.1ms
```

## 5. Checklist de Validação
- [ ] A API sobe em menos de 30 segundos (limite de healthcheck).
- [ ] O p99 se mantém abaixo de 1.0ms sob 900 RPS constante (Meta de segurança).
- [ ] O p50 se mantém abaixo de 300μs (Baseline local: ~200μs).
- [ ] Não há restarts por OOM (Out of Memory) durante o pico de carga.

```
