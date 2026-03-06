# APK Modder (Express + TypeScript + Static UI)

这是一个后端单仓版本：`Node.js + Express + TypeScript`，前端为 `public/` 下静态页面（无需单独前端工程）。

## 一键启动（推荐）

```bash
docker compose up -d --build
```

启动后访问：`http://localhost:3000`

## 快速启动脚本

```bash
./scripts/quick-start.sh
```

说明：
- 如果设置了 `APK_MODDER_IMAGE`，脚本会优先尝试拉预构建镜像。
- 拉取失败或未设置时，自动回退本地构建。

## 项目结构

- `src/`: Express + TypeScript 后端源码
- `public/`: 静态前端页面
- `Dockerfile`: 生产镜像构建
- `docker-compose.yml`: 本地/部署启动

## 后端接口

- `GET /health`
- `GET /api/tools`
- `POST /api/upload`
- `GET /api/library/apks`
- `POST /api/library/use`
- `DELETE /api/library/apks/:id`
- `POST /api/mod` (可选 API Key)
- `GET /api/status/:id`
- `GET /api/tasks`
- `GET /api/icon/:id`
- `GET /api/unity-config/:id`
- `GET /api/edit-file/:id`
- `GET /api/files/:id/tree`
- `GET /api/files/:id/content`
- `GET /api/download/:id` (可选 API Key)

## 本地开发

```bash
npm install
npm run dev
```

## 构建和运行

```bash
npm run build
npm start
```

## 鉴权

设置 `API_KEY`（或 `AUTH_TOKEN`）后开启鉴权。

需要鉴权的接口：
- `POST /api/mod`
- `GET /api/download/:id`

可通过以下方式传 token：
- `Authorization: Bearer <API_KEY>`
- `x-api-key: <API_KEY>`
- `?api_key=<API_KEY>`

## 环境变量

- `PORT` 默认 `3000`
- `HOST` 默认 `127.0.0.1`
- `APKTOOL_PATH` 默认 `apktool`
- `ZIPALIGN_PATH` 默认自动探测 Android build-tools 中的 `zipalign`
- `APKSIGNER_PATH` 默认自动探测 Android build-tools 中的 `apksigner`
- `KEYTOOL_PATH` 默认 `keytool`
- `DEBUG_KEY_ALIAS` 默认 `androiddebugkey`
- `DEBUG_KEY_PASS` 默认 `android`
- `API_KEY` 默认空

说明：在部分架构（如 arm64 容器）若 `zipalign` 不可执行，系统会自动降级为“跳过 zipalign 后签名”，保证流程可用。
