FROM oven/bun:1.3 AS builder
WORKDIR /app

ARG RESOURSES_PATH=/resources
ARG RINHA_REPO=https://github.com/zanfranceschi/rinha-de-backend-2026.git

RUN apt-get update && apt-get install -y git && echo "TESTING: $RESOURSES_PATH" && \
    if [ ! -d "$FOLDER_NAME" ]; then \
        git clone "$RINHA_REPO" "/tmp/rinha" && \
        cp -r "/tmp/rinha/resources" "$RESOURSES_PATH"; \
    fi;

COPY package.json tsconfig.json ./
COPY src/ src/
COPY scripts/ scripts/

RUN ls /resources && bun run scripts/prepare.ts

FROM oven/bun:1.3

WORKDIR /app

COPY --from=builder /app/package.json /app/tsconfig.json ./
COPY --from=builder /app/src/ /app/src/
COPY --from=builder /app/dataset.bin /app/dataset.bin

CMD ["sh", "-c", "bun run scripts/validate-dataset.ts && bun run src/api.ts"]