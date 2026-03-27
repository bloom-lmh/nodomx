import { rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const docsRoot = process.cwd();
const vitepressRoot = join(docsRoot, ".vitepress");

for (const target of [".cache", ".temp", "cache", "dist"]) {
    rmSync(join(vitepressRoot, target), {
        recursive: true,
        force: true
    });
}

const result = spawnSync(
    "npx",
    ["vitepress", "build", "."],
    {
        cwd: docsRoot,
        env: process.env,
        stdio: "inherit",
        shell: process.platform === "win32"
    }
);

if (result.error) {
    throw result.error;
}
if (result.status !== 0) {
    process.exit(result.status || 1);
}
