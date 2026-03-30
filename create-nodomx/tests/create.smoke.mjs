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
const registryDir = path.join(tmpDir, "registry-app");
const basicDir = path.join(tmpDir, "basic-app");
const featureDir = path.join(tmpDir, "feature-app");
const storeDir = path.join(tmpDir, "store-app");
const typescriptDir = path.join(tmpDir, "ts-app");
const libraryDir = path.join(tmpDir, "library-app");
const docsDir = path.join(tmpDir, "docs-app");
const ssrDir = path.join(tmpDir, "ssr-app");
const repoRoot = path.resolve(__dirname, "..", "..");
const packageVersions = {
    vitePlugin: await readVersion(path.join(repoRoot, "vite-plugin-nodomx", "package.json")),
    nodom: await readVersion(path.join(repoRoot, "nodomx", "package.json")),
    reactivity: await readVersion(path.join(repoRoot, "nodomx", "packages", "reactivity", "package.json")),
    ssr: await readVersion(path.join(repoRoot, "ssr", "package.json")),
    store: await readVersion(path.join(repoRoot, "store", "package.json")),
    runtimeCore: await readVersion(path.join(repoRoot, "nodomx", "packages", "runtime-core", "package.json"))
};

await createProject(projectDir, {
    packageMode: "local",
    repoRoot
});

const packageJson = JSON.parse(await fs.readFile(path.join(projectDir, "package.json"), "utf8"));
assert.equal(packageJson.name, "demo-app");
assert.equal(packageJson.scripts.dev, "vite");
assert.equal(packageJson.scripts.build, "vite build");
assert.match(packageJson.devDependencies["vite-plugin-nodomx"], /^file:/);
assert.match(packageJson.dependencies["@nodomx/reactivity"], /^file:/);
assert.match(packageJson.dependencies["@nodomx/runtime-core"], /^file:/);
assert.match(packageJson.dependencies["@nodomx/store"], /^file:/);
assert.match(packageJson.dependencies.nodomx, /^file:/);

assert.ok(await exists(path.join(projectDir, "src", "App.nd")));
assert.ok(await exists(path.join(projectDir, "src", "components", "StarterHero.nd")));
assert.ok(await exists(path.join(projectDir, "src", "styles", "main.css")));
assert.ok(await exists(path.join(projectDir, "index.html")));
assert.ok(await exists(path.join(projectDir, "vite.config.mjs")));
assert.match(await fs.readFile(path.join(projectDir, "vite.config.mjs"), "utf8"), /vite-plugin-nodomx/);
assert.match(await fs.readFile(path.join(projectDir, "src", "main.js"), "utf8"), /bootstrapNodomxViteApp/);
assert.match(await fs.readFile(path.join(projectDir, "src", "main.js"), "utf8"), /styles\/main\.css/);
assert.match(await fs.readFile(path.join(projectDir, "src", "App.nd"), "utf8"), /<script setup>/);
assert.match(await fs.readFile(path.join(projectDir, "src", "App.nd"), "utf8"), /StarterHero/);

await createProject(registryDir, {
    packageMode: "registry"
});
const registryPkg = JSON.parse(await fs.readFile(path.join(registryDir, "package.json"), "utf8"));
assert.equal(registryPkg.devDependencies["vite-plugin-nodomx"], `^${packageVersions.vitePlugin}`);
assert.equal(registryPkg.dependencies["@nodomx/reactivity"], `^${packageVersions.reactivity}`);
assert.equal(registryPkg.dependencies["@nodomx/runtime-core"], `^${packageVersions.runtimeCore}`);
assert.equal(registryPkg.dependencies["@nodomx/store"], `^${packageVersions.store}`);
assert.equal(registryPkg.dependencies.nodomx, `^${packageVersions.nodom}`);
assert.equal(registryPkg.scripts.dev, "vite");

await createProject(basicDir, {
    packageMode: "local",
    repoRoot,
    template: "basic"
});
const basicPkg = JSON.parse(await fs.readFile(path.join(basicDir, "package.json"), "utf8"));
assert.equal(basicPkg.scripts.dev, "rollup -c rollup.config.mjs -w");
assert.match(basicPkg.devDependencies["@nodomx/rollup-plugin-dev-server"], /^file:/);
assert.match(basicPkg.devDependencies["@nodomx/rollup-plugin-nd"], /^file:/);
assert.ok(await exists(path.join(basicDir, "public", "index.html")));
assert.match(await fs.readFile(path.join(basicDir, "rollup.config.mjs"), "utf8"), /nodomDevServer/);

await createProject(featureDir, {
    packageMode: "local",
    repoRoot,
    router: true,
    store: true
});
assert.ok(await exists(path.join(featureDir, "src", "router", "index.js")));
assert.ok(await exists(path.join(featureDir, "src", "router", "routes.js")));
assert.ok(await exists(path.join(featureDir, "src", "layouts", "AppShell.nd")));
assert.ok(await exists(path.join(featureDir, "src", "views", "HomeView.nd")));
assert.ok(await exists(path.join(featureDir, "src", "stores", "counter.js")));
assert.ok(await exists(path.join(featureDir, "src", "stores", "index.js")));
assert.equal(await exists(path.join(featureDir, "features")), false);
assert.match(await fs.readFile(path.join(featureDir, "src", "main.js"), "utf8"), /installAppRouter/);
assert.match(await fs.readFile(path.join(featureDir, "src", "main.js"), "utf8"), /Nodom\.use\(appStore\)/);
assert.match(await fs.readFile(path.join(featureDir, "src", "router", "index.js"), "utf8"), /routes/);
assert.match(await fs.readFile(path.join(featureDir, "src", "router", "routes.js"), "utf8"), /module: HomeView/);
assert.match(await fs.readFile(path.join(featureDir, "src", "views", "HomeView.nd"), "utf8"), /useCounterStore/);
assert.match(await fs.readFile(path.join(featureDir, "src", "stores", "counter.js"), "utf8"), /defineStore/);
assert.match(await fs.readFile(path.join(featureDir, "src", "App.nd"), "utf8"), /AppShell/);

await createProject(storeDir, {
    packageMode: "local",
    repoRoot,
    store: true
});
assert.ok(await exists(path.join(storeDir, "src", "stores", "counter.js")));
assert.ok(await exists(path.join(storeDir, "src", "stores", "index.js")));
assert.match(await fs.readFile(path.join(storeDir, "src", "main.js"), "utf8"), /Nodom\.use\(appStore\)/);
assert.match(await fs.readFile(path.join(storeDir, "src", "App.nd"), "utf8"), /useCounterStore/);
assert.doesNotMatch(await fs.readFile(path.join(storeDir, "src", "App.nd"), "utf8"), /<router/);

await createProject(typescriptDir, {
    packageMode: "local",
    repoRoot,
    router: true,
    store: true,
    typescript: true
});
const tsPkg = JSON.parse(await fs.readFile(path.join(typescriptDir, "package.json"), "utf8"));
assert.equal(tsPkg.scripts.typecheck, "tsc --noEmit");
assert.equal(tsPkg.devDependencies.typescript, "^5.9.2");
assert.ok(await exists(path.join(typescriptDir, "tsconfig.json")));
assert.ok(await exists(path.join(typescriptDir, "vite.config.ts")));
assert.ok(await exists(path.join(typescriptDir, "src", "env.d.ts")));
assert.ok(await exists(path.join(typescriptDir, "src", "main.ts")));
assert.equal(await exists(path.join(typescriptDir, "src", "main.js")), false);
assert.ok(await exists(path.join(typescriptDir, "src", "router", "index.ts")));
assert.ok(await exists(path.join(typescriptDir, "src", "router", "routes.ts")));
assert.ok(await exists(path.join(typescriptDir, "src", "stores", "counter.ts")));
assert.ok(await exists(path.join(typescriptDir, "src", "stores", "index.ts")));
assert.match(await fs.readFile(path.join(typescriptDir, "src", "views", "HomeView.nd"), "utf8"), /\.\.\/stores\/index/);
assert.match(await fs.readFile(path.join(typescriptDir, "src", "main.ts"), "utf8"), /\.\/stores\/index/);

await createProject(libraryDir, {
    packageMode: "local",
    repoRoot,
    template: "library"
});
const libraryPkg = JSON.parse(await fs.readFile(path.join(libraryDir, "package.json"), "utf8"));
assert.equal(libraryPkg.scripts.typecheck, "tsc --noEmit");
assert.ok(await exists(path.join(libraryDir, "vite.config.ts")));
assert.ok(await exists(path.join(libraryDir, "tsconfig.json")));
assert.ok(await exists(path.join(libraryDir, "src", "index.ts")));
assert.ok(await exists(path.join(libraryDir, "src", "dev.ts")));
assert.ok(await exists(path.join(libraryDir, "src", "env.d.ts")));
assert.match(await fs.readFile(path.join(libraryDir, "src", "index.ts"), "utf8"), /NodomBadge/);

await createProject(docsDir, {
    packageMode: "local",
    repoRoot,
    template: "docs"
});
const docsPkg = JSON.parse(await fs.readFile(path.join(docsDir, "package.json"), "utf8"));
assert.equal(docsPkg.scripts.dev, "vitepress dev .");
assert.ok(await exists(path.join(docsDir, ".vitepress", "config.mts")));
assert.ok(await exists(path.join(docsDir, "index.md")));
assert.ok(await exists(path.join(docsDir, "guide", "getting-started.md")));

await createProject(ssrDir, {
    packageMode: "local",
    repoRoot,
    template: "ssr"
});
const ssrPkg = JSON.parse(await fs.readFile(path.join(ssrDir, "package.json"), "utf8"));
assert.equal(ssrPkg.scripts.dev, "vite");
assert.equal(ssrPkg.scripts.build, "vite build && npm run ssg");
assert.equal(ssrPkg.scripts["ssr:render"], "node ./scripts/render-ssr.mjs");
assert.equal(ssrPkg.scripts.ssg, "node ./scripts/generate-static.mjs");
assert.match(ssrPkg.dependencies["@nodomx/ssr"], /^file:/);
assert.match(ssrPkg.dependencies["@nodomx/nd-compiler"], /^file:/);
assert.ok(await exists(path.join(ssrDir, "src", "App.nd")));
assert.ok(await exists(path.join(ssrDir, "src", "main.js")));
assert.ok(await exists(path.join(ssrDir, "scripts", "render-ssr.mjs")));
assert.ok(await exists(path.join(ssrDir, "scripts", "generate-static.mjs")));
assert.match(await fs.readFile(path.join(ssrDir, "src", "main.js"), "utf8"), /resumeFromSsrPayload/);

await linkNodeModules(featureDir, repoRoot);
runCommand("npm", ["run", "build"], featureDir);
await linkNodeModules(typescriptDir, repoRoot);
runCommand("npm", ["run", "build"], typescriptDir);
runCommand("npm", ["run", "typecheck"], typescriptDir);
await linkNodeModules(libraryDir, repoRoot);
runCommand("npm", ["run", "build"], libraryDir);
runCommand("npm", ["run", "typecheck"], libraryDir);
await linkNodeModules(docsDir, repoRoot);
runCommand("npm", ["run", "build"], docsDir);
await linkNodeModules(ssrDir, repoRoot);
runCommand("npm", ["run", "build"], ssrDir);
assert.ok(await exists(path.join(ssrDir, "dist-ssr", "index.html")));

console.log("create-nodomx smoke test passed");

async function exists(file) {
    try {
        await fs.stat(file);
        return true;
    } catch {
        return false;
    }
}

async function readVersion(file) {
    const packageJson = JSON.parse(await fs.readFile(file, "utf8"));
    return packageJson.version;
}

function runCommand(command, args, cwd) {
    const result = spawnSync(command, args, {
        cwd,
        encoding: "utf8",
        shell: process.platform === "win32"
    });
    assert.equal(
        result.status,
        0,
        `${command} ${args.join(" ")} failed in ${cwd}\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`
    );
}

async function linkNodeModules(projectDir, repoRootPath) {
    const targetDir = path.join(projectDir, "node_modules");
    const sourceDir = path.join(repoRootPath, "node_modules");
    await fs.rm(targetDir, {
        force: true,
        recursive: true
    });
    await fs.symlink(sourceDir, targetDir, "junction");
}
