import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";

const CLIENT_PATH = "/@nodomx/dev-client.js";
const SSE_PATH = "/__nodomx_live_reload";

export function nodomDevServer(options = {}) {
    const rootDir = path.resolve(options.rootDir || "public");
    const distDir = path.resolve(options.distDir || "dist");
    const host = options.host || "127.0.0.1";
    const port = Number.isInteger(options.port) ? options.port : 3000;
    const open = options.open === true;
    const fallback = options.fallback || "/index.html";
    const forceStart = options.forceStart === true;
    const clients = new Set();
    const changedFiles = new Set();

    let server;
    let serverPromise;
    let actualPort = port;
    let openedBrowser = false;

    return {
        name: "nodom-dev-server",
        async buildStart() {
            if (!shouldStart(this?.meta?.watchMode, forceStart) || serverPromise) {
                return;
            }
            serverPromise = startServer();
            await serverPromise;
        },
        async writeBundle() {
            if (!serverPromise) {
                return;
            }
            await serverPromise;
            broadcastUpdate(clients, changedFiles);
            changedFiles.clear();
        },
        watchChange(id) {
            if (id) {
                changedFiles.add(id);
            }
        },
        async closeWatcher() {
            await closeServer();
        },
        async closeBundle() {
            if (forceStart) {
                await closeServer();
            }
        },
        getServerInfo() {
            return {
                host,
                port: actualPort,
                url: `http://${host}:${actualPort}`
            };
        }
    };

    async function startServer() {
        server = http.createServer((request, response) => {
            void handleRequest(request, response);
        });

        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(port, host, () => {
                const address = server.address();
                actualPort = typeof address === "object" && address ? address.port : port;
                server.off("error", reject);
                resolve();
            });
        });

        if (open && !openedBrowser) {
            openedBrowser = true;
            openBrowser(`http://${host}:${actualPort}`);
        }

        return server;
    }

    async function closeServer() {
        if (!server) {
            return;
        }

        for (const client of clients) {
            client.end();
        }
        clients.clear();

        await new Promise(resolve => server.close(resolve));
        server = undefined;
        serverPromise = undefined;
    }

    async function handleRequest(request, response) {
        const url = new URL(request.url || "/", `http://${host}:${actualPort}`);
        const pathname = decodeURIComponent(url.pathname);

        if (pathname === CLIENT_PATH) {
            sendText(response, 200, clientScript(SSE_PATH), "application/javascript; charset=utf-8");
            return;
        }

        if (pathname === SSE_PATH) {
            response.writeHead(200, {
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                "Content-Type": "text/event-stream; charset=utf-8"
            });
            response.write("retry: 1000\n\n");
            clients.add(response);
            request.on("close", () => {
                clients.delete(response);
            });
            return;
        }

        const file = await resolveFile(pathname, {
            distDir,
            fallback,
            rootDir
        });

        if (!file) {
            sendText(response, 404, "Not Found", "text/plain; charset=utf-8");
            return;
        }

        const content = await fsp.readFile(file);
        const type = contentType(file);
        if (type.startsWith("text/html")) {
            const html = injectClient(content.toString("utf8"));
            sendText(response, 200, html, type);
            return;
        }

        response.writeHead(200, {
            "Content-Type": type
        });
        response.end(content);
    }
}

export default nodomDevServer;

async function resolveFile(pathname, options) {
    const relativePath = sanitizePath(pathname);
    if (!relativePath) {
        return null;
    }

    const candidates = [];
    if (relativePath === "/") {
        candidates.push(path.join(options.rootDir, "index.html"));
    } else {
        const trimmed = relativePath.replace(/^\//, "");
        if (trimmed === path.basename(options.distDir) || trimmed.startsWith(`${path.basename(options.distDir)}/`)) {
            const distRelative = trimmed === path.basename(options.distDir)
                ? ""
                : trimmed.slice(path.basename(options.distDir).length + 1);
            candidates.push(path.join(options.distDir, distRelative));
            if (!path.extname(distRelative)) {
                candidates.push(path.join(options.distDir, distRelative, "index.html"));
            }
        } else {
            candidates.push(path.join(options.rootDir, trimmed));
            candidates.push(path.join(options.distDir, trimmed));
            if (!path.extname(trimmed)) {
                candidates.push(path.join(options.rootDir, trimmed, "index.html"));
                candidates.push(path.join(options.distDir, trimmed, "index.html"));
            }
        }
    }

    for (const file of candidates) {
        const stat = await safeStat(file);
        if (stat?.isFile()) {
            return file;
        }
    }

    const fallbackFile = path.join(options.rootDir, options.fallback.replace(/^\//, ""));
    const fallbackStat = await safeStat(fallbackFile);
    return fallbackStat?.isFile() ? fallbackFile : null;
}

function sanitizePath(pathname) {
    const normalized = path.posix.normalize(pathname);
    if (normalized.includes("..")) {
        return null;
    }
    return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function broadcastReload(clients) {
    for (const client of clients) {
        client.write("event: reload\ndata: now\n\n");
    }
}

function broadcastUpdate(clients, changedFiles) {
    const payload = JSON.stringify({
        changed: Array.from(changedFiles)
    });
    for (const client of clients) {
        client.write(`event: update\ndata: ${payload}\n\n`);
    }
}

function injectClient(html) {
    const snippet = `<script type="module" src="${CLIENT_PATH}"></script>`;
    if (html.includes(snippet)) {
        return html;
    }
    if (html.includes("</body>")) {
        return html.replace("</body>", `  ${snippet}\n</body>`);
    }
    return `${html}\n${snippet}\n`;
}

function sendText(response, statusCode, body, type) {
    response.writeHead(statusCode, {
        "Content-Type": type
    });
    response.end(body);
}

function contentType(file) {
    switch (path.extname(file).toLowerCase()) {
        case ".html":
            return "text/html; charset=utf-8";
        case ".js":
        case ".mjs":
            return "application/javascript; charset=utf-8";
        case ".css":
            return "text/css; charset=utf-8";
        case ".json":
            return "application/json; charset=utf-8";
        case ".svg":
            return "image/svg+xml";
        default:
            return "application/octet-stream";
    }
}

function clientScript(ssePath) {
    return `
const source = new EventSource(${JSON.stringify(ssePath)});
const state = window.__NODOMX_HMR__ = window.__NODOMX_HMR__ || {
    entryUrl: "",
    pending: Promise.resolve()
};

source.addEventListener("update", async () => {
    if (!state.entryUrl) {
        window.location.reload();
        return;
    }
    const entryUrl = withTimestamp(state.entryUrl);
    state.pending = state.pending
        .catch(() => {})
        .then(() => import(entryUrl))
        .catch((error) => {
            console.error("[nodomx-hmr] hot update failed, reloading page.", error);
            window.location.reload();
        });
});

source.addEventListener("reload", () => {
    window.location.reload();
});

function withTimestamp(url) {
    const next = new URL(url, window.location.href);
    next.searchParams.set("t", Date.now().toString());
    return next.href;
}
`.trim();
}

function shouldStart(watchMode, forceStart) {
    return Boolean(watchMode) || forceStart;
}

function openBrowser(url) {
    const platform = process.platform;
    if (platform === "win32") {
        spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
        return;
    }
    if (platform === "darwin") {
        spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
        return;
    }
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

async function safeStat(file) {
    try {
        return await fsp.stat(file);
    } catch {
        return null;
    }
}
