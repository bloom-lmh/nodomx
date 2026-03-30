import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "acorn";
import { build } from "vite";
import { nodomx } from "../src/index.js";
import { bootstrapNodomxViteApp } from "../src/runtime.js";

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nd-vite-"));
const srcDir = path.join(tmpDir, "src");
const componentFile = path.join(srcDir, "Counter.nd");
const entryFile = path.join(srcDir, "main.mjs");
const tsComponentFile = path.join(srcDir, "TypedCounter.nd");

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

await fs.writeFile(tsComponentFile, `
<template>
  <section class="typed-counter">
    <p>{{count}}</p>
    <p>{{label}}</p>
  </section>
</template>

<script setup lang="ts">
import { useComputed, useState } from "nodomx";

type CounterLabel = string;

const count = useState<number>(2);
const label = useComputed<CounterLabel>(() => \`typed:\${count.value}\`);
</script>
`, "utf8");

const primaryPlugin = nodomx();
const buildResult = await build({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    root: tmpDir,
    plugins: [primaryPlugin],
    build: {
        lib: {
            entry: entryFile,
            formats: ["es"]
        },
        sourcemap: true,
        rollupOptions: {
            external: ["nodomx"]
        },
        write: false
    }
});

const outputs = Array.isArray(buildResult) ? buildResult : [buildResult];
const chunk = outputs
    .flatMap((item) => item.output || [])
    .find((item) => item.type === "chunk");
const code = chunk?.code || "";

assert.match(code, /extends e \{\}/);
assert.match(code, /Object\.assign\(/);
assert.match(code, /data-nd-scope=/);
assert.match(code, /prototype\.__ndFile = ".*Counter\.nd"/);
assert.ok(chunk?.map);
assert.ok(chunk.map.sources.some(item => /Counter\.nd$/i.test(String(item))));
assert.ok(chunk.map.sourcesContent.some(item => /<template>[\s\S]*<script setup>/m.test(String(item || ""))));

const typedBuildResult = await build({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    root: tmpDir,
    plugins: [nodomx()],
    build: {
        lib: {
            entry: tsComponentFile,
            formats: ["es"]
        },
        sourcemap: true,
        rollupOptions: {
            external: ["nodomx"]
        },
        write: false
    }
});

const typedOutputs = Array.isArray(typedBuildResult) ? typedBuildResult : [typedBuildResult];
const typedChunk = typedOutputs
    .flatMap((item) => item.output || [])
    .find((item) => item.type === "chunk");
const typedCode = typedChunk?.code || "";

assert.match(typedCode, /typed:/);
assert.doesNotMatch(typedCode, /type CounterLabel/);
assert.doesNotMatch(typedCode, /useState<number>/);
assert.ok(typedChunk?.map?.sources.some(item => /TypedCounter\.nd$/i.test(String(item))));

await fs.writeFile(componentFile, `
<template>
  <div class="counter">
    <p>{{count}}</p>
  </div>
</template>

<script setup>
import { useState } from "nodomx";

const count = useState(1
</script>
`, "utf8");

let recoveredBrokenError;
try {
    await build({
        appType: "custom",
        configFile: false,
        logLevel: "silent",
        root: tmpDir,
        plugins: [primaryPlugin],
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
} catch (error) {
    recoveredBrokenError = error;
}

assert.ok(recoveredBrokenError);
assert.match(String(recoveredBrokenError.message || recoveredBrokenError), /Counter\.nd/);
assert.match(String(recoveredBrokenError.message || recoveredBrokenError), /Changed block\(s\): script/);
assert.match(String(recoveredBrokenError.message || recoveredBrokenError), /Last successful compile: available/);
assert.match(String(recoveredBrokenError.message || recoveredBrokenError), /keep the last successful \.nd module output/i);

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
`, "utf8");

const servePlugin = nodomx();
const serveMessages = [];
servePlugin.configResolved({
    command: "serve",
    root: tmpDir
});
servePlugin.configureServer({
    ws: {
        send(payload) {
            serveMessages.push(payload);
        }
    }
});
const serveContext = {
    addWatchFile() {},
    parse(code, options) {
        return parse(code, {
            ecmaVersion: "latest",
            sourceType: options?.sourceType || "module"
        });
    }
};
const servedInitial = await servePlugin.load.call(serveContext, componentFile);
assert.ok(servedInitial?.code);
assert.ok(serveMessages.some(item => item?.type === "custom" && item?.event === "nodomx:nd-serve-status" && item?.data?.state === "healthy"));
const initialServeStatus = serveMessages.find(item => item?.type === "custom" && item?.event === "nodomx:nd-serve-status" && item?.data?.state === "healthy");
assert.equal(initialServeStatus?.data?.activeOutput, "latest");
assert.deepEqual(initialServeStatus?.data?.preservedBlocks, []);

await fs.writeFile(componentFile, `
<template>
  <div class="counter">
    <p>{{count}}</p>
  </div>
</template>

<script setup>
import { useState } from "nodomx";

const count = useState(1
</script>
`, "utf8");

const servedRecovered = await servePlugin.load.call(serveContext, componentFile);
assert.equal(servedRecovered?.code, servedInitial.code);
assert.ok(serveMessages.some(item => item?.type === "error"));
assert.ok(serveMessages.some(item => item?.type === "custom" && item?.event === "nodomx:nd-serve-status" && item?.data?.state === "preserved-last-good-output"));
const serveError = serveMessages.filter(item => item?.type === "error").at(-1)?.err?.message || "";
assert.match(serveError, /Changed block\(s\): script/);
assert.match(serveError, /Recovery state: serving preserved last successful output/);
assert.match(serveError, /Serving output: preserved last successful output/);
assert.match(serveError, /Preserved block\(s\): template/);
assert.match(serveError, /Last successful compile: available/);
assert.match(serveError, /Last successful compile at:/);
assert.match(serveError, /keep the last successful \.nd module output/i);
const preservedServeStatus = serveMessages.find(item => item?.type === "custom" && item?.event === "nodomx:nd-serve-status" && item?.data?.state === "preserved-last-good-output");
assert.equal(preservedServeStatus?.data?.file, componentFile.replace(/\\/g, "/"));
assert.equal(preservedServeStatus?.data?.activeOutput, "preserved-last-good-output");
assert.deepEqual(preservedServeStatus?.data?.preservedBlocks, ["template"]);
assert.ok(preservedServeStatus?.data?.lastSuccessfulAt);

const brokenComponentFile = path.join(srcDir, "BrokenCounter.nd");
await fs.writeFile(brokenComponentFile, `
<template>
  <div>{{count}}</div>
</template>

<script setup>
import { useState } from "nodomx";

const count = useState(1
</script>
`, "utf8");

let brokenError;
try {
    await build({
        appType: "custom",
        configFile: false,
        logLevel: "silent",
        root: tmpDir,
        plugins: [nodomx()],
        build: {
            lib: {
                entry: brokenComponentFile,
                formats: ["es"]
            },
            rollupOptions: {
                external: ["nodomx"]
            },
            write: false
        }
    });
} catch (error) {
    brokenError = error;
}

assert.ok(brokenError);
assert.match(String(brokenError.message || brokenError), /BrokenCounter\.nd/);
assert.match(brokenError.message, /Invalid <script setup> syntax/);
assert.match(String(brokenError.message || brokenError), /Recovery:/);
assert.match(String(brokenError.message || brokenError), /Fix the highlighted script syntax/);
assert.match(String(brokenError.message || brokenError), /Changed block\(s\): template, script/);
assert.match(String(brokenError.message || brokenError), /Serving output: none/);
assert.match(String(brokenError.message || brokenError), /Last successful compile: none/);
assert.match(String(brokenError.message || brokenError), /BrokenCounter\.nd:9:24/);
assert.match(String(brokenError.frame || brokenError.message || brokenError), /9 \| const count = useState\(1/);

const brokenTypedComponentFile = path.join(srcDir, "BrokenTypedCounter.nd");
await fs.writeFile(brokenTypedComponentFile, `
<template>
  <div>{{count}}</div>
</template>

<script setup lang="ts">
import { useState } from "nodomx";

const count = useState<number>(1
</script>
`, "utf8");

let brokenTypedError;
try {
    await build({
        appType: "custom",
        configFile: false,
        logLevel: "silent",
        root: tmpDir,
        plugins: [nodomx()],
        build: {
            lib: {
                entry: brokenTypedComponentFile,
                formats: ["es"]
            },
            rollupOptions: {
                external: ["nodomx"]
            },
            write: false
        }
    });
} catch (error) {
    brokenTypedError = error;
}

assert.ok(brokenTypedError);
assert.match(String(brokenTypedError.message || brokenTypedError), /BrokenTypedCounter\.nd/);
assert.match(String(brokenTypedError.message || brokenTypedError), /Invalid <script setup lang="ts"> syntax/);
assert.match(String(brokenTypedError.message || brokenTypedError), /Recovery:/);
assert.match(String(brokenTypedError.message || brokenTypedError), /Fix the highlighted script syntax/);
assert.match(String(brokenTypedError.message || brokenTypedError), /Changed block\(s\): template, script/);

const templateTypeErrorFile = path.join(srcDir, "TemplateTypeError.nd");
await fs.writeFile(templateTypeErrorFile, `
<template>
  <div>
    <p>{{count}}</p>
    <button e-click="missingHandler">save</button>
  </div>
</template>

<script setup>
import { useState } from "nodomx";

const count = useState(1);
</script>
`, "utf8");

let templateTypeError;
try {
    await build({
        appType: "custom",
        configFile: false,
        logLevel: "silent",
        root: tmpDir,
        plugins: [nodomx()],
        build: {
            lib: {
                entry: templateTypeErrorFile,
                formats: ["es"]
            },
            rollupOptions: {
                external: ["nodomx"]
            },
            write: false
        }
    });
} catch (error) {
    templateTypeError = error;
}

assert.ok(templateTypeError);
assert.match(String(templateTypeError.message || templateTypeError), /TemplateTypeError\.nd/);
assert.match(String(templateTypeError.message || templateTypeError), /Template type check failed/);
assert.match(String(templateTypeError.message || templateTypeError), /Unknown template identifier `missingHandler`/);
assert.match(String(templateTypeError.message || templateTypeError), /Recovery:/);
assert.match(String(templateTypeError.message || templateTypeError), /Add the missing template binding or event handler/);

const contractChildFile = path.join(srcDir, "ContractChild.nd");
await fs.writeFile(contractChildFile, `
<template>
  <div>
    <slot />
    <slot name="footer" />
  </div>
</template>

<script setup lang="ts">
type Props = {
  title: string;
};

type Emits = {
  (event: "save", payload: number): void;
};

type Slots = {
  default?: unknown;
  footer?: (props: { count: number }) => unknown;
};

defineProps<Props>();
defineEmits<Emits>();
defineSlots<Slots>();
</script>
`, "utf8");

const contractParentFile = path.join(srcDir, "ContractParent.nd");
await fs.writeFile(contractParentFile, `
<template>
  <ContractChild title="ok" extra="bad" on-save="handleSave">
    <slot name="missing" />
  </ContractChild>
</template>

<script setup>
import ContractChild from "./ContractChild.nd";

const handleSave = () => {};
</script>
`, "utf8");

let contractTypeError;
try {
    await build({
        appType: "custom",
        configFile: false,
        logLevel: "silent",
        root: tmpDir,
        plugins: [nodomx()],
        build: {
            lib: {
                entry: contractParentFile,
                formats: ["es"]
            },
            rollupOptions: {
                external: ["nodomx"]
            },
            write: false
        }
    });
} catch (error) {
    contractTypeError = error;
}

assert.ok(contractTypeError);
assert.match(String(contractTypeError.message || contractTypeError), /ContractParent\.nd/);
assert.match(String(contractTypeError.message || contractTypeError), /Unknown prop `extra`/);
assert.match(String(contractTypeError.message || contractTypeError), /Unknown named slot `missing`/);
assert.match(String(contractTypeError.message || contractTypeError), /Recovery:/);
assert.match(String(contractTypeError.message || contractTypeError), /declare the prop on the child component/i);

await fs.writeFile(componentFile, `
<template>
  <div class="counter">
    <p>{{count}}</p>
  </div>
</template>

<script setup>
import { useState } from "nodomx";

const count = useState(2);
</script>
`, "utf8");

const recoveredServeSuccess = await servePlugin.load.call(serveContext, componentFile);
assert.ok(recoveredServeSuccess?.code);
const recoveredServeStatus = serveMessages.filter(item => item?.type === "custom" && item?.event === "nodomx:nd-serve-status").at(-1);
assert.equal(recoveredServeStatus?.data?.state, "recovered");
assert.equal(recoveredServeStatus?.data?.activeOutput, "latest");
assert.ok(/latest module output/i.test(recoveredServeStatus?.data?.recoveryHint || ""));

const duplicateTemplateFile = path.join(srcDir, "DuplicateTemplate.nd");
await fs.writeFile(duplicateTemplateFile, `
<template>
  <div>first</div>
</template>

<template>
  <div>second</div>
</template>
`, "utf8");

let duplicateTemplateError;
try {
    await build({
        appType: "custom",
        configFile: false,
        logLevel: "silent",
        root: tmpDir,
        plugins: [nodomx()],
        build: {
            lib: {
                entry: duplicateTemplateFile,
                formats: ["es"]
            },
            rollupOptions: {
                external: ["nodomx"]
            },
            write: false
        }
    });
} catch (error) {
    duplicateTemplateError = error;
}

assert.ok(duplicateTemplateError);
assert.match(String(duplicateTemplateError.message || duplicateTemplateError), /DuplicateTemplate\.nd/);
assert.match(String(duplicateTemplateError.message || duplicateTemplateError), /Only one <template> block is allowed/);
assert.match(String(duplicateTemplateError.message || duplicateTemplateError), /Recovery:/);
assert.match(String(duplicateTemplateError.message || duplicateTemplateError), /Keep a single <template> block/);
assert.match(String(duplicateTemplateError.message || duplicateTemplateError), /Changed block\(s\): template/);
assert.match(String(duplicateTemplateError.message || duplicateTemplateError), /Last successful compile: none/);
assert.match(String(duplicateTemplateError.frame || duplicateTemplateError.message || duplicateTemplateError), /<template>/);

const missingTemplateFile = path.join(srcDir, "MissingTemplate.nd");
await fs.writeFile(missingTemplateFile, `
<script setup>
const count = 1;
</script>
`, "utf8");

let missingTemplateError;
try {
    await build({
        appType: "custom",
        configFile: false,
        logLevel: "silent",
        root: tmpDir,
        plugins: [nodomx()],
        build: {
            lib: {
                entry: missingTemplateFile,
                formats: ["es"]
            },
            rollupOptions: {
                external: ["nodomx"]
            },
            write: false
        }
    });
} catch (error) {
    missingTemplateError = error;
}

assert.ok(missingTemplateError);
assert.match(String(missingTemplateError.message || missingTemplateError), /MissingTemplate\.nd/);
assert.match(String(missingTemplateError.message || missingTemplateError), /Missing <template> block/);
assert.match(String(missingTemplateError.message || missingTemplateError), /Recovery:/);
assert.match(String(missingTemplateError.message || missingTemplateError), /Add a root <template>/);
assert.match(String(missingTemplateError.message || missingTemplateError), /Changed block\(s\): script/);
assert.match(String(missingTemplateError.message || missingTemplateError), /Last successful compile: none/);

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
listeners.get("nodomx:nd-update-meta")?.({
    blocks: ["style"],
    file: "/src/Counter.nd",
    styleOnly: true
});
listeners.get("nodomx:nd-serve-status")?.({
    activeOutput: "preserved-last-good-output",
    changedBlocks: ["script"],
    file: "/src/Counter.nd",
    hasLastSuccessfulSnapshot: true,
    lastSuccessfulAt: "2026-03-30T09:00:00.000Z",
    preservedBlocks: ["template"],
    recoveryHint: "Fix the script block and save again.",
    state: "preserved-last-good-output"
});

await hot.accepted([{ default: AppTwo }]);

assert.equal(reloadCalls.length, 2);
assert.equal(reloadCalls[1].App, AppTwo);
assert.equal(reloadCalls[1].selector, "#app");
assert.deepEqual(reloadCalls[1].changedFiles, ["/src/Counter.nd"]);
assert.deepEqual(reloadCalls[1].hotState, { version: 1 });
assert.deepEqual(nodom.__ndViteHotMeta.changedBlocks, {
    "/src/Counter.nd": ["style"]
});
assert.deepEqual(nodom.__ndViteHotMeta.styleOnlyFiles, ["/src/Counter.nd"]);
assert.deepEqual(nodom.__ndViteHotMeta.otherFiles, ["/src/main.mjs"]);
assert.equal(nodom.__ndViteHotMeta.strategy, "nd-block-hmr");
assert.equal(nodom.__ndViteHotMeta.serveStatus?.state, "preserved-last-good-output");
assert.equal(nodom.__ndViteHotMeta.serveStatus?.activeOutput, "preserved-last-good-output");
assert.deepEqual(nodom.__ndViteHotMeta.serveStatus?.preservedBlocks, ["template"]);
assert.equal(nodom.__ndViteHotMeta.serveStatus?.lastSuccessfulAt, "2026-03-30T09:00:00.000Z");
assert.equal(hot.invalidateCalled, false);

await hot.accepted([{ default: AppTwo }]);
assert.equal(nodom.__ndViteHotMeta.serveStatus, null);

let styleOnlyIndex = 0;
const styleOnlyReloadCalls = [];
const styleOnlyListeners = new Map();
const styleOnlyHot = {
    accepted: null,
    data: {},
    accept(deps, callback) {
        if (typeof deps === "function") {
            callback = deps;
        }
        this.accepted = callback;
    },
    invalidateCalled: false,
    invalidate() {
        this.invalidateCalled = true;
    },
    on(event, callback) {
        styleOnlyListeners.set(event, callback);
    }
};
const styleOnlyNodom = {
    captureHotState() {
        return { version: styleOnlyIndex };
    },
    hotReload(App, selector, hotState, changedFiles) {
        styleOnlyReloadCalls.push({
            App,
            changedFiles,
            hotState,
            selector
        });
    }
};

await bootstrapNodomxViteApp({
    deps: ["./Counter.nd"],
    hot: styleOnlyHot,
    load: async () => [{ default: AppOne }, { default: AppTwo }][styleOnlyIndex++],
    nodom: styleOnlyNodom,
    selector: "#app"
});

styleOnlyListeners.get("vite:beforeUpdate")?.({
    updates: [
        { path: "/src/Counter.nd" }
    ]
});
styleOnlyListeners.get("nodomx:nd-update-meta")?.({
    blocks: ["style"],
    file: "/src/Counter.nd",
    styleOnly: true
});

await styleOnlyHot.accepted([{ default: AppTwo }]);

assert.equal(styleOnlyReloadCalls.length, 1);
assert.equal(styleOnlyNodom.__ndViteHotMeta.strategy, "style-only-skip-reload");
assert.deepEqual(styleOnlyNodom.__ndViteHotMeta.ndFiles, ["/src/Counter.nd"]);
assert.deepEqual(styleOnlyNodom.__ndViteHotMeta.styleOnlyFiles, ["/src/Counter.nd"]);
assert.equal(styleOnlyHot.invalidateCalled, false);

console.log("vite plugin smoke test passed");
