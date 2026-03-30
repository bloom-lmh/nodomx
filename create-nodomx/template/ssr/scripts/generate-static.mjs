import { generateStaticSite } from "@nodomx/ssr";
import { loadSsrComponent, resolveProjectPath } from "./shared.mjs";

const App = await loadSsrComponent(pathJoin("src", "App.nd"));

const outputs = await generateStaticSite([
  {
    component: App,
    path: "/"
  }
], {
  outDir: resolveProjectPath("dist-ssr")
});

console.log("NodomX static generation complete:");
for (const output of outputs) {
  console.log(`  ${output.path} -> ${output.file}`);
}

function pathJoin(...segments) {
  return segments.join("/");
}
