FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./server.mjs
COPY public ./public
USER node
CMD ["node", "server.mjs"]
