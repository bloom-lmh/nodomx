# VSCode 扩展

扩展包名：`nodomx-nd-vscode`

发布者：`bloom-lmh`

Marketplace 直链：

```text
https://marketplace.visualstudio.com/items?itemName=bloom-lmh.nodomx-nd-vscode
```

## 已支持能力

- `.nd` 语法高亮
- 模板补全
- 指令与事件补全
- 组合式 API 补全
- 诊断
- 跳转到定义
- 保存自动编译
- Language Server

## 本地调试

```bash
cd vscode-extension
npm run build
```

然后在 VSCode 中按 `F5` 启动扩展开发宿主。

## 本地打包

```bash
npm run package:extension
```

输出文件位于：

```text
vscode-extension/nodomx-nd-vscode-<version>.vsix
```

## 发布到 Marketplace

```bash
cd vscode-extension
$env:VSCE_PAT="你的 token"
npm run publish:marketplace
```

发布成功后，用户可以直接从 VSCode 扩展市场安装；安装完成后，`.nd` 文件会被识别为 `nd` 语言，并启用语言服务器。

## 推荐设置

- `nodomx.nd.enableLanguageServer`
- `nodomx.nd.compileOnSave`
