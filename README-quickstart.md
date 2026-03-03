# Quick Start

## Fastest way

```bash
docker compose up -d --build
```

Open: `http://localhost:3000`

## Optional prebuilt image

If you have a public prebuilt image, set:

```bash
export APK_MODDER_IMAGE=ghcr.io/your-org/apk-modder:latest
./scripts/quick-start.sh
```

If prebuilt pull fails, script falls back to local build automatically.
