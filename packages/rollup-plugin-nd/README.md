# `@nodomx/rollup-plugin-nd`

Rollup plugin for importing NodomX `.nd` single-file components directly.

Example:

```js
import { nodomNd } from "@nodomx/rollup-plugin-nd";

export default {
  input: "./src/main.mjs",
  plugins: [nodomNd()]
};
```

Then you can write:

```js
import App from "./App.nd";
```

By default the generated component imports `Module` from `nodom3`. You can override that with:

```js
nodomNd({
  importSource: "nodom3"
})
```
