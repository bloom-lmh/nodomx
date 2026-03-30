# Devtools

`@nodomx/devtools` 是 NodomX 的官方运行时调试面板。

## 现在能做什么

- 自动发现并切换当前页面里已经挂载的 NodomX app
- 浏览模块树，搜索模块名、`hotId`、模块 id
- 从真实页面元素反查所属模块
- 查看 `setup / state / props / route / exposed / store`
- 直接 patch 模块 `setup / state`
- 直接 patch 官方 store 状态
- 查看 `Transition / KeepAlive / Suspense` 等关键事件时间线
- 按 `reason` 或 `module` 对 timeline 分组
- 点击 timeline 事件查看 detail payload
- 直接编辑 route 的 `path / query JSON / hash`
- 导出 snapshot 到控制台或剪贴板

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

默认会打开内嵌调试面板，也可以通过 `Ctrl + Shift + D` 手动切换。

## 面板结构

### App tabs

在多个已挂载 app 之间切换。

### Module tree

- 浏览当前 app 的模块树
- 支持搜索
- 选中模块后，树会自动滚动到当前位置
- 配合 `Pick element` 可以从真实 DOM 反查模块

### Timeline

会记录常见运行时事件，例如：

- `mount / unmount`
- `render / first-render`
- `Transition / TransitionGroup`
- `KeepAlive activated / deactivated`
- `Suspense pending / fallback / resolve / error / retry`
- `manual refresh / devtools patch / route nav`

同时支持：

- 按分类过滤
- 只看当前选中模块事件
- 按 `reason` 分组
- 按 `module` 分组

### Events

点击任意 timeline 事件后，可以在 `Events` 面板查看：

- summary
- category
- reason
- module / hot id
- hook 名称
- 原始 payload

### Inspector

在 `Module` / `App` / `Stores` / `Raw JSON` 几个 tab 里查看和编辑运行时状态。

当前已经支持：

- `Apply setup`
- `Apply state`
- `Apply store state`
- `Highlight`
- `Pick element`
- route 的 `Push / Replace`

## 路由调试

如果项目已经接入 Router，devtools 会在模块或 app inspector 中显示 route 编辑器。

可以直接修改：

- `path`
- `query`，使用 JSON 格式
- `hash`

然后点击：

- `Push route`
- `Replace route`

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
hook.navigateRoute("/docs?tab=intro");
hook.openOverlay();
hook.closeOverlay();
```

## 适合的场景

- 排查复杂组件组合下的状态变化
- 观察 `KeepAlive / Suspense / Transition` 的时序
- 直接在运行时修改模块或 store 状态复现问题
- 从页面真实 DOM 快速定位回模块树
- 调试路由跳转和 query 变化
