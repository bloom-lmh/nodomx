import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, "..");
const templateDir = path.join(packageDir, "template", "basic");

export async function createProject(targetDir, options = {}) {
    const targetPath = path.resolve(targetDir);
    const projectName = options.projectName || path.basename(targetPath);
    const packageMode = options.packageMode || "registry";
    const install = options.install === true;
    const force = options.force === true;
    const packageSpecs = resolvePackageSpecs(packageMode, options.repoRoot);

    if (!projectName || projectName === "." || projectName === path.sep) {
        throw new Error("Please provide a project directory name.");
    }

    await ensureEmptyDirectory(targetPath, force);
    await copyTemplate(templateDir, targetPath, {
        "__DEV_SERVER_SPEC__": packageSpecs.devServer,
        "__ND_COMPILER_SPEC__": packageSpecs.ndCompiler,
        "__ND_PLUGIN_SPEC__": packageSpecs.ndPlugin,
        "__NODOM_SPEC__": packageSpecs.nodom,
        "__PROJECT_NAME__": sanitizePackageName(projectName)
    });

    if (install) {
        runInstall(targetPath);
    }

    return {
        packageMode,
        projectName,
        targetPath
    };
}

export function parseArgs(args) {
    const flags = {
        force: false,
        install: false,
        packageMode: "registry",
        template: "basic"
    };
    const positional = [];

    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "--install") {
            flags.install = true;
        } else if (arg === "--force") {
            flags.force = true;
        } else if (arg === "--package-mode") {
            flags.packageMode = args[index + 1];
            index += 1;
        } else if (arg === "--template") {
            flags.template = args[index + 1];
            index += 1;
        } else if (arg === "--help" || arg === "-h") {
            flags.help = true;
        } else {
            positional.push(arg);
        }
    }

    if (!["registry", "local"].includes(flags.packageMode)) {
        throw new Error(`Unsupported package mode: ${flags.packageMode}`);
    }
    if (flags.template !== "basic") {
        throw new Error(`Unsupported template: ${flags.template}`);
    }

    return {
        flags,
        targetDir: positional[0]
    };
}

async function copyTemplate(fromDir, toDir, replacements) {
    await fs.mkdir(toDir, { recursive: true });
    const entries = await fs.readdir(fromDir, { withFileTypes: true });
    for (const entry of entries) {
        const sourcePath = path.join(fromDir, entry.name);
        const targetName = entry.name === "_gitignore" ? ".gitignore" : entry.name;
        const targetPath = path.join(toDir, targetName);
        if (entry.isDirectory()) {
            await copyTemplate(sourcePath, targetPath, replacements);
            continue;
        }
        const raw = await fs.readFile(sourcePath, "utf8");
        const rendered = applyReplacements(raw, replacements);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, rendered, "utf8");
    }
}

function applyReplacements(content, replacements) {
    return Object.entries(replacements).reduce(
        (result, [token, value]) => result.replaceAll(token, value),
        content
    );
}

async function ensureEmptyDirectory(targetPath, force) {
    const stat = await safeStat(targetPath);
    if (!stat) {
        await fs.mkdir(targetPath, { recursive: true });
        return;
    }

    const entries = await fs.readdir(targetPath);
    if (entries.length === 0) {
        return;
    }
    if (!force) {
        throw new Error(`Target directory is not empty: ${targetPath}`);
    }
}

function resolvePackageSpecs(mode, repoRootOption) {
    if (mode === "local") {
        const repoRoot = repoRootOption ? path.resolve(repoRootOption) : path.resolve(packageDir, "..", "..");
        return {
            devServer: `file:${slash(path.join(repoRoot, "packages", "rollup-plugin-dev-server"))}`,
            ndCompiler: `file:${slash(path.join(repoRoot, "packages", "nd-compiler"))}`,
            ndPlugin: `file:${slash(path.join(repoRoot, "packages", "rollup-plugin-nd"))}`,
            nodom: `file:${slash(repoRoot)}`
        };
    }

    return {
        devServer: "^0.1.0",
        ndCompiler: "^0.1.0",
        ndPlugin: "^0.1.0",
        nodom: "^0.2.3"
    };
}

function runInstall(targetPath) {
    const result = spawnSync("npm", ["install"], {
        cwd: targetPath,
        stdio: "inherit",
        shell: process.platform === "win32"
    });

    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`npm install failed with exit code ${result.status}.`);
    }
}

function sanitizePackageName(name) {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/^-+|-+$/g, "") || "nodomx-app";
}

async function safeStat(targetPath) {
    try {
        return await fs.stat(targetPath);
    } catch {
        return null;
    }
}

function slash(value) {
    return value.replace(/\\/g, "/");
}
