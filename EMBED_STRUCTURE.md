# APK Rebuilder 嵌入端结构说明

本说明用于梳理 `public/` 下的插件嵌入端文件结构与职责，便于后续维护与替换。

## 1. 入口与加载顺序

1. `public/embed.html`
   - 插件 iframe 的入口页面
   - 仅包含容器与脚本入口
   - 按顺序加载：
     - `styles/theme.css`（主题变量）
     - `styles/ui.base.css`（通用样式）
     - `styles/ui.embed.css`（嵌入版局部样式）
     - `modules/app.embed.js`（脚本入口）

2. `public/styles/theme.css`
   - 统一的主题变量定义（与插件设计指南一致）
   - 包含两套主题：
     - `:root`：日间主题
     - `body[data-mode="dark"]`：夜间主题
   - 仅负责变量，不包含具体组件样式

3. `public/styles/ui.base.css`
   - 通用 UI 样式（按钮、表单、卡片、布局）

4. `public/styles/ui.embed.css`
   - 嵌入版布局样式（容器宽度、间距）

5. `public/modules/app.embed.js`
   - 嵌入端入口，复用 `modules/` 下的功能组件

## 2. 脚本模块划分

- `public/modules/app.embed.js`：嵌入端入口
- `public/modules/app.shared.js`：通用逻辑编排（同 index 复用）
- `public/modules/sections/*`：功能区模块（上传/包信息/构建/日志等）
- `public/modules/modals/*`：弹层模块（图标编辑）
- `public/modules/tools/*`：工具检查
- `public/modules/drawers/*`：抽屉模块（如 APK 列表/文件浏览）

## 3. 维护约定

- 样式变量只放在 `styles/theme.css`
- 通用样式只放在 `styles/ui.base.css`
- `embed.html` 仅保留结构和入口，不再内联样式
