
type TrackKey = string | number | symbol;
type BindingHost = {
    model: object;
    key: TrackKey;
};

type CleanupRegistrar = (cleanup: () => void) => void;

export type WatchStopHandle = () => void;

export type WatchSource<T = unknown> = Ref<T> | ComputedRef<T> | (() => T) | object;

export type WatchOptions = {
    immediate?: boolean;
    deep?: boolean;
};

export type WatchCallback<T = unknown> = (
    value: T,
    oldValue: T | undefined,
    onCleanup: CleanupRegistrar
) => void;

export interface Ref<T = unknown> {
    value: T;
}

export interface ComputedRef<T = unknown> {
    readonly value: T;
}

type EffectDep = Set<ReactiveEffect<unknown>>;
type ReactiveRunner<T = unknown> = (() => T) & {
    effect: ReactiveEffect<T>;
};

export interface BindingOwner {
    notifyBindingChange(oldValue: unknown, newValue: unknown): void;
}

type BindingBucket = {
    bindings: BindingHost[];
    owners: BindingOwner[];
};

type ReactiveMeta = {
    bucket: BindingBucket;
    proxy: object;
    raw: object;
};

type BindingNotifier = (
    model: object,
    key: TrackKey,
    oldValue: unknown,
    newValue: unknown
) => void;

export interface CompositionScope {
    addCompositionCleanup(cleanup: () => void): void;
}

const targetMap: WeakMap<object, Map<TrackKey, EffectDep>> = new WeakMap();
const reactiveMap: WeakMap<object, ReactiveMeta> = new WeakMap();
const rawToReactiveMap: WeakMap<object, object> = new WeakMap();

let activeEffect: ReactiveEffect<unknown> | undefined;
const effectStack: ReactiveEffect<unknown>[] = [];
let currentScope: CompositionScope | undefined;
let bindingNotifier: BindingNotifier | undefined;

class ReactiveEffect<T = unknown> {
    public active: boolean = true;
    public deps: EffectDep[] = [];

    constructor(public fn: () => T, public scheduler?: () => void) { }

    public run(): T {
        if (!this.active) {
            return this.fn();
        }
        cleanupEffect(this);
        try {
            effectStack.push(this);
            activeEffect = this;
            return this.fn();
        } finally {
            effectStack.pop();
            activeEffect = effectStack[effectStack.length - 1];
        }
    }

    public stop(): void {
        if (!this.active) {
            return;
        }
        cleanupEffect(this);
        this.active = false;
    }
}

class StateRefImpl<T = unknown> implements Ref<T>, BindingOwner {
    private bindings: BindingHost[] = [];
    private rawValue: T;
    private innerValue: T;

    constructor(value: T) {
        this.rawValue = value;
        this.innerValue = toReactiveValue(value, this);
    }

    public get value(): T {
        track(this, "value");
        return this.innerValue;
    }

    public set value(value: T) {
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

    public notifyBindingChange(oldValue: unknown, newValue: unknown): void {
        trigger(this, "value");
        notifyBindings(this.bindings, oldValue, newValue);
    }

    public addBinding(model: object, key: TrackKey): void {
        addBinding(this.bindings, model, key);
    }

    public removeBinding(model: object, key: TrackKey): void {
        removeBinding(this.bindings, model, key);
    }
}

class ComputedRefImpl<T = unknown> implements ComputedRef<T> {
    private bindings: BindingHost[] = [];
    private dirty: boolean = true;
    private innerValue!: T;
    private runner: ReactiveRunner<T>;

    constructor(
        private getter: () => T,
        private setter?: (value: T) => void
    ) {
        this.runner = createEffect(
            () => this.getter(),
            () => {
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
            },
            true
        );
    }

    public get value(): T {
        track(this, "value");
        if (this.dirty) {
            this.innerValue = this.runner();
            this.dirty = false;
        }
        return this.innerValue;
    }

    public set value(value: T) {
        if (!this.setter) {
            return;
        }
        this.setter(value);
    }

    public addBinding(model: object, key: TrackKey): void {
        addBinding(this.bindings, model, key);
    }

    public removeBinding(model: object, key: TrackKey): void {
        removeBinding(this.bindings, model, key);
    }
}

function cleanupEffect(effect: ReactiveEffect<unknown>): void {
    if (effect.deps.length === 0) {
        return;
    }
    for (const dep of effect.deps) {
        dep.delete(effect);
    }
    effect.deps.length = 0;
}

function createEffect<T>(
    fn: () => T,
    scheduler?: () => void,
    lazy?: boolean
): ReactiveRunner<T> {
    const effect = new ReactiveEffect<T>(fn, scheduler);
    const runner = effect.run.bind(effect) as ReactiveRunner<T>;
    runner.effect = effect;
    if (!lazy) {
        runner();
    }
    return runner;
}

function addBinding(bindings: BindingHost[], model: object, key: TrackKey): void {
    if (bindings.find(item => item.model === model && item.key === key)) {
        return;
    }
    bindings.push({ model, key });
}

function removeBinding(bindings: BindingHost[], model: object, key: TrackKey): void {
    const index = bindings.findIndex(item => item.model === model && item.key === key);
    if (index !== -1) {
        bindings.splice(index, 1);
    }
}

function notifyBindings(bindings: BindingHost[], oldValue: unknown, newValue: unknown): void {
    for (const binding of bindings) {
        trigger(binding.model, binding.key);
        bindingNotifier?.(binding.model, binding.key, oldValue, newValue);
    }
}

function mergeBuckets(targetBucket: BindingBucket, fromBucket?: BindingBucket): BindingBucket {
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

function isObject(value: unknown): value is object {
    return value !== null && typeof value === "object";
}

function createBucket(owner?: BindingOwner): BindingBucket {
    return {
        bindings: [],
        owners: owner ? [owner] : []
    };
}

function getReactiveMeta(target: unknown): ReactiveMeta | undefined {
    if (!isObject(target)) {
        return;
    }
    return reactiveMap.get(target);
}

function notifyBucket(bucket: BindingBucket, value: unknown): void {
    for (const owner of bucket.owners) {
        owner.notifyBindingChange(value, value);
    }
    notifyBindings(bucket.bindings, value, value);
}

function toReactiveValue<T>(value: T, owner?: BindingOwner): T {
    if (!isObject(value)) {
        return value;
    }
    return createReactiveObject(value, undefined, owner) as T;
}

function resolveValue<T>(source: WatchSource<T>, deep?: boolean): unknown {
    let value: unknown;
    if (isRef(source) || isComputed(source)) {
        value = source.value;
    } else if (typeof source === "function") {
        value = source();
    } else {
        value = source;
    }
    return deep ? traverse(value) : value;
}

function traverse<T>(value: T, seen: Set<unknown> = new Set()): T {
    if (!isObject(value) || seen.has(value)) {
        return value;
    }
    seen.add(value);
    for (const key of Object.keys(value)) {
        traverse((value as Record<string, unknown>)[key], seen);
    }
    return value;
}

function recordCleanup(stop: WatchStopHandle): WatchStopHandle {
    if (currentScope) {
        currentScope.addCompositionCleanup(stop);
    }
    return stop;
}

export function configureReactivityRuntime(options: {
    notifyBindingUpdate?: BindingNotifier;
} = {}): void {
    bindingNotifier = options.notifyBindingUpdate;
}

export function track(target: object, key: TrackKey): void {
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

export function trigger(target: object, key: TrackKey): void {
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
        } else {
            effect.run();
        }
    }
}

function createReactiveObject<T extends object>(
    target: T,
    bucket?: BindingBucket,
    owner?: BindingOwner
): T {
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
        return existedProxy as T;
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
        get(src: object, key: TrackKey, receiver: object): unknown {
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
        set(src: object, key: TrackKey, value: unknown, receiver: object): boolean {
            const oldValue = Reflect.get(src, key, receiver);
            if (Object.is(oldValue, value)) {
                return true;
            }
            const result = Reflect.set(src, key, value, receiver);
            trigger(proxy, key);
            notifyBucket(sharedBucket, proxy);
            return result;
        },
        deleteProperty(src: object, key: TrackKey): boolean {
            const hasKey = Reflect.has(src, key);
            const result = Reflect.deleteProperty(src, key);
            if (hasKey) {
                trigger(proxy, key);
                notifyBucket(sharedBucket, proxy);
            }
            return result;
        }
    });

    const meta: ReactiveMeta = {
        bucket: sharedBucket,
        proxy,
        raw: target
    };
    reactiveMap.set(proxy, meta);
    rawToReactiveMap.set(target, proxy);
    return proxy as T;
}

export function reactive<T extends object>(target: T): T {
    return createReactiveObject(target);
}

export function useReactive<T extends object>(target: T): T {
    return reactive(target);
}

export function useState<T>(value: T): Ref<T> {
    return new StateRefImpl(value);
}

export function useRef<T>(value: T): Ref<T> {
    return useState(value);
}

export function useComputed<T>(
    getter: (() => T) | { get: () => T; set?: (value: T) => void }
): ComputedRef<T> {
    if (typeof getter === "function") {
        return new ComputedRefImpl(getter);
    }
    return new ComputedRefImpl(getter.get, getter.set);
}

export function useWatch<T>(
    source: WatchSource<T> | Array<WatchSource<T>>,
    callback: WatchCallback<T>,
    options: WatchOptions = {}
): WatchStopHandle {
    let cleanup: () => void;
    const getter = () => {
        if (Array.isArray(source)) {
            return source.map(item => resolveValue(item, options.deep));
        }
        return resolveValue(source, options.deep);
    };

    const onCleanup: CleanupRegistrar = (fn: () => void) => {
        cleanup = fn;
    };

    let initialized = false;
    let oldValue: unknown;
    let runner: ReactiveRunner<unknown>;
    const job = () => {
        const newValue = runner();
        if (!initialized) {
            initialized = true;
            oldValue = newValue;
            if (options.immediate) {
                callback(newValue as T, undefined, onCleanup);
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
        callback(newValue as T, oldValue as T, onCleanup);
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

export function useWatchEffect(
    effect: (onCleanup: CleanupRegistrar) => void
): WatchStopHandle {
    let cleanup: () => void;
    const onCleanup: CleanupRegistrar = (fn: () => void) => {
        cleanup = fn;
    };
    let runner: ReactiveRunner<void>;
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

export function toValue<T>(value: T | Ref<T> | ComputedRef<T>): T {
    if (isRef(value) || isComputed(value)) {
        return value.value as T;
    }
    return value as T;
}

export function isRef(value: unknown): value is Ref<unknown> {
    return value instanceof StateRefImpl;
}

export function isComputed(value: unknown): value is ComputedRef<unknown> {
    return value instanceof ComputedRefImpl;
}

export function isReactive(value: unknown): value is object {
    return !!getReactiveMeta(value);
}

export function unwrapState(value: unknown): unknown {
    if (isRef(value) || isComputed(value)) {
        return value.value;
    }
    return value;
}

export function shouldSkipModelProxy(value: unknown): boolean {
    return isRef(value) || isComputed(value) || isReactive(value);
}

export function bindStateHost(value: unknown, model: object, key: TrackKey): void {
    if (isRef(value) || isComputed(value)) {
        (<StateRefImpl<unknown> | ComputedRefImpl<unknown>>value).addBinding(model, key);
        return;
    }
    const meta = getReactiveMeta(value);
    if (meta) {
        addBinding(meta.bucket.bindings, model, key);
    }
}

export function unbindStateHost(value: unknown, model: object, key: TrackKey): void {
    if (isRef(value) || isComputed(value)) {
        (<StateRefImpl<unknown> | ComputedRefImpl<unknown>>value).removeBinding(model, key);
        return;
    }
    const meta = getReactiveMeta(value);
    if (meta) {
        removeBinding(meta.bucket.bindings, model, key);
    }
}

export function removeReactiveOwner(value: unknown, owner: BindingOwner): void {
    const meta = getReactiveMeta(value);
    if (!meta) {
        return;
    }
    const index = meta.bucket.owners.indexOf(owner);
    if (index !== -1) {
        meta.bucket.owners.splice(index, 1);
    }
}

export function withCurrentScope<TScope extends CompositionScope, T>(scope: TScope, handler: () => T): T {
    const previous = currentScope;
    currentScope = scope;
    try {
        return handler();
    } finally {
        currentScope = previous;
    }
}

export function getCurrentScope<TScope extends CompositionScope = CompositionScope>(): TScope | undefined {
    return currentScope as TScope | undefined;
}

export function toRaw<T>(value: T): T {
    const meta = getReactiveMeta(value);
    return meta ? meta.raw as T : value;
}

export function cloneStateValue<T>(value: T): T {
    if (typeof globalThis.structuredClone === "function") {
        return globalThis.structuredClone(value);
    }
    return deepClone(value, new WeakMap()) as T;
}

function deepClone<T>(value: T, seen: WeakMap<object, unknown>): T {
    if (!isObject(value)) {
        return value;
    }
    const raw = toRaw(value);
    if (!isObject(raw)) {
        return raw as T;
    }
    if (seen.has(raw)) {
        return seen.get(raw) as T;
    }
    if (Array.isArray(raw)) {
        const arr: unknown[] = [];
        seen.set(raw, arr);
        for (const item of raw) {
            arr.push(deepClone(item, seen));
        }
        return arr as T;
    }
    const result: Record<string | number | symbol, unknown> = {};
    seen.set(raw, result);
    for (const key of Reflect.ownKeys(raw)) {
        result[key] = deepClone((raw as Record<string | number | symbol, unknown>)[key], seen);
    }
    return result as T;
}

export const ref = useRef;
export const computed = useComputed;
export const watch = useWatch;
export const watchEffect = useWatchEffect;
export const unref = toValue;

