import {
    cloneStateValue,
    computed,
    isComputed,
    isReactive,
    isRef,
    reactive,
    toRaw,
    watch
} from "nodomx";

const NODOM_STORE_KEY = Symbol("nodomx.store");

let activeStore = null;
let defaultStore = null;

export function createStore() {
    return {
        _app: null,
        _stores: new Map(),
        install(app) {
            this._app = app;
            setActiveStore(this);
            if (typeof app?.provide === "function") {
                app.provide(NODOM_STORE_KEY, this);
            }
            if (app?.config?.globalProperties) {
                app.config.globalProperties.$store = this;
            }
            return this;
        }
    };
}

export function setActiveStore(store) {
    activeStore = store || getDefaultStore();
    return activeStore;
}

export function getActiveStore() {
    return activeStore || getDefaultStore();
}

export function defineStore(id, definition) {
    if (!id || typeof id !== "string") {
        throw new TypeError("defineStore(id, definition) requires a string id.");
    }
    if (typeof definition !== "function" && (!definition || typeof definition !== "object")) {
        throw new TypeError(`Store definition for "${id}" must be a setup function or an options object.`);
    }

    return function useDefinedStore(storeContainer = getActiveStore()) {
        const container = storeContainer || getDefaultStore();
        if (!container?._stores) {
            throw new Error(`Unable to resolve a store container for "${id}".`);
        }
        if (container._stores.has(id)) {
            return container._stores.get(id);
        }

        const store = typeof definition === "function"
            ? createSetupStore(id, definition, container)
            : createOptionsStore(id, definition, container);

        container._stores.set(id, store);
        return store;
    };
}

export function storeToRefs(store) {
    const refs = {};
    if (!store || typeof store !== "object") {
        return refs;
    }
    for (const key of Object.keys(store)) {
        if (key.startsWith("$") || typeof store[key] === "function") {
            continue;
        }
        refs[key] = computed({
            get: () => store[key],
            set: value => {
                store[key] = value;
            }
        });
    }
    return refs;
}

export { NODOM_STORE_KEY };

function createOptionsStore(id, definition, container) {
    const rawStore = {};
    const stateFactory = typeof definition.state === "function" ? definition.state : () => ({});
    const initialState = stateFactory() || {};
    for (const [key, value] of Object.entries(initialState)) {
        rawStore[key] = value;
    }

    const store = finalizeStoreProxy(id, rawStore, container);

    for (const [key, getter] of Object.entries(definition.getters || {})) {
        rawStore[key] = computed(() => getter.length > 0 ? getter.call(store, store) : getter.call(store));
    }

    for (const [key, action] of Object.entries(definition.actions || {})) {
        rawStore[key] = (...args) => action.apply(store, args);
    }

    attachStoreMeta(store, rawStore, id, container);
    return store;
}

function createSetupStore(id, setup, container) {
    const rawResult = setup();
    if (!rawResult || typeof rawResult !== "object") {
        throw new TypeError(`Setup store "${id}" must return an object.`);
    }
    const rawStore = rawResult;
    const store = finalizeStoreProxy(id, rawStore, container);
    attachStoreMeta(store, rawStore, id, container);
    return store;
}

function finalizeStoreProxy(id, rawStore, container) {
    const reactiveStore = reactive(rawStore);
    let store;
    store = new Proxy(reactiveStore, {
        get(target, key, receiver) {
            return Reflect.get(target, key, receiver);
        },
        set(target, key, value, receiver) {
            const current = rawStore[key];
            if (isWritableSignal(current)) {
                current.value = value;
                return true;
            }
            return Reflect.set(target, key, value, receiver);
        },
        deleteProperty(target, key) {
            const current = rawStore[key];
            if (isWritableSignal(current)) {
                current.value = undefined;
                return true;
            }
            return Reflect.deleteProperty(target, key);
        }
    });
    Object.defineProperty(rawStore, "$id", {
        enumerable: false,
        configurable: true,
        value: id
    });
    Object.defineProperty(rawStore, "$container", {
        enumerable: false,
        configurable: true,
        value: container
    });
    return store;
}

function attachStoreMeta(store, rawStore, id, container) {
    const initialSnapshot = cloneStateValue(snapshotStoreState(rawStore));

    Object.defineProperty(rawStore, "$state", {
        enumerable: false,
        configurable: true,
        get() {
            return snapshotStoreState(rawStore);
        },
        set(value) {
            patchStoreState(store, rawStore, value || {});
        }
    });

    Object.defineProperty(rawStore, "$patch", {
        enumerable: false,
        configurable: true,
        value(patch) {
            if (typeof patch === "function") {
                patch(store);
                return store;
            }
            patchStoreState(store, rawStore, patch || {});
            return store;
        }
    });

    Object.defineProperty(rawStore, "$reset", {
        enumerable: false,
        configurable: true,
        value() {
            patchStoreState(store, rawStore, cloneStateValue(initialSnapshot), true);
            return store;
        }
    });

    Object.defineProperty(rawStore, "$subscribe", {
        enumerable: false,
        configurable: true,
        value(callback, options = {}) {
            return watch(
                () => buildSubscriptionSnapshot(rawStore, store),
                (value, oldValue) => {
                    callback?.(
                        {
                            storeId: id,
                            type: "direct"
                        },
                        cloneStateValue(snapshotForDelivery(value)),
                        cloneStateValue(snapshotForDelivery(oldValue))
                    );
                },
                {
                    deep: true,
                    ...options
                }
            );
        }
    });

    Object.defineProperty(rawStore, "$dispose", {
        enumerable: false,
        configurable: true,
        value() {
            container?._stores?.delete(id);
        }
    });
}

function getDefaultStore() {
    if (!defaultStore) {
        defaultStore = createStore();
    }
    return defaultStore;
}

function snapshotStoreState(rawStore) {
    const state = {};
    for (const key of Object.keys(rawStore)) {
        if (!isStateEntry(rawStore, key)) {
            continue;
        }
        state[key] = cloneSerializableValue(rawStore[key]);
    }
    return state;
}

function buildSubscriptionSnapshot(rawStore, store) {
    const state = {};
    for (const key of Object.keys(rawStore)) {
        if (!isStateEntry(rawStore, key)) {
            continue;
        }
        state[key] = store[key];
    }
    return state;
}

function snapshotForDelivery(value) {
    return value === undefined ? {} : value;
}

function patchStoreState(store, rawStore, patch, replace = false) {
    if (!patch || typeof patch !== "object") {
        return;
    }

    const nextKeys = new Set(Object.keys(patch));
    if (replace) {
        for (const key of Object.keys(rawStore)) {
            if (!isStateEntry(rawStore, key) || nextKeys.has(key)) {
                continue;
            }
            delete store[key];
        }
    }

    for (const [key, value] of Object.entries(patch)) {
        const current = rawStore[key];
        if (isWritableSignal(current)) {
            current.value = value;
            continue;
        }
        if (isReactive(current) && isPlainObject(value)) {
            replaceObject(current, value);
            continue;
        }
        store[key] = cloneSerializableValue(value);
    }
}

function replaceObject(target, next) {
    const nextKeys = new Set(Object.keys(next));
    for (const key of Object.keys(target)) {
        if (!nextKeys.has(key)) {
            delete target[key];
        }
    }
    for (const [key, value] of Object.entries(next)) {
        if (isReactive(target[key]) && isPlainObject(value)) {
            replaceObject(target[key], value);
            continue;
        }
        target[key] = cloneSerializableValue(value);
    }
}

function isStateEntry(rawStore, key) {
    if (typeof key !== "string" || key.startsWith("$")) {
        return false;
    }
    const value = rawStore[key];
    if (typeof value === "function" || isComputed(value)) {
        return false;
    }
    return true;
}

function readStateEntry(value) {
    if (isRef(value) || isComputed(value)) {
        return value.value;
    }
    return value;
}

function isWritableSignal(value) {
    return isRef(value) || isComputed(value);
}

function cloneSerializableValue(value) {
    const unwrapped = readStateEntry(value);
    if (isReactive(unwrapped)) {
        return cloneStateValue(toRaw(unwrapped));
    }
    if (Array.isArray(unwrapped) || isPlainObject(unwrapped)) {
        return cloneStateValue(unwrapped);
    }
    return unwrapped;
}

function isPlainObject(value) {
    return !!value && Object.prototype.toString.call(value) === "[object Object]";
}
