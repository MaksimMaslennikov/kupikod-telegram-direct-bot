FROM node:24-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src

RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV BOT_DB_PATH=/app/data/bot.sqlite3
CMD ["node", "src/bot.mjs"]
