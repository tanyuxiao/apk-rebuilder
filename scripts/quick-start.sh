#!/usr/bin/env bash
set -euo pipefail

IMAGE="${APK_MODDER_IMAGE:-ghcr.io/tanyuxiao/apk-modder:latest}"

detect_platform() {
  local machine
  machine="$(uname -m 2>/dev/null || echo unknown)"
  case "${machine}" in
    x86_64|amd64)
      echo "linux/amd64"
      ;;
    arm64|aarch64)
      # Current toolchain binaries (zipalign/apksigner) are validated on amd64 path.
      # Keep amd64 by default on Apple Silicon for maximum compatibility.
      echo "linux/amd64"
      ;;
    *)
      echo "linux/amd64"
      ;;
  esac
}

if [[ -z "${APK_MODDER_PLATFORM:-}" ]]; then
  export APK_MODDER_PLATFORM="$(detect_platform)"
else
  export APK_MODDER_PLATFORM
fi

echo "[quick-start] Trying prebuilt image: ${IMAGE}"
if docker pull "${IMAGE}" >/dev/null 2>&1; then
  echo "[quick-start] Prebuilt image is available, starting from image (platform=${APK_MODDER_PLATFORM})."
  docker compose -f docker-compose.yml -f docker-compose.prebuilt.yml up -d
else
  echo "[quick-start] Prebuilt image not accessible, falling back to local build (platform=${APK_MODDER_PLATFORM})."
  docker compose up -d --build
fi

echo "[quick-start] Done. Open: http://localhost:3000"
