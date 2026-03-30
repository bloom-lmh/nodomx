import fs from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import { Nodom, Renderer } from "nodomx";

const DOM_GLOBAL_KEYS = [
    "window",
    "document",
    "navigator",
    "Node",
    "Element",
    "HTMLElement",
    "Comment",
    "DocumentFragment",
    "Event",
    "CustomEvent",
    "Text",
    "SVGElement",
    "AbortController",
    "AbortSignal",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame"
];

const DEFAULT_DOCUMENT = "<!DOCTYPE html><html><head></head><body><div id=\"app\"></div></body></html>";
const DEFAULT_PAYLOAD_ID = "__NODOMX_SSR__";

export function createSsrDom(options = {}) {
    const dom = new JSDOM(options.html || DEFAULT_DOCUMENT, {
        url: options.url || "http://localhost/"
    });
    const restore = installDomGlobals(dom.window);
    return {
        document: dom.window.document,
        restore() {
            restore();
            dom.window.close();
        },
        window: dom.window
    };
}

export async function renderToString(rootComponent, options = {}) {
    const dom = createSsrDom({
        html: options.html,
        url: options.url
    });
    try {
        const selector = options.selector || "#app";
        ensureMountTarget(dom.document, selector);
        const app = Nodom.createApp(rootComponent, selector);
        applyGlobalOptions(app, options.global);
        if (typeof options.beforeMount === "function") {
            await options.beforeMount({
                app,
                document: dom.document,
                window: dom.window
            });
        }
        const instance = app.mount(selector);
        await flushSsr(options.flushRounds, options.settleTicks);
        const rootEl = dom.document.querySelector(selector);
        const appHtml = rootEl?.innerHTML || "";
        const payload = options.payload === false
            ? null
            : createSsrPayload(instance, {
                selector
            });
        const payloadScript = payload
            ? serializeSsrPayload(payload, {
                payloadId: options.payloadId
            })
            : "";
        const html = serializeHtmlDocument(dom.document, payloadScript, {
            injectPayloadScript: options.injectPayloadScript !== false && !!payloadScript
        });
        app.unmount();
        return {
            appHtml,
            html,
            payload,
            payloadScript,
            selector
        };
    } finally {
        dom.restore();
    }
}

export async function mountFromSsrPayload(rootComponent, options = {}) {
    const dom = options.dom || createSsrDom({
        html: options.html,
        url: options.url
    });
    const selector = options.selector || "#app";
    ensureMountTarget(dom.document, selector);
    const target = dom.document.querySelector(selector);
    if (target) {
        target.innerHTML = "";
    }
    const app = Nodom.createApp(rootComponent, selector);
    applyGlobalOptions(app, options.global);
    if (typeof options.beforeMount === "function") {
        await options.beforeMount({
            app,
            document: dom.document,
            window: dom.window
        });
    }
    const instance = app.mount(selector);
    await flushSsr(options.flushRounds, options.settleTicks);
    const payload = options.payload || readSsrPayload(dom.window, {
        payloadId: options.payloadId
    });
    if (payload?.snapshot && instance && typeof instance.applyHotSnapshot === "function") {
        instance.applyHotSnapshot(payload.snapshot);
        await flushSsr(options.flushRounds, options.settleTicks);
    }
    return {
        app,
        dom,
        instance,
        payload,
        restore() {
            app.unmount();
            if (!options.dom) {
                dom.restore();
            }
        }
    };
}

export async function resumeFromSsrPayload(rootComponent, options = {}) {
    if (typeof document === "undefined") {
        throw new Error("resumeFromSsrPayload() requires a browser-like document.");
    }
    const selector = options.selector || "#app";
    ensureMountTarget(document, selector);
    const target = document.querySelector(selector);
    const payload = options.payload || readSsrPayload(window, {
        payloadId: options.payloadId
    });
    if (target && options.replaceTarget !== false) {
        target.innerHTML = "";
    }
    const app = Nodom.createApp(rootComponent, selector);
    applyGlobalOptions(app, options.global);
    if (typeof options.beforeMount === "function") {
        await options.beforeMount({
            app,
            document,
            window
        });
    }
    const instance = app.mount(selector);
    await flushSsr(options.flushRounds, options.settleTicks);
    if (payload?.snapshot && instance && typeof instance.applyHotSnapshot === "function") {
        instance.applyHotSnapshot(payload.snapshot);
        await flushSsr(options.flushRounds, options.settleTicks);
    }
    return {
        app,
        instance,
        payload
    };
}

export function createSsrPayload(instance, options = {}) {
    if (!instance || typeof instance.captureHotSnapshot !== "function") {
        return null;
    }
    return {
        selector: options.selector || "#app",
        snapshot: instance.captureHotSnapshot(),
        timestamp: new Date().toISOString(),
        version: 1
    };
}

export function serializeSsrPayload(payload, options = {}) {
    const payloadId = options.payloadId || DEFAULT_PAYLOAD_ID;
    const serialized = JSON.stringify(payload || null)
        .replace(/</g, "\\u003C")
        .replace(/>/g, "\\u003E");
    return `<script id="${payloadId}" type="application/json">${serialized}</script>`;
}

export function readSsrPayload(windowRef, options = {}) {
    if (!windowRef?.document) {
        return null;
    }
    const payloadId = options.payloadId || DEFAULT_PAYLOAD_ID;
    const inline = windowRef.document.getElementById(payloadId);
    if (inline?.textContent) {
        try {
            return JSON.parse(inline.textContent);
        } catch {
            return null;
        }
    }
    return null;
}

export async function generateStaticSite(entries, options = {}) {
    if (!Array.isArray(entries) || entries.length === 0) {
        throw new Error("generateStaticSite(entries, options) requires at least one route entry.");
    }
    const outDir = path.resolve(options.outDir || "dist-ssr");
    const prettyUrls = options.prettyUrls !== false;
    const generated = [];
    for (const entry of entries) {
        const routePath = normalizeRoutePath(entry.path || "/");
        const renderResult = await renderToString(entry.component, {
            beforeMount: entry.beforeMount || options.beforeMount,
            flushRounds: entry.flushRounds ?? options.flushRounds,
            global: mergeGlobalOptions(options.global, entry.global),
            html: entry.html || options.html,
            injectPayloadScript: entry.injectPayloadScript ?? options.injectPayloadScript,
            payload: entry.payload ?? options.payload,
            payloadId: entry.payloadId || options.payloadId,
            selector: entry.selector || options.selector,
            settleTicks: entry.settleTicks ?? options.settleTicks,
            url: resolveRouteUrl(options.baseUrl, routePath)
        });
        const outputFile = resolveStaticOutputFile(outDir, routePath, prettyUrls);
        await fs.mkdir(path.dirname(outputFile), { recursive: true });
        await fs.writeFile(outputFile, renderResult.html, "utf8");
        generated.push({
            file: outputFile,
            path: routePath
        });
    }
    return generated;
}

export async function flushSsr(maxRounds = 8, settleTicks = 2) {
    Renderer.flush(maxRounds);
    for (let index = 0; index < settleTicks; index += 1) {
        await Promise.resolve();
        Renderer.flush(maxRounds);
    }
}

function serializeHtmlDocument(documentRef, payloadScript, options = {}) {
    if (payloadScript && options.injectPayloadScript !== false) {
        const body = documentRef.body || documentRef.documentElement;
        body.insertAdjacentHTML("beforeend", payloadScript);
    }
    return `<!DOCTYPE html>\n${documentRef.documentElement.outerHTML}`;
}

function resolveStaticOutputFile(outDir, routePath, prettyUrls) {
    if (!prettyUrls) {
        const fileName = routePath === "/" ? "index.html" : `${routePath.replace(/^\//, "").replace(/\//g, "_")}.html`;
        return path.join(outDir, fileName);
    }
    if (routePath === "/") {
        return path.join(outDir, "index.html");
    }
    return path.join(outDir, routePath.replace(/^\//, ""), "index.html");
}

function resolveRouteUrl(baseUrl, routePath) {
    const normalizedBase = String(baseUrl || "http://localhost/").replace(/\/+$/, "");
    return `${normalizedBase}${routePath}`;
}

function normalizeRoutePath(routePath) {
    const value = `/${String(routePath || "/").trim().replace(/^\/+/, "")}`.replace(/\/+/g, "/");
    return value === "/" ? value : value.replace(/\/$/, "");
}

function mergeGlobalOptions(baseGlobal, routeGlobal) {
    if (!baseGlobal && !routeGlobal) {
        return undefined;
    }
    return {
        components: {
            ...(baseGlobal?.components || {}),
            ...(routeGlobal?.components || {})
        },
        config: {
            ...(baseGlobal?.config || {}),
            ...(routeGlobal?.config || {}),
            globalProperties: {
                ...(baseGlobal?.config?.globalProperties || {}),
                ...(routeGlobal?.config?.globalProperties || {})
            }
        },
        directives: {
            ...(baseGlobal?.directives || {}),
            ...(routeGlobal?.directives || {})
        },
        plugins: [
            ...(baseGlobal?.plugins || []),
            ...(routeGlobal?.plugins || [])
        ],
        provide: {
            ...(baseGlobal?.provide || {}),
            ...(routeGlobal?.provide || {})
        }
    };
}

function applyGlobalOptions(app, globalOptions = {}) {
    if (!globalOptions) {
        return;
    }
    for (const plugin of globalOptions.plugins || []) {
        if (Array.isArray(plugin)) {
            app.use(plugin[0], ...(plugin.slice(1)));
        } else {
            app.use(plugin);
        }
    }
    for (const [key, value] of Object.entries(globalOptions.provide || {})) {
        app.provide(key, value);
    }
    for (const [name, component] of Object.entries(globalOptions.components || {})) {
        app.component(name, component);
    }
    for (const [name, directive] of Object.entries(globalOptions.directives || {})) {
        if (typeof directive === "function") {
            app.directive(name, directive);
        } else if (directive && typeof directive === "object") {
            app.directive(name, directive.handler, directive.priority);
        }
    }
    if (globalOptions.config?.globalProperties) {
        Object.assign(app.config.globalProperties, globalOptions.config.globalProperties);
    }
}

function ensureMountTarget(documentRef, selector) {
    if (documentRef.querySelector(selector)) {
        return;
    }
    if (!selector.startsWith("#")) {
        throw new Error(`Only id selectors are auto-created for SSR helpers. Received: ${selector}`);
    }
    const mountNode = documentRef.createElement("div");
    mountNode.id = selector.slice(1);
    documentRef.body.appendChild(mountNode);
}

function installDomGlobals(windowRef) {
    const previous = new Map();
    for (const key of DOM_GLOBAL_KEYS) {
        previous.set(key, Object.prototype.hasOwnProperty.call(globalThis, key) ? globalThis[key] : undefined);
    }
    globalThis.window = windowRef;
    globalThis.document = windowRef.document;
    globalThis.navigator = windowRef.navigator;
    globalThis.Node = windowRef.Node;
    globalThis.Element = windowRef.Element;
    globalThis.HTMLElement = windowRef.HTMLElement;
    globalThis.Comment = windowRef.Comment;
    globalThis.DocumentFragment = windowRef.DocumentFragment;
    globalThis.Event = windowRef.Event;
    globalThis.CustomEvent = windowRef.CustomEvent;
    globalThis.Text = windowRef.Text;
    globalThis.SVGElement = windowRef.SVGElement;
    globalThis.AbortController = windowRef.AbortController;
    globalThis.AbortSignal = windowRef.AbortSignal;
    globalThis.getComputedStyle = windowRef.getComputedStyle.bind(windowRef);
    globalThis.requestAnimationFrame = callback => setTimeout(() => callback(Date.now()), 0);
    globalThis.cancelAnimationFrame = id => clearTimeout(id);
    return () => {
        for (const [key, value] of previous.entries()) {
            if (value === undefined) {
                delete globalThis[key];
            } else {
                globalThis[key] = value;
            }
        }
    };
}
