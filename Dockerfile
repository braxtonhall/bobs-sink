FROM node:24-slim AS build
# better-sqlite3 compiles from source when no prebuilt binary matches the platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/test-support/package.json packages/test-support/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/protocol ./packages/protocol
COPY packages/server ./packages/server
RUN npx tsc -b packages/server/tsconfig.build.json && npm prune --omit=dev

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
	DATABASE_PATH=/data/sink.sqlite
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/protocol/package.json ./packages/protocol/
COPY --from=build /app/packages/protocol/dist ./packages/protocol/dist
# The whole package: dist, migrations, and any dependencies npm couldn't hoist (e.g. ajv 8 beside eslint's ajv 6).
COPY --from=build /app/packages/server ./packages/server
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
WORKDIR /app/packages/server
CMD ["node", "dist/main.js"]
