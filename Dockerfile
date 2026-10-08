# FlyDubaiSim: one container serves the game (dist/) and the API.
#   docker build -t flydubaisim .
#   docker run -p 8791:8791 -v flydubaisim-data:/data --env-file .env.production flydubaisim
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8791 DATA_DIR=/data
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8791
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:8791/api/health || exit 1
CMD ["node", "server/index.mjs"]
