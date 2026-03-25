import { spawnSync } from "node:child_process";
import { officialNpmRegistry, publishablePackages, repoRoot } from "./shared.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const tag = readFlag("--tag");
const otp = readFlag("--otp");
const registry = readFlag("--registry") || officialNpmRegistry;

for (const pkg of publishablePackages) {
    const publishArgs = ["publish", "--workspace", pkg.name, "--access", "public", "--registry", registry];
    if (dryRun) {
        publishArgs.push("--dry-run");
    }
    if (tag) {
        publishArgs.push("--tag", tag);
    }
    if (otp) {
        publishArgs.push("--otp", otp);
    }
    run("npm", publishArgs);
}

function readFlag(flag) {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
}

function run(command, runArgs) {
    const result = spawnSync(command, runArgs, {
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
