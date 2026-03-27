# `vite-plugin-nodomx`

Vite plugin for importing NodomX `.nd` single-file components directly.

## Install

```bash
npm install nodomx vite vite-plugin-nodomx
```

## Usage

```ts
import { defineConfig } from "vite";
import { nodomx } from "vite-plugin-nodomx";

export default defineConfig({
  plugins: [nodomx()]
});
```

Then you can import `.nd` files:

```ts
import App from "./App.nd";
```

For Vite HMR with NodomX state restore:

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
