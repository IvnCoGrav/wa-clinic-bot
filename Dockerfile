FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS builder

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
# M17-11: kunci peta (CARTO) TIDAK lagi disuntikkan lewat build-arg; dashboard
# mengambilnya runtime dari GET /api/config/public agar rotasi tidak butuh rebuild.
WORKDIR /app/packages/admin-dashboard
# F8 rollout gate portal bidan. Default OFF; isi "true" hanya setelah angka
# raport divalidasi owner. Backend memakai env runtime bernama sama.
ARG VITE_SCORECARD_STAFF_UI_ENABLED=""
ENV VITE_SCORECARD_STAFF_UI_ENABLED=$VITE_SCORECARD_STAFF_UI_ENABLED
RUN npm ci --prefer-offline && npm run build
WORKDIR /app

# --- STAGE 2: PRODUCTION RUNNER ---
FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS runner

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
# DEL-05: Copy generated Prisma client from builder stage (avoid running prisma generate in runner)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Copy built code from builder stage
COPY --from=builder /app/dist ./dist
# CFG-02 & CFG-18: Salin config asset ke container runner
COPY --from=builder /app/src/config/persona_custom.txt ./src/config/persona_custom.txt
COPY --from=builder /app/src/config/surabaya_sidoarjo_subdistricts.json ./src/config/surabaya_sidoarjo_subdistricts.json
COPY --from=builder /app/src/config/landmarks.data.json ./src/config/landmarks.data.json
COPY --from=builder /app/src/config/kenari-pricing.snapshot.json ./src/config/kenari-pricing.snapshot.json
# Katalog layanan & tier delivery (runtime dibaca dari file + DB) — wajib ikut
# agar /api/admin/services dan TreatmentCatalogService tidak fallback ke default lama.
COPY --from=builder /app/services_custom.json ./services_custom.json
COPY --from=builder /app/delivery_tiers_custom.json ./delivery_tiers_custom.json
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
