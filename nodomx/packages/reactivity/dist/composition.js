const targetMap = new WeakMap();
const reactiveMap = new WeakMap();
const rawToReactiveMap = new WeakMap();
let activeEffect;
const effectStack = [];
let currentScope;
let bindingNotifier;
class ReactiveEffect {
    constructor(fn, scheduler) {
        this.fn = fn;
        this.scheduler = scheduler;
        this.active = true;
        this.deps = [];
    }
    run() {
        if (!this.active) {
            return this.fn();
        }
        cleanupEffect(this);
        try {
            effectStack.push(this);
            activeEffect = this;
            return this.fn();
        }
        finally {
            effectStack.pop();
            activeEffect = effectStack[effectStack.length - 1];
        }
    }
    stop() {
        if (!this.active) {
            return;
        }
        cleanupEffect(this);
        this.active = false;
    }
}
class StateRefImpl {
    constructor(value) {
        this.bindings = [];
        this.rawValue = value;
        this.innerValue = toReactiveValue(value, this);
    }
    get value() {
        track(this, "value");
        return this.innerValue;
    }
    set value(value) {
        if (Object.is(value, this.rawValue)) {
            return;
        }
        const oldValue = this.innerValue;
        removeReactiveOwner(oldValue, this);
        this.rawValue = value;
        this.innerValue = toReactiveValue(value, this);
        trigger(this, "value");
        notifyBindings(this.bindings, oldValue, this.innerValue);
    }
    notifyBindingChange(oldValue, newValue) {
        trigger(this, "value");
        notifyBindings(this.bindings, oldValue, newValue);
    }
    addBinding(model, key) {
        addBinding(this.bindings, model, key);
    }
    removeBinding(model, key) {
        removeBinding(this.bindings, model, key);
    }
}
class ComputedRefImpl {
    constructor(getter, setter) {
        this.getter = getter;
        this.setter = setter;
        this.bindings = [];
        this.dirty = true;
        this.runner = createEffect(() => this.getter(), () => {
            if (this.dirty) {
                return;
            }
            const oldValue = this.innerValue;
            this.dirty = true;
            trigger(this, "value");
            if (this.bindings.length > 0) {
                const newValue = this.value;
                notifyBindings(this.bindings, oldValue, newValue);
            }
        }, true);
    }
    get value() {
        track(this, "value");
        if (this.dirty) {
            this.innerValue = this.runner();
            this.dirty = false;
        }
        return this.innerValue;
    }
    set value(value) {
        if (!this.setter) {
            return;
        }
        this.setter(value);
    }
    addBinding(model, key) {
        addBinding(this.bindings, model, key);
    }
    removeBinding(model, key) {
        removeBinding(this.bindings, model, key);
    }
}
function cleanupEffect(effect) {
    if (effect.deps.length === 0) {
        return;
    }
    for (const dep of effect.deps) {
        dep.delete(effect);
    }
    effect.deps.length = 0;
}
function createEffect(fn, scheduler, lazy) {
    const effect = new ReactiveEffect(fn, scheduler);
    const runner = effect.run.bind(effect);
    runner.effect = effect;
    if (!lazy) {
        runner();
    }
    return runner;
}
function addBinding(bindings, model, key) {
    if (bindings.find(item => item.model === model && item.key === key)) {
        return;
    }
    bindings.push({ model, key });
}
function removeBinding(bindings, model, key) {
    const index = bindings.findIndex(item => item.model === model && item.key === key);
    if (index !== -1) {
        bindings.splice(index, 1);
    }
}
function notifyBindings(bindings, oldValue, newValue) {
    for (const binding of bindings) {
        trigger(binding.model, binding.key);
        bindingNotifier === null || bindingNotifier === void 0 ? void 0 : bindingNotifier(binding.model, binding.key, oldValue, newValue);
    }
}
function mergeBuckets(targetBucket, fromBucket) {
    if (!fromBucket || targetBucket === fromBucket) {
        return targetBucket;
    }
    for (const binding of fromBucket.bindings) {
        addBinding(targetBucket.bindings, binding.model, binding.key);
    }
    for (const owner of fromBucket.owners) {
        if (!targetBucket.owners.includes(owner)) {
            targetBucket.owners.push(owner);
        }
    }
    return targetBucket;
}
function isObject(value) {
    return value !== null && typeof value === "object";
}
function createBucket(owner) {
    return {
        bindings: [],
        owners: owner ? [owner] : []
    };
}
function getReactiveMeta(target) {
    if (!isObject(target)) {
        return;
    }
    return reactiveMap.get(target);
}
function notifyBucket(bucket, value) {
    for (const owner of bucket.owners) {
        owner.notifyBindingChange(value, value);
    }
    notifyBindings(bucket.bindings, value, value);
}
function toReactiveValue(value, owner) {
    if (!isObject(value)) {
        return value;
    }
    return createReactiveObject(value, undefined, owner);
}
function resolveValue(source, deep) {
    let value;
    if (isRef(source) || isComputed(source)) {
        value = source.value;
    }
    else if (typeof source === "function") {
        value = source();
    }
    else {
        value = source;
    }
    return deep ? traverse(value) : value;
}
function traverse(value, seen = new Set()) {
    if (!isObject(value) || seen.has(value)) {
        return value;
    }
    seen.add(value);
    for (const key of Object.keys(value)) {
        traverse(value[key], seen);
    }
    return value;
}
function recordCleanup(stop) {
    if (currentScope) {
        currentScope.addCompositionCleanup(stop);
    }
    return stop;
}
export function configureReactivityRuntime(options = {}) {
    bindingNotifier = options.notifyBindingUpdate;
}
export function track(target, key) {
    if (!activeEffect) {
        return;
    }
    let depsMap = targetMap.get(target);
    if (!depsMap) {
        depsMap = new Map();
        targetMap.set(target, depsMap);
    }
    let dep = depsMap.get(key);
    if (!dep) {
        dep = new Set();
        depsMap.set(key, dep);
    }
    if (dep.has(activeEffect)) {
        return;
    }
    dep.add(activeEffect);
    activeEffect.deps.push(dep);
}
export function trigger(target, key) {
    const depsMap = targetMap.get(target);
    if (!depsMap) {
        return;
    }
    const dep = depsMap.get(key);
    if (!dep || dep.size === 0) {
        return;
    }
    const effects = Array.from(dep);
    for (const effect of effects) {
        if (effect.scheduler) {
            effect.scheduler();
        }
        else {
            effect.run();
        }
    }
}
function createReactiveObject(target, bucket, owner) {
    const existedProxy = rawToReactiveMap.get(target);
    if (existedProxy) {
        const existedMeta = reactiveMap.get(existedProxy);
        if (existedMeta) {
            if (bucket && existedMeta.bucket !== bucket) {
                mergeBuckets(bucket, existedMeta.bucket);
                existedMeta.bucket = bucket;
            }
            if (owner && !existedMeta.bucket.owners.includes(owner)) {
                existedMeta.bucket.owners.push(owner);
            }
        }
        return existedProxy;
    }
    const existedMeta = reactiveMap.get(target);
    if (existedMeta) {
        if (bucket && existedMeta.bucket !== bucket) {
            mergeBuckets(bucket, existedMeta.bucket);
            existedMeta.bucket = bucket;
        }
        if (owner && !existedMeta.bucket.owners.includes(owner)) {
            existedMeta.bucket.owners.push(owner);
        }
        return target;
    }
    const sharedBucket = bucket || createBucket(owner);
    if (bucket && owner && !bucket.owners.includes(owner)) {
        bucket.owners.push(owner);
    }
    const proxy = new Proxy(target, {
        get(src, key, receiver) {
            const value = Reflect.get(src, key, receiver);
            track(proxy, key);
            if (isRef(value) || isComputed(value)) {
                return value.value;
            }
            if (isObject(value)) {
                return createReactiveObject(value, sharedBucket);
            }
            return value;
        },
        set(src, key, value, receiver) {
            const oldValue = Reflect.get(src, key, receiver);
            if (Object.is(oldValue, value)) {
                return true;
            }
            const result = Reflect.set(src, key, value, receiver);
            trigger(proxy, key);
            notifyBucket(sharedBucket, proxy);
            return result;
        },
        deleteProperty(src, key) {
            const hasKey = Reflect.has(src, key);
            const result = Reflect.deleteProperty(src, key);
            if (hasKey) {
                trigger(proxy, key);
                notifyBucket(sharedBucket, proxy);
            }
            return result;
        }
    });
    const meta = {
        bucket: sharedBucket,
        proxy,
        raw: target
    };
    reactiveMap.set(proxy, meta);
    rawToReactiveMap.set(target, proxy);
    return proxy;
}
export function reactive(target) {
    return createReactiveObject(target);
}
export function useReactive(target) {
    return reactive(target);
}
export function useState(value) {
    return new StateRefImpl(value);
}
export function useRef(value) {
    return useState(value);
}
export function useComputed(getter) {
    if (typeof getter === "function") {
        return new ComputedRefImpl(getter);
    }
    return new ComputedRefImpl(getter.get, getter.set);
}
export function useWatch(source, callback, options = {}) {
    let cleanup;
    const getter = () => {
        if (Array.isArray(source)) {
            return source.map(item => resolveValue(item, options.deep));
        }
        return resolveValue(source, options.deep);
    };
    const onCleanup = (fn) => {
        cleanup = fn;
    };
    let initialized = false;
    let oldValue;
    let runner;
    const job = () => {
        const newValue = runner();
        if (!initialized) {
            initialized = true;
            oldValue = newValue;
            if (options.immediate) {
                callback(newValue, undefined, onCleanup);
            }
            return;
        }
        if (!options.deep && Object.is(newValue, oldValue)) {
            return;
        }
        if (cleanup) {
            cleanup();
            cleanup = undefined;
        }
        callback(newValue, oldValue, onCleanup);
        oldValue = newValue;
    };
    runner = createEffect(getter, job, true);
    job();
    const stop = () => {
        if (cleanup) {
            cleanup();
            cleanup = undefined;
        }
        runner.effect.stop();
    };
    return recordCleanup(stop);
}
export function useWatchEffect(effect) {
    let cleanup;
    const onCleanup = (fn) => {
        cleanup = fn;
    };
    let runner;
    const job = () => {
        if (cleanup) {
            cleanup();
            cleanup = undefined;
        }
        runner();
    };
    runner = createEffect(() => effect(onCleanup), job, true);
    job();
    const stop = () => {
        if (cleanup) {
            cleanup();
            cleanup = undefined;
        }
        runner.effect.stop();
    };
    return recordCleanup(stop);
}
export function toValue(value) {
    if (isRef(value) || isComputed(value)) {
        return value.value;
    }
    return value;
}
export function isRef(value) {
    return value instanceof StateRefImpl;
}
export function isComputed(value) {
    return value instanceof ComputedRefImpl;
}
export function isReactive(value) {
    return !!getReactiveMeta(value);
}
export function unwrapState(value) {
    if (isRef(value) || isComputed(value)) {
        return value.value;
    }
    return value;
}
export function shouldSkipModelProxy(value) {
    return isRef(value) || isComputed(value) || isReactive(value);
}
export function bindStateHost(value, model, key) {
    if (isRef(value) || isComputed(value)) {
        value.addBinding(model, key);
        return;
    }
    const meta = getReactiveMeta(value);
    if (meta) {
        addBinding(meta.bucket.bindings, model, key);
    }
}
export function unbindStateHost(value, model, key) {
    if (isRef(value) || isComputed(value)) {
        value.removeBinding(model, key);
        return;
    }
    const meta = getReactiveMeta(value);
    if (meta) {
        removeBinding(meta.bucket.bindings, model, key);
    }
}
export function removeReactiveOwner(value, owner) {
    const meta = getReactiveMeta(value);
    if (!meta) {
        return;
    }
    const index = meta.bucket.owners.indexOf(owner);
    if (index !== -1) {
        meta.bucket.owners.splice(index, 1);
    }
}
export function withCurrentScope(scope, handler) {
    const previous = currentScope;
    currentScope = scope;
    try {
        return handler();
    }
    finally {
        currentScope = previous;
    }
}
export function getCurrentScope() {
    return currentScope;
}
export function toRaw(value) {
    const meta = getReactiveMeta(value);
    return meta ? meta.raw : value;
}
export function cloneStateValue(value) {
    if (typeof globalThis.structuredClone === "function") {
        return globalThis.structuredClone(value);
    }
    return deepClone(value, new WeakMap());
}
function deepClone(value, seen) {
    if (!isObject(value)) {
        return value;
    }
    const raw = toRaw(value);
    if (!isObject(raw)) {
        return raw;
    }
    if (seen.has(raw)) {
        return seen.get(raw);
    }
    if (Array.isArray(raw)) {
        const arr = [];
        seen.set(raw, arr);
        for (const item of raw) {
            arr.push(deepClone(item, seen));
        }
        return arr;
    }
    const result = {};
    seen.set(raw, result);
    for (const key of Reflect.ownKeys(raw)) {
        result[key] = deepClone(raw[key], seen);
    }
    return result;
}
export const ref = useRef;
export const computed = useComputed;
export const watch = useWatch;
export const watchEffect = useWatchEffect;
export const unref = toValue;
//# sourceMappingURL=composition.js.map