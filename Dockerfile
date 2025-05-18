FROM node:23-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app
COPY . /app

FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm run build

FROM base
COPY --from=prod-deps /app/node_modules /app/node_modules
# COPY --from=build /app/dist /app/dist
COPY --from=base /app/src /app/src
# RUN ls -la /app/dist
# EXPOSE 5001
CMD [ "pnpm", "dev", "./test_project", "We are building a simple todo app. Your job is to create an API scaffolding, without any functionality, using Node.js express.js and Typescript." ]