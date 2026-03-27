# 工具与部署

这套仓库现在支持三类使用方式：

- 只用 `nodomx` 写经典模块
- 用 `.nd` + `script setup` 写现代组件
- 围绕 Rollup、Vite、VSCode 和 CI 建完整工程链路

## 文档站本地开发

仓库根目录运行：

```bash
npm run docs:dev
```

如果你直接在 `docs` 目录工作：

```bash
cd docs
npm install
npm run dev
```

## 文档站构建

根目录：

```bash
npm run build:docs
```

或在 `docs` 目录：

```bash
npm run build
```

## 已上线官网

- 国际站：[https://nodomx-docs.vercel.app/](https://nodomx-docs.vercel.app/)
- 中文站：[https://nodomx-e83lc0sk.maozi.io/](https://nodomx-e83lc0sk.maozi.io/)

## Vercel 部署

推荐直接把 `docs` 作为独立项目根目录：

- Root Directory: `docs`
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: `.vitepress/dist`

仓库里已经提供了 `docs/vercel.json` 供 Vercel 读取。

## GitHub Pages 部署

仓库已经配置好 `.github/workflows/docs.yml`。

要点只有两个：

1. GitHub Pages 的 Source 选择 `GitHub Actions`
2. 推送 `main` 后，`Docs` workflow 成功即可自动部署

`build-docs-pages.mjs` 会为 GitHub Pages 自动设置正确的 `base`，因此无需再手工改 VitePress 基路径。

## 帽子云部署

帽子云也可以直接把 `docs` 目录当作项目根目录，构建参数与 Vercel 保持一致：

- Root Directory: `docs`
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: `.vitepress/dist`

## 应用开发工具

### Rollup

```bash
npm install -D @nodomx/rollup-plugin-nd @nodomx/rollup-plugin-dev-server
```

### Vite

```bash
npm install -D vite vite-plugin-nodomx
```

### 脚手架

```bash
npm create nodomx@latest my-app
```

### VSCode 扩展

安装 `nodomx-nd-vscode` 后，VSCode 会识别 `.nd` 并启用语言服务。
