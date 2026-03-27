import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProject } from "../src/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "create-nodomx-"));
const projectDir = path.join(tmpDir, "demo-app");
const registryDir = path.join(tmpDir, "registry-app");

await createProject(projectDir, {
    packageMode: "local",
    repoRoot: path.resolve(__dirname, "..", "..")
});

const packageJson = JSON.parse(await fs.readFile(path.join(projectDir, "package.json"), "utf8"));
assert.equal(packageJson.name, "demo-app");
assert.equal(packageJson.scripts.dev, "rollup -c rollup.config.mjs -w");
assert.match(packageJson.devDependencies["@nodomx/rollup-plugin-dev-server"], /^file:/);
assert.match(packageJson.devDependencies["@nodomx/rollup-plugin-nd"], /^file:/);
assert.match(packageJson.devDependencies["@nodomx/nd-compiler"], /^file:/);
assert.match(packageJson.dependencies["@nodomx/reactivity"], /^file:/);
assert.match(packageJson.dependencies["@nodomx/runtime-core"], /^file:/);
assert.match(packageJson.dependencies.nodomx, /^file:/);

assert.ok(await exists(path.join(projectDir, "src", "App.nd")));
assert.ok(await exists(path.join(projectDir, "public", "index.html")));
assert.match(await fs.readFile(path.join(projectDir, "rollup.config.mjs"), "utf8"), /nodomDevServer/);
assert.match(await fs.readFile(path.join(projectDir, "src", "main.js"), "utf8"), /Nodom/);
assert.match(await fs.readFile(path.join(projectDir, "src", "App.nd"), "utf8"), /<script setup>/);

await createProject(registryDir, {
    packageMode: "registry"
});
const registryPkg = JSON.parse(await fs.readFile(path.join(registryDir, "package.json"), "utf8"));
assert.equal(registryPkg.devDependencies["@nodomx/rollup-plugin-dev-server"], "^0.1.0");
assert.equal(registryPkg.devDependencies["@nodomx/rollup-plugin-nd"], "^0.1.0");
assert.equal(registryPkg.devDependencies["@nodomx/nd-compiler"], "^0.1.0");
assert.equal(registryPkg.dependencies["@nodomx/reactivity"], "^0.2.3");
assert.equal(registryPkg.dependencies["@nodomx/runtime-core"], "^0.2.3");
assert.equal(registryPkg.dependencies.nodomx, "^0.2.3");

console.log("create-nodomx smoke test passed");

async function exists(file) {
    try {
        await fs.stat(file);
        return true;
    } catch {
        return false;
    }
}
