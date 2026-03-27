# `vite-plugin-nodomx`

`vite-plugin-nodomx` 让 Vite 可以直接导入 `.nd` 文件，同时保留 NodomX 的热更新能力。

## 安装

```bash
npm install nodomx
npm install -D vite vite-plugin-nodomx
```

## `vite.config.ts`

```ts
import { defineConfig } from "vite";
import { nodomx } from "vite-plugin-nodomx";

export default defineConfig({
  plugins: [nodomx()]
});
```

## 入口文件

```ts
import { Nodom } from "nodomx";
import { bootstrapNodomxViteApp } from "vite-plugin-nodomx/runtime";

await bootstrapNodomxViteApp({
  nodom: Nodom,
  hot: import.meta.hot,
  deps: ["./App.nd"],
  load: () => import("./App.nd"),
  selector: "#app"
});
```

## 特性

- 直接导入 `.nd`
- scoped style 编译
- `script setup` 编译
- root-relative hot id，便于和 Vite 的 HMR 更新路径对齐
- 配合 `Nodom.hotReload()` 做状态恢复
