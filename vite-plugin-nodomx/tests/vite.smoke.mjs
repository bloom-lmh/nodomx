import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "vite";
import { nodomx } from "../src/index.js";
import { bootstrapNodomxViteApp } from "../src/runtime.js";

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nd-vite-"));
const srcDir = path.join(tmpDir, "src");
const componentFile = path.join(srcDir, "Counter.nd");
const entryFile = path.join(srcDir, "main.mjs");

await fs.mkdir(srcDir, { recursive: true });
await fs.writeFile(componentFile, `
<template>
  <div class="counter">
    <p>{{count}}</p>
  </div>
</template>

<script setup>
import { useState } from "nodomx";

const count = useState(1);
</script>

<style scoped>
.counter {
  color: red;
}
</style>
`, "utf8");

await fs.writeFile(entryFile, `
import Counter from "./Counter.nd";

export default Counter;
`, "utf8");

const buildResult = await build({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    root: tmpDir,
    plugins: [nodomx()],
    build: {
        lib: {
            entry: entryFile,
            formats: ["es"]
        },
        rollupOptions: {
            external: ["nodomx"]
        },
        write: false
    }
});

const outputs = Array.isArray(buildResult) ? buildResult : [buildResult];
const code = outputs
    .flatMap((item) => item.output || [])
    .find((item) => item.type === "chunk")?.code || "";

assert.match(code, /extends e \{\}/);
assert.match(code, /Object\.assign\(/);
assert.match(code, /data-nd-scope=/);
assert.match(code, /prototype\.__ndFile = "\/src\/Counter\.nd"/);

class AppOne {}
class AppTwo {}

let loadIndex = 0;
const reloadCalls = [];
const listeners = new Map();
const hot = {
    accepted: null,
    acceptedDeps: null,
    data: {},
    accept(deps, callback) {
        if (typeof deps === "function") {
            callback = deps;
            deps = [];
        }
        this.acceptedDeps = deps;
        this.accepted = callback;
    },
    invalidateCalled: false,
    invalidate() {
        this.invalidateCalled = true;
    },
    on(event, callback) {
        listeners.set(event, callback);
    }
};

const nodom = {
    captureHotState() {
        return { version: loadIndex };
    },
    hotReload(App, selector, hotState, changedFiles) {
        reloadCalls.push({
            App,
            changedFiles,
            hotState,
            selector
        });
    }
};

const initialApp = await bootstrapNodomxViteApp({
    deps: ["./Counter.nd"],
    hot,
    load: async () => [{ default: AppOne }, { default: AppTwo }][loadIndex++],
    nodom,
    selector: "#app"
});

assert.equal(initialApp, AppOne);
assert.deepEqual(hot.acceptedDeps, ["./Counter.nd"]);
assert.equal(reloadCalls.length, 1);
assert.equal(reloadCalls[0].App, AppOne);
assert.deepEqual(reloadCalls[0].changedFiles, []);

listeners.get("vite:beforeUpdate")?.({
    updates: [
        { path: "/src/Counter.nd" },
        { path: "/src/main.mjs" }
    ]
});

await hot.accepted([{ default: AppTwo }]);

assert.equal(reloadCalls.length, 2);
assert.equal(reloadCalls[1].App, AppTwo);
assert.equal(reloadCalls[1].selector, "#app");
assert.deepEqual(reloadCalls[1].changedFiles, ["/src/Counter.nd", "/src/main.mjs"]);
assert.deepEqual(reloadCalls[1].hotState, { version: 1 });
assert.equal(hot.invalidateCalled, false);

console.log("vite plugin smoke test passed");
