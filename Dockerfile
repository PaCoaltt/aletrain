FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm install --omit=dev 2>/dev/null || true
EXPOSE 4173
CMD ["node", "server.mjs"]
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm install --omit=dev 2>/dev/null || true
EXPOSE 4173
CMD ["node", "server.mjs"]
