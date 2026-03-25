const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const packageDir = path.resolve(__dirname, "..");
const distDir = path.join(packageDir, "dist");

async function main() {
    await fs.promises.rm(distDir, { recursive: true, force: true });
    await fs.promises.mkdir(distDir, { recursive: true });

    await esbuild.build({
        bundle: true,
        entryPoints: [path.join(packageDir, "src", "extension.mjs")],
        external: ["vscode"],
        format: "cjs",
        outfile: path.join(distDir, "extension.cjs"),
        platform: "node",
        tsconfigRaw: {
            compilerOptions: {}
        },
        target: "node18"
    });

    await esbuild.build({
        bundle: true,
        entryPoints: [path.join(packageDir, "src", "server.mjs")],
        format: "cjs",
        outfile: path.join(distDir, "server.cjs"),
        platform: "node",
        tsconfigRaw: {
            compilerOptions: {}
        },
        target: "node18"
    });

    const requiredFiles = [
        path.join(distDir, "extension.cjs"),
        path.join(distDir, "server.cjs")
    ];

    for (const file of requiredFiles) {
        if (!fs.existsSync(file)) {
            throw new Error(`Missing built artifact: ${file}`);
        }
    }

    console.log("vscode extension build passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
