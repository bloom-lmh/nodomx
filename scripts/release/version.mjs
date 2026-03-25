import { spawnSync } from "node:child_process";
import {
    getCurrentReleaseVersion,
    incrementVersion,
    publishablePackages,
    readJson,
    repoRoot,
    resolveRepoPath,
    writeJson
} from "./shared.mjs";

const args = process.argv.slice(2);
const bump = args[0];
const dryRun = args.includes("--dry-run");

if (!bump) {
    throw new Error("Usage: node ./scripts/release/version.mjs <patch|minor|major|x.y.z> [--dry-run]");
}

const currentVersion = await getCurrentReleaseVersion();
const nextVersion = incrementVersion(currentVersion, bump);

for (const pkg of publishablePackages) {
    const file = resolveRepoPath(pkg.dir, "package.json");
    const json = await readJson(file);
    json.version = nextVersion;

    if (pkg.name === "@nodomx/rollup-plugin-nd") {
        json.dependencies["@nodomx/nd-compiler"] = `^${nextVersion}`;
    }

    if (!dryRun) {
        await writeJson(file, json);
    }
}

if (!dryRun) {
    run("npm", ["install"]);
}

console.log(`Release version: ${currentVersion} -> ${nextVersion}`);

function run(command, args) {
    const result = spawnSync(command, args, {
        cwd: repoRoot,
        stdio: "inherit",
        shell: process.platform === "win32"
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}
