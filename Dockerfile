# ─── Stage 1 : build ────────────────────────────────────────────────────────
# Compile TypeScript en bundle ESM unique avec esbuild.
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Cache npm install : on copie package*.json en premier.
# `--include=dev` est nécessaire car Coolify injecte NODE_ENV=production en
# ARG dès le start du build, ce qui ferait skip esbuild/tsx/typescript.
COPY package.json package-lock.json* ./
RUN npm ci --include=dev --no-audit --no-fund

# Copie le source et build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm run typecheck

# ─── Stage 2 : runtime ──────────────────────────────────────────────────────
# Base : image officielle Playwright (Chromium pré-installé + libs système).
# ~600 Mo mais évite d'installer manuellement libs Chromium dans une alpine.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy AS runtime

WORKDIR /app

# Curl pour healthcheck Docker / Coolify
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Installe les deps prod uniquement
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Copie le bundle compilé
COPY --from=build /app/dist ./dist

# Crée un user non-root (l'image playwright a déjà `pwuser` mais on le réutilise)
RUN chown -R pwuser:pwuser /app
USER pwuser

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Healthcheck : Coolify ping /health pour considérer le service ready.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -fsS http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
