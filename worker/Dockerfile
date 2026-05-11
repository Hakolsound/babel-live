FROM oven/bun:1.2-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY tsconfig.json ./
COPY src ./src

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

CMD ["bun", "run", "src/index.ts"]
