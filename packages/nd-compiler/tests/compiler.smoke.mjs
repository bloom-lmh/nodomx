import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    collectNdFiles,
    compileFile,
    compileNd,
    compilePath,
    defaultOutFile,
    parseNd,
    watchNd
} from "../src/index.js";

const source = `
<template>
  <div class="counter">
    <p>{{count}}</p>
    <button e-click="add">add</button>
  </div>
</template>

<script>
import { useComputed, useState } from "nodom3";

export default {
  setup() {
    const count = useState(1);
    const doubleCount = useComputed(() => count.value * 2);
    const add = () => {
      count.value++;
    };
    return {
      count,
      doubleCount,
      add
    };
  }
}
</script>

<style scoped>
.counter {
  color: red;
}
</style>
`;

const descriptor = parseNd(source, { filename: "Counter.nd" });
assert.equal(descriptor.styles.length, 1);
assert.ok(descriptor.styles[0].scoped);

const code = compileNd(source, {
    filename: "Counter.nd",
    importSource: "nodom3"
});

assert.match(code, /class CounterComponent extends Module/);
assert.match(code, /const __nd_component__ =/);
assert.match(code, /data-nd-scope=\\"nd-/);
assert.match(code, /\[data-nd-scope=\\"nd-[a-f0-9]+\\"\] \.counter/);
assert.match(code, /useState/);

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nd-compiler-"));
const inputFile = path.join(tmpDir, "Counter.nd");
const nestedDir = path.join(tmpDir, "nested");
await fs.mkdir(nestedDir, { recursive: true });
await fs.writeFile(inputFile, source, "utf8");
await fs.writeFile(path.join(nestedDir, "Nested.nd"), source.replace("count", "nestedCount"), "utf8");

const files = await collectNdFiles(tmpDir);
assert.equal(files.length, 2);

const outFile = defaultOutFile(inputFile);
const result = await compileFile(inputFile, {
    importSource: "nodom3"
});

assert.equal(result.outputFile, outFile);
const outputCode = await fs.readFile(outFile, "utf8");
assert.match(outputCode, /export default CounterComponent/);

const compiledFromDir = await compilePath(tmpDir, {
    importSource: "nodom3"
});
assert.equal(compiledFromDir.length, 2);

const watcher = await watchNd(tmpDir, {
    importSource: "nodom3"
});
await watcher.ready;

const watchedSource = source.replace("count", "watchedCount");
await fs.writeFile(inputFile, watchedSource, "utf8");
await waitFor(async () => {
    const watchedOutput = await fs.readFile(outFile, "utf8");
    return /watchedCount/.test(watchedOutput);
});

watcher.close();

console.log("nd compiler smoke test passed");

async function waitFor(predicate, timeoutMs = 4000, intervalMs = 80) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await predicate()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error("Timed out waiting for watch output.");
}
