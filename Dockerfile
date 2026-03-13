ARG NODE_IMAGE=node:20-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip openjdk-17-jdk-headless && rm -rf /var/lib/apt/lists/*

ARG APKTOOL_VERSION=2.11.1
ARG APKTOOL_JAR_URL=https://github.com/iBotPeaches/Apktool/releases/download/v${APKTOOL_VERSION}/apktool_${APKTOOL_VERSION}.jar
ARG ANDROID_BUILD_TOOLS_URL=https://dl.google.com/android/repository/build-tools_r34-linux.zip

COPY package.json tsconfig.json ./
RUN npm install

RUN set -eux; \
  mkdir -p /opt/tooling; \
  curl -fsSL --retry 3 --retry-delay 2 "${APKTOOL_JAR_URL}" -o /opt/tooling/apktool.jar; \
  curl -fsSL --retry 3 --retry-delay 2 "${ANDROID_BUILD_TOOLS_URL}" -o /opt/tooling/build-tools.zip

COPY src ./src
COPY public ./public
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

# 安装运行时依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
  openjdk-17-jre-headless \
  unzip \
  ca-certificates \
  curl \
  && rm -rf /var/lib/apt/lists/*

ARG ANDROID_BUILD_TOOLS_VERSION=34.0.0
COPY --from=build /opt/tooling/apktool.jar /opt/apktool/apktool.jar
COPY --from=build /opt/tooling/build-tools.zip /tmp/build-tools.zip
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY scripts ./scripts
COPY public ./public

RUN set -eux; \
  mkdir -p /opt/android/build-tools/${ANDROID_BUILD_TOOLS_VERSION}; \
  cd /opt/android/build-tools/${ANDROID_BUILD_TOOLS_VERSION}; \
  unzip -q /tmp/build-tools.zip; \
  rm -f /tmp/build-tools.zip; \
  tools_dir="$(dirname "$(find /opt/android/build-tools/${ANDROID_BUILD_TOOLS_VERSION} -type f -name apksigner | head -n1)")"; \
  test -n "${tools_dir}"; \
  test -f "${tools_dir}/zipalign"; \
  printf '%s\n' '#!/bin/sh' "exec ${tools_dir}/zipalign \"\$@\"" > /usr/local/bin/zipalign; \
  printf '%s\n' '#!/bin/sh' "exec ${tools_dir}/apksigner \"\$@\"" > /usr/local/bin/apksigner; \
  printf '%s\n' '#!/bin/sh' 'exec java -jar /opt/apktool/apktool.jar "$@"' > /usr/local/bin/apktool; \
  chmod +x /usr/local/bin/apktool /usr/local/bin/zipalign /usr/local/bin/apksigner "${tools_dir}/zipalign" "${tools_dir}/apksigner"

ENV APKTOOL_PATH=/usr/local/bin/apktool
ENV ZIPALIGN_PATH=/usr/local/bin/zipalign
ENV APKSIGNER_PATH=/usr/local/bin/apksigner
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000
CMD ["node", "dist/index.js"]
