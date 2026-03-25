#!/usr/bin/env node
import { createProject, parseArgs } from "../src/index.mjs";

const { flags, targetDir } = parseArgs(process.argv.slice(2));

if (flags.help || !targetDir) {
    printHelp();
    process.exit(flags.help ? 0 : 1);
}

const result = await createProject(targetDir, {
    force: flags.force,
    install: flags.install,
    packageMode: flags.packageMode
});

console.log(`Created ${result.projectName} at ${result.targetPath}`);
console.log(`Package mode: ${result.packageMode}`);
if (!flags.install) {
    console.log("Next steps:");
    console.log(`  cd ${result.targetPath}`);
    console.log("  npm install");
    console.log("  npm run dev");
}

function printHelp() {
    console.log("Usage: create-nodomx <project-name> [--install] [--package-mode registry|local] [--force]");
}
