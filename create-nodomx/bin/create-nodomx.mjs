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
    packageMode: flags.packageMode,
    router: flags.router,
    store: flags.store,
    template: flags.template,
    typescript: flags.typescript
});

console.log(`Created ${result.projectName} at ${result.targetPath}`);
console.log(`Package mode: ${result.packageMode}`);
console.log(`Template: ${result.template}`);
console.log(`Router: ${result.router ? "yes" : "no"}`);
console.log(`Store: ${result.store ? "yes" : "no"}`);
console.log(`TypeScript: ${result.typescript ? "yes" : "no"}`);
if (!flags.install) {
    console.log("Next steps:");
    console.log(`  cd ${result.targetPath}`);
    console.log("  npm install");
    console.log("  npm run dev");
}

function printHelp() {
    console.log("Usage: create-nodomx <project-name> [--install] [--package-mode registry|local] [--template vite|basic|library|docs] [--router] [--store] [--typescript] [--force]");
}
