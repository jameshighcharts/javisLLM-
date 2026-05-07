FROM node:22-bookworm-slim AS build

ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ARG VITE_SUPABASE_PUBLISHABLE_KEY=""

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/ts/contracts/package.json packages/ts/contracts/package.json
COPY packages/ts/api-client/package.json packages/ts/api-client/package.json

RUN pnpm install --frozen-lockfile --filter @easy-llm-benchmarker/web...

COPY apps/web apps/web
COPY packages/ts packages/ts

RUN pnpm --filter @easy-llm-benchmarker/web build

FROM nginxinc/nginx-unprivileged:1.29-alpine

COPY ops/hs-platform/app-images/web.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 8080
