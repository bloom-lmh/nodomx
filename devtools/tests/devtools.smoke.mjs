import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Nodom, Module, onMounted, useState } from "nodomx";
import { createStore, defineStore } from "@nodomx/store";
import {
    createDevtools,
    getDevtoolsHook,
    installDevtoolsHook
} from "../src/index.js";

const dom = new JSDOM("<!doctype html><html><body><div id=\"app\"></div></body></html>", {
    url: "http://localhost/"
});

installGlobals(dom.window);
const originalConsoleInfo = console.info;
console.info = () => {};

const appStore = createStore();
const useCounterStore = defineStore("counter", () => {
    const total = useState(10);
    return {
        total
    };
});

class CounterApp extends Module {
    template() {
        return `
            <section class="app-shell">
                <p>{{count}}</p>
                <button e-click="inc">+</button>
            </section>
        `;
    }

    setup() {
        const count = useState(1);
        onMounted(() => {});
        return {
            count,
            inc() {
                count.value += 1;
            }
        };
    }
}

const hook = installDevtoolsHook({
    overlay: true
});
const app = Nodom.createApp(CounterApp, "#app");
app.use(appStore);
app.use(createDevtools({
    overlay: true
}));
const counterStore = useCounterStore(appStore);
const instance = app.mount("#app");

assert.ok(instance, "expected mounted NodomX app");

const snapshots = hook.getSnapshot();
assert.equal(snapshots.length, 1, "expected one mounted app in devtools");
assert.equal(snapshots[0].snapshot.name, "CounterApp");
assert.equal(snapshots[0].snapshot.rootModule.setup.count, 1);
assert.equal(snapshots[0].snapshot.store[0].state.total, 10);
assert.ok(hook.getTimeline().some(item => item.reason === "mount"), "expected mount event in timeline");

instance.inc();
hook.notifyUpdate(app, "manual-refresh");
const updated = hook.getSnapshot()[0];
assert.equal(updated.lastEvent, "manual-refresh");
assert.equal(updated.snapshot.rootModule.setup.count, 2);

const panel = getDevtoolsHook().openOverlay();
assert.ok(panel, "expected overlay panel");
assert.ok(document.querySelector("[data-nodomx-devtools]"), "expected overlay root in document");
assert.ok(document.querySelector("[data-nodomx-devtools-tree]"), "expected module tree section");
assert.ok(document.querySelector("[data-nodomx-devtools-timeline]"), "expected timeline section");
assert.ok(document.querySelector("[data-nodomx-devtools-inspector]"), "expected inspector section");

const pickButton = document.querySelector('[data-action="pick"]');
assert.ok(pickButton, "expected element picker button");
pickButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
assert.equal(hook.__pickerState.active, true, "expected element picker to start");
hook.highlightSelection();
const appButton = findNodeByTag(instance.domManager.renderedTree, "button") || findFirstElementNode(instance.domManager.renderedTree);
assert.ok(appButton, "expected rendered module element for picker test");
const picked = hook.pickElement(appButton);
assert.ok(picked, "expected picker to resolve a module");
assert.equal(hook.__pickerState.active, false, "expected element picker to stop after selecting");
assert.equal(hook.getSnapshot()[0].selectedModuleId, instance.id, "expected picker to select current module");

const exported = hook.exportSnapshot();
assert.ok(exported.includes("\"CounterApp\""), "expected exported snapshot to contain app name");
assert.equal(window.__NODOMX_DEVTOOLS_LAST_EXPORT__, exported, "expected export payload cached on window");

const inspected = hook.inspectSelection();
assert.equal(inspected.module.name, "CounterApp", "expected inspect selection to resolve current module");
assert.equal(window.__NODOMX_DEVTOOLS_LAST_INSPECT__.module.name, "CounterApp");

const highlight = hook.highlightSelection();
assert.equal(highlight.targetTag, "section", "expected module highlight to resolve root section");
assert.ok(document.querySelector("[data-nodomx-devtools-highlight]"), "expected visible highlight overlay");

hook.applyModulePatch(undefined, undefined, "setup", {
    count: 9
});
assert.equal(hook.getSnapshot()[0].snapshot.rootModule.setup.count, 9, "expected setup patch to update snapshot");

hook.applyStorePatch(undefined, "counter", {
    total: 18
});
assert.equal(counterStore.total, 18, "expected store patch to update actual store");
assert.equal(hook.getSnapshot()[0].snapshot.store[0].state.total, 18, "expected store patch to update snapshot");

const manualRefreshEvent = hook.getTimeline().find(item => item.reason === "manual-refresh");
assert.ok(manualRefreshEvent, "expected manual refresh event in timeline");
const manualRefreshButton = document.querySelector(`[data-event-id="${manualRefreshEvent.id}"]`);
assert.ok(manualRefreshButton, "expected clickable timeline item");
manualRefreshButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
assert.match(document.querySelector("[data-nodomx-devtools-inspector]").textContent, /Event details/i, "expected event inspector view");
assert.match(document.querySelector("[data-nodomx-devtools-inspector]").textContent, /manual-refresh/i, "expected selected event reason in inspector");

hook.clearTimeline();
assert.ok(hook.getTimeline().some(item => item.reason === "timeline-cleared"), "expected timeline cleared event");

app.unmount();
assert.equal(hook.getSnapshot().length, 0, "expected no mounted apps after unmount");

dom.window.close();
console.info = originalConsoleInfo;
console.log("@nodomx/devtools smoke test passed");

function installGlobals(windowRef) {
    globalThis.window = windowRef;
    globalThis.document = windowRef.document;
    globalThis.navigator = windowRef.navigator;
    globalThis.Node = windowRef.Node;
    globalThis.Element = windowRef.Element;
    globalThis.HTMLElement = windowRef.HTMLElement;
    globalThis.Comment = windowRef.Comment;
    globalThis.DocumentFragment = windowRef.DocumentFragment;
    globalThis.Event = windowRef.Event;
    globalThis.MouseEvent = windowRef.MouseEvent;
    globalThis.CustomEvent = windowRef.CustomEvent;
    globalThis.AbortController = windowRef.AbortController;
    globalThis.AbortSignal = windowRef.AbortSignal;
    globalThis.Text = windowRef.Text;
    globalThis.SVGElement = windowRef.SVGElement;
    globalThis.getComputedStyle = windowRef.getComputedStyle.bind(windowRef);
    globalThis.requestAnimationFrame = callback => setTimeout(() => callback(Date.now()), 0);
    globalThis.cancelAnimationFrame = id => clearTimeout(id);
}

function findNodeByTag(renderedDom, tagName) {
    if (!renderedDom) {
        return null;
    }
    if (renderedDom.node?.tagName?.toLowerCase?.() === tagName) {
        return renderedDom.node;
    }
    for (const child of renderedDom.children || []) {
        const found = findNodeByTag(child, tagName);
        if (found) {
            return found;
        }
    }
    return null;
}

function findFirstElementNode(renderedDom) {
    if (!renderedDom) {
        return null;
    }
    if (renderedDom.node instanceof Element) {
        return renderedDom.node;
    }
    for (const child of renderedDom.children || []) {
        const found = findFirstElementNode(child);
        if (found) {
            return found;
        }
    }
    return null;
}
