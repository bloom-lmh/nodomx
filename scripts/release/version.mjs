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
const releasePackageNames = new Set(publishablePackages.map(item => item.name));

for (const pkg of publishablePackages) {
    const file = resolveRepoPath(pkg.dir, "package.json");
    const json = await readJson(file);
    json.version = nextVersion;
    syncDependencyVersions(json, nextVersion, releasePackageNames);

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

function syncDependencyVersions(pkg, version, releaseNames) {
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        const deps = pkg[field];
        if (!deps) {
            continue;
        }
        for (const dependencyName of Object.keys(deps)) {
            if (releaseNames.has(dependencyName)) {
                deps[dependencyName] = `^${version}`;
            }
        }
    }
}
