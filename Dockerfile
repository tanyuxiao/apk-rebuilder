ARG NODE_BUILD_IMAGE=docker.m.daocloud.io/library/node:20-bookworm
ARG NODE_RUNTIME_IMAGE=docker.m.daocloud.io/library/node:20-bookworm-slim

FROM ${NODE_BUILD_IMAGE} AS build
WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.20.0 --activate

ARG APKTOOL_VERSION=2.11.1
ARG APKTOOL_JAR_URL=https://github.com/iBotPeaches/Apktool/releases/download/v${APKTOOL_VERSION}/apktool_${APKTOOL_VERSION}.jar
ARG ANDROID_BUILD_TOOLS_URL=https://dl.google.com/android/repository/build-tools_r34-linux.zip
ARG JDK_URL_AMD64=https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse
ARG JDK_URL_ARM64=https://api.adoptium.net/v3/binary/latest/17/ga/linux/aarch64/jdk/hotspot/normal/eclipse
ARG TARGETARCH

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY src ./src
COPY public ./public
COPY tsconfig.json ./tsconfig.json
RUN pnpm build && pnpm prune --prod

RUN set -eux; \
  case "${TARGETARCH}" in \
    amd64) jdk_url="${JDK_URL_AMD64}" ;; \
    arm64) jdk_url="${JDK_URL_ARM64}" ;; \
    *) echo "Unsupported TARGETARCH: ${TARGETARCH}"; exit 1 ;; \
  esac; \
  mkdir -p /opt/tooling; \
  export APKTOOL_JAR_URL ANDROID_BUILD_TOOLS_URL JDK_URL="${jdk_url}"; \
  node -e ' \
    const fs = require("fs"); \
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)); \
    async function download(url, out) { \
      let lastError; \
      for (let i = 1; i <= 6; i++) { \
        try { \
          const res = await fetch(url, { redirect: "follow" }); \
          if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`); \
          const buf = Buffer.from(await res.arrayBuffer()); \
          fs.writeFileSync(out, buf); \
          return; \
        } catch (err) { \
          lastError = err; \
          if (i < 6) await wait(i * 2000); \
        } \
      } \
      throw lastError; \
    } \
    (async () => { \
      await download(process.env.APKTOOL_JAR_URL, "/opt/tooling/apktool.jar"); \
      await download(process.env.ANDROID_BUILD_TOOLS_URL, "/opt/tooling/build-tools.zip"); \
      await download(process.env.JDK_URL, "/opt/tooling/jdk.tar.gz"); \
    })().catch((err) => { \
      console.error(String(err)); \
      process.exit(1); \
    }); \
  '

FROM ${NODE_RUNTIME_IMAGE} AS runtime
WORKDIR /app

ARG ANDROID_BUILD_TOOLS_VERSION=34.0.0
COPY --from=build /opt/tooling/apktool.jar /opt/apktool/apktool.jar
COPY --from=build /opt/tooling/build-tools.zip /tmp/build-tools.zip
COPY --from=build /opt/tooling/jdk.tar.gz /tmp/jdk.tar.gz

RUN set -eux; \
  mkdir -p /opt/java/openjdk; \
  tar -xzf /tmp/jdk.tar.gz -C /opt/java/openjdk --strip-components=1; \
  rm -f /tmp/jdk.tar.gz; \
  mkdir -p /opt/android/build-tools/${ANDROID_BUILD_TOOLS_VERSION}; \
  cd /opt/android/build-tools/${ANDROID_BUILD_TOOLS_VERSION}; \
  /opt/java/openjdk/bin/jar xf /tmp/build-tools.zip; \
  rm -f /tmp/build-tools.zip; \
  tools_dir="$(dirname "$(find /opt/android/build-tools/${ANDROID_BUILD_TOOLS_VERSION} -type f -name apksigner | head -n1)")"; \
  test -n "${tools_dir}"; \
  test -f "${tools_dir}/zipalign"; \
  printf '%s\n' '#!/bin/sh' "exec ${tools_dir}/zipalign \"\$@\"" > /usr/local/bin/zipalign; \
  printf '%s\n' '#!/bin/sh' "exec ${tools_dir}/apksigner \"\$@\"" > /usr/local/bin/apksigner; \
  printf '%s\n' '#!/bin/sh' 'exec java -jar /opt/apktool/apktool.jar "$@"' > /usr/local/bin/apktool; \
  chmod +x /usr/local/bin/apktool /usr/local/bin/zipalign /usr/local/bin/apksigner \
    "${tools_dir}/zipalign" \
    "${tools_dir}/apksigner"

ENV APKTOOL_PATH=/usr/local/bin/apktool
ENV ZIPALIGN_PATH=/usr/local/bin/zipalign
ENV APKSIGNER_PATH=/usr/local/bin/apksigner
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH=/opt/java/openjdk/bin:$PATH
ENV HOST=0.0.0.0

COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
COPY --from=build /app/public /app/public

EXPOSE 3000
CMD ["node", "dist/index.js"]
