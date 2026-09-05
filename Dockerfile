# Node 24 is a hard floor, not a preference: server/ runs as TypeScript through Node's
# type-stripping, and scripts/register-ts-ext.mjs needs module.registerHooks (v22.15+).
# Most PaaS defaults are still 20/22, so pin it explicitly.
FROM node:24-slim AS build
WORKDIR /app
# devDependencies are required to build — `build` is `tsc --noEmit && vite build`.
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
# The server runs the .ts sources directly, so src/, server/ and scripts/ ship as-is.
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src ./src
COPY scripts/register-ts-ext.mjs ./scripts/
COPY tsconfig.json ./
EXPOSE 8787
# Exec node directly rather than `npm start`: npm does not forward SIGTERM to its child, so
# under `npm` the graceful-shutdown handler never runs, players get a dropped socket with no
# explanation, and the container reports a failed exit on every ordinary deploy.
# PORT is injected by the platform; server/main.ts defaults to 8787.
CMD ["node", "--import", "./scripts/register-ts-ext.mjs", "server/main.ts"]
