FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev && npm install tsx
COPY --from=builder /app/dist ./dist
COPY src/ ./src/
COPY tsconfig.json ./

EXPOSE 3001
CMD ["sh", "-c", "npx tsx src/seed.ts && node dist/index.js"]
