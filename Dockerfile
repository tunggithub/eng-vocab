# App cục bộ: backend Node + SQLite, không cần Supabase/Vercel
FROM node:24-slim

# better-sqlite3 cần build tools nếu không có prebuilt binary
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js db.js ai.js index.html api.js ./
COPY routes ./routes

EXPOSE 3000
CMD ["node", "server.js"]
