import fs from "node:fs/promises";
import { renderToString } from "@nodomx/ssr";
import { loadSsrComponent, resolveProjectPath } from "./shared.mjs";

const App = await loadSsrComponent(pathJoin("src", "App.nd"));
const result = await renderToString(App, {
  selector: "#app"
});

const outDir = resolveProjectPath("dist-ssr");
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(resolveProjectPath("dist-ssr", "index.html"), result.html, "utf8");

console.log("NodomX SSR render complete:", resolveProjectPath("dist-ssr", "index.html"));

function pathJoin(...segments) {
  return segments.join("/");
}
