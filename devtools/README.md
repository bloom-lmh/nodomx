# `@nodomx/devtools`

`@nodomx/devtools` 为 NodomX 提供运行时调试桥和浏览器内调试面板。

当前版本支持：

- 自动发现并跟踪已挂载的 NodomX app
- 模块树浏览与模块级检查
- `setup / model / props / route / exposed` 快照查看
- 官方 store 状态查看
- 生命周期与 `Transition / KeepAlive / Suspense` 时间线
- 快照导出与控制台检查
- `Ctrl + Shift + D` 快捷开关面板

## 安装

```bash
npm install -D @nodomx/devtools
```

## 使用

```js
import { createDevtools } from "@nodomx/devtools";
import { Nodom } from "nodomx";
import App from "./App.nd";

const app = Nodom.createApp(App, "#app");
app.use(createDevtools());
app.mount("#app");
```

## 面板能力

- App tabs: 在多个已挂载 app 之间切换
- Module tree: 浏览模块树并选中当前模块
- Timeline: 查看 mount、render、hook、manual refresh 等事件
- Inspector: 查看当前模块或 app 的结构化快照
- Export: 导出当前 app 快照 JSON
- Inspect: 将当前 app / module 快照输出到浏览器控制台

## 编程接口

```js
import {
  getDevtoolsHook,
  installDevtoolsHook,
  notifyDevtoolsUpdate
} from "@nodomx/devtools";
```

- `installDevtoolsHook(options)`：安装并返回全局 hook
- `getDevtoolsHook()`：获取当前 hook
- `notifyDevtoolsUpdate(app, reason, details)`：手动推送一次调试更新
- `hook.getSnapshot()`：获取所有 app 的当前快照
- `hook.getTimeline(appId?)`：获取当前或指定 app 的时间线
- `hook.exportSnapshot(appId?)`：导出快照 JSON
- `hook.inspectSelection(appId?, moduleId?)`：把当前选中的 app/module 输出到控制台

## 说明

这是一版运行时内嵌调试面板，不依赖浏览器扩展就能用。后续如果继续演进，可以在此基础上扩展为更完整的独立 DevTools。
