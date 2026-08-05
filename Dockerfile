FROM node:20-slim AS builder

WORKDIR /app

# Copy dependency files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma Client & Build TypeScript
RUN npx prisma generate
# --max-old-space-size: mencegah OOM saat tsc build di server/VPS dengan RAM terbatas
RUN NODE_OPTIONS="--max-old-space-size=2048" npm run build

# --- STAGE 2: PRODUCTION RUNNER ---
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Prisma query engine butuh OpenSSL (node:20-slim tidak menyertakannya)
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma/

# Install production dependencies only
RUN npm ci --only=production
RUN npx prisma generate

# Copy built code from builder stage
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/app.js"]
