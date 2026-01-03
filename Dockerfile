# Image resmi Bun
FROM oven/bun:1 AS base

WORKDIR /app

# Install deps berdasarkan package.json (lock akan di-resolve saat bun install)
COPY package.json ./
RUN bun install

# Copy source (saat dev, ini dioverride oleh volume)
COPY . .

EXPOSE 41102
