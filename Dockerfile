FROM oven/bun:1.3 AS builder
WORKDIR /app
COPY dataset/ dataset/
COPY scripts/ scripts/
COPY src/config.ts src/config.ts
COPY src/types.ts src/types.ts
COPY src/vectorizer.ts src/vectorizer.ts
RUN bun run scripts/prepare.ts

FROM oven/bun:1.3
WORKDIR /app
COPY --from=builder /app/dataset.bin dataset.bin
COPY --from=builder /app/dataset/expected-results.json dataset/expected-results.json
COPY src/ src/
EXPOSE 9998
