import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileFile } from "@nodomx/nd-compiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

export async function loadSsrComponent(relativeFile) {
  const inputFile = path.join(projectRoot, relativeFile);
  const compiled = await compileFile(inputFile, {
    importSource: "nodomx",
    outputSuffix: ".nd.ssr.gen.mjs"
  });
  const mod = await import(pathToFileURL(compiled.outputFile).href);
  return mod.default;
}

export function resolveProjectPath(...segments) {
  return path.join(projectRoot, ...segments);
}
