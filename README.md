# APK Rebuilder (Express + TypeScript + Static UI)

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
- 如果设置了 `APK_REBUILDER_IMAGE`，脚本会优先尝试拉预构建镜像。
- 拉取失败或未设置时，自动回退本地构建。

## 项目结构

- `src/`: Express + TypeScript 后端源码
  - `src/plugin/`: 插件相关路由、认证、辅助函数（这是插件的核心）
  - `src/api/`: 可选的本地 UI/调试接口实现。
    在本仓库中，这些路由被挂载到 `/api` 前缀下，因此前端可以直接访问 `/api/upload`, `/api/status/:id` 等。
    如果将本项目作为后端插件嵌入宿主平台，可以忽略该前缀，路由自身在 `createApiRouter()` 内部定义为 `/upload`, `/status/:id` 等。
  - `src/common/`: 公共工具函数（响应格式、任务处理等）
  - `src/middleware/`: 中间件（例如 `requireAuth`）
- `public/`: 静态前端页面（仅供本仓库内的调试界面使用）
- `Dockerfile`: 生产镜像构建
- `docker-compose.yml`: 本地/部署启动

## 后端接口

- `GET /health`
- `GET /api/tools`
- `POST /api/upload`
- `GET /api/library/apks` (返回库项列表，若存在缓存会包含 `apkInfo.iconUrl`)
- `GET /api/library/icon/:id` (获取库 APK 的图标，用于显示)
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
- `GET /api/download/:id` (可选 API Key) – 下载时文件名会使用 APK 中的 appName，若存在则附带版本号；如无则退回包名或任务 ID。

> **注意**: 上述路径是指向运行在此仓库编译出的服务器且附带 `/api` 前缀的情况；如果你在其他宿主应用中挂载路由，可直接使用去掉 `api` 前缀的版本，例如 `/upload`、`/status/:id` 等。

### 调试提示

为了方便在开发或 CI 环境中无工具链测试，该服务会在无法调用 apktool/apksigner 时自动启用 **stub 模式**：

- 上传任何文件都会跳过真实反编译，并生成一个包含 `<application/>` 的最小 `AndroidManifest.xml`。
- 后续的修改/构建也会模拟完毕，日志中会出现 `Build tools unavailable, running stub mod flow` 和 `Stub mod workflow finished` 记录。
- `downloadReady` 会变为 `true`，并可从 `/api/download/:id` 获取一个占位 APK。

此外，当前版本已将任务日志 (`task.logs`) 加入到 `/api/status` 和 `/api/tasks` 返回值中，前端页面会显示它们并据此调整进度条。这样即便没有安装外部工具，也能完整演练上传、修改、构建流程。

## 插件接口

本仓库本身只是 **一个独立的后端插件实现**，并不包含宿主框架。 在一个平台中可能会有多个类似插件，`apk-rebuilder` 是其中之一，本项目演示了后端插件的最小结构。标准入口如下：

- `GET /plugin/manifest`
- `POST /plugin/execute`
- `GET /plugin/runs/:runId`
- `GET /plugin/artifacts/:artifactId`

说明：
- `/plugin/*` 使用插件 token 鉴权，不复用旧的 `API_KEY`。
- `/api/*` 仍保留用于旧页面和本地调试，**仅用于本仓库构建的独立前端界面**，而非宿主平台的插件接口。
- 默认内置本地 artifact 存储兼容层；若宿主平台提供独立 artifact service，可继续替换实现而不改插件 API。

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

插件接口额外支持：
- `PLUGIN_TOKEN_SECRET`：用于校验 `/plugin/*` 的 HS256 Bearer token

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
