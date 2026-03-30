import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = path.resolve(__dirname, "..", "node_modules", ".cache", "rollup-plugin-typescript2");

await fs.rm(cacheDir, {
    force: true,
    recursive: true
});

await fs.mkdir(cacheDir, {
    recursive: true
});
