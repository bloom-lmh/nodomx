# Devtools

`@nodomx/devtools` 是 NodomX 的官方运行时调试面板。

## 能力概览

- 自动发现并跟踪已挂载的 NodomX app
- 模块树浏览、搜索、选中与高亮
- 查看 `setup / state / props / route / exposed`
- 查看并直接 patch 官方 store 状态
- 时间线记录 `mount / render / hook / manual refresh`
- 跟踪 `Transition / KeepAlive / Suspense` 关键生命周期
- 事件详情面板，可查看 timeline payload
- 页面元素拾取，点击真实 DOM 反查所属模块
- 快照导出与控制台 inspect

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

默认会打开内嵌调试面板，也可以通过 `Ctrl + Shift + D` 切换。

## 面板说明

### App tabs

在多个已挂载 app 之间切换。

### Module tree

浏览模块树，支持按模块名、`hotId`、模块 id 搜索。

### Timeline

查看最近发生的运行时事件：

- `mount / unmount`
- `render / first-render`
- `Transition / TransitionGroup`
- `KeepAlive activated / deactivated`
- `Suspense pending / fallback / resolve / error / retry`

### Events

点击任意时间线事件后，可以在 `Events` 面板里查看：

- summary
- category
- reason
- module / hot id
- hook 名称
- 原始 payload

### Inspector

查看当前选中模块或 app 的结构化快照，并可直接修改：

- `Apply setup`
- `Apply state`
- `Apply store state`
- `Highlight`
- `Pick element`

## 编程接口

```js
import {
  createDevtools,
  getDevtoolsHook,
  installDevtoolsHook,
  notifyDevtoolsUpdate
} from "@nodomx/devtools";
```

常用 hook API：

```js
const hook = getDevtoolsHook();

hook.getSnapshot();
hook.getTimeline();
hook.exportSnapshot();
hook.inspectSelection();
hook.highlightSelection();
hook.pickElement(targetNode);
hook.openOverlay();
hook.closeOverlay();
```

## 适合的场景

- 排查复杂组件组合下的状态变化
- 观察 `KeepAlive / Suspense / Transition` 的时序
- 直接在运行时修改模块或 store 状态复现问题
- 从页面真实 DOM 快速定位回模块树
