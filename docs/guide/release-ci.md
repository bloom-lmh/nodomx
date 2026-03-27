# 发布与 CI

NodomX 仓库当前已经接通这些自动化流程：

- GitHub Actions CI
- GitHub Pages 文档部署
- npm 包发布
- VSCode 扩展打包与发布

## CI

主流程负责：

- 安装依赖
- 构建所有 workspace
- 运行测试
- 校验可发布产物

只要 `main` 分支上的 CI 通过，说明 monorepo 本体、工具链和文档构建都处于可发布状态。

## npm 发布

当前已发布的核心包包括：

- `nodomx`
- `@nodomx/reactivity`
- `@nodomx/nd-compiler`
- `@nodomx/rollup-plugin-nd`
- `@nodomx/rollup-plugin-dev-server`
- `vite-plugin-nodomx`
- `create-nodomx`

仓库中可以通过以下命令做本地发布前检查：

```bash
npm run release:check
```

## VSCode 扩展发布

扩展包名是 `nodomx-nd-vscode`。

本地打包：

```bash
npm run package:extension
```

本地发布：

```bash
cd vscode-extension
npm run publish:marketplace
```

需要提前配置 `VSCE_PAT`。

## 文档部署

### GitHub Pages

- Settings -> Pages -> Source 选择 `GitHub Actions`
- 推送 `main` 后自动触发 `Docs` workflow

### Vercel / 帽子云

- 项目根目录使用 `docs`
- Build Command 用 `npm run build`
- Output Directory 用 `.vitepress/dist`
