# Multi-stage Dockerfile for Click Catcher Microservice

# --- Stage 1: Build ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src
RUN npm run build

# --- Stage 2: Runtime ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
COPY public/ ./public

EXPOSE 3002
CMD ["node", "dist/server.js"]
