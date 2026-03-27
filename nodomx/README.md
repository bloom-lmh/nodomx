# NodomX

NodomX 是一个面向单页应用的 MVVM 前端框架。它保留了 Nodom 一直以来的模板语法和模块化思想，同时补上了现代开发体验：

- 组合式状态 API
- `.nd` 单文件组件
- `<script setup>` 语法糖
- 应用级插件 / `provide` / `inject`
- 内置路由与预加载
- Rollup 开发服务器与 HMR
- VSCode 语言服务

如果你已经在用旧的 `template() + data()` 风格，NodomX 仍然兼容；如果你更想写接近 Vue 3 的组合式代码，也可以直接切过去。

## 仓库结构

当前仓库是 monorepo，核心包和工具链并行维护：

- `./packages/shared`: 共享类型、运行时公共工具
- `./packages/reactivity`: 响应式系统
- `./packages/runtime-*`: 模板编译、模块、渲染、路由、调度、应用层等运行时子包
- `../nd-compiler`: `.nd` 编译器与 CLI
- `../rollup-plugin-nd`: Rollup 的 `.nd` 导入插件
- `../rollup-plugin-dev-server`: 开发服务器与 HMR 运行时
- `../vite-plugin-nodomx`: Vite 的 `.nd` 导入插件与 HMR 助手
- `../create-nodomx`: 官方脚手架
- `../vscode-extension`: VSCode 扩展与语言服务器

对外使用时，你通常只需要安装 `nodomx`；如果要做 `.nd` 构建，再按需搭配工具包。

## 安装

```bash
npm install nodomx
```

如果你想直接新建项目，推荐使用脚手架：

```bash
npm create nodomx@latest my-app
```

## 快速开始

### 1. 经典模块写法

```ts
import { Module, Nodom } from "nodomx";

class HelloModule extends Module {
    template() {
        return `
            <div class="hello">
                Hello {{name}}
            </div>
        `;
    }

    data() {
        return {
            name: "NodomX"
        };
    }
}

Nodom.app(HelloModule, "#app");
```

### 2. 组合式写法

模板语法不变，只是把状态写进 `setup()`：

```ts
import { Module, Nodom, useComputed, useReactive, useState } from "nodomx";

class CounterModule extends Module {
    template() {
        return `
            <section class="counter">
                <p>count: {{count}}</p>
                <p>double: {{doubleCount}}</p>
                <p>user: {{profile.name}}</p>
                <button e-click="increase">+1</button>
            </section>
        `;
    }

    setup() {
        const count = useState(1);
        const profile = useReactive({ name: "nodomx" });
        const doubleCount = useComputed(() => count.value * 2);

        const increase = () => {
            count.value++;
        };

        return {
            count,
            profile,
            doubleCount,
            increase
        };
    }
}

Nodom.app(CounterModule, "#app");
```

要点：

- 模板里仍然写 `{{count}}`，不是 `{{count.value}}`
- 事件仍然写 `e-click="increase"`
- 只有在 `setup()` 里访问 `ref/computed` 时才使用 `.value`

## `.nd` 单文件组件

NodomX 现在支持 `.nd` 单文件组件，适合项目化开发。

一个最小示例：

```html
<template>
  <div class="hero">
    <h1>{{title}}</h1>
    <p>{{count}}</p>
    <button e-click="inc">+1</button>
  </div>
</template>

<script setup>
import { useState } from "nodomx";

const title = useState("Hello NodomX");
const count = useState(1);

const inc = () => {
  count.value++;
};
</script>

<style scoped>
.hero {
  padding: 24px;
}
</style>
```

支持的区块：

- `<template>`
- `<script>`
- `<script setup>`
- `<style>`
- `<style scoped>`

### `<script setup>` 语法糖

`<script setup>` 下，顶层声明会自动暴露给模板，不需要再手写 `setup()` 返回对象。

目前常用能力包括：

- `useState`
- `useReactive`
- `useComputed`
- `useWatch`
- `useWatchEffect`
- `provide`
- `inject`
- `useRoute`
- `useRouter`
- `defineProps`
- `withDefaults`
- `defineOptions`（编译期宏）

`defineOptions` 适合声明模块级配置，例如子模块：

```html
<script setup>
import ChildPanel from "./ChildPanel.nd";
import { defineOptions, useState } from "nodomx";

defineOptions({
  modules: [ChildPanel]
});

const title = useState("Dashboard");
</script>
```

## 应用、插件与依赖注入

除了 `Nodom.app()`，你也可以显式创建应用实例：

```ts
import { Nodom } from "nodomx";
import App from "./App.nd";

const app = Nodom.createApp(App, "#app");

app.mount("#app");
```

插件既可以通过 `Nodom.use()` 预注册，也可以对某个 app 单独安装：

```ts
import { Nodom } from "nodomx";
import axios from "axios";

const httpPlugin = {
    install(app) {
        app.config.globalProperties.$http = axios;
        app.provide("http", axios);
    }
};

Nodom.use(httpPlugin);
```

在模块或 `<script setup>` 里：

```ts
import { inject } from "nodomx";

const http = inject("http");
```

## 路由

NodomX 内置路由，不需要额外再接第三方路由器才能跑 SPA。

### 注册路由

```ts
import { Nodom, Router } from "nodomx";
import HomePage from "./pages/HomePage.nd";

Nodom.use(Router);

Nodom.createRoute([
    {
        path: "/",
        name: "home",
        module: HomePage
    },
    {
        path: "/report",
        name: "report",
        load: async () => import("./pages/ReportPage.nd"),
        preload: true
    }
]);
```

### 模板里使用

```html
<template>
  <main>
    <route path="/">Home</route>
    <route path="/report">Report</route>
    <router />
  </main>
</template>
```

### 在组合式代码里使用

```ts
import { useRoute, useRouter } from "nodomx";

const router = useRouter();
const route = useRoute();

const warmReport = () => {
    router.preload("/report");
};

const openReport = () => {
    router.push("/report?id=7");
};
```

当前路由能力包括：

- `push`
- `replace`
- `resolve`
- `preload`
- `beforeEach`
- `afterEach`
- `beforeEnter`
- `redirect`
- `meta`
- `query`
- `params`
- 懒加载与子路由

## 响应式与生命周期

常用组合式 API：

```ts
import {
    inject,
    onMounted,
    provide,
    useComputed,
    useReactive,
    useRoute,
    useRouter,
    useState,
    useWatch,
    useWatchEffect
} from "nodomx";
```

示例：

```ts
setup() {
    const count = useState(1);
    const profile = useReactive({ name: "nodomx" });
    const doubleCount = useComputed(() => count.value * 2);

    useWatch(count, value => {
        console.log("count changed:", value);
    });

    useWatchEffect(() => {
        console.log(profile.name, doubleCount.value);
    });

    onMounted(() => {
        console.log("mounted");
    });

    provide("theme", "light");

    return {
        count,
        profile,
        doubleCount
    };
}
```

## 模板语法与性能建议

NodomX 保留了自己原本的模板风格，但运行时已经补了更细的 patch flag、block tree、结构型块边界和列表 diff 优化。想让它跑得更稳，推荐注意下面几点。

### 列表一定尽量带稳定 `key`

```html
<ul>
  <li x-repeat={{todos}} key={{id}}>
    {{title}}
  </li>
</ul>
```

这样会命中 keyed diff，移动和重排更稳定。

### 静态壳包动态区

```html
<section class="card">
  <header class="card-hd">Dashboard</header>
  <div class="card-bd">
    <p>{{count}}</p>
    <button e-click="inc">+1</button>
  </div>
</section>
```

静态部分会被 hoist，并通过 block tree 复用，减少无关递归。

### 条件、插槽、模块、路由节点现在都会形成结构型块边界

这意味着 `if/elseif/slot/module/route/router` 这一类节点不再混进普通子节点的 diff 逻辑里硬猜，它们会在编译期带上结构信息，运行时更容易稳定复用静态兄弟节点。

## 工具链

围绕 `nodomx`，当前已经有完整的基础开发链路。

### 1. `create-nodomx`

官方脚手架，直接生成 `.nd + Rollup + dev server` 项目：

```bash
npm create nodomx@latest my-app
```

### 2. `@nodomx/nd-compiler`

单独编译 `.nd` 文件：

```bash
npm run compile:nd -- ./examples/nd-counter.nd
```

或编译整个目录：

```bash
npm run compile:nd -- ./examples
```

### 3. `@nodomx/rollup-plugin-nd`

让 Rollup 可以直接：

```ts
import App from "./App.nd";
```

### 4. `@nodomx/rollup-plugin-dev-server`

本地开发服务器，支持 `.nd` 变更后的 HMR。

当前 HMR 能力包括：

- `.nd` 组件级热替换
- 顶层 `setup()` 状态恢复
- 组件子树重挂载，而不是整页刷新

### 5. `vite-plugin-nodomx`

如果你的项目基于 Vite，可以直接安装：

```bash
npm install -D vite vite-plugin-nodomx
```

然后在 `vite.config.ts` 里：

```ts
import { defineConfig } from "vite";
import { nodomx } from "vite-plugin-nodomx";

export default defineConfig({
    plugins: [nodomx()]
});
```

入口文件推荐配合 `vite-plugin-nodomx/runtime` 的 `bootstrapNodomxViteApp()` 一起使用。

### 6. VSCode 扩展

仓库里的 `../vscode-extension` 提供了：

- `.nd` 语法高亮
- 补全
- 诊断
- 跳转
- 保存自动编译

## 示例

你可以先看这些文件：

- `./examples/composition.html`
- `./examples/nd-counter.nd`
- `./examples/repeat.html`
- `../create-nodomx/template/basic/src/App.nd`
- `../docs`

## 本地开发

在仓库根目录运行：

```bash
npm install
npm run build:all
npm run test:all
```

只开发 `nodomx` 包时，也可以进入当前目录：

```bash
npm run build
npm test
```

当前 `npm test` 会覆盖：

- 组合式 API smoke test
- HMR smoke test
- 渲染优化 smoke test
- keyed / unkeyed 列表 diff smoke test
- 结构型 block smoke test
- 路由 smoke test
- 路由 preload smoke test

## 文档与 API

- API 文档入口：[./api/nodomx.md](./api/nodomx.md)
- 版本记录：[./update.md](./update.md)
- 仓库根说明：[../README.md](../README.md)
- npm 发布清单：[../docs/npm-release-checklist.md](../docs/npm-release-checklist.md)

## 兼容说明

NodomX 当前同时支持两套写法：

- 经典 `Module + template() + data()`
- 组合式 `setup()` / `<script setup>`

旧模板语法不会被强制替换，所以可以渐进迁移。建议新项目优先使用：

- `.nd`
- `<script setup>`
- `useState/useReactive/useComputed`
- 稳定 `key`
- `create-nodomx` 脚手架
