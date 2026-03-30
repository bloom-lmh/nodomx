import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    checkNdTemplateTypes,
    collectNdFiles,
    compileFile,
    compileNd,
    compileNdWithMap,
    compilePath,
    defaultDeclarationOutFile,
    describeNdError,
    defaultOutFile,
    extractNdTypeSurface,
    generateNdDeclaration,
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
import { useComputed, useState } from "nodomx";

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

const setupSugarSource = `
<template>
  <div class="counter">
    <p>{{count}}</p>
    <button e-click="add">add</button>
  </div>
</template>

<script setup>
import { useState } from "nodomx";

const count = useState(1);
const add = () => {
  count.value++;
};
</script>
`;

const setupOptionsSource = `
<template>
  <ChildCounter />
</template>

<script setup>
import ChildCounter from "./ChildCounter.nd";

defineOptions({
  modules: [ChildCounter]
});
</script>
`;

const asyncSetupOptionsSource = `
<template>
  <AsyncChild />
</template>

<script setup>
import { defineAsyncComponent } from "nodomx";

const AsyncChild = defineAsyncComponent(() => import("./AsyncChild.nd"));

defineOptions({
  modules: [AsyncChild]
});
</script>
`;

const tsSetupSource = `
<template>
  <div class="counter">
    <p>{{count}}</p>
    <p>{{label}}</p>
  </div>
</template>

<script setup lang="ts">
import { useComputed, useState } from "nodomx";

type CountLabel = string;

const count = useState<number>(1);
const label = useComputed<CountLabel>(() => \`count:\${count.value}\`);
</script>
`;

const tsScriptSource = `
<template>
  <div>{{headline}}</div>
</template>

<script lang="ts">
type CardOptions = {
  title: string;
};

const defaults: CardOptions = {
  title: "typed card"
};

export default {
  setup() {
    return {
      headline: defaults.title
    };
  }
};
</script>
`;

const mediaScopedSource = `
<template>
  <div class="shell">
    <p class="title">hello</p>
  </div>
</template>

<style scoped>
.shell {
  padding: 16px;
}

@media (max-width: 720px) {
  .shell,
  .title {
    padding: 8px;
  }
}
</style>
`;

const typeSurfaceSource = `
<template>
  <div class="card">
    <slot />
    <slot name="footer" />
    <button e-click="emitSave">save</button>
  </div>
</template>

<script setup lang="ts">
type Props = {
  title: string;
  count?: number;
};

type Emits = {
  (event: "save", payload: number): void;
  (event: "cancel"): void;
};

type Slots = {
  default?: (props: { title: string }) => unknown;
  footer?: (props: { count: number }) => unknown;
};

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
defineSlots<Slots>();
const model = defineModel<boolean>("checked");
const emitSave = () => emit("save", count ?? 0);
</script>
`;

const unknownTemplateSource = `
<template>
  <div>
    <p>{{count}}</p>
    <button e-click="missingHandler">fail</button>
  </div>
</template>

<script setup>
import { useState } from "nodomx";

const count = useState(1);
</script>
`;

const repeatScopeSource = `
<template>
  <ul>
    <li x-repeat={{todos}} key={{id}}>
      {{title}}
    </li>
  </ul>
</template>

<script setup>
const todos = [
  { id: 1, title: "learn" }
];
</script>
`;

const repeatScopeUnknownSource = `
<template>
  <ul>
    <li x-repeat={{todos}} key={{id}}>
      {{title}}
      {{missingField}}
    </li>
  </ul>
</template>

<script setup lang="ts">
type Todo = {
  id: number;
  title: string;
};

const todos: Todo[] = [
  { id: 1, title: "learn" }
];
</script>
`;

const xModelScopeSource = `
<template>
  <section x-model={{profile}}>
    <h2>{{name}}</h2>
    <button e-click="submit(name)">save</button>
  </section>
</template>

<script setup>
const profile = {
  name: "Ada",
  visits: 1
};

const submit = () => {};
</script>
`;

const xModelScopeUnknownSource = `
<template>
  <section x-model={{profile}}>
    <h2>{{name}}</h2>
    <p>{{missingField}}</p>
  </section>
</template>

<script setup>
const profile = {
  name: "Ada",
  visits: 1
};
</script>
`;

const descriptor = parseNd(source, { filename: "Counter.nd" });
assert.equal(descriptor.styles.length, 1);
assert.ok(descriptor.styles[0].scoped);
assert.ok(descriptor.script.contentStartOffset > 0);
assert.ok(descriptor.template.contentStartOffset > 0);

const code = compileNd(source, {
    filename: "Counter.nd",
    importSource: "nodomx"
});
const mapped = compileNdWithMap(source, {
    filename: "Counter.nd",
    importSource: "nodomx",
    sourceMapFilename: "/src/Counter.nd"
});

assert.match(code, /class CounterComponent extends Module/);
assert.match(code, /const __nd_component__ =/);
assert.match(code, /data-nd-scope=\\"nd-/);
assert.match(code, /\[data-nd-scope=\\"nd-[a-f0-9]+\\"\] \.counter/);
assert.match(code, /useState/);
assert.match(code, /__nd_module_factory__\.addClass\(CounterComponent\)/);
assert.equal(mapped.code, code);
assert.equal(mapped.map.version, 3);
assert.deepEqual(mapped.map.sources, ["/src/Counter.nd"]);
assert.equal(mapped.map.sourcesContent[0], source);
assert.match(mapped.map.mappings, /A/);

const setupSugarCode = compileNd(setupSugarSource, {
    filename: "Counter.nd",
    importSource: "nodomx"
});
assert.match(setupSugarCode, /setup\(\)/);
assert.match(setupSugarCode, /const count = useState\(1\);/);
assert.match(setupSugarCode, /return \{/);
assert.match(setupSugarCode, /count/);
assert.match(setupSugarCode, /add/);

const setupOptionsCode = compileNd(setupOptionsSource, {
    filename: "Parent.nd",
    importSource: "nodomx"
});
assert.match(setupOptionsCode, /const __nd_apply_options__ =/);
assert.match(setupOptionsCode, /\.\.\.__nd_apply_options__\(\(\) => \(\{\s*modules: \[ChildCounter\]/);
assert.match(setupOptionsCode, /\{ ChildCounter \}/);
assert.match(setupOptionsCode, /setup\(\)/);

const asyncSetupOptionsCode = compileNd(asyncSetupOptionsSource, {
    filename: "AsyncParent.nd",
    importSource: "nodomx"
});
assert.match(asyncSetupOptionsCode, /const AsyncChild = defineAsyncComponent/);
assert.match(asyncSetupOptionsCode, /scope\[key\] === item/);
assert.match(asyncSetupOptionsCode, /\{ AsyncChild \}/);
assert.match(asyncSetupOptionsCode, /return \{\};/);

const tsSetupCode = compileNd(tsSetupSource, {
    filename: "TypedSetup.nd",
    importSource: "nodomx"
});
assert.doesNotMatch(tsSetupCode, /type CountLabel/);
assert.doesNotMatch(tsSetupCode, /useState<number>/);
assert.match(tsSetupCode, /const count = useState\(1\);/);
assert.match(tsSetupCode, /const label = useComputed\(\(\) => `count:\$\{count\.value\}`\);/);

const tsScriptCode = compileNd(tsScriptSource, {
    filename: "TypedScript.nd",
    importSource: "nodomx"
});
assert.doesNotMatch(tsScriptCode, /type CardOptions/);
assert.doesNotMatch(tsScriptCode, /: CardOptions/);
assert.match(tsScriptCode, /const defaults = \{/);
assert.match(tsScriptCode, /headline: defaults\.title/);

const mediaScopedCode = compileNd(mediaScopedSource, {
    filename: "MediaScoped.nd",
    importSource: "nodomx"
});
assert.doesNotMatch(mediaScopedCode, /\[data-nd-scope=\\"nd-[a-f0-9]+\\"\]\s+@media/);
assert.match(mediaScopedCode, /@media\s*\(max-width: 720px\)\s*\{[\s\S]*\[data-nd-scope=\\"nd-[a-f0-9]+\\"\] \.shell,\s*\[data-nd-scope=\\"nd-[a-f0-9]+\\"\] \.title/);

const typeSurface = extractNdTypeSurface(typeSurfaceSource, {
    filename: "TypedContract.nd"
});
assert.deepEqual(typeSurface.props.map(item => item.name), ["title", "count", "checked"]);
assert.deepEqual(typeSurface.emits.map(item => item.name), ["save", "cancel", "update:checked"]);
assert.deepEqual(typeSurface.slots.map(item => item.name), ["default", "footer"]);
assert.equal(typeSurface.props.find(item => item.name === "title")?.typeText, "string");
assert.equal(typeSurface.props.find(item => item.name === "title")?.optional, false);
assert.equal(typeSurface.props.find(item => item.name === "count")?.typeText, "number");
assert.equal(typeSurface.props.find(item => item.name === "count")?.optional, true);
assert.equal(typeSurface.props.find(item => item.name === "checked")?.typeText, "boolean");
assert.equal(typeSurface.emits.find(item => item.name === "save")?.typeText, "(payload: number) => void");
assert.equal(typeSurface.emits.find(item => item.name === "update:checked")?.typeText, "(value: boolean) => unknown");
assert.equal(typeSurface.slots.find(item => item.name === "footer")?.typeText, "(props: {\n    count: number;\n}) => unknown");
const declarationCode = generateNdDeclaration(typeSurfaceSource, {
    filename: "TypedContract.nd",
    typeSurface
});
assert.match(declarationCode, /export interface __NdProps/);
assert.match(declarationCode, /title: string;/);
assert.match(declarationCode, /count\?: number;/);
assert.match(declarationCode, /checked\?: boolean;/);
assert.match(declarationCode, /save\?: \(payload: number\) => void;/);
assert.match(declarationCode, /"update:checked"\?: \(value: boolean\) => unknown;/);
assert.match(declarationCode, /footer\?: \(props: \{\s*count: number;\s*\}\) => unknown;/);

const templateDiagnostics = checkNdTemplateTypes(unknownTemplateSource, {
    filename: "UnknownTemplate.nd"
});
assert.equal(templateDiagnostics.length, 1);
assert.match(templateDiagnostics[0].message, /missingHandler/);

assert.doesNotThrow(() => compileNd(repeatScopeSource, {
    filename: "RepeatScope.nd",
    importSource: "nodomx"
}));
assert.throws(() => compileNd(repeatScopeUnknownSource, {
    filename: "RepeatScopeUnknown.nd",
    importSource: "nodomx"
}), (error) => {
    assert.match(String(error?.message || error), /missingField/);
    return true;
});
assert.doesNotThrow(() => compileNd(xModelScopeSource, {
    filename: "ModelScope.nd",
    importSource: "nodomx"
}));
assert.throws(() => compileNd(xModelScopeUnknownSource, {
    filename: "ModelScopeUnknown.nd",
    importSource: "nodomx"
}), (error) => {
    assert.match(String(error?.message || error), /missingField/);
    return true;
});

assert.throws(() => parseNd("<script setup>\nconst count = 1;\n</script>", {
    filename: "Broken.nd"
}), (error) => {
    const diagnostic = describeNdError(error, "<script setup>\nconst count = 1;\n</script>", {
        filename: "Broken.nd"
    });
    assert.equal(diagnostic.line, 1);
    assert.equal(diagnostic.column, 1);
    assert.match(diagnostic.frame, /1 \| <script setup>/);
    return true;
});

assert.throws(() => compileNd(`
<template>
  <div>{{count}}</div>
</template>

<script setup lang="ts">
import { useState } from "nodomx";

const count = useState<number>(1
</script>
`, {
    filename: "BrokenTyped.nd",
    importSource: "nodomx"
}), (error) => {
    const diagnostic = describeNdError(error, `
<template>
  <div>{{count}}</div>
</template>

<script setup lang="ts">
import { useState } from "nodomx";

const count = useState<number>(1
</script>
`, {
        filename: "BrokenTyped.nd"
    });
    assert.match(diagnostic.message, /Invalid <script setup lang="ts"> syntax/);
    assert.ok(diagnostic.line >= 7);
    assert.match(diagnostic.frame, /useState<number>/);
    return true;
});

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
    importSource: "nodomx"
});

assert.equal(result.outputFile, outFile);
const outputCode = await fs.readFile(outFile, "utf8");
assert.match(outputCode, /export default CounterComponent/);
assert.match(outputCode, /__nd_module_factory__\.addClass\(CounterComponent\)/);
assert.equal(result.map.sources[0].replace(/\\/g, "/"), inputFile.replace(/\\/g, "/"));

const declarationOutFile = defaultDeclarationOutFile(inputFile);
const declarationResult = await compileFile(inputFile, {
    declaration: true,
    importSource: "nodomx"
});
assert.equal(declarationResult.declarationFile, declarationOutFile);
const writtenDeclaration = await fs.readFile(declarationOutFile, "utf8");
assert.match(writtenDeclaration, /import type \{ UnknownClass \} from "nodomx";/);
assert.match(writtenDeclaration, /export interface __NdProps/);

const compiledFromDir = await compilePath(tmpDir, {
    importSource: "nodomx"
});
assert.equal(compiledFromDir.length, 2);

const contractTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nd-compiler-contract-"));
const contractChildFile = path.join(contractTmpDir, "ContractChild.nd");
const contractParentFile = path.join(contractTmpDir, "ContractParent.nd");
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

await assert.rejects(() => compileFile(contractParentFile, {
    importSource: "nodomx"
}), (error) => {
    const message = String(error?.message || error);
    assert.match(message, /Template type check failed/);
    assert.match(message, /Unknown prop `extra`/);
    assert.match(message, /Unknown named slot `missing`/);
    return true;
});

const watcher = await watchNd(tmpDir, {
    importSource: "nodomx"
});
await watcher.ready;

const watchedSource = source.replace("count", "watchedCount");
await fs.writeFile(inputFile, watchedSource, "utf8");
await waitFor(async () => {
    const watchedOutput = await fs.readFile(outFile, "utf8");
    return /watchedCount/.test(watchedOutput);
});

watcher.close();

const typeCheckGood = spawnSync(process.execPath, [
    path.resolve("bin/nd-tsc.mjs"),
    tmpDir,
    "--declaration"
], {
    cwd: path.resolve("."),
    encoding: "utf8"
});
assert.equal(typeCheckGood.status, 0, typeCheckGood.stderr);
assert.match(typeCheckGood.stdout, /Checked 2 \.nd file\(s\) successfully\./);
assert.ok(await fileExists(defaultDeclarationOutFile(inputFile)));

const badTypeCheckDir = await fs.mkdtemp(path.join(os.tmpdir(), "nd-compiler-typecheck-"));
const badTypeCheckFile = path.join(badTypeCheckDir, "BrokenContract.nd");
await fs.writeFile(badTypeCheckFile, repeatScopeUnknownSource, "utf8");
const typeCheckBad = spawnSync(process.execPath, [
    path.resolve("bin/nd-tsc.mjs"),
    badTypeCheckDir
], {
    cwd: path.resolve("."),
    encoding: "utf8"
});
assert.equal(typeCheckBad.status, 1);
assert.match(typeCheckBad.stdout, /with 1 error\(s\)/);
assert.match(typeCheckBad.stderr, /missingField/);

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

async function fileExists(filePath) {
    try {
        await fs.stat(filePath);
        return true;
    } catch {
        return false;
    }
}
