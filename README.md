# APK Modder (Monorepo)

Vue 3 + Vite 5 + Element Plus + Node/Express + pnpm + Docker 的 APK 修改工具。

## 项目结构

- `packages/frontend`: Vue 3 前端
- `packages/backend`: Express 后端
- `.github/workflows`: CI 与 Docker 构建流水线

后端分层（对齐规范）：

- `src/index.ts`: 启动入口
- `src/app.ts`: 应用装配
- `src/config/*`: 环境与路径配置
- `src/models/*`: 领域类型
- `src/routes/*`: 路由层
- `src/utils/*`: 工具函数
- `tests/unit/*`: 单元测试

## 本地开发

### 1) 安装依赖

```bash
pnpm install
```

可选：复制环境变量模板

```bash
cp .env.example .env
```

### 2) 启动后端

```bash
pnpm dev:backend
```

### 3) 启动前端

```bash
pnpm dev:frontend
```

前端默认在 `http://localhost:5173`，后端在 `http://localhost:3000`。

## 当前已实现接口

- `GET /health`
- `GET /api-docs` Swagger 文档
- `GET /api/tools` 工具链自检
- `POST /api/upload` 上传 APK 并反编译
- `POST /api/mod` 修改 Manifest（应用名、标识符/包名、版本名、版本号、图标）并重打包签名
- `GET /api/status/:id` 查看任务状态/日志
- `GET /api/tasks` 查看任务列表
- `GET /api/icon/:id` 获取当前任务解析出的图标
- `GET /api/download/:id` 下载输出 APK

说明：版本相关有两个独立字段。
- `versionName`：版本名（如 `1.0.0`）
- `versionCode`：版本号（整型，如 `100`，界面里常显示为 `(100)`）

## 本地工具链依赖

需要以下命令可在 PATH 找到（或通过环境变量覆盖路径）：

- `java` (JDK/JRE 17+)
- `keytool`
- `apktool`（或设置 `APKTOOL_PATH=/path/to/apktool`）
- `zipalign`
- `apksigner`

可用 `GET /api/tools` 检查。

说明：后端已内置 Homebrew 常见路径自动检测（例如 `/opt/homebrew/...` 下的 OpenJDK 和 Android build-tools），多数 macOS 场景下无需手动导出工具路径。

## 构建

```bash
pnpm build
```

`pnpm build` 只负责代码编译（对齐常规工程语义），不会自动打包 tar。

## 打包（交付）

应用构建产物打包：

```bash
pnpm release:app
# 输出: builds/apk-modder-app.tar.gz
```

Docker 镜像打包：

```bash
pnpm release:docker
# 输出: builds/apk-modder-image.tar
```

## 质量检查

```bash
pnpm lint
pnpm test
pnpm typecheck
```

## Docker

### 构建镜像

```bash
docker build -t apk-modder:dev .
```

### 运行容器

```bash
docker run --rm -p 3000:3000 apk-modder:dev
```

### 使用 docker compose

```bash
docker compose up -d
```

服务端口：`http://localhost:3000`

## 环境变量（后端）

- `PORT` 默认 `3000`
- `HOST` 默认 `127.0.0.1`（容器内请设为 `0.0.0.0`）
- `APKTOOL_PATH` 默认 `apktool`
- `ZIPALIGN_PATH` 默认 `zipalign`
- `APKSIGNER_PATH` 默认 `apksigner`
- `KEYTOOL_PATH` 默认 `keytool`
- `JAVA_PATH` 默认自动检测（或 `java`）
- `JAVA_HOME` 默认自动推导（用于 `apksigner/keytool` 执行环境）
- `DEBUG_KEY_ALIAS` 默认 `androiddebugkey`
- `DEBUG_KEY_PASS` 默认 `android`
- `API_KEY` 默认空（设置后自动开启鉴权）
- `AUTH_TOKEN` 兼容旧变量，`API_KEY` 优先

鉴权开启后，以下接口需要 token：

- `POST /api/mod`
- `GET /api/download/:id`

可通过任一方式传入：

- `Authorization: Bearer <API_KEY>`
- `x-api-key: <API_KEY>`
- query: `?api_key=<API_KEY>`

## 常用命令

- `pnpm dev`
- `pnpm dev:backend`
- `pnpm dev:frontend`
- `pnpm build`
- `pnpm lint`
- `pnpm test`
- `pnpm typecheck`
- `pnpm package:app`
- `pnpm release:app`
- `pnpm docker:build`
- `pnpm docker:up`
- `pnpm docker:down`
- `pnpm docker:save`
- `pnpm docker:load`
- `pnpm release:docker`
