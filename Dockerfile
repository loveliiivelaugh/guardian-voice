FROM oven/bun:1.2.15

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lockb* package-lock.json* tsconfig.json ./
RUN bun install

COPY . .

EXPOSE 5678
CMD ["bun", "run", "index.ts"]
