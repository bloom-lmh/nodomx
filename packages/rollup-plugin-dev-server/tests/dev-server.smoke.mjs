import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { nodomDevServer } from "../src/index.js";
import { bootstrapNodomApp } from "../src/runtime.js";

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nd-dev-server-"));
const publicDir = path.join(tmpDir, "public");
const distDir = path.join(tmpDir, "dist");

await fs.mkdir(publicDir, { recursive: true });
await fs.mkdir(distDir, { recursive: true });
await fs.writeFile(path.join(publicDir, "index.html"), `
<!doctype html>
<html>
<body>
  <div id="app"></div>
</body>
</html>
`, "utf8");
await fs.writeFile(path.join(distDir, "main.js"), "console.log('hello dev server');", "utf8");

const plugin = nodomDevServer({
    distDir,
    forceStart: true,
    host: "127.0.0.1",
    port: 0,
    rootDir: publicDir
});

await plugin.buildStart.call({ meta: { watchMode: true } });

const info = plugin.getServerInfo();
const html = await request(`${info.url}/`);
assert.match(html.body, /@nodomx\/dev-client\.js/);
assert.match(html.body, /<div id="app"><\/div>/);

const js = await request(`${info.url}/dist/main.js`);
assert.equal(js.body, "console.log('hello dev server');");

const client = await request(`${info.url}/@nodomx/dev-client.js`);
assert.match(client.body, /EventSource/);
assert.match(client.body, /__NODOMX_HMR__/);

global.window = {
    __NODOMX_HMR__: {
        changedFiles: ["C:/demo/App.nd"]
    }
};
let hotReloaded = null;
const nodom = {
    captureHotState() {
        return {
            count: 2
        };
    },
    hotReload(clazz, selector, hotState, changedFiles) {
        hotReloaded = { changedFiles, clazz, selector, hotState };
    }
};

class DemoApp {}
await bootstrapNodomApp({
    entryUrl: "/dist/main.js",
    load: async () => ({ default: DemoApp }),
    nodom,
    selector: "#app"
});

assert.equal(global.window.__NODOMX_HMR__.entryUrl, "/dist/main.js");
assert.deepEqual(hotReloaded, {
    clazz: DemoApp,
    changedFiles: ["C:/demo/App.nd"],
    hotState: {
        count: 2
    },
    selector: "#app"
});

delete global.window;

await plugin.closeBundle();

console.log("rollup dev server smoke test passed");

function request(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (response) => {
            const chunks = [];
            response.on("data", chunk => chunks.push(chunk));
            response.on("end", () => {
                resolve({
                    body: Buffer.concat(chunks).toString("utf8"),
                    statusCode: response.statusCode
                });
            });
        }).on("error", reject);
    });
}
