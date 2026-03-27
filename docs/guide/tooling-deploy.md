# 工具链与部署

这一页讲的是“如何真正把 NodomX 用起来”，包括 `.nd`、语言服务器、脚手架、开发服务器、Vite、Rollup，以及官网如何部署到 GitHub Pages、Vercel 和帽子云。

## 安装框架

```bash
npm install nodomx
```

如果你只是消费已经发布好的框架包，到这里就可以开始写模块或 `.nd` 文件了。

## `.nd` 单文件组件

如果你只想手工编译 `.nd`：

```bash
npm install -D @nodomx/nd-compiler
```

```bash
ndc ./src/App.nd --out ./src/App.nd.gen.mjs
```

## Rollup 工程

```bash
npm install nodomx
npm install -D @nodomx/rollup-plugin-nd @nodomx/rollup-plugin-dev-server
```

适合：

- 直接使用官方脚手架模板
- 想走更轻的官方开发体验
- 想用官方 dev server 和 HMR

## Vite 工程

```bash
npm install nodomx
npm install -D vite vite-plugin-nodomx
```

## 脚手架

```bash
npm create nodomx@latest my-app
cd my-app
npm run dev
```

## VSCode 语言服务器

当前扩展包名是 `nodomx-nd-vscode`。

本地打包：

```bash
npm run package:extension
```

输出文件：

```text
vscode-extension/nodomx-nd-vscode-<version>.vsix
```

然后在 VSCode 中执行 `Extensions: Install from VSIX...` 安装。

Marketplace 发布后的直链格式是：

```text
https://marketplace.visualstudio.com/items?itemName=bloom-lmh.nodomx-nd-vscode
```

## 文档站本地开发

本仓库 docs 已切到 VitePress：

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```

## 官网部署

NodomX 文档站现在支持三种部署模式：

- GitHub Pages
- Vercel
- 帽子云

三者共用同一套 VitePress 源码，区别只在构建时的 `base`。

### GitHub Pages

GitHub Pages 使用仓库子路径部署，已经接入自动 workflow。

关键点：

- 分支：`main`
- 构建命令：由 GitHub Actions 调用 [build-docs-pages.mjs](/E:/dev_projects/nodomx/scripts/release/build-docs-pages.mjs)
- 站点基路径：`/nodomx/`
- 输出目录：`docs/.vitepress/dist`

你平时只需要推送到 `main`，`Docs` workflow 会自动部署。

### Vercel

仓库里已经提供了 [vercel.json](/E:/dev_projects/nodomx/vercel.json)，直接适配 Vercel 静态部署。

推荐项目设置：

- Framework Preset：`Other` 或自动识别为 `VitePress`
- Root Directory：仓库根目录
- Install Command：`npm install`
- Build Command：`npm run docs:build:vercel`
- Output Directory：`docs/.vitepress/dist`
- Production Branch：`main`
- Node.js：建议 `20`

仓库内对应脚本：

```bash
npm run docs:build:vercel
```

这个脚本会把 `DOCS_BASE` 固定成 `/`，适合 Vercel 根域名或自定义域名部署。

### 帽子云

帽子云这类静态托管平台，推荐和 Vercel 一样走“根路径静态站点”模式。

推荐项目设置：

- 仓库来源：GitHub 或 Gitee 的 `main`
- Root Directory：仓库根目录
- Install Command：`npm install`
- Build Command：`npm run docs:build:maoziyun`
- Output Directory：`docs/.vitepress/dist`
- Node.js：建议 `20`

仓库内对应脚本：

```bash
npm run docs:build:maoziyun
```

这个脚本和 Vercel 一样，都会生成根路径站点。

### 自定义域名建议

- GitHub Pages：适合挂二级域名或项目子路径
- Vercel：适合国外访问和自动 HTTPS
- 帽子云：适合国内访问和备案场景

如果你准备双部署，推荐：

- 国外主站放 Vercel
- 国内镜像站放帽子云
- GitHub Pages 继续作为公开备用镜像

## 发布前校验

```bash
npm run release:check
```

这个命令会覆盖：

- monorepo build
- monorepo test
- npm pack 检查
- docs 构建
- Vite 插件
- VSCode 扩展测试
- VSCode 扩展打包
