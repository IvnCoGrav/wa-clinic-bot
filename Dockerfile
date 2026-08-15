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

# Build Admin Dashboard SPA (base '/admin/', diserve bot di /admin/*)
WORKDIR /app/packages/admin-dashboard
RUN npm ci --prefer-offline && npm run build
WORKDIR /app

# --- STAGE 2: PRODUCTION RUNNER ---
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Prisma query engine butuh OpenSSL; sharp butuh font standard utk render teks watermark SVG
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates fonts-dejavu-core fontconfig \
  && fc-cache -f \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma/

# Install production dependencies only
RUN npm ci --only=production
RUN npx prisma generate

# Copy built code from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/config/surabaya_sidoarjo_subdistricts.json ./src/config/surabaya_sidoarjo_subdistricts.json
# Aset statis (mis. gambar pricelist default assets/pricelist_spa.jpg) — wajib ikut
# dicopy supaya pengiriman pricelist image tidak gagal di container.
COPY --from=builder /app/assets ./assets
# Admin dashboard SPA (diserve bot di /admin/*)
COPY --from=builder /app/packages/admin-dashboard/dist ./packages/admin-dashboard/dist

# Ensure non-root execution
RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["node", "dist/app.js"]
