# `@nodomx/rollup-plugin-dev-server`

Rollup development server for NodomX apps.

Features:

- serves `public/` and `dist/`
- injects a tiny live reload client into HTML
- hot-imports the rebuilt entry module and remounts the app root

Example:

```js
import { nodomDevServer } from "@nodomx/rollup-plugin-dev-server";

export default {
  plugins: [
    nodomDevServer({
      rootDir: "./public",
      distDir: "./dist",
      port: 3000
    })
  ]
};
```

For app bootstrapping, pair it with the runtime helper:

```js
import { Nodom } from "nodom3";
import { bootstrapNodomApp } from "@nodomx/rollup-plugin-dev-server/runtime";

await bootstrapNodomApp({
  entryUrl: import.meta.url,
  load: () => import("./App.nd"),
  nodom: Nodom,
  selector: "#app"
});
```
