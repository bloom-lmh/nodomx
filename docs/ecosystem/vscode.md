# VSCode 扩展

扩展包名：`nodomx-nd-vscode`

发布者：`bloom-lmh`

Marketplace 预期直链：

```text
https://marketplace.visualstudio.com/items?itemName=bloom-lmh.nodomx-nd-vscode
```

## 已支持能力

- `.nd` 语法高亮
- 模板符号补全
- 诊断
- 跳转
- 保存自动编译
- 语言服务器

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
vscode-extension/nodomx-nd-vscode-<version>.vsix
```

如果 Marketplace 索引还没完成，或者你想先内测，这就是最稳的安装方式。

## Marketplace 发布

GitHub Actions 里的 `Release` workflow 已经支持扩展发布，但它依赖仓库 secret：

- `VSCE_PAT`

只有在 `VSCE_PAT` 已配置时，这一步才会真正执行：

```bash
npm run publish:extension
```

如果 workflow 成功但 Marketplace 页面暂时还打不开，通常有两种情况：

- 发布步骤被 secret 缺失逻辑跳过了
- 扩展已经发布，但 Marketplace 搜索索引还没完成

最直接的核验方式是访问上面的 `itemName` 直链，而不是只看 workflow 是否成功。

## 推荐配置

安装后建议打开这些设置：

- `nodomx.nd.compileOnSave`
- `nodomx.nd.enableLanguageServer`

这样 `.nd` 文件会在保存时自动编译，并且模板里的符号能获得更稳定的诊断和跳转。

## 发布前检查清单

- `publisher` 与你在 VSCode Marketplace 上创建的发布者一致
- `VSCE_PAT` 已放进 GitHub Secrets
- `npm run package:extension` 本地可通过
- `Release` workflow 里 `Publish VSCode extension` 步骤没有走 skip 分支

如果你希望同时上架 Open VSX，可以在后续再补 `OVSX_TOKEN` 和一条独立的发布流程。
