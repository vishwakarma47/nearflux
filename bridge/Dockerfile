FROM node:20-bookworm-slim AS build
WORKDIR /app/bridge
COPY bridge/package.json bridge/package-lock.json* ./
RUN npm install --include=dev
COPY bridge/tsconfig.json ./
COPY bridge/src ./src
COPY shared ../shared
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app/bridge
COPY bridge/package.json bridge/package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/bridge/dist ./dist
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/bridge/src/index.js"]
