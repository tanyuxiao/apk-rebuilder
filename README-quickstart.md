# APK Modder Quick Start

## Prerequisite
- Docker Desktop is installed and running.

## Start
```bash
./scripts/quick-start.sh
```

Open: [http://localhost:3000](http://localhost:3000)

`quick-start.sh` behavior:
- Try prebuilt image (`ghcr.io/tanyuxiao/apk-modder:latest`) first
- If registry is denied/unavailable, auto fallback to local build
- Auto detect host architecture and set container platform (`APK_MODDER_PLATFORM`) for best compatibility

## Manual: force local build
```bash
docker compose up -d --build
```

## Optional: mirror overrides
```bash
cat > .env <<'EOF'
APK_MODDER_IMAGE=ghcr.io/tanyuxiao/apk-modder:latest
APK_MODDER_PLATFORM=linux/amd64
NODE_BUILD_IMAGE=docker.m.daocloud.io/library/node:20-bookworm
NODE_RUNTIME_IMAGE=docker.m.daocloud.io/library/node:20-bookworm-slim
APKTOOL_JAR_URL=https://ghproxy.com/https://github.com/iBotPeaches/Apktool/releases/download/v2.11.1/apktool_2.11.1.jar
ANDROID_BUILD_TOOLS_URL=https://dl.google.com/android/repository/build-tools_r34-linux.zip
JDK_URL_AMD64=https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse
JDK_URL_ARM64=https://api.adoptium.net/v3/binary/latest/17/ga/linux/aarch64/jdk/hotspot/normal/eclipse
EOF
./scripts/quick-start.sh
```

Notes:
- Default container platform is `linux/amd64` to keep `zipalign`/`apksigner` behavior consistent on Apple Silicon.
- If you have verified an arm64-compatible toolchain, you can set `APK_MODDER_PLATFORM=linux/arm64`.

## Stop
```bash
docker compose down
```

## Optional: Reset local service data
```bash
docker compose down -v
```
