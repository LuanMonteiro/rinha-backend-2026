FROM oven/bun:1.3 AS builder
WORKDIR /app

COPY package.json tsconfig.json ./
COPY src/ src/
COPY scripts/ scripts/

CMD ["sh", "-c", "bun run scripts/prepare.ts && bun run src/api.ts"]