FROM node:20-bookworm AS build
WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.20.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/backend/package.json packages/backend/package.json
COPY packages/frontend/package.json packages/frontend/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter frontend build \
  && mkdir -p packages/backend/public \
  && cp -R packages/frontend/dist/. packages/backend/public/ \
  && pnpm --filter backend build \
  && pnpm --filter backend --prod deploy --legacy /opt/backend

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ARG APT_MIRROR=https://mirrors.tuna.tsinghua.edu.cn

RUN set -eux; \
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list; do \
    [ -f "$f" ] || continue; \
    sed -i "s|http://deb.debian.org/debian|${APT_MIRROR}/debian|g" "$f"; \
    sed -i "s|http://deb.debian.org/debian-security|${APT_MIRROR}/debian-security|g" "$f"; \
    sed -i "s|https://deb.debian.org/debian|${APT_MIRROR}/debian|g" "$f"; \
    sed -i "s|https://deb.debian.org/debian-security|${APT_MIRROR}/debian-security|g" "$f"; \
  done

RUN apt-get -o Acquire::Retries=6 -o Acquire::http::Timeout=20 update && \
  apt-get -o Acquire::Retries=6 -o Acquire::http::Timeout=20 install -y --no-install-recommends --fix-missing \
  openjdk-17-jre-headless \
  apktool \
  zipalign \
  apksigner \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV APKTOOL_PATH=/usr/bin/apktool
ENV ZIPALIGN_PATH=/usr/bin/zipalign
ENV APKSIGNER_PATH=/usr/bin/apksigner
ENV HOST=0.0.0.0

COPY --from=build /opt/backend /app

EXPOSE 3000
CMD ["node", "dist/index.js"]
