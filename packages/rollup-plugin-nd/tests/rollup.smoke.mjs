import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { rollup } from "rollup";
import { nodomNd } from "../src/index.js";

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nd-rollup-"));
const componentFile = path.join(tmpDir, "Counter.nd");
const entryFile = path.join(tmpDir, "entry.mjs");

await fs.writeFile(componentFile, `
<template>
  <div class="counter">
    <p>{{count}}</p>
  </div>
</template>

<script>
import { useState } from "nodom3";

export default {
  setup() {
    const count = useState(1);
    return {
      count
    };
  }
}
</script>
`, "utf8");

await fs.writeFile(entryFile, `
import Counter from "./Counter.nd";

export default Counter;
`, "utf8");

const bundle = await rollup({
    input: entryFile,
    external: ["nodom3"],
    plugins: [nodomNd()]
});

const generated = await bundle.generate({
    format: "esm"
});

const output = generated.output[0].code;
assert.match(output, /class CounterComponent extends Module/);
assert.match(output, /Object\.assign\(CounterComponent\.prototype, __nd_component__\)/);
assert.match(output, /export \{ CounterComponent as default \}/);

console.log("rollup nd plugin smoke test passed");
