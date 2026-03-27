# VSCode 扩展

扩展包名：`nodomx-nd-vscode`

## 已支持能力

- `.nd` 语法高亮
- 模板符号补全
- 诊断
- 跳转
- 保存自动编译

## 本地安装

### 直接调试

```bash
cd vscode-extension
npm run build
```

然后在 VSCode 中按 `F5` 启动扩展开发宿主。

### 打包成 VSIX

在 monorepo 根目录执行：

```bash
npm run package:extension
```

安装输出：

```text
vscode-extension/nodomx-nd-vscode-0.1.0.vsix
```

## 推荐配置

安装后建议打开这些设置：

- `nodomx.nd.compileOnSave`
- `nodomx.nd.enableLanguageServer`

这样 `.nd` 文件会在保存时自动编译，并且模板里的符号能获得更稳定的诊断和跳转。
