FROM node:20-alpine

WORKDIR /app

COPY . .

ENV NODE_ENV=production
ENV PORT=4173

EXPOSE 4173

CMD ["node", "server.mjs"]
