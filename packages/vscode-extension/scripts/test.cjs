const path = require("node:path");
const { spawnSync } = require("node:child_process");

const packageDir = path.resolve(__dirname, "..");

run("node", [path.join(packageDir, "scripts", "build.cjs")]);
run("node", [path.join(packageDir, "tests", "language.smoke.mjs")]);

console.log("vscode extension test passed");

function run(command, args) {
    const result = spawnSync(command, args, {
        cwd: packageDir,
        stdio: "inherit"
    });

    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}
