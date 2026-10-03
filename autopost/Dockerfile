# Zero-dependency app, so this is just Node plus the source.
FROM node:22-alpine

RUN addgroup -S heartlens && adduser -S heartlens -G heartlens

WORKDIR /app
COPY package.json ./
COPY bin ./bin
COPY src ./src
COPY public ./public
COPY .env.example ./

# Persist the queue, history and outbox outside the container.
RUN mkdir -p /data && chown -R heartlens:heartlens /app /data
USER heartlens

ENV DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=4310 \
    HEARTLENS_ENV_FILE=/data/.env

EXPOSE 4310

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4310)+'/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "bin/heartlens-autopost.js", "serve"]
