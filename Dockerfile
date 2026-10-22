FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build
RUN mkdir -p /data/uploads && chown -R node:node /app /data
USER node
EXPOSE 3000
# Com SEED_MASTER_EMAIL definido, cria master e planos (idempotente) a cada subida.
CMD ["sh", "-c", "npx prisma migrate deploy && { [ -z \"$SEED_MASTER_EMAIL\" ] || npx tsx prisma/seed.ts; } && npx next start -H 0.0.0.0 -p 3000"]
