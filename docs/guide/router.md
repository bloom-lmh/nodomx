# Router 与应用入口

## 创建应用

```ts
import { Nodom } from "nodomx";
import App from "./App.nd";

const app = Nodom.createApp(App, "#app");
app.mount("#app");
```

## 注册插件

```ts
import { Nodom } from "nodomx";
import axios from "axios";

Nodom.use({
  install(app) {
    app.config.globalProperties.$http = axios;
    app.provide("http", axios);
  }
});
```

## 注册路由

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

## 模板里使用

```html
<template>
  <main>
    <route path="/">Home</route>
    <route path="/report">Report</route>
    <router />
  </main>
</template>
```

## 组合式 API

```ts
import { useRoute, useRouter } from "nodomx";

const router = useRouter();
const route = useRoute();

const warmReport = () => {
  router.preload("/report?id=7");
};

const openReport = () => {
  router.push("/report?id=7");
};
```
