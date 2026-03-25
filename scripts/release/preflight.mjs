import { spawnSync } from "node:child_process";
import {
    officialNpmRegistry,
    publishablePackages,
    readJson,
    resolveRepoPath
} from "./shared.mjs";

const currentRegistry = readCommand("npm", ["config", "get", "registry"]).stdout;
const whoami = readCommand("npm", ["whoami", "--registry", officialNpmRegistry], true);
const issues = [];

if (currentRegistry !== officialNpmRegistry) {
    issues.push(`npm registry is ${currentRegistry}, expected ${officialNpmRegistry}`);
}

if (whoami.status !== 0 || !whoami.stdout) {
    issues.push("npm login is missing for the official registry");
}

console.log("Release preflight");
console.log(`registry: ${currentRegistry}`);
console.log(`publisher: ${whoami.stdout || "(not logged in)"}`);

for (const pkg of publishablePackages) {
    const json = await readJson(resolveRepoPath(pkg.dir, "package.json"));
    console.log(`${json.name}@${json.version}`);
}

if (issues.length > 0) {
    for (const issue of issues) {
        console.error(`- ${issue}`);
    }
    process.exit(1);
}

function readCommand(command, args, allowFailure = false) {
    const result = spawnSync(command, args, {
        cwd: resolveRepoPath(),
        encoding: "utf8",
        shell: process.platform === "win32"
    });
    if (!allowFailure && result.status !== 0) {
        if (result.error) {
            throw result.error;
        }
        throw new Error(result.stderr || `${command} ${args.join(" ")} failed.`);
    }
    return {
        status: result.status || 0,
        stdout: (result.stdout || "").trim(),
        stderr: (result.stderr || "").trim()
    };
}
