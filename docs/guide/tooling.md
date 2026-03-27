# 工具链部署与使用

这页就是你把整条链路真正装起来时最常用的说明：框架、`.nd`、语言服务器、脚手架、Rollup、Vite。

## 1. 安装 `nodomx`

```bash
npm install nodomx
```

## 2. 通过 `.nd` 写组件

如果你在 Rollup 或 Vite 工程中使用 `.nd`，需要再装对应插件。

### Rollup

```bash
npm install -D @nodomx/rollup-plugin-nd @nodomx/rollup-plugin-dev-server
```

### Vite

```bash
npm install -D vite vite-plugin-nodomx
```

## 3. 安装 VSCode 语言服务器

当前仓库里的扩展包是 `nodomx-nd-vscode`。

本地开发有两种方式：

### 方式 A：直接运行扩展开发宿主

1. 用 VSCode 打开 `vscode-extension`
2. 按 `F5`
3. 在新的 Extension Development Host 里打开你的 NodomX 项目

### 方式 B：打包成 VSIX 后安装

在 monorepo 根目录执行：

```bash
npm run package:extension
```

生成文件：

```text
vscode-extension/nodomx-nd-vscode-0.1.0.vsix
```

然后在 VSCode 里执行 `Extensions: Install from VSIX...` 安装。

## 4. 使用脚手架

```bash
npm create nodomx@latest my-app
cd my-app
npm run dev
```

脚手架默认生成 `.nd` 项目骨架，并带有开发服务器。

## 5. 本地发布这些包

如果你要把这一套发布到 npm：

```bash
npm run release:check
npm run release:preflight
npm run release:publish -- --dry-run
```

如果要真正发布，先确保你登录的是官方 npm registry：

```bash
npm config set registry https://registry.npmjs.org/
npm login --registry https://registry.npmjs.org/
```

## 6. 当前可用工具

- `nodomx`
- `@nodomx/nd-compiler`
- `@nodomx/rollup-plugin-nd`
- `@nodomx/rollup-plugin-dev-server`
- `vite-plugin-nodomx`
- `create-nodomx`
- `nodomx-nd-vscode`
