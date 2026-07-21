FROM node:22-bookworm-slim AS base
RUN npm install --global npm@11.18.0 --no-audit --no-fund

FROM base AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . ./
RUN npm run build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
RUN mkdir -p /var/lib/solodot/tokens && chown -R node:node /var/lib/solodot
VOLUME ["/var/lib/solodot"]
USER node
CMD ["node", "dist/runtime.js"]
