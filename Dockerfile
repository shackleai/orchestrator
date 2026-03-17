FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install deps
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
COPY apps/cli/package.json apps/cli/
COPY apps/dashboard/package.json apps/dashboard/
RUN pnpm install --frozen-lockfile

# Build
FROM deps AS build
COPY . .
RUN pnpm build

# Production
FROM base AS production
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/apps/cli/dist /app/apps/cli/dist
COPY --from=build /app/apps/cli/package.json /app/apps/cli/package.json
COPY --from=build /app/apps/dashboard/dist /app/apps/dashboard/dist
COPY --from=build /app/package.json /app/package.json

ENV NODE_ENV=production
EXPOSE 4800
CMD ["node", "apps/cli/dist/index.js", "start", "--no-open"]
