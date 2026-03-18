FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/

EXPOSE 3001
CMD ["sh", "-c", "npx tsx src/seed.ts && npx tsx src/index.ts"]
