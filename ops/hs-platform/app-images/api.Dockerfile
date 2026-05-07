FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json

RUN pnpm install --frozen-lockfile --filter @easy-llm-benchmarker/api...

COPY apps/api apps/api

RUN pnpm --filter @easy-llm-benchmarker/api build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV API_PORT=8787
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/package.json /app/apps/api/package.json
COPY --from=build /app/apps/api/dist /app/apps/api/dist

EXPOSE 8787

CMD ["node", "apps/api/dist/server.js"]
