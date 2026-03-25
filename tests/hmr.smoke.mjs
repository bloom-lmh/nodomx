import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const { window } = new JSDOM("<!DOCTYPE html><html><body><div id=\"app\"></div></body></html>", {
    url: "http://localhost/"
});

globalThis.window = window;
globalThis.document = window.document;
globalThis.navigator = window.navigator;
globalThis.Node = window.Node;
globalThis.Element = window.Element;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Comment = window.Comment;
globalThis.DocumentFragment = window.DocumentFragment;
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;
globalThis.Text = window.Text;
globalThis.SVGElement = window.SVGElement;
globalThis.AbortController = window.AbortController;
globalThis.AbortSignal = window.AbortSignal;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const {
    Module,
    ModuleFactory,
    Nodom,
    Renderer,
    useState
} = await import("../dist/nodom.esm.js");

const APP_FILE = "C:\\demo\\App.nd";
const CHILD_FILE = "C:\\demo\\CounterChild.nd";

class CounterChild extends Module {
    template() {
        return `
            <div id="child">
                <p id="child-version">cold</p>
                <p id="child-count">{{count}}</p>
                <button id="child-inc" e-click="inc">inc</button>
            </div>
        `;
    }

    setup() {
        const count = useState(1);
        return {
            count,
            inc() {
                count.value++;
            }
        };
    }
}
CounterChild.prototype.__ndFile = CHILD_FILE;

class HotApp extends Module {
    modules = [CounterChild];

    template() {
        return `
            <div id="hmr-app">
                <p id="title">{{title}}</p>
                <button id="rename" e-click="rename">rename</button>
                <CounterChild />
            </div>
        `;
    }

    setup() {
        const title = useState("cold-root");
        return {
            title,
            rename() {
                title.value = "warm-root";
            }
        };
    }
}
HotApp.prototype.__ndFile = APP_FILE;

function text(selector) {
    return document.querySelector(selector)?.textContent?.trim();
}

Renderer.setRootEl(document.querySelector("#app"));
const app = ModuleFactory.get(HotApp);
ModuleFactory.setMain(app);
app.active();
Renderer.flush();

document.querySelector("#rename").dispatchEvent(new window.Event("click", { bubbles: true }));
document.querySelector("#child-inc").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();

const rootId = ModuleFactory.getMain().id;
const childBefore = ModuleFactory.getMain().children[0];

assert.equal(text("#title"), "warm-root");
assert.equal(text("#child-version"), "cold");
assert.equal(text("#child-count"), "2");

const hotState = Nodom.captureHotState();

const CounterChildHot = class CounterChild extends Module {
    template() {
        return `
            <div id="child">
                <p id="child-version">hot</p>
                <p id="child-count">{{count}}</p>
                <button id="child-inc" e-click="inc">inc</button>
            </div>
        `;
    }

    setup() {
        const count = useState(99);
        return {
            count,
            inc() {
                count.value++;
            }
        };
    }
};
CounterChildHot.prototype.__ndFile = CHILD_FILE;

ModuleFactory.addClass(CounterChildHot);
Nodom.hotReload(HotApp, "#app", hotState, ["C:/demo/CounterChild.nd"]);
Renderer.flush();

const rootAfter = ModuleFactory.getMain();
const childAfter = rootAfter.children[0];

assert.equal(rootAfter.id, rootId);
assert.notEqual(childAfter.id, childBefore.id);
assert.equal(text("#title"), "warm-root");
assert.equal(text("#child-version"), "hot");
assert.equal(text("#child-count"), "2");

document.querySelector("#child-inc").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();

assert.equal(text("#child-count"), "3");

rootAfter.destroy();

console.log("hmr smoke test passed");
