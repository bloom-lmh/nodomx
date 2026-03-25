const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const packageDir = path.resolve(__dirname, "..");
const stageDir = path.join(packageDir, ".vsix-stage");
const outputFile = path.join(packageDir, "nodomx-nd-vscode-0.1.0.vsix");

const includeEntries = [
    "dist",
    "language-configuration.json",
    "syntaxes",
    "snippets",
    "README.md",
    "LICENSE",
    "package.json"
];

async function main() {
    runBuild();
    await fs.rm(stageDir, { recursive: true, force: true });
    await fs.mkdir(stageDir, { recursive: true });

    for (const entry of includeEntries) {
        const from = path.join(packageDir, entry);
        const to = path.join(stageDir, entry);
        await fs.cp(from, to, { recursive: true });
    }

    let result;
    if (process.platform === "win32") {
        const command = path.resolve(packageDir, "../../node_modules/.bin/vsce.cmd");
        result = spawnSync(
            `"${command}" package --allow-star-activation --out "${outputFile}"`,
            {
                cwd: stageDir,
                stdio: "inherit",
                shell: true
            }
        );
    } else {
        const command = path.resolve(packageDir, "../../node_modules/.bin/vsce");
        result = spawnSync(
            command,
            ["package", "--allow-star-activation", "--out", outputFile],
            {
                cwd: stageDir,
                stdio: "inherit"
            }
        );
    }

    if (result.error) {
        console.error(result.error);
        process.exit(1);
    }
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }

    console.log(`VSIX created at ${outputFile}`);
}

function runBuild() {
    const result = spawnSync(
        process.execPath,
        [path.join(packageDir, "scripts", "build.cjs")],
        {
            cwd: packageDir,
            stdio: "inherit"
        }
    );

    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
