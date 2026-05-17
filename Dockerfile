FROM node:20-alpine

WORKDIR /app

COPY index.html app.js styles.css server.mjs ./

ENV NODE_ENV=production

EXPOSE 4173

CMD ["node", "server.mjs"]
