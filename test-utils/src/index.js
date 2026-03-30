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

export function createTestDom(options = {}) {
    const html = options.html || "<!DOCTYPE html><html><body><div id=\"app\"></div></body></html>";
    const dom = new JSDOM(html, {
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

export async function mount(rootComponent, options = {}) {
    const selector = options.selector || "#app";
    const dom = options.dom || createTestDom({
        html: options.html,
        url: options.url
    });
    ensureMountTarget(dom.document, selector);

    const app = Nodom.createApp(rootComponent, selector);
    applyGlobalOptions(app, options.global);

    const instance = app.mount(selector);
    await flush();

    const wrapper = {
        app,
        element: dom.document.querySelector(selector),
        instance,
        selector,
        window: dom.window,
        find(targetSelector) {
            return dom.document.querySelector(targetSelector);
        },
        exists(targetSelector) {
            return !!this.find(targetSelector);
        },
        html() {
            return (this.element || Renderer.getRootEl())?.innerHTML || "";
        },
        text(targetSelector = selector) {
            return this.find(targetSelector)?.textContent?.trim() || "";
        },
        async trigger(targetSelector, eventName, init = {}) {
            const element = this.find(targetSelector);
            if (!element) {
                throw new Error(`Unable to find target element: ${targetSelector}`);
            }
            const event = createDomEvent(dom.window, eventName, init);
            element.dispatchEvent(event);
            await flush();
            return this;
        },
        async update() {
            await flush();
            return this;
        },
        destroy() {
            app.unmount();
            if (!options.dom) {
                dom.restore();
            }
        }
    };

    return wrapper;
}

export async function flush() {
    Renderer.flush();
    await Promise.resolve();
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
        throw new Error(`Only id selectors are auto-created by test-utils. Received: ${selector}`);
    }
    const mountNode = documentRef.createElement("div");
    mountNode.id = selector.slice(1);
    documentRef.body.appendChild(mountNode);
}

function createDomEvent(windowRef, eventName, init = {}) {
    const eventOptions = {
        bubbles: true,
        cancelable: true,
        ...init
    };
    if (eventName === "input" || eventName === "change") {
        return new windowRef.Event(eventName, eventOptions);
    }
    if (/^(click|mousedown|mouseup|mouseenter|mouseleave|mouseover|mouseout)$/.test(eventName)) {
        return new windowRef.MouseEvent(eventName, eventOptions);
    }
    if (/^(keydown|keyup|keypress)$/.test(eventName)) {
        return new windowRef.KeyboardEvent(eventName, eventOptions);
    }
    return new windowRef.Event(eventName, eventOptions);
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
