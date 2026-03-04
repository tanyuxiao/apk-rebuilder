ARG PYTHON_BUILD_IMAGE=python:3.12-bookworm
ARG PYTHON_RUNTIME_IMAGE=python:3.12-slim-bookworm

FROM ${PYTHON_BUILD_IMAGE} AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*

ARG APKTOOL_VERSION=2.11.1
ARG APKTOOL_JAR_URL=https://github.com/iBotPeaches/Apktool/releases/download/v${APKTOOL_VERSION}/apktool_${APKTOOL_VERSION}.jar
ARG ANDROID_BUILD_TOOLS_URL=https://dl.google.com/android/repository/build-tools_r34-linux.zip
ARG JDK_URL_AMD64=https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse
ARG JDK_URL_ARM64=https://api.adoptium.net/v3/binary/latest/17/ga/linux/aarch64/jdk/hotspot/normal/eclipse
ARG TARGETARCH

COPY requirements.txt ./requirements.txt
RUN python -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

RUN set -eux; \
  case "${TARGETARCH}" in \
    amd64) jdk_url="${JDK_URL_AMD64}" ;; \
    arm64) jdk_url="${JDK_URL_ARM64}" ;; \
    *) echo "Unsupported TARGETARCH: ${TARGETARCH}"; exit 1 ;; \
  esac; \
  mkdir -p /opt/tooling; \
  for i in 1 2 3 4 5 6; do \
    curl -fsSL --retry 3 --retry-delay 2 "${APKTOOL_JAR_URL}" -o /opt/tooling/apktool.jar && break || test "$i" -eq 6; \
    sleep $((i * 2)); \
  done; \
  for i in 1 2 3 4 5 6; do \
    curl -fsSL --retry 3 --retry-delay 2 "${ANDROID_BUILD_TOOLS_URL}" -o /opt/tooling/build-tools.zip && break || test "$i" -eq 6; \
    sleep $((i * 2)); \
  done; \
  for i in 1 2 3 4 5 6; do \
    curl -fsSL --retry 3 --retry-delay 2 "${jdk_url}" -o /opt/tooling/jdk.tar.gz && break || test "$i" -eq 6; \
    sleep $((i * 2)); \
  done

FROM ${PYTHON_RUNTIME_IMAGE} AS runtime
WORKDIR /app

ARG ANDROID_BUILD_TOOLS_VERSION=34.0.0
COPY --from=build /opt/tooling/apktool.jar /opt/apktool/apktool.jar
COPY --from=build /opt/tooling/build-tools.zip /tmp/build-tools.zip
COPY --from=build /opt/tooling/jdk.tar.gz /tmp/jdk.tar.gz
COPY --from=build /opt/venv /opt/venv

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*

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
ENV PATH=/opt/venv/bin:/opt/java/openjdk/bin:$PATH
ENV HOST=0.0.0.0

COPY app ./app
COPY public ./public
COPY main.py ./main.py

EXPOSE 3000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3000"]
