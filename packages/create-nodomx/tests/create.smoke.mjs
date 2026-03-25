import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createProject } from "../src/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "create-nodomx-"));
const projectDir = path.join(tmpDir, "demo-app");

await createProject(projectDir, {
    install: true,
    packageMode: "local",
    repoRoot: path.resolve(__dirname, "..", "..", "..")
});

const packageJson = JSON.parse(await fs.readFile(path.join(projectDir, "package.json"), "utf8"));
assert.equal(packageJson.name, "demo-app");
assert.equal(packageJson.scripts.dev, "rollup -c rollup.config.mjs -w");

assert.ok(await exists(path.join(projectDir, "src", "App.nd")));
assert.ok(await exists(path.join(projectDir, "public", "index.html")));

run("npm", ["run", "build"], projectDir);
assert.ok(await exists(path.join(projectDir, "dist", "main.js")));

console.log("create-nodomx smoke test passed");

function run(command, args, cwd) {
    const result = spawnSync(command, args, {
        cwd,
        stdio: "inherit",
        shell: process.platform === "win32"
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(" ")} failed`);
    }
}

async function exists(file) {
    try {
        await fs.stat(file);
        return true;
    } catch {
        return false;
    }
}
