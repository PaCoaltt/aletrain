FROM node:22-alpine
WORKDIR /app
COPY . .
ARG APP_REVISION=development
ENV APP_REVISION=$APP_REVISION
ENV VISITS_FILE=/data/visits.json
ENV REQUIRE_VISITS_FILE=1
RUN npm run build
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4173
CMD ["node", "server.mjs"]
