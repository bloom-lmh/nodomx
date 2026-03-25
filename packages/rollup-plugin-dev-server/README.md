# `@nodomx/rollup-plugin-dev-server`

Rollup development server for NodomX apps.

Features:

- serves `public/` and `dist/`
- injects a tiny live reload client into HTML
- reloads the page after each Rollup rebuild

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
