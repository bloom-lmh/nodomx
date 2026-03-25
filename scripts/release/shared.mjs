import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "..", "..");

export const publishablePackages = [
    {
        dir: "packages/nd-compiler",
        name: "@nodomx/nd-compiler"
    },
    {
        dir: "packages/rollup-plugin-nd",
        name: "@nodomx/rollup-plugin-nd"
    },
    {
        dir: "packages/rollup-plugin-dev-server",
        name: "@nodomx/rollup-plugin-dev-server"
    },
    {
        dir: "packages/create-nodomx",
        name: "create-nodomx"
    }
];

export async function readJson(file) {
    return JSON.parse(await fs.readFile(file, "utf8"));
}

export async function writeJson(file, value) {
    await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function resolveRepoPath(...segments) {
    return path.join(repoRoot, ...segments);
}

export function incrementVersion(version, bump) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!match) {
        throw new Error(`Unsupported version format: ${version}`);
    }
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);

    switch (bump) {
        case "major":
            return `${major + 1}.0.0`;
        case "minor":
            return `${major}.${minor + 1}.0`;
        case "patch":
            return `${major}.${minor}.${patch + 1}`;
        default:
            if (/^\d+\.\d+\.\d+$/.test(bump)) {
                return bump;
            }
            throw new Error(`Unsupported bump target: ${bump}`);
    }
}

export async function getCurrentReleaseVersion() {
    const pkg = await readJson(resolveRepoPath("packages", "create-nodomx", "package.json"));
    return pkg.version;
}
