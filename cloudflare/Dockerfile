FROM node:24-bookworm-slim

ENV NODE_ENV=production
ENV VERCEL=1
ENV PORT=3000

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "cloudflare/container-server.js"]
