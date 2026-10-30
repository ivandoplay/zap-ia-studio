# Ienvia Motor — Dockerfile ARM (Oracle Cloud Always Free / Ampere A1)
# Base: Node.js 20 Alpine (multi-arch: arm64 + amd64)

FROM node:20-alpine AS runner

# ffmpeg para conversão de áudio OGG/Opus (Whisper/Gemini transcrição)
RUN apk add --no-cache ffmpeg ca-certificates curl

# Diretório de trabalho
WORKDIR /app

# Copa package files primeiro para cache de layers
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts

# Copa código
COPY . .

# Diretório de dados persistido (bind mount no compose)
RUN mkdir -p /app/data/uploads /app/data/wa_auth /app/data/training_packs

# Expoe porta do motor
EXPOSE 3000

# Healthcheck simples
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:3000/health || exit 1

# Roda o motor em modo local (não Vercel — IS_VERCEL=false)
CMD ["node", "src/server.js"]
