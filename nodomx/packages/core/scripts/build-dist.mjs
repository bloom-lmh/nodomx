import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, "..");
const distDir = path.join(packageDir, "dist");
const entrySource = 'export * from "@nodomx/reactivity";\nexport * from "@nodomx/runtime-core";\n';

await fs.mkdir(distDir, { recursive: true });
await fs.writeFile(path.join(distDir, "index.js"), entrySource, "utf8");
await fs.writeFile(path.join(distDir, "index.d.ts"), entrySource, "utf8");