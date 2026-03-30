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
    defineAsyncComponent,
    defineModel,
    Module,
    ModuleFactory,
    Nodom,
    Renderer,
    defineEmits,
    defineExpose,
    defineProps,
    inject,
    onActivated,
    onAfterEnter,
    onAfterLeave,
    onBeforeEnter,
    onBeforeLeave,
    onBeforeMove,
    onDeactivated,
    onEnter,
    onEnterCancelled,
    onInit,
    onLeave,
    onLeaveCancelled,
    onMove,
    onMoveCancelled,
    onMounted,
    onAfterMove,
    onSuspenseError,
    onSuspenseFallback,
    onSuspensePending,
    onSuspenseRetry,
    onSuspenseResolve,
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

const emittedPayloads = [];

class EmitsChildModule extends Module {
    template() {
        return `
            <div>
                <button id="emit-save" e-click="fireSave">emit</button>
            </div>
        `;
    }

    setup() {
        const emit = defineEmits(["save"]);
        const exposedState = {
            name: "emit-child"
        };
        defineExpose(exposedState);

        return {
            fireSave() {
                emit("save", 7, "done");
            }
        };
    }
}

class EmitsParentModule extends Module {
    modules = [EmitsChildModule];

    template() {
        return `
            <div id="emit-parent">
                <EmitsChildModule onSave={{this.handleSave}} />
            </div>
        `;
    }

    setup() {
        return {
            handleSave(...args) {
                emittedPayloads.push(args);
            }
        };
    }
}

document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const emitsParent = ModuleFactory.get(EmitsParentModule);
emitsParent.active();
Renderer.render();

const emitsChild = emitsParent.children.find(child => child.constructor === EmitsChildModule);
assert.ok(emitsChild);
assert.deepEqual(emitsChild.exposed, {
    name: "emit-child"
});

document.querySelector("#emit-save").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.render();

assert.deepEqual(emittedPayloads, [[7, "done"]]);

emitsParent.destroy();

class ModelChildModule extends Module {
    template() {
        return `
            <div class="model-child">
                <p id="model-child-count">{{countModel}}</p>
                <button id="model-child-increase" e-click="increase">child +1</button>
            </div>
        `;
    }

    setup() {
        const countModel = defineModel("count", {
            default: 1
        });

        return {
            countModel,
            increase() {
                countModel.value += 1;
            }
        };
    }
}

class ModelParentModule extends Module {
    modules = [ModelChildModule];

    template() {
        return `
            <div id="model-parent">
                <p id="model-parent-count">{{count}}</p>
                <button id="model-parent-increase" e-click="increaseParent">parent +1</button>
                <ModelChildModule count={{count}} onUpdateCount={{this.syncCount}} />
            </div>
        `;
    }

    setup() {
        const count = useState(2);

        return {
            count,
            increaseParent() {
                count.value += 1;
            },
            syncCount(value) {
                count.value = value;
            }
        };
    }
}

document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const modelParent = ModuleFactory.get(ModelParentModule);
modelParent.active();
Renderer.flush();

assert.equal(text("#model-parent-count"), "2");
assert.equal(text("#model-child-count"), "2");

document.querySelector("#model-child-increase").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();

assert.equal(text("#model-parent-count"), "3");
assert.equal(text("#model-child-count"), "3");

document.querySelector("#model-parent-increase").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();

assert.equal(text("#model-parent-count"), "4");
assert.equal(text("#model-child-count"), "4");

modelParent.destroy();

class AsyncLoadingModule extends Module {
    template() {
        return `
            <div class="async-loading">
                <p id="async-state">loading</p>
            </div>
        `;
    }
}

class AsyncResolvedModule extends Module {
    template() {
        return `
            <div class="async-resolved">
                <p id="async-state">resolved</p>
            </div>
        `;
    }
}

const AsyncChildModule = defineAsyncComponent({
    delay: 0,
    loader: () => new Promise(resolve => {
        setTimeout(() => resolve(AsyncResolvedModule), 12);
    }),
    loadingComponent: AsyncLoadingModule
});

class AsyncParentModule extends Module {
    modules = [
        {
            name: "AsyncChild",
            module: AsyncChildModule
        }
    ];

    template() {
        return `
            <div id="async-parent">
                <AsyncChild />
            </div>
        `;
    }
}

document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const asyncParent = ModuleFactory.get(AsyncParentModule);
asyncParent.active();
Renderer.flush();

assert.equal(text("#async-state"), "loading");

await new Promise(resolve => setTimeout(resolve, 30));
Renderer.flush();

assert.equal(text("#async-state"), "resolved");

asyncParent.destroy();

class SuspenseResolvedModule extends Module {
    template() {
        return `
            <div class="suspense-resolved">
                <p id="suspense-async-state">resolved</p>
            </div>
        `;
    }
}

const SuspenseAsyncChild = defineAsyncComponent({
    delay: 0,
    loader: () => new Promise(resolve => {
        setTimeout(() => resolve(SuspenseResolvedModule), 24);
    })
});

class SuspenseFallbackModule extends Module {
    modules = [
        {
            name: "AsyncChild",
            module: SuspenseAsyncChild
        }
    ];

    template() {
        return `
            <div id="suspense-fallback-parent">
                <Suspense>
                    <AsyncChild />
                    <slot name="fallback">
                        <p id="suspense-fallback">loading</p>
                    </slot>
                </Suspense>
            </div>
        `;
    }
}

document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const suspenseFallbackParent = ModuleFactory.get(SuspenseFallbackModule);
suspenseFallbackParent.active();
Renderer.flush();
Renderer.flush();

assert.equal(text("#suspense-fallback"), "loading");
assert.equal(document.querySelector("#suspense-async-state"), null);

await new Promise(resolve => setTimeout(resolve, 60));
Renderer.flush();

assert.equal(text("#suspense-async-state"), "resolved");
assert.equal(document.querySelector("#suspense-fallback"), null);

suspenseFallbackParent.destroy();

const SuspenseDelayedChild = defineAsyncComponent({
    delay: 0,
    loader: () => new Promise(resolve => {
        setTimeout(() => resolve(SuspenseResolvedModule), 80);
    })
});

class SuspenseTimeoutModule extends Module {
    modules = [
        {
            name: "AsyncDelayedChild",
            module: SuspenseDelayedChild
        }
    ];

    template() {
        return `
            <div id="suspense-timeout-parent">
                <Suspense fallback="Please wait..." timeout="30">
                    <AsyncDelayedChild />
                </Suspense>
            </div>
        `;
    }
}

document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const suspenseTimeoutParent = ModuleFactory.get(SuspenseTimeoutModule);
suspenseTimeoutParent.active();
Renderer.flush();
Renderer.flush();

assert.equal(document.querySelector(".nd-suspense-fallback-text"), null);

await new Promise(resolve => setTimeout(resolve, 80));
Renderer.flush();

assert.equal(text(".nd-suspense-fallback-text"), "Please wait...");
assert.equal(document.querySelector("#suspense-async-state"), null);

await new Promise(resolve => setTimeout(resolve, 60));
Renderer.flush();

assert.equal(text("#suspense-async-state"), "resolved");
assert.equal(document.querySelector(".nd-suspense-fallback-text"), null);

suspenseTimeoutParent.destroy();

const SuspenseTransitionChild = defineAsyncComponent({
    delay: 0,
    loader: () => new Promise(resolve => {
        setTimeout(() => resolve(SuspenseResolvedModule), 54);
    })
});

class SuspenseTransitionModule extends Module {
    modules = [
        {
            name: "AsyncTransitionChild",
            module: SuspenseTransitionChild
        }
    ];

    template() {
        return `
            <div id="suspense-transition-parent">
                <Suspense
                    fallback="Loading with motion..."
                    branch-transition
                    transition-name="fade"
                    transition-duration="18"
                >
                    <AsyncTransitionChild />
                </Suspense>
            </div>
        `;
    }
}

document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const suspenseTransitionParent = ModuleFactory.get(SuspenseTransitionModule);
suspenseTransitionParent.active();
Renderer.flush();
Renderer.flush();

assert.equal(text(".nd-suspense-fallback-text"), "Loading with motion...");
assert.equal(document.querySelector(".nd-suspense-fallback")?.classList.contains("fade-enter-active"), true);

await new Promise(resolve => setTimeout(resolve, 26));
Renderer.flush();

assert.ok(document.querySelector(".nd-suspense-fallback"));

await new Promise(resolve => setTimeout(resolve, 40));
Renderer.flush();

assert.equal(document.querySelector(".nd-suspense-fallback")?.classList.contains("fade-leave-active"), true);

await new Promise(resolve => setTimeout(resolve, 40));
Renderer.flush();

assert.equal(text("#suspense-async-state"), "resolved");
assert.equal(document.querySelector(".nd-suspense-fallback"), null);

suspenseTransitionParent.destroy();

const suspenseHookEvents = [];
const SuspenseHookChild = defineAsyncComponent({
    delay: 0,
    loader: () => new Promise(resolve => {
        setTimeout(() => resolve(SuspenseResolvedModule), 42);
    })
});

class SuspenseHooksModule extends Module {
    modules = [
        {
            name: "AsyncHookChild",
            module: SuspenseHookChild
        }
    ];

    template() {
        return `
            <div id="suspense-hooks-parent">
                <Suspense fallback="Working..." timeout="12">
                    <AsyncHookChild />
                </Suspense>
            </div>
        `;
    }

    setup() {
        onSuspensePending((detail) => {
            suspenseHookEvents.push(`pending:${detail?.pendingCount}:${detail?.timeout}:${detail?.phase}:${detail?.sourceBoundaryId}`);
        });
        onSuspenseFallback((detail) => {
            suspenseHookEvents.push(`fallback:${detail?.pendingCount}:${detail?.timeout}:${detail?.phase}:${detail?.sourceBoundaryId}`);
        });
        onSuspenseResolve((detail) => {
            suspenseHookEvents.push(`resolve:${detail?.pendingCount}:${detail?.timeout}:${detail?.phase}:${detail?.sourceBoundaryId}`);
        });
        return {};
    }
}

document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const suspenseHooksParent = ModuleFactory.get(SuspenseHooksModule);
suspenseHooksParent.active();
Renderer.flush();
Renderer.flush();

assert.ok(suspenseHookEvents.some(item => /^pending:1:12:pending:\d+$/.test(item)));
assert.equal(document.querySelector(".nd-suspense-fallback-text"), null);

await new Promise(resolve => setTimeout(resolve, 20));
Renderer.flush();

assert.equal(text(".nd-suspense-fallback-text"), "Working...");
assert.ok(suspenseHookEvents.some(item => /^fallback:1:12:fallback:\d+$/.test(item)));

await new Promise(resolve => setTimeout(resolve, 60));
Renderer.flush();

assert.equal(text("#suspense-async-state"), "resolved");
assert.ok(suspenseHookEvents.some(item => /^resolve:0:0:resolved:\d+$/.test(item)));

suspenseHooksParent.destroy();

const suspenseErrorEvents = [];
const SuspenseRejectedChild = defineAsyncComponent({
    delay: 0,
    loader: () => new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Async exploded.")), 18);
    })
});

class SuspenseErrorModule extends Module {
    modules = [
        {
            name: "AsyncRejectedChild",
            module: SuspenseRejectedChild
        }
    ];

    template() {
        return `
            <div id="suspense-error-parent">
                <Suspense fallback="Retrying..." error="Load failed.">
                    <AsyncRejectedChild />
                </Suspense>
            </div>
        `;
    }

    setup() {
        onSuspensePending((detail) => {
            suspenseErrorEvents.push(`pending:${detail?.pendingCount}:${detail?.timeout}`);
        });
        onSuspenseError((detail) => {
            const message = detail?.error instanceof Error ? detail.error.message : String(detail?.error);
            suspenseErrorEvents.push(`error:${message}:${detail?.phase}:${detail?.sourceBoundaryId}`);
        });
        return {};
    }
}

document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const suspenseErrorParent = ModuleFactory.get(SuspenseErrorModule);
suspenseErrorParent.active();
Renderer.flush();
Renderer.flush();

assert.equal(text(".nd-suspense-fallback-text"), "Retrying...");
assert.ok(suspenseErrorEvents.includes("pending:1:0"));

await new Promise(resolve => setTimeout(resolve, 40));
Renderer.flush();

assert.equal(text(".nd-suspense-error-text"), "Load failed.");
assert.equal(document.querySelector(".nd-suspense-fallback-text"), null);
assert.ok(suspenseErrorEvents.some(item => /^error:Async exploded\.:error:\d+$/.test(item)));

suspenseErrorParent.destroy();

const NestedSuspenseChild = defineAsyncComponent({
    delay: 0,
    loader: () => new Promise(resolve => {
        setTimeout(() => resolve(SuspenseResolvedModule), 36);
    })
});

class InnerSuspenseBoundaryModule extends Module {
    modules = [
        {
            name: "NestedSuspenseChild",
            module: NestedSuspenseChild
        }
    ];

    template() {
        return `
            <Suspense fallback="Inner loading" timeout="0">
                <NestedSuspenseChild />
            </Suspense>
        `;
    }
}

class OuterSuspenseBoundaryModule extends Module {
    modules = [InnerSuspenseBoundaryModule];

    template() {
        return `
            <div id="outer-suspense-boundary">
                <Suspense fallback="Outer loading" timeout="0">
                    <InnerSuspenseBoundaryModule />
                </Suspense>
            </div>
        `;
    }
}

document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const outerSuspenseBoundary = ModuleFactory.get(OuterSuspenseBoundaryModule);
outerSuspenseBoundary.active();
Renderer.flush();
Renderer.flush();

assert.equal(document.body.textContent.includes("Outer loading"), false);
assert.equal(document.body.textContent.includes("Inner loading"), true);

await new Promise(resolve => setTimeout(resolve, 60));
Renderer.flush();

assert.equal(text("#suspense-async-state"), "resolved");
assert.equal(document.body.textContent.includes("Inner loading"), false);

outerSuspenseBoundary.destroy();

let suspenseRetryAttempt = 0;
const suspenseRetryEvents = [];
const SuspenseRetriableChild = defineAsyncComponent({
    delay: 0,
    loader: () => new Promise((resolve, reject) => {
        setTimeout(() => {
            suspenseRetryAttempt += 1;
            if (suspenseRetryAttempt === 1) {
                reject(new Error("Retry once"));
                return;
            }
            resolve(SuspenseResolvedModule);
        }, 16);
    })
});

class SuspenseRetryModule extends Module {
    modules = [
        {
            name: "AsyncRetryChild",
            module: SuspenseRetriableChild
        }
    ];

    template() {
        return `
            <div id="suspense-retry-parent">
                <button id="suspense-retry-button" e-click="retryLoad">retry</button>
                <Suspense fallback="Retrying..." error="Retry failed." retry-key={{retryKey}}>
                    <AsyncRetryChild />
                </Suspense>
            </div>
        `;
    }

    setup() {
        const retryKey = useState(0);
        onSuspenseRetry((detail) => {
            suspenseRetryEvents.push(`retry:${detail?.pendingCount}:${detail?.timeout}:${detail?.retryKey}`);
        });
        onSuspenseResolve((detail) => {
            suspenseRetryEvents.push(`resolve:${detail?.pendingCount}:${detail?.timeout}`);
        });
        return {
            retryKey,
            retryLoad() {
                retryKey.value += 1;
            }
        };
    }
}

document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const suspenseRetryParent = ModuleFactory.get(SuspenseRetryModule);
suspenseRetryParent.active();
Renderer.flush();
Renderer.flush();

await new Promise(resolve => setTimeout(resolve, 40));
Renderer.flush();

assert.equal(text(".nd-suspense-error-text"), "Retry failed.");
assert.equal(text("#suspense-async-state"), undefined);

document.querySelector("#suspense-retry-button").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();

assert.equal(document.querySelector(".nd-suspense-error-text"), null);
assert.ok(suspenseRetryEvents.includes("retry:1:0:1"));

await new Promise(resolve => setTimeout(resolve, 10));
Renderer.flush();

assert.equal(text(".nd-suspense-fallback-text"), "Retrying...");

await new Promise(resolve => setTimeout(resolve, 40));
Renderer.flush();

assert.equal(text("#suspense-async-state"), "resolved");
assert.equal(document.querySelector(".nd-suspense-fallback-text"), null);
assert.ok(suspenseRetryEvents.includes("resolve:0:0"));

suspenseRetryParent.destroy();

let nestedSuspenseRetryAttempt = 0;
const nestedSuspenseRetryEvents = [];
const NestedRetriableSuspenseChild = defineAsyncComponent({
    delay: 0,
    loader: () => new Promise((resolve, reject) => {
        setTimeout(() => {
            nestedSuspenseRetryAttempt += 1;
            if (nestedSuspenseRetryAttempt === 1) {
                reject(new Error("Nested retry once"));
                return;
            }
            resolve(SuspenseResolvedModule);
        }, 18);
    })
});

class NestedRetryInnerBoundaryModule extends Module {
    modules = [
        {
            name: "NestedRetriableSuspenseChild",
            module: NestedRetriableSuspenseChild
        }
    ];

    template() {
        return `
            <Suspense fallback="Inner retrying..." error="Inner failed.">
                <NestedRetriableSuspenseChild />
            </Suspense>
        `;
    }
}

class NestedRetryOuterBoundaryModule extends Module {
    modules = [NestedRetryInnerBoundaryModule];

    template() {
        return `
            <div id="nested-suspense-retry-parent">
                <button id="nested-suspense-retry-button" e-click="retryLoad">retry nested</button>
                <Suspense fallback="Outer retrying..." error="Outer failed." retry-key={{retryKey}}>
                    <NestedRetryInnerBoundaryModule />
                </Suspense>
            </div>
        `;
    }

    setup() {
        const retryKey = useState(0);

        onSuspenseError((detail) => {
            nestedSuspenseRetryEvents.push(`error:${detail?.nested ? "nested" : "own"}:${detail?.boundaryId}:${detail?.sourceBoundaryId}:${detail?.phase}`);
        });
        onSuspenseRetry((detail) => {
            nestedSuspenseRetryEvents.push(`retry:${detail?.nested ? "nested" : "own"}:${detail?.pendingCount}:${detail?.nestedRetryCount || 0}:${detail?.retryKey || ""}:${detail?.sourceBoundaryId}:${detail?.phase}`);
        });
        onSuspenseResolve((detail) => {
            nestedSuspenseRetryEvents.push(`resolve:${detail?.nested ? "nested" : "own"}:${detail?.pendingCount}:${detail?.boundaryId}:${detail?.sourceBoundaryId}:${detail?.phase}`);
        });

        return {
            retryKey,
            retryLoad() {
                retryKey.value += 1;
            }
        };
    }
}

document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const nestedRetryOuterBoundary = ModuleFactory.get(NestedRetryOuterBoundaryModule);
nestedRetryOuterBoundary.active();
Renderer.flush();
Renderer.flush();

await new Promise(resolve => setTimeout(resolve, 40));
Renderer.flush();

assert.equal(text(".nd-suspense-error-text"), "Inner failed.");
assert.equal(document.body.textContent.includes("Outer failed."), false);
assert.ok(nestedSuspenseRetryEvents.some(item => /^error:nested:\d+:\d+:error$/.test(item)));

document.querySelector("#nested-suspense-retry-button").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();

assert.equal(document.querySelector(".nd-suspense-error-text"), null);
assert.ok(nestedSuspenseRetryEvents.some(item => /^retry:nested:1:0:1:\d+:pending$/.test(item)));
assert.ok(nestedSuspenseRetryEvents.some(item => /^retry:nested:0:1:1:\d+:pending$/.test(item)));

await new Promise(resolve => setTimeout(resolve, 8));
Renderer.flush();

assert.equal(text(".nd-suspense-fallback-text"), "Inner retrying...");

await new Promise(resolve => setTimeout(resolve, 50));
Renderer.flush();

assert.equal(text("#suspense-async-state"), "resolved");
assert.equal(document.querySelector(".nd-suspense-fallback-text"), null);
assert.ok(nestedSuspenseRetryEvents.some(item => /^resolve:nested:0:\d+:\d+:resolved$/.test(item)));

nestedRetryOuterBoundary.destroy();

let suspenseSlotScopeAttempt = 0;
const SuspenseScopedSlotChild = defineAsyncComponent({
    delay: 0,
    loader: () => new Promise((resolve, reject) => {
        setTimeout(() => {
            suspenseSlotScopeAttempt += 1;
            if (suspenseSlotScopeAttempt === 1) {
                reject(new Error("Scoped slot failed."));
                return;
            }
            resolve(SuspenseResolvedModule);
        }, 16);
    })
});

class SuspenseScopedSlotModule extends Module {
    modules = [
        {
            name: "AsyncScopedSlotChild",
            module: SuspenseScopedSlotChild
        }
    ];

    template() {
        return `
            <div id="suspense-slot-scope-parent">
                <button id="suspense-slot-scope-retry" e-click="retryLoad">retry scoped slot</button>
                <Suspense retry-key={{retryKey}}>
                    <AsyncScopedSlotChild />
                    <slot name="fallback">
                        <p id="suspense-slot-fallback">{{prefix}}:{{phase}}:{{pendingCount}}:{{retryKey}}</p>
                    </slot>
                    <slot name="error">
                        <p id="suspense-slot-error">{{prefix}}:{{phase}}:{{errorMessage}}:{{retryKey}}</p>
                    </slot>
                </Suspense>
            </div>
        `;
    }

    setup() {
        const prefix = useState("slot-parent");
        const retryKey = useState(0);

        return {
            prefix,
            retryKey,
            retryLoad() {
                retryKey.value += 1;
            }
        };
    }
}

document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const suspenseScopedSlotParent = ModuleFactory.get(SuspenseScopedSlotModule);
suspenseScopedSlotParent.active();
Renderer.flush();
Renderer.flush();

assert.equal(text("#suspense-slot-fallback"), "slot-parent:fallback:1:0");

await new Promise(resolve => setTimeout(resolve, 40));
Renderer.flush();

assert.equal(text("#suspense-slot-error"), "slot-parent:error:Scoped slot failed.:0");

document.querySelector("#suspense-slot-scope-retry").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();

assert.equal(text("#suspense-slot-fallback"), "slot-parent:fallback:1:1");

await new Promise(resolve => setTimeout(resolve, 40));
Renderer.flush();

assert.equal(text("#suspense-async-state"), "resolved");
assert.equal(document.querySelector("#suspense-slot-fallback"), null);
assert.equal(document.querySelector("#suspense-slot-error"), null);

suspenseScopedSlotParent.destroy();

class KeepAliveChildModule extends Module {
    template() {
        return `
            <div class="keepalive-child">
                <p id="keepalive-count">{{count}}</p>
                <button id="keepalive-increase" e-click="increase">keepalive +1</button>
            </div>
        `;
    }

    setup() {
        const count = useState(1);

        return {
            count,
            increase() {
                count.value += 1;
            }
        };
    }
}

class KeepAliveParentModule extends Module {
    modules = [KeepAliveChildModule];

    template() {
        return `
            <div id="keepalive-parent">
                <button id="keepalive-toggle" e-click="toggle">toggle</button>
                <if cond={{show}}>
                    <KeepAlive>
                        <KeepAliveChildModule />
                    </KeepAlive>
                </if>
                <endif />
            </div>
        `;
    }

    setup() {
        const show = useState(true);

        return {
            show,
            toggle() {
                show.value = !show.value;
            }
        };
    }
}

document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const keepAliveParent = ModuleFactory.get(KeepAliveParentModule);
keepAliveParent.active();
Renderer.flush();

assert.equal(text("#keepalive-count"), "1");

document.querySelector("#keepalive-increase").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();

assert.equal(text("#keepalive-count"), "2");

document.querySelector("#keepalive-toggle").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();

assert.equal(document.querySelector("#keepalive-count"), null);

document.querySelector("#keepalive-toggle").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();

assert.equal(text("#keepalive-count"), "2");

keepAliveParent.destroy();

class KeepAliveIncludedModule extends Module {
    template() {
        return `
            <div class="keepalive-included">
                <p id="keepalive-include-count">{{count}}</p>
                <button id="keepalive-include-increase" e-click="increase">include +1</button>
            </div>
        `;
    }

    setup() {
        const count = useState(1);
        return {
            count,
            increase() {
                count.value += 1;
            }
        };
    }
}

class KeepAliveExcludedModule extends Module {
    template() {
        return `
            <div class="keepalive-excluded">
                <p id="keepalive-exclude-count">{{count}}</p>
                <button id="keepalive-exclude-increase" e-click="increase">exclude +1</button>
            </div>
        `;
    }

    setup() {
        const count = useState(10);
        return {
            count,
            increase() {
                count.value += 1;
            }
        };
    }
}

class KeepAlivePolicyParentModule extends Module {
    modules = [KeepAliveIncludedModule, KeepAliveExcludedModule];

    template() {
        return `
            <div id="keepalive-policy-parent">
                <button id="keepalive-policy-show-include" e-click="showInclude">show include</button>
                <button id="keepalive-policy-show-exclude" e-click="showExclude">show exclude</button>
                <KeepAlive include="KeepAliveIncludedModule" exclude="KeepAliveExcludedModule" max="1">
                    <KeepAliveIncludedModule x-if={{current === 'include'}} />
                    <KeepAliveExcludedModule x-if={{current === 'exclude'}} />
                </KeepAlive>
            </div>
        `;
    }

    setup() {
        const current = useState("include");
        return {
            current,
            showExclude() {
                current.value = "exclude";
            },
            showInclude() {
                current.value = "include";
            }
        };
    }
}

document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const keepAlivePolicyParent = ModuleFactory.get(KeepAlivePolicyParentModule);
keepAlivePolicyParent.active();
Renderer.flush();

assert.equal(text("#keepalive-include-count"), "1");

document.querySelector("#keepalive-include-increase").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();
assert.equal(text("#keepalive-include-count"), "2");

document.querySelector("#keepalive-policy-show-exclude").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();
assert.equal(text("#keepalive-exclude-count"), "10");

document.querySelector("#keepalive-exclude-increase").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();
assert.equal(text("#keepalive-exclude-count"), "11");

document.querySelector("#keepalive-policy-show-include").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();
assert.equal(text("#keepalive-include-count"), "2");

document.querySelector("#keepalive-policy-show-exclude").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();
assert.equal(text("#keepalive-exclude-count"), "10");

keepAlivePolicyParent.destroy();

class KeepAliveAlphaModule extends Module {
    template() {
        return `
            <div class="keepalive-alpha">
                <p id="keepalive-alpha-count">{{count}}</p>
                <button id="keepalive-alpha-increase" e-click="increase">alpha +1</button>
            </div>
        `;
    }

    setup() {
        const count = useState(1);
        return {
            count,
            increase() {
                count.value += 1;
            }
        };
    }
}

class KeepAliveBetaModule extends Module {
    template() {
        return `
            <div class="keepalive-beta">
                <p id="keepalive-beta-count">{{count}}</p>
                <button id="keepalive-beta-increase" e-click="increase">beta +1</button>
            </div>
        `;
    }

    setup() {
        const count = useState(10);
        return {
            count,
            increase() {
                count.value += 1;
            }
        };
    }
}

class KeepAliveGammaModule extends Module {
    template() {
        return `
            <div class="keepalive-gamma">
                <p id="keepalive-gamma-count">{{count}}</p>
            </div>
        `;
    }

    setup() {
        const count = useState(100);
        return {
            count
        };
    }
}

class KeepAliveMaxParentModule extends Module {
    modules = [KeepAliveAlphaModule, KeepAliveBetaModule, KeepAliveGammaModule];

    template() {
        return `
            <div id="keepalive-max-parent">
                <button id="keepalive-max-show-alpha" e-click="showAlpha">alpha</button>
                <button id="keepalive-max-show-beta" e-click="showBeta">beta</button>
                <button id="keepalive-max-show-gamma" e-click="showGamma">gamma</button>
                <KeepAlive max="1">
                    <KeepAliveAlphaModule x-if={{current === 'alpha'}} />
                    <KeepAliveBetaModule x-if={{current === 'beta'}} />
                    <KeepAliveGammaModule x-if={{current === 'gamma'}} />
                </KeepAlive>
            </div>
        `;
    }

    setup() {
        const current = useState("alpha");
        return {
            current,
            showAlpha() {
                current.value = "alpha";
            },
            showBeta() {
                current.value = "beta";
            },
            showGamma() {
                current.value = "gamma";
            }
        };
    }
}

document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const keepAliveMaxParent = ModuleFactory.get(KeepAliveMaxParentModule);
keepAliveMaxParent.active();
Renderer.flush();

assert.equal(text("#keepalive-alpha-count"), "1");

document.querySelector("#keepalive-alpha-increase").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();
assert.equal(text("#keepalive-alpha-count"), "2");

document.querySelector("#keepalive-max-show-beta").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();
assert.equal(text("#keepalive-beta-count"), "10");

document.querySelector("#keepalive-beta-increase").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();
assert.equal(text("#keepalive-beta-count"), "11");

document.querySelector("#keepalive-max-show-gamma").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();
assert.equal(text("#keepalive-gamma-count"), "100");

document.querySelector("#keepalive-max-show-alpha").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();
assert.equal(text("#keepalive-alpha-count"), "1");

keepAliveMaxParent.destroy();

class KeepAliveLifecycleChildModule extends Module {
    template() {
        return `
            <div class="keepalive-lifecycle-child">
                <p id="keepalive-lifecycle-count">{{count}}</p>
                <button id="keepalive-lifecycle-increase" e-click="increase">lifecycle +1</button>
            </div>
        `;
    }

    setup() {
        const count = useState(1);
        const hooks = [];

        onMounted(() => {
            hooks.push("mounted");
        });

        onActivated(() => {
            hooks.push("activated");
        });

        onDeactivated(() => {
            hooks.push("deactivated");
        });

        return {
            count,
            hooks,
            increase() {
                count.value += 1;
            }
        };
    }
}

class KeepAliveLifecycleParentModule extends Module {
    modules = [KeepAliveLifecycleChildModule];

    template() {
        return `
            <div id="keepalive-lifecycle-parent">
                <button id="keepalive-lifecycle-toggle" e-click="toggle">toggle</button>
                <KeepAlive>
                    <KeepAliveLifecycleChildModule x-if={{show}} />
                </KeepAlive>
            </div>
        `;
    }

    setup() {
        const show = useState(true);
        return {
            show,
            toggle() {
                show.value = !show.value;
            }
        };
    }
}

document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const keepAliveLifecycleParent = ModuleFactory.get(KeepAliveLifecycleParentModule);
keepAliveLifecycleParent.active();
Renderer.flush();

const keepAliveLifecycleChild = keepAliveLifecycleParent.children.find(
    child => child.constructor === KeepAliveLifecycleChildModule
);
assert.ok(keepAliveLifecycleChild);
assert.deepEqual(Array.from(keepAliveLifecycleChild.model.hooks), ["mounted", "activated"]);

document.querySelector("#keepalive-lifecycle-increase").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();
assert.equal(text("#keepalive-lifecycle-count"), "2");

document.querySelector("#keepalive-lifecycle-toggle").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();

assert.equal(document.querySelector("#keepalive-lifecycle-count"), null);
assert.deepEqual(Array.from(keepAliveLifecycleChild.model.hooks), ["mounted", "activated", "deactivated"]);

document.querySelector("#keepalive-lifecycle-toggle").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();

assert.equal(text("#keepalive-lifecycle-count"), "2");
assert.deepEqual(Array.from(keepAliveLifecycleChild.model.hooks), ["mounted", "activated", "deactivated", "activated"]);

keepAliveLifecycleParent.destroy();

class TransitionSmokeModule extends Module {
    template() {
        return `
            <div id="transition-smoke">
                <button id="transition-toggle" e-click="toggle">toggle</button>
                <if cond={{show}}>
                    <Transition name="fade" duration="18">
                        <p id="transition-panel">{{message}}</p>
                    </Transition>
                </if>
                <endif />
            </div>
        `;
    }

    setup() {
        const transitionHooks = [];
        const message = useState("animated");
        const show = useState(true);

        onBeforeEnter((el) => {
            transitionHooks.push(`before-enter:${el?.id || "unknown"}`);
        });
        onEnter((el) => {
            transitionHooks.push(`enter:${el?.id || "unknown"}`);
        });
        onAfterEnter((el) => {
            transitionHooks.push(`after-enter:${el?.id || "unknown"}`);
        });
        onBeforeLeave((el) => {
            transitionHooks.push(`before-leave:${el?.id || "unknown"}`);
        });
        onLeave((el) => {
            transitionHooks.push(`leave:${el?.id || "unknown"}`);
        });
        onAfterLeave((el) => {
            transitionHooks.push(`after-leave:${el?.id || "unknown"}`);
        });

        return {
            message,
            show,
            transitionHooks,
            toggle() {
                show.value = !show.value;
            }
        };
    }
}

document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const transitionModule = ModuleFactory.get(TransitionSmokeModule);
transitionModule.active();
Renderer.flush();

assert.equal(text("#transition-panel"), "animated");
assert.equal(document.querySelector("#transition-panel")?.classList.contains("fade-enter-active"), true);
assert.deepEqual(transitionModule.model.transitionHooks.slice(0, 1), ["before-enter:transition-panel"]);

await new Promise(resolve => setTimeout(resolve, 80));
Renderer.flush();

assert.ok(transitionModule.model.transitionHooks.includes("enter:transition-panel"));
assert.ok(transitionModule.model.transitionHooks.includes("after-enter:transition-panel"));

document.querySelector("#transition-toggle").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();

assert.equal(document.querySelector("#transition-panel")?.classList.contains("fade-leave-active"), true);

await new Promise(resolve => setTimeout(resolve, 100));
Renderer.flush();

assert.equal(document.querySelector("#transition-panel"), null);
assert.ok(transitionModule.model.transitionHooks.includes("before-leave:transition-panel"));
assert.ok(transitionModule.model.transitionHooks.includes("leave:transition-panel"));
assert.ok(transitionModule.model.transitionHooks.includes("after-leave:transition-panel"));

document.querySelector("#transition-toggle").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();

assert.equal(text("#transition-panel"), "animated");

transitionModule.destroy();

class TransitionCancelModule extends Module {
    template() {
        return `
            <div id="transition-cancel-smoke">
                <button id="transition-cancel-toggle" e-click="toggle">toggle</button>
                <if cond={{show}}>
                    <Transition name="fade" duration="24">
                        <p id="transition-cancel-panel">{{message}}</p>
                    </Transition>
                </if>
                <endif />
            </div>
        `;
    }

    setup() {
        const hooks = [];
        const message = useState("cancelable");
        const show = useState(true);

        onEnterCancelled((el) => {
            hooks.push(`enter-cancelled:${el?.id || "unknown"}`);
        });
        onLeaveCancelled((el) => {
            hooks.push(`leave-cancelled:${el?.id || "unknown"}`);
        });

        return {
            hooks,
            message,
            show,
            toggle() {
                show.value = !show.value;
            }
        };
    }
}

document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const transitionCancelModule = ModuleFactory.get(TransitionCancelModule);
transitionCancelModule.active();
Renderer.flush();

document.querySelector("#transition-cancel-toggle").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();

assert.ok(transitionCancelModule.model.hooks.includes("enter-cancelled:transition-cancel-panel"));
assert.equal(document.querySelector("#transition-cancel-panel")?.classList.contains("fade-leave-active"), true);

await new Promise(resolve => setTimeout(resolve, 8));
document.querySelector("#transition-cancel-toggle").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();

await new Promise(resolve => setTimeout(resolve, 70));
Renderer.flush();

assert.equal(text("#transition-cancel-panel"), "cancelable");

transitionCancelModule.destroy();

class TransitionGroupModule extends Module {
    template() {
        return `
            <div id="transition-group-smoke">
                <button id="transition-group-add" e-click="add">add</button>
                <button id="transition-group-remove" e-click="remove">remove</button>
                <button id="transition-group-reverse" e-click="reverse">reverse</button>
                <TransitionGroup name="fade" duration="18" move-duration="24">
                    <p
                        x-repeat={{items}}
                        key={{id}}
                        class="transition-group-item"
                        data-id={{id}}
                    >
                        {{label}}
                    </p>
                </TransitionGroup>
            </div>
        `;
    }

    setup() {
        const hooks = [];
        const items = useState([
            { id: 1, label: "one" },
            { id: 2, label: "two" },
            { id: 3, label: "three" }
        ]);

        onBeforeMove((el) => {
            hooks.push(`before-move:${el?.getAttribute("data-id") || "unknown"}`);
        });
        onMove((el) => {
            hooks.push(`move:${el?.getAttribute("data-id") || "unknown"}`);
        });
        onAfterMove((el) => {
            hooks.push(`after-move:${el?.getAttribute("data-id") || "unknown"}`);
        });
        onMoveCancelled((el) => {
            hooks.push(`move-cancelled:${el?.getAttribute("data-id") || "unknown"}`);
        });

        return {
            hooks,
            items,
            add() {
                items.value = [...items.value, { id: 4, label: "four" }];
            },
            remove() {
                items.value = items.value.filter(item => item.id !== 1);
            },
            reverse() {
                items.value = [...items.value].reverse();
            }
        };
    }
}

document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const transitionGroupModule = ModuleFactory.get(TransitionGroupModule);
transitionGroupModule.active();
Renderer.flush();

function patchTransitionGroupRects() {
    for (const element of document.querySelectorAll(".transition-group-item")) {
        element.getBoundingClientRect = () => {
            const parent = element.parentElement;
            const order = parent ? Array.from(parent.children).indexOf(element) : 0;
            const left = order * 18;
            const top = 0;
            return {
                bottom: top + 12,
                height: 12,
                left,
                right: left + 16,
                toJSON() {
                    return this;
                },
                top,
                width: 16,
                x: left,
                y: top
            };
        };
    }
}

patchTransitionGroupRects();

assert.equal(text('[data-id="1"]'), "one");
assert.equal(document.querySelector('[data-id="1"]')?.classList.contains("fade-enter-active"), true);

await new Promise(resolve => setTimeout(resolve, 80));
Renderer.flush();
patchTransitionGroupRects();

document.querySelector("#transition-group-reverse").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();
patchTransitionGroupRects();

await new Promise(resolve => setTimeout(resolve, 25));
Renderer.flush();
patchTransitionGroupRects();

assert.ok(document.querySelectorAll(".fade-move").length > 0);
assert.ok(transitionGroupModule.model.hooks.some(item => item.startsWith("before-move:")));
assert.ok(transitionGroupModule.model.hooks.some(item => item.startsWith("move:")));

document.querySelector("#transition-group-reverse").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();
patchTransitionGroupRects();

await new Promise(resolve => setTimeout(resolve, 70));
Renderer.flush();
patchTransitionGroupRects();

assert.ok(transitionGroupModule.model.hooks.some(item => item.startsWith("move-cancelled:")));
assert.ok(transitionGroupModule.model.hooks.some(item => item.startsWith("after-move:")));

document.querySelector("#transition-group-remove").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();

assert.equal(document.querySelector('[data-id="1"]')?.classList.contains("fade-leave-active"), true);

await new Promise(resolve => setTimeout(resolve, 100));
Renderer.flush();

assert.equal(document.querySelector('[data-id="1"]'), null);

document.querySelector("#transition-group-add").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();
patchTransitionGroupRects();

assert.equal(text('[data-id="4"]'), "four");
assert.equal(document.querySelector('[data-id="4"]')?.classList.contains("fade-enter-active"), true);

await new Promise(resolve => setTimeout(resolve, 80));
Renderer.flush();
patchTransitionGroupRects();

assert.equal(text('[data-id="4"]'), "four");

transitionGroupModule.destroy();

class CachedSuspenseResolvedModule extends Module {
    template() {
        return `
            <div class="cached-suspense-resolved">
                <p id="cached-suspense-state">resolved</p>
            </div>
        `;
    }
}

const CachedSuspenseAsyncChild = defineAsyncComponent({
    delay: 0,
    loader: () => new Promise(resolve => {
        setTimeout(() => resolve(CachedSuspenseResolvedModule), 44);
    })
});

class KeepAliveSuspenseTransitionParentModule extends Module {
    modules = [KeepAliveSuspenseTransitionPageModule];

    template() {
        return `
            <div id="keepalive-suspense-parent">
                <button id="keepalive-suspense-toggle" e-click="toggle">toggle</button>
                <KeepAlive>
                    <KeepAliveSuspenseTransitionPageModule x-if={{show}} />
                </KeepAlive>
            </div>
        `;
    }

    setup() {
        const show = useState(true);
        return {
            show,
            toggle() {
                show.value = !show.value;
            }
        };
    }
}

class KeepAliveSuspenseTransitionPageModule extends Module {
    modules = [
        {
            name: "AsyncCachedSuspenseChild",
            module: CachedSuspenseAsyncChild
        }
    ];

    template() {
        return `
            <Transition name="fade" duration="18">
                <div id="keepalive-suspense-page">
                    <p id="keepalive-suspense-hooks">{{hooksSummary}}</p>
                    <Suspense
                        fallback="Loading cached..."
                        branch-transition
                        transition-name="fade"
                        transition-duration="18"
                    >
                        <AsyncCachedSuspenseChild />
                    </Suspense>
                </div>
            </Transition>
        `;
    }

    setup() {
        const hooks = useState([]);
        const pushHook = (value) => {
            hooks.value = [...hooks.value, value];
        };
        const hooksSummary = useComputed(() => hooks.value.join("|"));

        onMounted(() => {
            pushHook("mounted");
        });
        onActivated(() => {
            pushHook("activated");
        });
        onDeactivated(() => {
            pushHook("deactivated");
        });
        onSuspensePending(() => {
            pushHook("pending");
        });
        onSuspenseFallback(() => {
            pushHook("fallback");
        });
        onSuspenseResolve(() => {
            pushHook("resolve");
        });

        return {
            hooksSummary
        };
    }
}

document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const keepAliveSuspenseParent = ModuleFactory.get(KeepAliveSuspenseTransitionParentModule);
keepAliveSuspenseParent.active();
Renderer.flush();
Renderer.flush();

assert.equal(text(".nd-suspense-fallback-text"), "Loading cached...");
assert.ok(text("#keepalive-suspense-hooks")?.includes("mounted"));
assert.ok(text("#keepalive-suspense-hooks")?.includes("activated"));
assert.ok(text("#keepalive-suspense-hooks")?.includes("pending"));
assert.ok(text("#keepalive-suspense-hooks")?.includes("fallback"));

document.querySelector("#keepalive-suspense-toggle").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();

await new Promise(resolve => setTimeout(resolve, 90));
Renderer.flush();

assert.equal(document.querySelector("#cached-suspense-state"), null);
assert.equal(document.querySelector(".nd-suspense-fallback"), null);

document.querySelector("#keepalive-suspense-toggle").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();
Renderer.flush();

const keepAliveSuspenseHooks = text("#keepalive-suspense-hooks") || "";
assert.equal(text("#cached-suspense-state"), "resolved");
assert.equal(document.querySelector(".nd-suspense-fallback"), null);
assert.ok(keepAliveSuspenseHooks.includes("deactivated"));
assert.ok(keepAliveSuspenseHooks.includes("resolve"));
assert.ok(keepAliveSuspenseHooks.endsWith("activated"));
assert.equal(keepAliveSuspenseHooks.split("fallback").length - 1, 1);

keepAliveSuspenseParent.destroy();

class TeleportSmokeModule extends Module {
    template() {
        return `
            <div id="teleport-smoke">
                <button id="teleport-switch" e-click="switchTarget">switch</button>
                <div id="teleport-source"></div>
                <div id="teleport-target-a"></div>
                <div id="teleport-target-b"></div>
                <Teleport to={{target}}>
                    <p id="teleported-content">{{message}}</p>
                </Teleport>
            </div>
        `;
    }

    setup() {
        const target = useState("#teleport-target-a");
        const message = useState("teleported");

        return {
            message,
            target,
            switchTarget() {
                target.value = target.value === "#teleport-target-a"
                    ? "#teleport-target-b"
                    : "#teleport-target-a";
                message.value = "moved";
            }
        };
    }
}

document.body.innerHTML = "";
Renderer.setRootEl(document.body);
const teleportModule = ModuleFactory.get(TeleportSmokeModule);
teleportModule.active();
Renderer.flush();

assert.equal(document.querySelector("#teleport-source #teleported-content"), null);
assert.equal(text("#teleport-target-a #teleported-content"), "teleported");
assert.equal(text("#teleport-target-b #teleported-content"), undefined);

document.querySelector("#teleport-switch").dispatchEvent(new window.Event("click", { bubbles: true }));
Renderer.flush();

assert.equal(text("#teleport-target-a #teleported-content"), undefined);
assert.equal(text("#teleport-target-b #teleported-content"), "moved");

teleportModule.destroy();

console.log("composition smoke test passed");
