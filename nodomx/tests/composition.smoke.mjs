import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const { window } = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
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
    defineProps,
    inject,
    onInit,
    onMounted,
    useComputed,
    useReactive,
    useState,
    useWatch,
    useWatchEffect,
    withDefaults
} = await import("../dist/nodom.esm.js");

const watchValues = [];
const effectValues = [];

class CompositionSmokeModule extends Module {
    template() {
        return `
            <div id="composition-smoke">
                <p id="count">{{count}}</p>
                <p id="double">{{doubleCount}}</p>
                <p id="name">{{profile.name}}</p>
                <p id="visits">{{profile.visits}}</p>
                <p id="summary">{{summary}}</p>
                <button id="increase" e-click="increase">increase</button>
                <button id="rename" e-click="rename">rename</button>
            </div>
        `;
    }

    setup() {
        const count = useState(1);
        const profile = useReactive({
            name: "nodomx",
            visits: 0
        });
        const doubleCount = useComputed(() => count.value * 2);
        const summary = useComputed(() => `${profile.name}:${count.value}:${profile.visits}`);

        useWatch(count, (value) => {
            watchValues.push(value);
        });

        useWatchEffect(() => {
            effectValues.push(summary.value);
        });

        return {
            count,
            doubleCount,
            profile,
            summary,
            increase() {
                count.value++;
                profile.visits++;
            },
            rename() {
                profile.name = "composition";
            }
        };
    }
}

function text(selector) {
    return document.querySelector(selector)?.textContent?.trim();
}

Renderer.setRootEl(document.body);
const moduleInstance = ModuleFactory.get(CompositionSmokeModule);
moduleInstance.active();
Renderer.render();

assert.equal(text("#count"), "1");
assert.equal(text("#double"), "2");
assert.equal(text("#name"), "nodomx");
assert.equal(text("#visits"), "0");
assert.equal(text("#summary"), "nodomx:1:0");

document.querySelector("#increase").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.render();

assert.equal(text("#count"), "2");
assert.equal(text("#double"), "4");
assert.equal(text("#visits"), "1");
assert.equal(text("#summary"), "nodomx:2:1");

document.querySelector("#rename").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.render();

assert.equal(text("#name"), "composition");
assert.equal(text("#summary"), "composition:2:1");
assert.deepEqual(watchValues, [2]);
assert.ok(effectValues.includes("nodomx:1:0"));
assert.ok(effectValues.includes("nodomx:2:1"));
assert.ok(effectValues.includes("composition:2:1"));

const hotState = moduleInstance.captureSetupState();
assert.deepEqual(hotState, {
    count: 2,
    profile: {
        name: "composition",
        visits: 1
    }
});

moduleInstance.destroy();

class CompositionHotModule extends Module {
    template() {
        return `
            <div id="composition-smoke">
                <p id="count">{{count}}</p>
                <p id="double">{{doubleCount}}</p>
                <p id="name">{{profile.name}}</p>
                <p id="visits">{{profile.visits}}</p>
                <p id="summary">{{summary}}</p>
            </div>
        `;
    }

    setup() {
        const count = useState(99);
        const profile = useReactive({
            name: "fresh",
            visits: 9
        });
        const doubleCount = useComputed(() => count.value * 2);
        const summary = useComputed(() => `${profile.name}:${count.value}:${profile.visits}`);

        return {
            count,
            doubleCount,
            profile,
            summary
        };
    }
}

CompositionHotModule.__nodomHotState = hotState;
const hotModuleInstance = ModuleFactory.get(CompositionHotModule);
hotModuleInstance.active();
Renderer.render();

assert.equal(text("#count"), "2");
assert.equal(text("#double"), "4");
assert.equal(text("#name"), "composition");
assert.equal(text("#visits"), "1");
assert.equal(text("#summary"), "composition:2:1");

hotModuleInstance.destroy();

const appEvents = [];
const demoPlugin = {
    install(app) {
        app.config.globalProperties.$formatCount = (value) => `count:${value}`;
        app.provide("sharedLabel", "plugin-shared");
    }
};

class AppApiModule extends Module {
    template() {
        return `
            <div id="app-api">
                <p id="provided">{{sharedLabel}}</p>
                <p id="formatted">{{$formatCount(count)}}</p>
                <p id="defaulted">{{propsLabel}}</p>
            </div>
        `;
    }

    setup() {
        const count = useState(3);
        const props = withDefaults(defineProps(), {
            label: "default label"
        });
        const sharedLabel = inject("sharedLabel", "fallback");

        onInit(() => {
            appEvents.push("init");
        });

        onMounted(() => {
            appEvents.push("mounted");
        });

        return {
            count,
            propsLabel: props.label,
            sharedLabel
        };
    }
}

Nodom.use(demoPlugin);
document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const app = Nodom.createApp(AppApiModule);
ModuleFactory.setAppContext(app.context);
const appModule = ModuleFactory.get(AppApiModule);
appModule.active();
Renderer.render();

assert.equal(text("#provided"), "plugin-shared");
assert.equal(text("#formatted"), "count:3");
assert.equal(text("#defaulted"), "default label");
assert.deepEqual(appEvents, ["init", "mounted"]);

appModule.destroy();
ModuleFactory.setAppContext(undefined);

console.log("composition smoke test passed");
