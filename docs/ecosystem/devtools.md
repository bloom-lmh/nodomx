# `@nodomx/devtools`

`@nodomx/devtools` 是 NodomX 的官方调试面板包。

## 当前能力

- 自动发现并跟踪已挂载的 NodomX app
- 查看模块树并选中当前模块
- 查看 `setup / model / props / route / exposed`
- 查看官方 store 当前状态
- 记录 `mount / render / hook / manual refresh` 时间线
- 跟踪 `Transition / KeepAlive / Suspense` 关键生命周期
- 导出当前 app 快照
- 将当前 app / module 快照输出到浏览器控制台
- `Ctrl + Shift + D` 快捷开关面板

## 安装

```bash
npm install -D @nodomx/devtools
```

## 基本使用

```js
import { createDevtools } from "@nodomx/devtools";
import { Nodom } from "nodomx";
import App from "./App.nd";

const app = Nodom.createApp(App, "#app");
app.use(createDevtools());
app.mount("#app");
```

## 面板区域

### App tabs

在多个已挂载 app 之间切换。

### Module tree

浏览模块树，支持搜索模块名、`hotId` 和模块 id。

### Timeline

查看最近发生的运行时事件：

- `mount / unmount`
- `render / first-render`
- `Transition / TransitionGroup`
- `KeepAlive activated / deactivated`
- `Suspense pending / fallback / resolve / error / retry`

### Inspector

查看当前选中模块或 app 的结构化快照：

- `props`
- `setup`
- `model/state`
- `route`
- `exposed`
- `store`

## 编程接口

```js
import {
  createDevtools,
  getDevtoolsHook,
  installDevtoolsHook,
  notifyDevtoolsUpdate
} from "@nodomx/devtools";
```

### `createDevtools(options?)`

创建一个可直接 `app.use(...)` 的插件。

### `installDevtoolsHook(options?)`

安装并返回全局调试 hook。

### `getDevtoolsHook()`

获取当前已安装 hook。

### `notifyDevtoolsUpdate(app, reason, details?)`

手动推送一次调试更新。

## 常用 hook API

```js
const hook = getDevtoolsHook();

hook.getSnapshot();
hook.getTimeline();
hook.exportSnapshot();
hook.inspectSelection();
hook.openOverlay();
hook.closeOverlay();
```

## 适合的场景

- 排查复杂组件组合下的状态变化
- 观察 `KeepAlive / Suspense / Transition` 的时序
- 检查模块树结构是否符合预期
- 快速导出运行时快照给团队成员复现问题
