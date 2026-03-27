# Vite 插件

`vite-plugin-nodomx` 用来让 `.nd` 在 Vite 中直接工作。

## 安装

```bash
npm install nodomx
npm install -D vite vite-plugin-nodomx
```

## 基本配置

`vite.config.ts`

```ts
import { defineConfig } from "vite";
import { nodomx } from "vite-plugin-nodomx";

export default defineConfig({
  plugins: [nodomx()]
});
```

## 入口示例

`src/main.ts`

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

## 适用场景

- 希望用 Vite 开发 `.nd`
- 希望获得更快的冷启动与更自然的前端工程体验
- 希望把 NodomX 接入现有 Vite 技术栈
