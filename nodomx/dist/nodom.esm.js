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
function configureReactivityRuntime(options = {}) {
    bindingNotifier = options.notifyBindingUpdate;
}
function track(target, key) {
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
function trigger(target, key) {
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
function reactive(target) {
    return createReactiveObject(target);
}
function useReactive(target) {
    return reactive(target);
}
function useState(value) {
    return new StateRefImpl(value);
}
function useRef(value) {
    return useState(value);
}
function useComputed(getter) {
    if (typeof getter === "function") {
        return new ComputedRefImpl(getter);
    }
    return new ComputedRefImpl(getter.get, getter.set);
}
function useWatch(source, callback, options = {}) {
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
function useWatchEffect(effect) {
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
function toValue(value) {
    if (isRef(value) || isComputed(value)) {
        return value.value;
    }
    return value;
}
function isRef(value) {
    return value instanceof StateRefImpl;
}
function isComputed(value) {
    return value instanceof ComputedRefImpl;
}
function isReactive(value) {
    return !!getReactiveMeta(value);
}
function unwrapState(value) {
    if (isRef(value) || isComputed(value)) {
        return value.value;
    }
    return value;
}
function shouldSkipModelProxy(value) {
    return isRef(value) || isComputed(value) || isReactive(value);
}
function bindStateHost(value, model, key) {
    if (isRef(value) || isComputed(value)) {
        value.addBinding(model, key);
        return;
    }
    const meta = getReactiveMeta(value);
    if (meta) {
        addBinding(meta.bucket.bindings, model, key);
    }
}
function unbindStateHost(value, model, key) {
    if (isRef(value) || isComputed(value)) {
        value.removeBinding(model, key);
        return;
    }
    const meta = getReactiveMeta(value);
    if (meta) {
        removeBinding(meta.bucket.bindings, model, key);
    }
}
function removeReactiveOwner(value, owner) {
    const meta = getReactiveMeta(value);
    if (!meta) {
        return;
    }
    const index = meta.bucket.owners.indexOf(owner);
    if (index !== -1) {
        meta.bucket.owners.splice(index, 1);
    }
}
function withCurrentScope(scope, handler) {
    const previous = currentScope;
    currentScope = scope;
    try {
        return handler();
    }
    finally {
        currentScope = previous;
    }
}
function getCurrentScope() {
    return currentScope;
}
function toRaw(value) {
    const meta = getReactiveMeta(value);
    return meta ? meta.raw : value;
}
function cloneStateValue(value) {
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
const ref = useRef;
const computed = useComputed;
const watch = useWatch;
const watchEffect = useWatchEffect;
const unref = toValue;

function createAppContext(seed) {
    return {
        app: undefined,
        components: new Map((seed === null || seed === void 0 ? void 0 : seed.components) || []),
        config: {
            globalProperties: Object.assign({}, ((seed === null || seed === void 0 ? void 0 : seed.config.globalProperties) || {}))
        },
        directives: new Map((seed === null || seed === void 0 ? void 0 : seed.directives) || []),
        installedPlugins: new Set((seed === null || seed === void 0 ? void 0 : seed.installedPlugins) || []),
        provides: new Map((seed === null || seed === void 0 ? void 0 : seed.provides) || [])
    };
}

/**
 * 缓存模块
 */
class NCache {
    constructor() {
        /**
         * 缓存数据容器
         */
        this.cacheData = {};
        /**
         * 订阅map，格式为
         * ```js
         * {
         *  key:[{
         *      module:订阅模块,
         *      handler:回调钩子
         * },...]}
         * ```
         */
        this.subscribeMap = new Map();
    }
    /**
     * 通过提供的键名从内存中拿到对应的值
     * @param key - 键，支持"."（多级数据分割）
     * @returns 值或undefined
     */
    get(key) {
        let p = this.cacheData;
        if (key.indexOf('.') !== -1) {
            const arr = key.split('.');
            if (arr.length > 1) {
                for (let i = 0; i < arr.length - 1 && p; i++) {
                    p = p[arr[i]];
                }
                if (p) {
                    key = arr[arr.length - 1];
                }
            }
        }
        if (p) {
            return p[key];
        }
    }
    /**
     * 通过提供的键名和值将其存储在内存中
     * @param key - 键
     * @param value - 值
     */
    set(key, value) {
        let p = this.cacheData;
        const key1 = key;
        if (key.indexOf('.') !== -1) {
            const arr = key.split('.');
            if (arr.length > 1) {
                for (let i = 0; i < arr.length - 1; i++) {
                    if (!p[arr[i]] || typeof p[arr[i]] !== 'object') {
                        p[arr[i]] = {};
                    }
                    p = p[arr[i]];
                }
                key = arr[arr.length - 1];
            }
        }
        if (p) {
            p[key] = value;
        }
        if (this.subscribeMap.has(key1)) {
            const arr = this.subscribeMap.get(key1);
            for (const a of arr) {
                this.invokeSubscribe(a.module, a.handler, value);
            }
        }
    }
    /**
     * 通过提供的键名将其移除
     * @param key - 键
     */
    remove(key) {
        let p = this.cacheData;
        if (key.indexOf('.') !== -1) {
            const arr = key.split('.');
            if (arr.length > 1) {
                for (let i = 0; i < arr.length - 1 && p; i++) {
                    p = p[arr[i]];
                }
                if (p) {
                    key = arr[arr.length - 1];
                }
            }
        }
        if (p) {
            delete p[key];
        }
    }
    /**
     * 订阅
     * @param module - 订阅的模块
     * @param key - 订阅的属性名
     * @param handler - 回调函数或方法名
     */
    subscribe(module, key, handler) {
        if (!this.subscribeMap.has(key)) {
            this.subscribeMap.set(key, [{ module: module, handler: handler }]);
        }
        else {
            const arr = this.subscribeMap.get(key);
            if (!arr.find(item => item.module === module && item.handler === handler)) {
                arr.push({ module: module, handler: handler });
            }
        }
        const v = this.get(key);
        if (v) {
            this.invokeSubscribe(module, handler, v);
        }
    }
    /**
     * 调用订阅方法
     * @param module - 模块
     * @param foo - 方法或方法名
     * @param v - 值
     */
    invokeSubscribe(module, foo, v) {
        if (typeof foo === 'string') {
            module.invokeMethod(foo, v);
        }
        else {
            foo.call(module, v);
        }
    }
}

/*
* 英文消息文件
*/
const NodomMessage_en = {
    /**
     * tip words
     */
    TipWords: {
        application: "Application",
        system: "System",
        module: "Module",
        clazz: "类",
        moduleClass: 'ModuleClass',
        model: "Model",
        directive: "Directive",
        directiveType: "Directive-type",
        expression: "Expression",
        event: "Event",
        method: "Method",
        filter: "Filter",
        filterType: "Filter-type",
        data: "Data",
        dataItem: 'Data-item',
        route: 'Route',
        routeView: 'Route-container',
        plugin: 'Plugin',
        resource: 'Resource',
        root: 'Root',
        element: 'VirtualDom'
    },
    /**
     * error info
     */
    ErrorMsgs: {
        unknown: "unknown error",
        uninit: "{0}未初始化",
        paramException: "{0} '{1}' parameter error，see api",
        invoke: "method {0} parameter {1} must be {2}",
        invoke1: "method {0} parameter {1} must be {2} or {3}",
        invoke2: "method {0} parameter {1} or {2} must be {3}",
        invoke3: "method {0} parameter {1} not allowed empty",
        exist: "{0} is already exist",
        exist1: "{0} '{1}' is already exist",
        notexist: "{0} is not exist",
        notexist1: "{0} '{1}' is not exist",
        notupd: "{0} not allow to change",
        notremove: "{0} not allow to delete",
        notremove1: "{0} {1} not allow to delete",
        namedinvalid: "{0} {1} name error，see name rules",
        initial: "{0} init parameter error",
        jsonparse: "JSON parse error",
        timeout: "request overtime",
        config: "{0} config parameter error",
        config1: "{0} config parameter '{1}' error",
        itemnotempty: "{0} '{1}' config item '{2}' not allow empty",
        itemincorrect: "{0} '{1}' config item '{2}' error",
        needEndTag: "element {0} is not closed",
        needStartTag: "without start tag matchs {0}",
        tagError: "element {0} error",
        wrongTemplate: "wrong template",
        wrongExpression: "expression error: {0} "
    },
    WeekDays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
};

/*
* 中文消息文件
*/
const NodomMessage_zh = {
    /**
     * 提示单词
     */
    TipWords: {
        application: "应用",
        system: "系统",
        module: "模块",
        clazz: "类",
        moduleClass: '模块类',
        model: "模型",
        directive: "指令",
        directiveType: "指令类型",
        expression: "表达式",
        event: "事件",
        method: "方法",
        filter: "过滤器",
        filterType: "过滤器类型",
        data: "数据",
        dataItem: '数据项',
        route: '路由',
        routeView: '路由容器',
        plugin: '插件',
        resource: '资源',
        root: '根',
        element: '元素'
    },
    /**
     * 异常信息
     */
    ErrorMsgs: {
        unknown: "未知错误",
        uninit: "{0}未初始化",
        paramException: "{0}'{1}'方法参数错误，请参考api",
        invoke: "{0} 方法参数 {1} 必须为 {2}",
        invoke1: "{0} 方法参数 {1} 必须为 {2} 或 {3}",
        invoke2: "{0} 方法参数 {1} 或 {2} 必须为 {3}",
        invoke3: "{0} 方法参数 {1} 不能为空",
        exist: "{0} 已存在",
        exist1: "{0} '{1}' 已存在",
        notexist: "{0} 不存在",
        notexist1: "{0} '{1}' 不存在",
        notupd: "{0} 不可修改",
        notremove: "{0} 不可删除",
        notremove1: "{0} {1} 不可删除",
        namedinvalid: "{0} {1} 命名错误，请参考用户手册对应命名规范",
        initial: "{0} 初始化参数错误",
        jsonparse: "JSON解析错误",
        timeout: "请求超时",
        config: "{0} 配置参数错误",
        config1: "{0} 配置参数 '{1}' 错误",
        itemnotempty: "{0} '{1}' 配置项 '{2}' 不能为空",
        itemincorrect: "{0} '{1}' 配置项 '{2}' 错误",
        needEndTag: "{0} 标签未闭合",
        needStartTag: "未找到与 {0} 匹配的开始标签",
        tagError: "标签 {0} 错误",
        wrongTemplate: "模版格式错误",
        wrongExpression: "表达式 {0} 错误"
    },
    WeekDays: ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"]
};

const RuntimeConfig = {
    isDebug: false
};
let NodomMessage = NodomMessage_zh;
function setRuntimeDebug(debug) {
    RuntimeConfig.isDebug = !!debug;
}
function setRuntimeLang(lang) {
    NodomMessage = lang === "en" ? NodomMessage_en : NodomMessage_zh;
}

/**
 * 异常处理类
 */
class NError extends Error {
    constructor(errorName, ...params) {
        super(errorName);
        const msg = NodomMessage.ErrorMsgs[errorName];
        if (msg === undefined) {
            this.message = "未知错误";
            return;
        }
        //编译提示信息
        this.message = compileMessage(msg, ...params);
    }
}
function compileMessage(src, ...params) {
    if (!params || params.length === 0) {
        return src;
    }
    let output = src;
    for (let index = 0; index < params.length; index++) {
        if (output.indexOf(`{${index}}`) === -1) {
            break;
        }
        output = output.replace(new RegExp(`\\{${index}\\}`, "g"), String(params[index]));
    }
    return output;
}

/**
 * 全局缓存
 *
 * @remarks
 * 用于所有模块共享数据，实现模块通信
 */
class GlobalCache {
    /**
     * 保存到cache
     * @param key - 键，支持"."（多级数据分割）
     * @param value - 值
     */
    static set(key, value) {
        this.cache.set(key, value);
    }
    /**
     * 从cache读取
     * @param key - 键，支持"."（多级数据分割）
     * @returns 缓存的值或undefined
     */
    static get(key) {
        return this.cache.get(key);
    }
    /**
     * 订阅
     *
     * @remarks
     * 如果订阅的数据发生改变，则会触发handler
     *
     * @param module - 订阅的模块
     * @param key - 订阅的属性名
     * @param handler - 回调函数或方法名
     */
    static subscribe(module, key, handler) {
        this.cache.subscribe(module, key, handler);
    }
    /**
     * 从cache移除
     * @param key - 键，支持"."（多级数据分割）
     */
    static remove(key) {
        this.cache.remove(key);
    }
}
/**
 * NCache实例，用于存放缓存对象
 */
GlobalCache.cache = new NCache();

var PatchFlags;
(function (PatchFlags) {
    PatchFlags[PatchFlags["NONE"] = 0] = "NONE";
    PatchFlags[PatchFlags["TEXT"] = 1] = "TEXT";
    PatchFlags[PatchFlags["CLASS"] = 2] = "CLASS";
    PatchFlags[PatchFlags["STYLE"] = 4] = "STYLE";
    PatchFlags[PatchFlags["PROPS"] = 8] = "PROPS";
    PatchFlags[PatchFlags["ASSETS"] = 16] = "ASSETS";
    PatchFlags[PatchFlags["EVENTS"] = 32] = "EVENTS";
    PatchFlags[PatchFlags["DIRECTIVES"] = 64] = "DIRECTIVES";
    PatchFlags[PatchFlags["KEYED_FRAGMENT"] = 128] = "KEYED_FRAGMENT";
    PatchFlags[PatchFlags["UNKEYED_FRAGMENT"] = 256] = "UNKEYED_FRAGMENT";
    PatchFlags[PatchFlags["BAIL"] = 512] = "BAIL";
})(PatchFlags || (PatchFlags = {}));
var StructureFlags;
(function (StructureFlags) {
    StructureFlags[StructureFlags["NONE"] = 0] = "NONE";
    StructureFlags[StructureFlags["CONDITIONAL"] = 1] = "CONDITIONAL";
    StructureFlags[StructureFlags["SLOT"] = 2] = "SLOT";
    StructureFlags[StructureFlags["MODULE"] = 4] = "MODULE";
    StructureFlags[StructureFlags["ROUTE_LINK"] = 8] = "ROUTE_LINK";
    StructureFlags[StructureFlags["ROUTE_VIEW"] = 16] = "ROUTE_VIEW";
    StructureFlags[StructureFlags["RECURSIVE"] = 32] = "RECURSIVE";
    StructureFlags[StructureFlags["LIST"] = 64] = "LIST";
})(StructureFlags || (StructureFlags = {}));
var EModuleState;
(function (EModuleState) {
    EModuleState[EModuleState["INIT"] = 1] = "INIT";
    EModuleState[EModuleState["UNMOUNTED"] = 2] = "UNMOUNTED";
    EModuleState[EModuleState["MOUNTED"] = 3] = "MOUNTED";
})(EModuleState || (EModuleState = {}));

/**
 * 基础服务库
 */
class Util {
    /**
     * 唯一主键
     */
    static genId() {
        return this.generatedId++;
    }
    /**
     * 初始化保留字map
     */
    static initKeyMap() {
        [
            'arguments', 'boolean', 'break', 'byte', 'catch',
            'char', 'const', 'default', 'delete', 'do',
            'double', 'else', 'enum', 'eval', 'false',
            'float', 'for', 'function', 'goto', 'if',
            'in', 'instanceof', 'int', 'let', 'long',
            'null', 'return', 'short', 'switch', 'this',
            'throw', 'true', 'try', 'this', 'throw',
            'typeof', 'var', 'while', 'with', 'Array',
            'Date', 'JSON', 'Set', 'Map', 'eval',
            'Infinity', 'isFinite', 'isNaN', 'isPrototypeOf', 'Math',
            'new', 'NaN', 'Number', 'Object', 'prototype', 'String',
            'isPrototypeOf', 'undefined', 'valueOf'
        ].forEach(item => {
            this.keyWordMap.set(item, true);
        });
    }
    /**
     * 是否为 js 保留关键字
     * @param name -    名字
     * @returns         如果为保留字，则返回true，否则返回false
     */
    static isKeyWord(name) {
        return this.keyWordMap.has(name);
    }
    /******对象相关******/
    /**
     * 对象复制
     * @param srcObj -  源对象
     * @param expKey -  不复制的键正则表达式或属性名
     * @param extra -   附加参数
     * @returns         复制的对象
     */
    static clone(srcObj, expKey, extra) {
        const map = new WeakMap();
        return clone(srcObj, expKey, extra);
        /**
         * clone对象
         * @param src -      待clone对象
         * @param expKey -   不克隆的键
         * @param extra -    clone附加参数
         * @returns        克隆后的对象
         */
        function clone(src, expKey, extra) {
            //非对象或函数，直接返回            
            if (!src || typeof src !== 'object' || Util.isFunction(src)) {
                return src;
            }
            let dst;
            //带有clone方法，则直接返回clone值
            if (src.clone && Util.isFunction(src.clone)) {
                return src.clone(extra);
            }
            else if (Util.isObject(src)) {
                dst = new Object();
                //把对象加入map，如果后面有新克隆对象，则用新克隆对象进行覆盖
                map.set(src, dst);
                Object.getOwnPropertyNames(src).forEach((prop) => {
                    //不克隆的键
                    if (expKey) {
                        if (expKey.constructor === RegExp && expKey.test(prop) //正则表达式匹配的键不复制
                            || Util.isArray(expKey) && expKey.includes(prop) //被排除的键不复制
                        ) {
                            return;
                        }
                    }
                    dst[prop] = getCloneObj(src[prop], expKey, extra);
                });
            }
            else if (Util.isMap(src)) {
                dst = new Map();
                //把对象加入map，如果后面有新克隆对象，则用新克隆对象进行覆盖
                src.forEach((value, key) => {
                    //不克隆的键
                    if (expKey) {
                        if (expKey.constructor === RegExp && expKey.test(key) //正则表达式匹配的键不复制
                            || expKey.includes(key)) { //被排除的键不复制
                            return;
                        }
                    }
                    dst.set(key, getCloneObj(value, expKey, extra));
                });
            }
            else if (Util.isArray(src)) {
                dst = [];
                //把对象加入map，如果后面有新克隆对象，则用新克隆对象进行覆盖
                src.forEach(function (item, i) {
                    dst[i] = getCloneObj(item, expKey, extra);
                });
            }
            return dst;
        }
        /**
         * 获取clone对象
         * @param value -     待clone值
         * @param expKey -    排除键
         * @param extra -     附加参数
         */
        function getCloneObj(value, expKey, extra) {
            if (typeof value === 'object' && !Util.isFunction(value)) {
                let co = null;
                if (!map.has(value)) { //clone新对象
                    co = clone(value, expKey, extra);
                }
                else { //从map中获取对象
                    co = map.get(value);
                }
                return co;
            }
            return value;
        }
    }
    /**
     * 比较两个对象值是否相同(只比较object和array)
     * @param src - 源对象
     * @param dst - 目标对象
     * @returns     值相同则返回true，否则返回false
     */
    static compare(src, dst) {
        return cmp(src, dst);
        function cmp(o1, o2) {
            if (o1 === o2) {
                return true;
            }
            const keys1 = Object.keys(o1);
            const keys2 = Object.keys(o2);
            if (keys1.length !== keys2.length) {
                return false;
            }
            for (const k of keys1) {
                if (typeof o1[k] === 'object' && typeof o2[k] === 'object') {
                    if (!cmp(o1[k], o2[k])) {
                        return false;
                    }
                }
                else if (o1[k] !== o2[k]) {
                    return false;
                }
            }
            return true;
        }
    }
    /**
     * 获取对象自有属性
     * @param obj - 需要获取属性的对象
     * @returns     返回属性数组
     */
    static getOwnProps(obj) {
        if (!obj) {
            return [];
        }
        return Object.getOwnPropertyNames(obj);
    }
    /**************对象判断相关************/
    /**
     * 判断是否为函数
     * @param foo - 检查的对象
     * @returns     true/false
     */
    static isFunction(foo) {
        return foo !== undefined && foo !== null && foo.constructor === Function;
    }
    /**
     * 判断是否为数组
     * @param obj -   检查的对象
     * @returns     true/false
     */
    static isArray(obj) {
        return Array.isArray(obj);
    }
    /**
     * 判断是否为map
     * @param obj -   检查的对象
     */
    static isMap(obj) {
        return obj !== null && obj !== undefined && obj.constructor === Map;
    }
    /**
     * 判断是否为对象
     * @param obj -   检查的对象
     * @returns     true/false
     */
    static isObject(obj) {
        return obj !== null && obj !== undefined && obj.constructor === Object;
    }
    /**
     * 判断对象/字符串是否为空
     * @param obj - 检查的对象
     * @returns     true/false
     */
    static isEmpty(obj) {
        if (obj === null || obj === undefined)
            return true;
        if (this.isObject(obj)) {
            const keys = Object.keys(obj);
            return keys.length === 0;
        }
        else if (typeof obj === 'string') {
            return obj === '';
        }
        return false;
    }
    /******日期相关******/
    /**
     * 日期格式化
     * @param timestamp -   时间戳
     * @param format -      日期格式
     * @returns             日期串
     */
    static formatDate(timeStamp, format) {
        if (typeof timeStamp === 'string') {
            //排除日期格式串,只处理时间戳
            if (/^\d+$/.test(timeStamp)) {
                timeStamp = Number(timeStamp);
            }
            else {
                throw new NError('invoke', 'Util.formatDate', '0', 'date string', 'date');
            }
        }
        //得到日期
        const date = new Date(timeStamp);
        // invalid date
        if (isNaN(date.getDay())) {
            throw new NError('invoke', 'Util.formatDate', '0', 'date string', 'date');
        }
        const o = {
            "M+": date.getMonth() + 1, //月份
            "d+": date.getDate(), //日
            "h+": date.getHours(), //小时
            "H+": date.getHours(), //小时
            "m+": date.getMinutes(), //分
            "s+": date.getSeconds(), //秒
            "S": date.getMilliseconds() //毫秒
        };
        let re;
        //年
        if (re = /(y+)/.exec(format)) {
            format = format.replace(re[0], (date.getFullYear() + "").substring(4 - re[0].length));
        }
        //月日
        this.getOwnProps(o).forEach(function (k) {
            if (re = new RegExp("(" + k + ")").exec(format)) {
                format = format.replace(re[0], re[0].length === 1 ? o[k] : ("00" + o[k]).substring((o[k] + '').length));
            }
        });
        //星期
        format = format.replace(/(E+)/, NodomMessage.WeekDays[date.getDay() + ""]);
        return format;
    }
    /******字符串相关*****/
    /**
     * 编译字符串，把 \{n\}替换成带入值
     * @param src -     待编译的字符串
     * @param params -  参数数组
     * @returns     转换后的消息
     */
    static compileStr(src, ...params) {
        if (!params || params.length === 0) {
            return src;
        }
        let reg;
        for (let i = 0; i < params.length; i++) {
            if (src.indexOf('\{' + i + '\}') !== -1) {
                reg = new RegExp('\\{' + i + '\\}', 'g');
                src = src.replace(reg, params[i]);
            }
            else {
                break;
            }
        }
        return src;
    }
    /**
     * 在节点后插入节点
     * @param src -     待插入节点
     * @param dst -     目标位置节点
     */
    static insertAfter(src, dst) {
        if (!dst.parentElement) {
            return;
        }
        const pEl = dst.parentElement;
        if (dst === pEl.lastChild) {
            pEl.appendChild(src);
        }
        else {
            pEl.insertBefore(src, dst.nextSibling);
        }
    }
}
/**
 * 全局id
 */
Util.generatedId = 1;
/**
 * js 保留字 map
 */
Util.keyWordMap = new Map();
//初始化keymap
Util.initKeyMap();

/**
 * 自定义元素管理器
 *
 * @remarks
 * 所有自定义元素需要添加到管理器才能使用
 */
class DefineElementManager {
    /**
     * 添加自定义元素
     * @param clazz -   自定义元素类或类数组
     */
    static add(clazz) {
        if (Array.isArray(clazz)) {
            for (const c of clazz) {
                this.elements.set(c.name.toUpperCase(), c);
            }
        }
        else {
            this.elements.set(clazz.name.toUpperCase(), clazz);
        }
    }
    /**
     * 获取自定义元素类
     * @param tagName - 元素名
     * @returns         自定义元素类
     */
    static get(tagName) {
        return this.elements.get(tagName.toUpperCase());
    }
    /**
     * 是否存在自定义元素
     * @param tagName - 元素名
     * @returns         存在或不存在
     */
    static has(tagName) {
        return this.elements.has(tagName.toUpperCase());
    }
}
/**
 * 自定义元素集合
 */
DefineElementManager.elements = new Map();

/**
 * 指令类型
 */
class DirectiveType {
    /**
     * 构造方法
     * @param name -    指令类型名
     * @param handle -  渲染时执行方法
     * @param prio -    类型优先级
     */
    constructor(name, handler, prio) {
        this.name = name;
        this.prio = prio >= 0 ? prio : 10;
        this.handler = handler;
    }
}

/**
 * 指令管理器
 */
class DirectiveManager {
    /**
     * 增加指令映射
     * @param name -    指令类型名
     * @param handle -  渲染处理函数
     * @param prio -    类型优先级
     */
    static addType(name, handler, prio) {
        this.directiveTypes.set(name, new DirectiveType(name, handler, prio));
    }
    /**
     * 移除指令映射
     * @param name -    指令类型名
     */
    static removeType(name) {
        this.directiveTypes.delete(name);
    }
    /**
     * 获取指令
     * @param name -    指令类型名
     * @returns         指令类型或undefined
     */
    static getType(name) {
        return this.directiveTypes.get(name);
    }
    /**
     * 是否含有某个指令
     * @param name -    指令类型名
     * @returns         true/false
     */
    static hasType(name) {
        return this.directiveTypes.has(name);
    }
}
/**
 * 指令映射
 */
DirectiveManager.directiveTypes = new Map();

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
/* global Reflect, Promise, SuppressedError, Symbol, Iterator */


function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};

/**
 * 模块工厂
 * @remarks
 * 用于管理模块类和模块实例
 */
class ModuleFactory {
    static add(item) {
        if (this.modules.size === 0) {
            this.mainModule = item;
        }
        this.modules.set(item.id, item);
        this.addClass(item.constructor);
    }
    static get(name) {
        var _a;
        const tp = typeof name;
        let mdl;
        if (tp === "number") {
            return this.modules.get(name);
        }
        if (tp === "string") {
            name = name.toLowerCase();
            if (!this.classes.has(name)) {
                name = this.aliasMap.get(name);
            }
            if (name && this.classes.has(name)) {
                mdl = Reflect.construct(this.classes.get(name), [++this.moduleId]);
            }
        }
        else {
            mdl = Reflect.construct(name, [++this.moduleId]);
        }
        if (mdl) {
            (_a = mdl.init) === null || _a === void 0 ? void 0 : _a.call(mdl);
            return mdl;
        }
        return undefined;
    }
    static hasClass(clazzName) {
        const name = clazzName.toLowerCase();
        return this.classes.has(name) || this.aliasMap.has(name);
    }
    static addClass(clazz, alias) {
        const name = clazz.name.toLowerCase();
        this.classes.set(name, clazz);
        if (alias) {
            this.aliasMap.set(alias.toLowerCase(), name);
        }
    }
    static getClass(name) {
        name = name.toLowerCase();
        return this.classes.has(name) ? this.classes.get(name) : this.classes.get(this.aliasMap.get(name));
    }
    static load(modulePath) {
        return __awaiter(this, void 0, void 0, function* () {
            const m = yield import(modulePath);
            if (m) {
                for (const k of Object.keys(m)) {
                    if (m[k].name) {
                        this.addClass(m[k]);
                        return m[k];
                    }
                }
            }
            return undefined;
        });
    }
    static remove(id) {
        this.modules.delete(id);
    }
    static setMain(m) {
        this.mainModule = m;
    }
    static getMain() {
        return this.mainModule;
    }
    static setAppContext(context) {
        this.appContext = context;
    }
    static getAppContext() {
        return this.appContext;
    }
}
ModuleFactory.modules = new Map();
ModuleFactory.classes = new Map();
ModuleFactory.aliasMap = new Map();
ModuleFactory.moduleId = 0;

function normalizeDependencyPath(path) {
    if (!path) {
        return;
    }
    let value = path.trim();
    if (!value || value === "$model" || value === "this") {
        return;
    }
    value = value.replace(/^\$model\./, "");
    value = value.replace(/^this\./, "");
    value = value.replace(/^\.\.\./, "");
    value = value.replace(/\[\s*(['"`])([^'"`]+)\1\s*\]/g, ".$2");
    value = value.replace(/\[\s*\d+\s*\]/g, "");
    value = value.replace(/\.{2,}/g, ".");
    value = value.replace(/^\./, "");
    value = value.replace(/\.$/, "");
    if (!value || value === "$model" || value === "this") {
        return;
    }
    return value;
}
function mergeDependencyPaths(target = [], next) {
    if (!next) {
        return target;
    }
    for (const item of next) {
        const normalized = normalizeDependencyPath(item);
        if (!normalized || target.includes(normalized)) {
            continue;
        }
        target.push(normalized);
    }
    return target;
}
function isRelatedDependencyPath(left, right) {
    if (!left || !right) {
        return false;
    }
    return left === right
        || left.startsWith(right + ".")
        || right.startsWith(left + ".");
}
function hasDependencyMatch(paths, dirtyPaths) {
    if (!dirtyPaths || dirtyPaths.length === 0) {
        return true;
    }
    if (dirtyPaths.includes("*")) {
        return true;
    }
    if (!paths || paths.length === 0) {
        return false;
    }
    for (const dirtyPath of dirtyPaths) {
        for (const path of paths) {
            if (isRelatedDependencyPath(path, dirtyPath)) {
                return true;
            }
        }
    }
    return false;
}

function getSequence(values) {
    const predecessors = values.slice();
    const result = [];
    for (let i = 0; i < values.length; i++) {
        const value = values[i];
        if (value < 0) {
            continue;
        }
        if (result.length === 0 || values[result[result.length - 1]] < value) {
            predecessors[i] = result.length > 0 ? result[result.length - 1] : -1;
            result.push(i);
            continue;
        }
        let start = 0;
        let end = result.length - 1;
        while (start < end) {
            const middle = (start + end) >> 1;
            if (values[result[middle]] < value) {
                start = middle + 1;
            }
            else {
                end = middle;
            }
        }
        if (value < values[result[start]]) {
            if (start > 0) {
                predecessors[i] = result[start - 1];
            }
            else {
                predecessors[i] = -1;
            }
            result[start] = i;
        }
    }
    let length = result.length;
    let last = length > 0 ? result[length - 1] : -1;
    while (length-- > 0 && last >= 0) {
        result[length] = last;
        last = predecessors[last];
    }
    return result;
}

class Expression {
    constructor(exprStr) {
        this.depPaths = [];
        this.hasUnknownDeps = false;
        this.id = Util.genId();
        if (!exprStr || (exprStr = exprStr.trim()) === "") {
            return;
        }
        if (RuntimeConfig.isDebug) {
            this.exprStr = exprStr;
        }
        if (exprStr.includes("[")) {
            this.hasUnknownDeps = true;
        }
        const funStr = this.compile(exprStr);
        this.execFunc = new Function("$model", "return " + funStr);
    }
    compile(exprStr) {
        const reg = /('[\s\S]*?')|("[\s\S]*?")|(`[\s\S]*?`)|([a-zA-Z$_][\w$]*\s*?:)|((\.{3}|\.)?[a-zA-Z$_][\w$]*(\.[a-zA-Z$_][\w$]*)*(\s*[\[\(](\s*\))?)?)/g;
        let result;
        let retS = "";
        let index = 0;
        while ((result = reg.exec(exprStr)) !== null) {
            let token = result[0];
            if (index < result.index) {
                retS += exprStr.substring(index, result.index);
            }
            if (token[0] === "'" || token[0] === '"' || token[0] === "`") {
                retS += token;
            }
            else {
                const lastChar = token[token.length - 1];
                if (lastChar === ":") {
                    retS += token;
                }
                else if (lastChar === "(" || lastChar === ")") {
                    retS += handleFunc.call(this, token);
                }
                else if (token.startsWith("this.")
                    || token === "$model"
                    || Util.isKeyWord(token)
                    || (token[0] === "." && token[1] !== ".")) {
                    retS += token;
                }
                else {
                    let prefix = "";
                    if (token.startsWith("...")) {
                        prefix = "...";
                        token = token.substring(3);
                    }
                    this.addDependency(token);
                    retS += prefix + "$model." + token;
                }
            }
            index = reg.lastIndex;
        }
        if (index < exprStr.length) {
            retS += exprStr.substring(index);
        }
        return retS;
    }
    val(module, model) {
        if (!this.execFunc) {
            return;
        }
        try {
            return this.execFunc.call(module, model);
        }
        catch (e) {
            if (RuntimeConfig.isDebug) {
                console.error(new NError("wrongExpression", this.exprStr).message);
                console.error(e);
            }
        }
    }
    addDependency(path) {
        const normalized = normalizeDependencyPath(path);
        if (!normalized || this.depPaths.includes(normalized)) {
            return;
        }
        this.depPaths.push(normalized);
    }
}
function handleFunc(str) {
    str = str.replace(/\s+/g, "");
    const leftParenIndex = str.lastIndexOf("(");
    const dotIndex = str.indexOf(".");
    const fnName = dotIndex !== -1 ? str.substring(0, dotIndex) : str.substring(0, leftParenIndex);
    if (dotIndex !== -1) {
        this.addDependency(str.substring(0, leftParenIndex));
        return str;
    }
    let result = "this.invokeMethod('" + fnName + "'";
    result += str[str.length - 1] !== ")" ? "," : ")";
    return result;
}

/**
 * 指令类
 */
class Directive {
    /**
     * 构造方法
     * @param type -  	    类型名
     * @param value - 	    指令值
     */
    constructor(type, value) {
        this.id = Util.genId();
        if (type) {
            this.type = DirectiveManager.getType(type);
            if (!this.type) {
                throw new NError('notexist1', NodomMessage.TipWords['directive'], type);
            }
        }
        if (typeof value === 'string') {
            this.value = value.trim();
        }
        else if (value instanceof Expression) {
            this.expression = value;
        }
        else {
            this.value = value;
        }
    }
    /**
     * 执行指令
     * @param module -  模块
     * @param dom -     渲染目标节点对象
     * @returns         是否继续渲染
     */
    exec(module, dom) {
        //禁用，不执行
        if (this.disabled) {
            return true;
        }
        if (this.expression) {
            this.value = this.expression.val(module, dom.model);
        }
        return this.type.handler.apply(this, [module, dom]);
    }
    /**
     * 克隆
     * @returns     新克隆的指令
     */
    clone() {
        const d = new Directive();
        d.type = this.type;
        d.expression = this.expression;
        d.value = this.value;
        return d;
    }
}

/**
 * 事件类
 * @remarks
 * 事件分为自有事件和代理事件，事件默认传递参数为：
 *
 * 0: model(事件对应数据模型)
 *
 * 1: dom(事件target对应的虚拟dom节点)
 *
 * 2: evObj(Nodom Event对象)
 *
 * 3: e(Html Event对象)
 */
class NEvent {
    /**
     * @param module -      模块
     * @param eventName -   事件名
     * @param eventCfg -    事件串或事件处理函数,以“:”分割,中间不能有空格,结构为: `方法名:delg:nopopo:once:capture`，`":"`后面的内容选择使用；
     *                      如果eventCfg为函数，则表示为事件处理函数
     * @param handler -     事件处理函数，此时eventCfg可以配置为 :delg:nopopo:once:capture等
     */
    constructor(module, eventName, eventCfg, handler) {
        this.id = Util.genId();
        this.module = module;
        this.name = eventName;
        //如果事件串不为空，则不需要处理
        if (!eventCfg && !handler) {
            return;
        }
        if (typeof eventCfg === 'string') {
            this.parseEvent(eventCfg.trim());
        }
        else if (typeof eventCfg === 'function') {
            this.handler = eventCfg;
        }
        if (typeof handler === 'function') {
            this.handler = handler;
        }
        this.touchOrNot();
    }
    /**
     * 解析事件字符串
     * @param eventStr -  待解析的字符串
     */
    parseEvent(eventStr) {
        eventStr.split(':').forEach((item, i) => {
            item = item.trim();
            if (i === 0) { //事件方法
                if (item !== '') {
                    this.handler = item;
                }
            }
            else { //事件附加参数
                switch (item) {
                    case 'delg':
                        this.delg = true;
                        break;
                    case 'nopopo':
                        this.nopopo = true;
                        break;
                    case 'once':
                        this.once = true;
                        break;
                    case 'capture':
                        this.capture = true;
                        break;
                }
            }
        });
    }
    /**
     * 触屏转换
     */
    touchOrNot() {
        if (document.ontouchend) { //触屏设备
            switch (this.name) {
                case 'click':
                    this.name = 'tap';
                    break;
                case 'mousedown':
                    this.name = 'touchstart';
                    break;
                case 'mouseup':
                    this.name = 'touchend';
                    break;
                case 'mousemove':
                    this.name = 'touchmove';
                    break;
            }
        }
        else { //转非触屏
            switch (this.name) {
                case 'tap':
                    this.name = 'click';
                    break;
                case 'touchstart':
                    this.name = 'mousedown';
                    break;
                case 'touchend':
                    this.name = 'mouseup';
                    break;
                case 'touchmove':
                    this.name = 'mousemove';
                    break;
            }
        }
    }
    /**
     * 设置附加参数值
     * @param module -    模块
     * @param dom -       虚拟dom
     * @param name -      参数名
     * @param value -     参数值
     */
    setParam(dom, name, value) {
        this.module.objectManager.setEventParam(this.id, dom.key, name, value);
    }
    /**
     * 获取附加参数值
     * @param dom -       虚拟dom
     * @param name -      参数名
     * @returns         附加参数值
     */
    getParam(dom, name) {
        return this.module.objectManager.getEventParam(this.id, dom.key, name);
    }
    /**
     * 移除参数
     * @param dom -       虚拟dom
     * @param name -      参数名
     */
    removeParam(dom, name) {
        return this.module.objectManager.removeEventParam(this.id, dom.key, name);
    }
    /**
     * 清参数cache
     * @param dom -       虚拟dom
     */
    clearParam(dom) {
        this.module.objectManager.clearEventParams(this.id, dom.key);
    }
}

/**
 * 虚拟dom
 * @remarks
 * 编译后的dom节点，与渲染后的dom节点(RenderedDom)不同
 */
class VirtualDom {
    /**
     * @param tag -     标签名
     * @param key -     key
     * @param module - 	模块
     */
    constructor(tag, key, module) {
        this.depPaths = [];
        this.subtreeDepPaths = [];
        this.forceFullRender = false;
        this.subtreeForceFullRender = false;
        this.patchFlag = PatchFlags.NONE;
        this.dynamicProps = [];
        this.hoisted = false;
        this.blockTree = false;
        this.blockRoot = false;
        this.dynamicChildIndexes = [];
        this.childrenPatchFlag = PatchFlags.NONE;
        this.structureFlags = StructureFlags.NONE;
        this.childrenStructureFlags = StructureFlags.NONE;
        this.moduleId = module === null || module === void 0 ? void 0 : module.id;
        this.key = key;
        this.staticNum = 1;
        if (tag) {
            this.tagName = tag;
        }
    }
    /**
     * 移除多个指令
     * @param directives - 	待删除的指令类型数组或指令类型
     * @returns             如果虚拟dom上的指令集为空，则返回void
     */
    removeDirectives(directives) {
        if (!this.directives) {
            return;
        }
        //数组
        directives.forEach((d) => {
            this.removeDirective(d);
        });
    }
    /**
     * 移除指令
     * @param directive - 	待删除的指令类型名
     * @returns             如果虚拟dom上的指令集为空，则返回void
     */
    removeDirective(directive) {
        if (!this.directives) {
            return;
        }
        let ind;
        if ((ind = this.directives.findIndex((item) => item.type.name === directive)) !== -1) {
            this.directives.splice(ind, 1);
        }
        if (this.directives.length === 0) {
            delete this.directives;
        }
    }
    /**
     * 添加指令
     * @param directive -     指令对象
     * @param sort -          是否排序
     * @returns             如果虚拟dom上的指令集不为空，且指令集中已经存在传入的指令对象，则返回void
     */
    addDirective(directive, sort) {
        if (!this.directives) {
            this.directives = [directive];
            return;
        }
        else if (this.directives.find((item) => item.type.name === directive.type.name)) {
            return;
        }
        this.directives.push(directive);
        //指令按优先级排序
        if (sort) {
            this.sortDirective();
        }
    }
    /**
     * 指令排序
     * @returns           如果虚拟dom上指令集为空，则返回void
     */
    sortDirective() {
        if (!this.directives) {
            return;
        }
        if (this.directives.length > 1) {
            this.directives.sort((a, b) => {
                return DirectiveManager.getType(a.type.name).prio <
                    DirectiveManager.getType(b.type.name).prio
                    ? -1
                    : 1;
            });
        }
    }
    /**
     * 是否有某个类型的指令
     * @param typeName - 	    指令类型名
     * @returns             如果指令集不为空，且含有传入的指令类型名则返回true，否则返回false
     */
    hasDirective(typeName) {
        return this.directives && this.directives.find(item => item.type.name === typeName) !== undefined;
    }
    /**
     * 获取某个类型的指令
     * @param module -            模块
     * @param directiveType - 	指令类型名
     * @returns                 如果指令集为空，则返回void；否则返回指令类型名等于传入参数的指令对象
     */
    getDirective(directiveType) {
        if (!this.directives) {
            return;
        }
        return this.directives.find((item) => item.type.name === directiveType);
    }
    /**
     * 添加子节点
     * @param dom -       子节点
     * @param index -     指定位置，如果不传此参数，则添加到最后
     */
    add(dom, index) {
        if (!this.children) {
            this.children = [];
        }
        if (index !== undefined && index !== null) {
            this.children.splice(index, 0, dom);
        }
        else {
            this.children.push(dom);
        }
        dom.parent = this;
    }
    /**
     * 移除子节点
     * @param dom -   子节点
     */
    remove(dom) {
        const index = this.children.indexOf(dom);
        if (index !== -1) {
            this.children.splice(index, 1);
        }
    }
    /**
     * 是否拥有属性
     * @param propName -  属性名
     * @param isExpr -    是否只检查表达式属性
     * @returns         如果属性集含有传入的属性名返回true，否则返回false
     */
    hasProp(propName) {
        if (this.props) {
            return this.props.has(propName);
        }
    }
    /**
     * 获取属性值
     * @param propName -  属性名
     * @returns         传入属性名的value
     */
    getProp(propName) {
        if (this.props) {
            return this.props.get(propName);
        }
    }
    /**
     * 设置属性值
     * @param propName -  属性名
     * @param v -         属性值
     */
    setProp(propName, v) {
        if (!this.props) {
            this.props = new Map();
        }
        this.props.set(propName, v);
    }
    /**
     * 删除属性
     * @param props -     属性名或属性名数组
     * @returns         如果虚拟dom上的属性集为空，则返回void
     */
    delProp(props) {
        if (!this.props) {
            return;
        }
        this.props.delete(props);
    }
    /**
     * 设置asset
     * @param assetName -     asset name
     * @param value -         asset value
     */
    setAsset(assetName, value) {
        if (!this.assets) {
            this.assets = new Map();
        }
        this.assets.set(assetName, value);
        this.setStaticOnce();
    }
    /**
     * 删除asset
     * @param assetName -     asset name
     * @returns             如果虚拟dom上的直接属性集为空，则返回void
     */
    delAsset(assetName) {
        if (!this.assets) {
            return;
        }
        this.assets.delete(assetName);
        this.setStaticOnce();
    }
    /**
     * 设置cache参数
     * @param module -    模块
     * @param name -      参数名
     * @param value -     参数值
     */
    setParam(module, name, value) {
        module.objectManager.setDomParam(this.key, name, value);
    }
    /**
     * 获取参数值
     * @param module -    模块
     * @param name -      参数名
     * @returns         参数值
     */
    getParam(module, name) {
        return module.objectManager.getDomParam(this.key, name);
    }
    /**
     * 移除参数
     * @param module -    模块
     * @param name -      参数名
     */
    removeParam(module, name) {
        module.objectManager.removeDomParam(this.key, name);
    }
    /**
     * 设置单次静态标志
     */
    setStaticOnce() {
        if (this.staticNum !== -1) {
            this.staticNum = 1;
        }
    }
    addDepPaths(paths) {
        if (!paths) {
            return;
        }
        for (const path of paths) {
            if (!path || this.depPaths.includes(path)) {
                continue;
            }
            this.depPaths.push(path);
        }
    }
    markForceFullRender() {
        this.forceFullRender = true;
        this.patchFlag |= PatchFlags.BAIL;
    }
    addPatchFlag(flag, propName) {
        if (!flag) {
            return;
        }
        const allowAfterBail = (flag & (PatchFlags.KEYED_FRAGMENT | PatchFlags.UNKEYED_FRAGMENT)) !== 0;
        if ((this.patchFlag & PatchFlags.BAIL) !== 0 && !allowAfterBail) {
            return;
        }
        this.patchFlag |= flag;
        if (propName && propName !== "key" && !this.dynamicProps.includes(propName)) {
            this.dynamicProps.push(propName);
        }
    }
    markHoisted() {
        this.hoisted = true;
        if (this.staticNum > 0) {
            this.staticNum = 0;
        }
    }
    markBlockRoot() {
        this.blockRoot = true;
    }
    addStructureFlag(flag) {
        if (!flag) {
            return;
        }
        this.structureFlags |= flag;
    }
    finalizeOptimization() {
        var _a, _b;
        const deps = [...this.depPaths];
        let forceFullRender = this.forceFullRender;
        const dynamicChildIndexes = [];
        let childrenPatchFlag = PatchFlags.NONE;
        let childrenStructureFlags = StructureFlags.NONE;
        if (this.children) {
            for (let index = 0; index < this.children.length; index++) {
                const child = this.children[index];
                for (const path of child.subtreeDepPaths) {
                    if (!deps.includes(path)) {
                        deps.push(path);
                    }
                }
                if (shouldBubbleForceFullRender(child)) {
                    forceFullRender = true;
                }
                if (isDynamicBlockChild(child)) {
                    dynamicChildIndexes.push(index);
                }
                if ((child.patchFlag & PatchFlags.KEYED_FRAGMENT) !== 0) {
                    childrenPatchFlag |= PatchFlags.KEYED_FRAGMENT;
                }
                if ((child.patchFlag & PatchFlags.UNKEYED_FRAGMENT) !== 0) {
                    childrenPatchFlag |= PatchFlags.UNKEYED_FRAGMENT;
                }
                childrenStructureFlags |= child.structureFlags;
                childrenStructureFlags |= child.childrenStructureFlags;
            }
        }
        this.subtreeDepPaths = deps;
        this.subtreeForceFullRender = forceFullRender;
        this.dynamicChildIndexes = dynamicChildIndexes;
        this.childrenPatchFlag = childrenPatchFlag;
        this.childrenStructureFlags = childrenStructureFlags;
        this.blockTree = !this.subtreeForceFullRender
            && dynamicChildIndexes.length > 0
            && dynamicChildIndexes.length < (((_a = this.children) === null || _a === void 0 ? void 0 : _a.length) || 0);
        this.blockRoot = this.blockRoot
            || this.blockTree
            || this.forceFullRender
            || this.depPaths.length > 0
            || (this.patchFlag & (PatchFlags.KEYED_FRAGMENT | PatchFlags.UNKEYED_FRAGMENT)) !== 0
            || childrenPatchFlag !== PatchFlags.NONE
            || this.structureFlags !== StructureFlags.NONE
            || childrenStructureFlags !== StructureFlags.NONE;
        if (!this.subtreeForceFullRender && this.subtreeDepPaths.length === 0 && !((_b = this.directives) === null || _b === void 0 ? void 0 : _b.length)) {
            this.markHoisted();
        }
    }
    /**
     * 克隆
     */
    clone() {
        const dst = new VirtualDom(this.tagName, this.key);
        dst.moduleId = this.moduleId;
        if (this.tagName) {
            //属性
            if (this.props && this.props.size > 0) {
                for (const p of this.props) {
                    dst.setProp(p[0], p[1]);
                }
            }
            if (this.assets && this.assets.size > 0) {
                for (const p of this.assets) {
                    dst.setAsset(p[0], p[1]);
                }
            }
            if (this.directives && this.directives.length > 0) {
                dst.directives = [];
                for (const d of this.directives) {
                    dst.directives.push(d.clone());
                }
            }
            //复制事件
            dst.events = this.events;
            //子节点clone
            if (this.children) {
                for (const c of this.children) {
                    dst.add(c.clone());
                }
            }
        }
        else {
            dst.expressions = this.expressions;
            dst.textContent = this.textContent;
        }
        dst.staticNum = this.staticNum;
        dst.addDepPaths(this.depPaths);
        dst.subtreeDepPaths = [...this.subtreeDepPaths];
        dst.forceFullRender = this.forceFullRender;
        dst.subtreeForceFullRender = this.subtreeForceFullRender;
        dst.patchFlag = this.patchFlag;
        dst.dynamicProps = [...this.dynamicProps];
        dst.hoisted = this.hoisted;
        dst.blockTree = this.blockTree;
        dst.blockRoot = this.blockRoot;
        dst.dynamicChildIndexes = [...this.dynamicChildIndexes];
        dst.childrenPatchFlag = this.childrenPatchFlag;
        dst.structureFlags = this.structureFlags;
        dst.childrenStructureFlags = this.childrenStructureFlags;
        dst.renderBlueprint = this.renderBlueprint;
        return dst;
    }
    /**
     * 保存事件
     * @param event - 	事件对象
     * @param index - 	位置
     */
    addEvent(event, index) {
        if (!this.events) {
            this.events = [event];
        }
        else if (!this.events.includes(event)) {
            if (index >= 0) {
                this.events.splice(index, 0, event);
            }
            else {
                this.events.push(event);
            }
        }
    }
}
function isDynamicBlockChild(dom) {
    if (isPassiveStructuralMarker(dom)) {
        return false;
    }
    return dom.blockRoot
        || dom.structureFlags !== StructureFlags.NONE
        || dom.childrenStructureFlags !== StructureFlags.NONE
        || dom.subtreeForceFullRender
        || dom.subtreeDepPaths.length > 0
        || !dom.hoisted;
}
function isPassiveStructuralMarker(dom) {
    var _a;
    return ((_a = dom.directives) === null || _a === void 0 ? void 0 : _a.length) === 1
        && dom.directives[0].type.name === "endif"
        && !dom.blockRoot
        && dom.structureFlags === StructureFlags.NONE
        && !dom.subtreeForceFullRender
        && dom.subtreeDepPaths.length === 0;
}
function shouldBubbleForceFullRender(dom) {
    return dom.subtreeForceFullRender
        && !dom.blockRoot
        && dom.structureFlags === StructureFlags.NONE
        && dom.childrenStructureFlags === StructureFlags.NONE
        && dom.subtreeDepPaths.length === 0
        && dom.hoisted;
}

const voidTagMap = new Set('area,base,br,col,embed,hr,img,input,link,meta,param,source,track,wbr'.split(','));
/**
 * 编译器
 *
 * @remarks
 * 用于编译模板串为虚拟dom(VirtualDom)节点，存放于模块的 domManager.vdomTree
 */
class Compiler {
    /**
     * 构造器
     * @param module - 模块
     */
    constructor(module) {
        /**
         * 自增型id
         */
        this.keyId = 0;
        /**
         * 虚拟dom数组
         */
        this.domArr = [];
        /**
         * 文本节点
         */
        this.textArr = [];
        /**
         * 是否是表达式文本节点
         */
        this.isExprText = false;
        /**
         * 当前编译的模板，用于报错的时候定位
         */
        this.template = '';
        this.module = module;
    }
    /**
     * 编译
     * @param elementStr - 	待编译html串
     * @returns             虚拟dom树根节点
     */
    compile(elementStr) {
        this.keyId = 0;
        if (!elementStr) {
            return;
        }
        // 清除注释
        this.template = elementStr.replace(/\<\!\-\-[\s\S]*?\-\-\>/g, '').trim();
        elementStr = this.template;
        // 编译
        this.compileTemplate(elementStr);
        // 处理未关闭节点
        if (this.domArr.length > 0) {
            this.forceClose(0);
        }
        return this.root;
    }
    /**
     * 产生dom key
     * @returns   dom key
     */
    genKey() {
        return ++this.keyId;
    }
    /**
     * 编译模板
     * @param srcStr - 	源串
     */
    compileTemplate(srcStr) {
        while (srcStr.length !== 0) {
            if (srcStr.startsWith('<')) {
                // 标签
                if (srcStr[1] == '/') {
                    // 结束标签
                    srcStr = this.compileEndTag(srcStr);
                }
                else {
                    // 开始标签
                    srcStr = this.compileStartTag(srcStr);
                }
            }
            else {
                // 文本节点
                srcStr = this.compileText(srcStr);
            }
        }
    }
    /**
     * 处理开始标签
     * @param srcStr - 待编译字符串
     * @returns 编译处理后的字符串
     */
    compileStartTag(srcStr) {
        // 抓取<div
        const match = /^<\s*([a-z][^\s\/\>]*)/i.exec(srcStr);
        // 抓取成功
        if (match) {
            // 设置当前正在编译的节点
            const dom = new VirtualDom(match[1].toLowerCase(), this.genKey(), this.module);
            if (dom.tagName === 'svg') {
                this.isSvg = true;
            }
            //设置svg标志
            if (this.isSvg) {
                dom.isSvg = this.isSvg;
            }
            if (!this.root) {
                this.root = dom;
            }
            if (this.current) {
                this.current.add(dom);
            }
            //设置当前节点
            this.current = dom;
            // 当前节点入栈
            this.domArr.push(dom);
            // 截断字符串 准备处理属性
            srcStr = srcStr.substring(match.index + match[0].length).trimStart();
        }
        else {
            // <!-- 或者<后跟符号不是字符
            // 当作text节点
            this.textArr.push(srcStr[0]);
            return srcStr.substring(1);
        }
        // 处理属性
        srcStr = this.compileAttributes(srcStr);
        // 属性处理完成之后 判断是否结束
        if (srcStr.startsWith('>')) {
            if (this.isVoidTab(this.current)) { //属于自闭合，则处理闭合
                this.handleCloseTag(this.current, true);
            }
            return srcStr.substring(1).trimStart();
        }
        return srcStr;
    }
    /**
     * 处理标签属性
     * @param srcStr - 待编译字符串
     * @returns 编译后字符串
     */
    compileAttributes(srcStr) {
        while (srcStr.length !== 0 && srcStr[0] !== '>') {
            // 抓取形如： /> a='b' a={{b}} a="b" a=`b` a $data={{***}} a={{***}}的属性串;
            const match = /^((\/\>)|\$?[a-z_][\w-]*)(?:\s*=\s*((?:'[^']*')|(?:"[^"]*")|(?:`[^`]*`)|(?:{{[^}}]*}})))?/i.exec(srcStr);
            // 抓取成功 处理属性
            if (match) {
                if (match[0] === '/>') { //自闭合标签结束则退出
                    // 是自闭合标签
                    this.handleCloseTag(this.current, true);
                    srcStr = srcStr.substring(match.index + match[0].length).trimStart();
                    break;
                }
                else { //属性
                    const name = match[1][0] !== '$' ? match[1].toLowerCase() : match[1];
                    // 是普通属性
                    let value = match[3];
                    if (value) {
                        if (value.startsWith('{{')) { //表达式
                            value = new Expression(value.substring(2, value.length - 2));
                            //表达式 staticNum为-1
                            this.current.staticNum = -1;
                            this.current.addDepPaths(value.depPaths);
                            if (value.hasUnknownDeps) {
                                this.current.markForceFullRender();
                            }
                        }
                        else if (value.startsWith('"') || value.startsWith("'")) { //字符串
                            value = value.substring(1, value.length - 1);
                        }
                    }
                    if (name.startsWith('x-')) {
                        // 指令
                        this.current.addDirective(new Directive(name.substring(2), value));
                        this.current.addPatchFlag(PatchFlags.BAIL);
                    }
                    else if (name.startsWith('e-')) {
                        this.current.addEvent(new NEvent(this.module, name.substring(2), value));
                        this.current.addPatchFlag(PatchFlags.EVENTS);
                    }
                    else {
                        //普通属性
                        this.current.setProp(name, value);
                        if (value instanceof Expression) {
                            this.current.addPatchFlag(resolvePropPatchFlag(name), normalizeDynamicPropName(name));
                        }
                    }
                }
                srcStr = srcStr.substring(match.index + match[0].length).trimStart();
            }
            else {
                if (this.current) {
                    throw new NError('tagError', this.current.tagName);
                }
                throw new NError('wrongTemplate');
            }
        }
        return srcStr;
    }
    /**
     * 编译结束标签
     * @param srcStr - 	源串
     * @returns 		剩余的串
     */
    compileEndTag(srcStr) {
        // 抓取结束标签
        const match = /^<\/\s*([a-z][^\>]*)/i.exec(srcStr);
        if (match) {
            const name = match[1].toLowerCase().trim();
            //如果找不到匹配的标签头则丢弃
            let index;
            for (let i = this.domArr.length - 1; i >= 0; i--) {
                if (this.domArr[i].tagName === name) {
                    index = i;
                    break;
                }
            }
            //关闭
            if (index !== undefined) {
                this.forceClose(index);
            }
            return srcStr.substring(match.index + match[0].length + 1);
        }
        return srcStr;
    }
    /**
     * 强制闭合
     * @param index - 在domArr中的索引号
     * @returns
     */
    forceClose(index) {
        if (index === -1 || index > this.domArr.length - 1) {
            return;
        }
        for (let i = this.domArr.length - 1; i >= index; i--) {
            this.handleCloseTag(this.domArr[i]);
        }
    }
    /**
     * 编译text
     * @param srcStr - 	源串
     * @returns
     */
    compileText(srcStr) {
        // 字符串最开始变为< 或者字符串消耗完 则退出循环
        while (!srcStr.startsWith('<') && srcStr.length !== 0) {
            if (srcStr.startsWith('{')) {
                // 可能是表达式
                const matchExp = /^{{([\s\S]*?)}}/i.exec(srcStr);
                if (matchExp) {
                    // 抓取成功
                    this.textArr.push(new Expression(matchExp[1]));
                    this.isExprText = true;
                    srcStr = srcStr.substring(matchExp.index + matchExp[0].length);
                }
                else {
                    // 跳过单独的{
                    typeof this.textArr[this.textArr.length] === 'string'
                        ? (this.textArr[this.textArr.length] += '{')
                        : this.textArr.push('{');
                    srcStr = srcStr.substring(1);
                }
            }
            else {
                // 非表达式，处理成普通字符节点
                const match = /([^\<\{]*)/.exec(srcStr);
                if (match) {
                    let txt;
                    if (this.current && this.current.tagName === 'pre') {
                        // 在pre标签里
                        txt = this.preHandleText(srcStr.substring(0, match.index + match[0].length));
                    }
                    else {
                        txt = this.preHandleText(srcStr.substring(0, match.index + match[0].length).trim());
                    }
                    if (txt !== '') {
                        this.textArr.push(txt);
                    }
                }
                srcStr = srcStr.substring(match.index + match[0].length);
            }
        }
        // 最开始是< 或者字符消耗完毕 退出循环
        const text = new VirtualDom(undefined, this.genKey(), this.module);
        if (this.isExprText) {
            text.expressions = [...this.textArr];
            //动态文本节点，staticNum=-1
            text.staticNum = -1;
            text.addPatchFlag(PatchFlags.TEXT);
            for (const item of this.textArr) {
                if (item instanceof Expression) {
                    text.addDepPaths(item.depPaths);
                    if (item.hasUnknownDeps) {
                        text.markForceFullRender();
                    }
                }
            }
        }
        else {
            text.textContent = this.textArr.join('');
        }
        text.finalizeOptimization();
        if (this.current && (this.isExprText || text.textContent.length !== 0)) {
            this.current.add(text);
        }
        // 重置状态
        this.isExprText = false;
        this.textArr = [];
        // 返回字符串
        return srcStr;
    }
    /**
     * 预处理html保留字符 如 &nbsp;,&lt;等
     * @param str -   待处理的字符串
     * @returns     解析之后的串
     */
    preHandleText(str) {
        const reg = /&[a-z]+;/;
        if (reg.test(str)) {
            const div = document.createElement('div');
            div.innerHTML = str;
            return div.textContent;
        }
        return str;
    }
    /**
     * 处理当前节点是模块或者自定义节点
     * @param dom - 	虚拟dom节点
     */
    postHandleNode(dom) {
        const clazz = DefineElementManager.get(dom.tagName);
        if (clazz) {
            Reflect.construct(clazz, [dom, this.module]);
        }
        // 是否是模块类
        if (ModuleFactory.hasClass(dom.tagName)) {
            dom.addDirective(new Directive('module', dom.tagName));
            dom.tagName = 'div';
        }
    }
    /**
     * 处理插槽
     * @param dom - 	虚拟dom节点
     */
    handleSlot(dom) {
        var _a;
        if (!dom.children || dom.children.length === 0 || !dom.hasDirective('module')) {
            return;
        }
        //default slot节点
        let slotCt;
        for (let j = 0; j < dom.children.length; j++) {
            const c = dom.children[j];
            //已经是slot节点且有子节点
            if (c.hasDirective('slot') && ((_a = c.children) === null || _a === void 0 ? void 0 : _a.length) > 0) {
                const d = c.getDirective('slot');
                // 默认slot
                if (d.value === undefined || d.value === 'default') {
                    if (!slotCt) { // slotCt还不存在，直接替代
                        slotCt = c;
                    }
                    else {
                        //子节点合并到slotCt
                        slotCt.children = slotCt.children.concat(c.children);
                        //节点移除
                        dom.children.splice(j--, 1);
                    }
                }
                else {
                    continue;
                }
            }
            else { //非slot节点，添加到default slot节点
                if (!slotCt) { //初始化default slot container
                    //第一个直接被slotCt替换
                    slotCt = new VirtualDom('div', this.genKey(), this.module);
                    slotCt.addDirective(new Directive('slot', 'default'));
                    //当前位置，用slot替代
                    dom.children.splice(j, 1, slotCt);
                }
                else { //直接删除
                    dom.children.splice(j--, 1);
                }
                //添加到slotCt
                slotCt.add(c);
            }
        }
    }
    /**
     * 标签闭合
     */
    handleCloseTag(dom, isSelfClose) {
        this.postHandleNode(dom);
        dom.sortDirective();
        const structuralDirective = getStructuralDirectiveName(dom);
        const structuralMeta = structuralDirective ? getStructuralDirectiveMeta(structuralDirective, dom) : undefined;
        if (structuralMeta) {
            if (structuralMeta.structureFlag !== StructureFlags.NONE) {
                dom.addStructureFlag(structuralMeta.structureFlag);
            }
            if (structuralMeta.patchFlag !== undefined) {
                dom.addPatchFlag(structuralMeta.patchFlag);
            }
            if (structuralMeta.forceFullRender) {
                dom.markForceFullRender();
            }
            if (structuralMeta.markBlockRoot) {
                dom.markBlockRoot();
            }
        }
        if (!isSelfClose) {
            this.handleSlot(dom);
        }
        dom.finalizeOptimization();
        //闭合节点出栈
        this.domArr.pop();
        //设置current为最后一个节点
        if (this.domArr.length > 0) {
            this.current = this.domArr[this.domArr.length - 1];
        }
        // 取消isSvg标识
        if (dom.tagName === 'svg') {
            this.isSvg = false;
        }
    }
    /**
     * 判断节点是否为空节点
     * @param dom -	带检测节点
     * @returns
     */
    isVoidTab(dom) {
        return voidTagMap.has(dom.tagName);
    }
}
function resolvePropPatchFlag(name) {
    if (name[0] === "$") {
        return PatchFlags.ASSETS;
    }
    if (name === "class") {
        return PatchFlags.CLASS;
    }
    if (name === "style") {
        return PatchFlags.STYLE;
    }
    return PatchFlags.PROPS;
}
function normalizeDynamicPropName(name) {
    return name[0] === "$" ? name.substring(1) : name;
}
function getStructuralDirectiveName(dom) {
    var _a;
    if (!dom.directives || dom.directives.length === 0) {
        return;
    }
    return (_a = dom.directives.find(directive => structuralDirectiveNames.has(directive.type.name))) === null || _a === void 0 ? void 0 : _a.type.name;
}
function hasStableKeyProp(dom) {
    const keyProp = dom.getProp("key");
    return keyProp !== undefined && keyProp !== null && keyProp !== "";
}
function getStructuralDirectiveMeta(name, dom) {
    switch (name) {
        case "repeat":
            return {
                forceFullRender: true,
                markBlockRoot: true,
                patchFlag: hasStableKeyProp(dom) ? PatchFlags.KEYED_FRAGMENT : PatchFlags.UNKEYED_FRAGMENT,
                structureFlag: StructureFlags.LIST
            };
        case "recur":
            return {
                forceFullRender: true,
                markBlockRoot: true,
                structureFlag: StructureFlags.RECURSIVE
            };
        case "if":
        case "else":
        case "elseif":
            return {
                forceFullRender: true,
                markBlockRoot: true,
                structureFlag: StructureFlags.CONDITIONAL
            };
        case "slot":
            return {
                forceFullRender: true,
                markBlockRoot: true,
                structureFlag: StructureFlags.SLOT
            };
        case "module":
            return {
                forceFullRender: true,
                markBlockRoot: true,
                structureFlag: StructureFlags.MODULE
            };
        case "route":
            return {
                forceFullRender: true,
                markBlockRoot: true,
                structureFlag: StructureFlags.ROUTE_LINK
            };
        case "router":
            return {
                forceFullRender: true,
                markBlockRoot: true,
                structureFlag: StructureFlags.ROUTE_VIEW
            };
        case "endif":
            return {
                forceFullRender: false,
                markBlockRoot: false,
                structureFlag: StructureFlags.NONE
            };
        default:
            return {
                forceFullRender: true,
                markBlockRoot: true,
                structureFlag: StructureFlags.NONE
            };
    }
}
const structuralDirectiveNames = new Set([
    "module",
    "repeat",
    "recur",
    "if",
    "else",
    "elseif",
    "endif",
    "slot",
    "route",
    "router"
]);

/**
 * 自定义元素
 *
 * @remarks
 * 用于扩充标签，主要用于指令简写，参考 ./extend/elementinit.ts。
 *
 * 如果未指定标签名，默认为`div`，也可以用`tag`属性指定
 *
 * @example
 * ```html
 *   <!-- 渲染后标签名为div -->
 *   <if cond={{any}}>hello</if>
 *   <!-- 渲染后标签名为p -->
 *   <if cond={{any}} tag='p'>hello</if>
 * ```
 */
class DefineElement {
    /**
     * 构造器，在dom编译后执行
     * @param node - 虚拟dom节点
     * @param module - 模块
     */
    constructor(node, module) {
        if (node.hasProp('tag')) {
            node.tagName = node.getProp('tag');
            node.delProp('tag');
        }
        else {
            node.tagName = 'div';
        }
    }
}

/**
 * css 管理器
 * @privateRemarks
 * 针对不同的rule，处理方式不同
 *
 * CssStyleRule 进行保存和替换，同时模块作用域scope有效
 *
 * CssImportRule 路径不重复添加，因为必须加在stylerule前面，所以需要记录最后的import索引号
 */
class CssManager {
    /**
     * 处理style 元素
     * @param module - 模块
     * @param dom - 虚拟dom
     * @returns 如果是styledom，则返回true，否则返回false
     */
    static handleStyleDom(module, dom) {
        if (dom.props["scope"] === "this") {
            let root;
            for (root = dom.parent; root === null || root === void 0 ? void 0 : root.parent; root = root.parent)
                ;
            const cls = this.cssPreName + module.id;
            if (root.props["class"]) {
                root.props["class"] = root.props["class"] + " " + cls;
            }
            else {
                root.props["class"] = cls;
            }
        }
    }
    /**
     * 处理 style 下的文本元素
     * @param module - 模块
     * @param dom - style text element
     * @returns 如果是styleTextdom返回true，否则返回false
     */
    static handleStyleTextDom(module, dom) {
        if (!dom.parent || dom.parent.tagName !== "style") {
            return false;
        }
        CssManager.addRules(module, dom.textContent, dom.parent && dom.parent.props["scope"] === "this" ? "." + this.cssPreName + module.id : undefined);
        return true;
    }
    /**
     * 添加多个css rule
     * @param cssText - rule集合
     * @param module - 模块
     * @param scopeName - 作用域名(前置选择器)
     */
    static addRules(module, cssText, scopeName) {
        if (!this.sheet) {
            const sheet = document.createElement("style");
            document.head.appendChild(sheet);
            this.sheet = document.styleSheets[0];
        }
        if (scopeName) {
            this.clearModuleRules(module);
        }
        const reg = /(@[a-zA-Z]+\s+url\(.+?\))|([.#@a-zA-Z]\S*(\s*\S*\s*?)?{)|\}/g;
        const regImp = /@[a-zA-Z]+\s+url/;
        let startIndex = -1;
        let beginNum = 0;
        let re;
        while ((re = reg.exec(cssText)) !== null) {
            if (regImp.test(re[0])) {
                handleImport(re[0]);
            }
            else if (re[0] === "}") {
                if (startIndex >= 0 && --beginNum <= 0) {
                    const txt = cssText.substring(startIndex, re.index + 1);
                    if (txt[0] === "@") {
                        this.sheet.insertRule(txt, CssManager.sheet.cssRules ? CssManager.sheet.cssRules.length : 0);
                    }
                    else {
                        handleStyle(module, txt, scopeName);
                    }
                    startIndex = -1;
                    beginNum = 0;
                }
            }
            else {
                if (startIndex === -1) {
                    startIndex = re.index;
                }
                beginNum++;
            }
        }
        function handleStyle(module, cssText, scopeName) {
            const reg = /.+(?=\{)/;
            const r = reg.exec(cssText);
            if (!r) {
                return;
            }
            if (scopeName) {
                let arr = module.cssRules;
                if (!arr) {
                    arr = [];
                    module.cssRules = arr;
                }
                arr.push((scopeName + " " + r[0]));
                cssText = scopeName + " " + cssText;
            }
            CssManager.sheet.insertRule(cssText, CssManager.sheet.cssRules ? CssManager.sheet.cssRules.length : 0);
        }
        function handleImport(cssText) {
            const ind = cssText.indexOf("(");
            const ind1 = cssText.lastIndexOf(")");
            if (ind === -1 || ind1 === -1 || ind >= ind1) {
                return;
            }
            const css = cssText.substring(ind + 1, ind1);
            if (CssManager.importMap.has(css)) {
                return;
            }
            CssManager.sheet.insertRule(cssText, CssManager.importIndex++);
            CssManager.importMap.set(css, true);
        }
    }
    /**
     * 清除模块css rules
     * @param module - 模块
     */
    static clearModuleRules(module) {
        const rules = module.cssRules;
        if (!rules || rules.length === 0) {
            return;
        }
        for (let i = 0; i < this.sheet.cssRules.length; i++) {
            const r = this.sheet.cssRules[i];
            if (r.selectorText && rules.indexOf(r.selectorText) !== -1) {
                this.sheet.deleteRule(i--);
            }
        }
        module.cssRules = [];
    }
}
/**
 * import url map，用于存储import的url路径
 */
CssManager.importMap = new Map();
/**
 * importrule 位置
 */
CssManager.importIndex = 0;
/**
 * css class 前置名
 */
CssManager.cssPreName = "___nodom_module_css_";

class DiffTool {
    static compare(src, dst) {
        const changeArr = [];
        clearUsed(dst);
        compareNode(src, dst);
        return changeArr;
        function compareNode(nextNode, prevNode) {
            if (!nextNode || !prevNode) {
                return;
            }
            if (nextNode === prevNode || nextNode.__skipDiff) {
                nextNode.node = prevNode.node;
                prevNode["__used"] = true;
                return;
            }
            nextNode.node = prevNode.node;
            prevNode["__used"] = true;
            if (!nextNode.tagName) {
                if (!prevNode.tagName) {
                    if (shouldTextChange(nextNode, prevNode)) {
                        addChange(2, nextNode, prevNode, prevNode.parent);
                    }
                    else if (nextNode.childModuleId !== prevNode.childModuleId) {
                        addChange(5, nextNode, prevNode, prevNode.parent);
                    }
                    return;
                }
                addChange(5, nextNode, prevNode, prevNode.parent);
                return;
            }
            if (((nextNode.childModuleId || prevNode.childModuleId) && nextNode.childModuleId !== prevNode.childModuleId)
                || nextNode.tagName !== prevNode.tagName) {
                addChange(5, nextNode, prevNode, prevNode.parent);
                return;
            }
            if (shouldUpdateNode(nextNode, prevNode)) {
                addChange(2, nextNode, prevNode, prevNode.parent);
            }
            compareChildren(nextNode, prevNode);
        }
        function compareChildren(nextNode, prevNode) {
            var _a, _b, _c, _d;
            const nextChildren = nextNode.children || [];
            const prevChildren = prevNode.children || [];
            const fragmentPatchFlag = (_b = (_a = nextNode.childrenPatchFlag) !== null && _a !== void 0 ? _a : prevNode.childrenPatchFlag) !== null && _b !== void 0 ? _b : PatchFlags.NONE;
            const structureFlags = (_d = (_c = nextNode.childrenStructureFlags) !== null && _c !== void 0 ? _c : prevNode.childrenStructureFlags) !== null && _d !== void 0 ? _d : StructureFlags.NONE;
            if (nextChildren.length === 0) {
                if (prevChildren.length > 0) {
                    prevChildren.forEach(item => addChange(3, item, null, prevNode));
                }
                return;
            }
            if (prevChildren.length === 0) {
                nextChildren.forEach((item, index) => addChange(1, item, null, prevNode, index));
                return;
            }
            if (canUseBlockDiff(nextNode)) {
                compareBlockChildren(nextNode, prevNode);
                return;
            }
            if ((fragmentPatchFlag & PatchFlags.UNKEYED_FRAGMENT) !== 0) {
                compareChildrenLegacy(nextNode, prevNode);
                return;
            }
            if (shouldPreferStructuralDiff(fragmentPatchFlag, structureFlags)) {
                compareChildrenLegacy(nextNode, prevNode);
                return;
            }
            if ((fragmentPatchFlag & PatchFlags.KEYED_FRAGMENT) === 0
                && (!canUseKeyedDiff(nextChildren) || !canUseKeyedDiff(prevChildren))) {
                compareChildrenLegacy(nextNode, prevNode);
                return;
            }
            const nextKeyToIndex = new Map();
            for (let i = 0; i < nextChildren.length; i++) {
                nextKeyToIndex.set(nextChildren[i].key, i);
            }
            const newIndexToOldIndexMap = new Array(nextChildren.length).fill(-1);
            for (let oldIndex = 0; oldIndex < prevChildren.length; oldIndex++) {
                const prevChild = prevChildren[oldIndex];
                const newIndex = nextKeyToIndex.get(prevChild.key);
                if (newIndex === undefined) {
                    addChange(3, prevChild, null, prevNode);
                    continue;
                }
                newIndexToOldIndexMap[newIndex] = oldIndex;
                compareNode(nextChildren[newIndex], prevChild);
            }
            const stableSequence = getSequence(newIndexToOldIndexMap);
            let stableIndex = stableSequence.length - 1;
            for (let newIndex = nextChildren.length - 1; newIndex >= 0; newIndex--) {
                const nextChild = nextChildren[newIndex];
                const oldIndex = newIndexToOldIndexMap[newIndex];
                if (oldIndex === -1) {
                    addChange(1, nextChild, null, prevNode, newIndex);
                    continue;
                }
                if (stableIndex < 0 || newIndex !== stableSequence[stableIndex]) {
                    addChange(4, nextChild, null, prevNode, newIndex, oldIndex);
                    continue;
                }
                stableIndex--;
            }
        }
        function compareBlockChildren(nextNode, prevNode) {
            var _a;
            const nextChildren = nextNode.children || [];
            const prevChildren = prevNode.children || [];
            const dynamicKeys = new Set(nextNode.dynamicChildKeys || []);
            const nextEntries = [];
            const nextKeyToIndex = new Map();
            for (let index = 0; index < nextChildren.length; index++) {
                const child = nextChildren[index];
                if (dynamicKeys.has(child.key)) {
                    nextKeyToIndex.set(child.key, nextEntries.length);
                    nextEntries.push({ child, index });
                    continue;
                }
                const prevIndex = (_a = prevNode.locMap) === null || _a === void 0 ? void 0 : _a.get(child.key);
                const prevChild = prevIndex !== undefined
                    ? prevChildren[prevIndex]
                    : prevChildren.find(item => item.key === child.key);
                if (prevChild) {
                    child.node = prevChild.node;
                    prevChild["__used"] = true;
                    continue;
                }
                addChange(1, child, null, prevNode, index);
            }
            const newIndexToOldIndexMap = new Array(nextEntries.length).fill(-1);
            for (let oldIndex = 0; oldIndex < prevChildren.length; oldIndex++) {
                const prevChild = prevChildren[oldIndex];
                if (prevChild["__used"]) {
                    continue;
                }
                const newIndex = nextKeyToIndex.get(prevChild.key);
                if (newIndex === undefined) {
                    addChange(3, prevChild, null, prevNode);
                    continue;
                }
                newIndexToOldIndexMap[newIndex] = oldIndex;
                compareNode(nextEntries[newIndex].child, prevChild);
            }
            const stableSequence = getSequence(newIndexToOldIndexMap);
            let stableIndex = stableSequence.length - 1;
            for (let newIndex = nextEntries.length - 1; newIndex >= 0; newIndex--) {
                const entry = nextEntries[newIndex];
                const oldIndex = newIndexToOldIndexMap[newIndex];
                if (oldIndex === -1) {
                    addChange(1, entry.child, null, prevNode, entry.index);
                    continue;
                }
                if (stableIndex < 0 || newIndex !== stableSequence[stableIndex]) {
                    addChange(4, entry.child, null, prevNode, entry.index, oldIndex);
                    continue;
                }
                stableIndex--;
            }
        }
        function compareChildrenLegacy(nextNode, prevNode) {
            var _a, _b, _c, _d;
            let oldIndex = 0;
            for (let i = 0; i < (((_a = nextNode.children) === null || _a === void 0 ? void 0 : _a.length) || 0); i++) {
                const child = nextNode.children[i];
                if (((_b = prevNode.children) === null || _b === void 0 ? void 0 : _b[oldIndex]) && prevNode.children[oldIndex].key === child.key) {
                    if (oldIndex !== i) {
                        addChange(4, child, null, prevNode, i, oldIndex);
                    }
                    compareNode(child, prevNode.children[oldIndex]);
                }
                else if ((_c = prevNode.locMap) === null || _c === void 0 ? void 0 : _c.has(child.key)) {
                    const nextLoc = (_d = nextNode.locMap) === null || _d === void 0 ? void 0 : _d.get(child.key);
                    const oldLoc = prevNode.locMap.get(child.key);
                    if (nextLoc !== oldLoc) {
                        addChange(4, child, null, prevNode, nextLoc, oldLoc);
                        oldIndex = oldLoc;
                    }
                    compareNode(child, prevNode.children[oldLoc]);
                }
                else {
                    addChange(1, child, null, prevNode, i);
                }
                oldIndex++;
            }
            for (const child of prevNode.children || []) {
                if (!child["__used"]) {
                    addChange(3, child, null, prevNode);
                }
            }
        }
        function shouldTextChange(nextNode, prevNode) {
            var _a;
            if (nextNode.childModuleId !== prevNode.childModuleId) {
                return true;
            }
            if (((_a = nextNode.patchFlag) !== null && _a !== void 0 ? _a : prevNode.patchFlag) === PatchFlags.TEXT) {
                return nextNode.textContent !== prevNode.textContent;
            }
            return !!(nextNode.staticNum || prevNode.staticNum) && nextNode.textContent !== prevNode.textContent;
        }
        function shouldUpdateNode(nextNode, prevNode) {
            var _a, _b, _c, _d, _e, _f;
            if (hasTeleportStateChanged(nextNode, prevNode)) {
                return true;
            }
            if (hasTransitionStateChanged(nextNode, prevNode)) {
                return true;
            }
            if (!(nextNode.staticNum || prevNode.staticNum || prevNode.key === 1)) {
                return false;
            }
            const patchFlag = (_b = (_a = nextNode.patchFlag) !== null && _a !== void 0 ? _a : prevNode.patchFlag) !== null && _b !== void 0 ? _b : PatchFlags.NONE;
            if (patchFlag === PatchFlags.NONE || (patchFlag & PatchFlags.BAIL) !== 0 || (patchFlag & PatchFlags.DIRECTIVES) !== 0 || prevNode.key === 1) {
                return isChanged(nextNode, prevNode);
            }
            if ((patchFlag & PatchFlags.TEXT) !== 0 && nextNode.textContent !== prevNode.textContent) {
                return true;
            }
            if ((patchFlag & PatchFlags.CLASS) !== 0 && ((_c = nextNode.props) === null || _c === void 0 ? void 0 : _c["class"]) !== ((_d = prevNode.props) === null || _d === void 0 ? void 0 : _d["class"])) {
                return true;
            }
            if ((patchFlag & PatchFlags.STYLE) !== 0 && ((_e = nextNode.props) === null || _e === void 0 ? void 0 : _e["style"]) !== ((_f = prevNode.props) === null || _f === void 0 ? void 0 : _f["style"])) {
                return true;
            }
            if ((patchFlag & PatchFlags.PROPS) !== 0 && hasChangedKeys(nextNode.dynamicProps, nextNode.props, prevNode.props)) {
                return true;
            }
            if ((patchFlag & PatchFlags.ASSETS) !== 0 && hasChangedKeys(nextNode.dynamicProps, nextNode.assets, prevNode.assets)) {
                return true;
            }
            if ((patchFlag & PatchFlags.EVENTS) !== 0 && !sameEventList(nextNode.events, prevNode.events)) {
                return true;
            }
            return false;
        }
        function isChanged(nextNode, prevNode) {
            if (hasTeleportStateChanged(nextNode, prevNode)) {
                return true;
            }
            if (hasTransitionStateChanged(nextNode, prevNode)) {
                return true;
            }
            for (const prop of ["props", "assets", "events"]) {
                if ((!nextNode[prop] && prevNode[prop]) || (nextNode[prop] && !prevNode[prop])) {
                    return true;
                }
                if (!nextNode[prop] || !prevNode[prop]) {
                    continue;
                }
                const nextKeys = Object.keys(nextNode[prop]);
                const prevKeys = Object.keys(prevNode[prop]);
                if (nextKeys.length !== prevKeys.length) {
                    return true;
                }
                for (const key of nextKeys) {
                    if (nextNode[prop][key] !== prevNode[prop][key]) {
                        return true;
                    }
                }
            }
            return false;
        }
        function addChange(type, dom, dom1, parent, loc, loc1) {
            const changed = [type, dom, dom1, parent, loc, loc1];
            if (type === 5) {
                delete dom.node;
            }
            changeArr.push(changed);
            return changed;
        }
    }
}
function hasTeleportStateChanged(nextNode, prevNode) {
    const nextTeleportNode = nextNode;
    const prevTeleportNode = prevNode;
    return nextTeleportNode.teleportTarget !== prevTeleportNode.teleportTarget
        || nextTeleportNode.teleportDisabled !== prevTeleportNode.teleportDisabled;
}
function hasTransitionStateChanged(nextNode, prevNode) {
    const nextTransition = nextNode.transition;
    const prevTransition = prevNode.transition;
    if (nextTransition === prevTransition) {
        return false;
    }
    if (!nextTransition || !prevTransition) {
        return nextTransition !== prevTransition;
    }
    return nextTransition.name !== prevTransition.name
        || nextTransition.duration !== prevTransition.duration
        || nextTransition.enterDuration !== prevTransition.enterDuration
        || nextTransition.leaveDuration !== prevTransition.leaveDuration
        || nextTransition.moveDuration !== prevTransition.moveDuration
        || nextTransition.enterFromClass !== prevTransition.enterFromClass
        || nextTransition.enterActiveClass !== prevTransition.enterActiveClass
        || nextTransition.enterToClass !== prevTransition.enterToClass
        || nextTransition.leaveFromClass !== prevTransition.leaveFromClass
        || nextTransition.leaveActiveClass !== prevTransition.leaveActiveClass
        || nextTransition.leaveToClass !== prevTransition.leaveToClass
        || nextTransition.moveClass !== prevTransition.moveClass
        || nextTransition.group !== prevTransition.group;
}
function canUseBlockDiff(node) {
    return !!node.dynamicChildKeys && node.dynamicChildKeys.length > 0;
}
function clearUsed(dom) {
    if (!dom) {
        return;
    }
    delete dom["__used"];
    if (dom.children) {
        for (const child of dom.children) {
            clearUsed(child);
        }
    }
}
function canUseKeyedDiff(children) {
    const keys = new Set();
    for (const child of children) {
        if (child.key === undefined || child.key === null || keys.has(child.key)) {
            return false;
        }
        keys.add(child.key);
    }
    return true;
}
function hasChangedKeys(keys, nextValues, prevValues) {
    if (!keys || keys.length === 0) {
        return false;
    }
    for (const key of keys) {
        if ((nextValues === null || nextValues === void 0 ? void 0 : nextValues[key]) !== (prevValues === null || prevValues === void 0 ? void 0 : prevValues[key])) {
            return true;
        }
    }
    return false;
}
function sameEventList(left, right) {
    if (left === right) {
        return true;
    }
    if (!left || !right || left.length !== right.length) {
        return false;
    }
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) {
            return false;
        }
    }
    return true;
}
function shouldPreferStructuralDiff(fragmentPatchFlag, structureFlags) {
    if ((fragmentPatchFlag & PatchFlags.KEYED_FRAGMENT) !== 0) {
        return false;
    }
    return (structureFlags & nonFragmentStructureFlags) !== 0;
}
const nonFragmentStructureFlags = StructureFlags.CONDITIONAL
    | StructureFlags.SLOT
    | StructureFlags.MODULE
    | StructureFlags.ROUTE_LINK
    | StructureFlags.ROUTE_VIEW
    | StructureFlags.RECURSIVE;

/**
 * 事件工厂
 *
 * @remarks
 * 每个模块一个事件工厂，用于管理模块内虚拟dom对应的事件对象
 * 事件配置不支持表达式
 * 代理事件不支持capture和nopopo
 *
 * 当父模块传递事件给子模块时，子模块根节点的参数model为子模块srcDom的model（来源于父模块），根节点自带事件model为子模块model
 * 如果存在传递事件和自带事件，则执行顺序为 1.自带事件 2.传递事件
 */
class EventFactory {
    /**
     * 构造器
     * @param module - 模块
     */
    constructor(module) {
        /**
         * 自有事件map
         */
        this.eventMap = new Map();
        /**
         * 代理事件map
         */
        this.delgMap = new Map();
        this.module = module;
    }
    /**
     * 添加事件
     * @param dom - 渲染节点
     * @param event - 事件对象
     */
    addEvent(dom, event) {
        dom.events.push(event);
        if (dom.node) {
            this.bind(dom, [event]);
        }
    }
    /**
     * 删除事件
     * @param dom - 渲染节点
     * @param event - 事件对象
     */
    removeEvent(dom, event) {
        var _a, _b, _c, _d;
        const events = (event ? [event] : dom.events);
        if (!events || !Array.isArray(events)) {
            return;
        }
        for (const ev of events) {
            if (ev.delg) {
                const parent = dom.key === 1 ? (_a = this.module.srcDom) === null || _a === void 0 ? void 0 : _a.parent : dom.parent;
                const pkey = dom.key === 1 ? ((_c = (_b = this.module.srcDom) === null || _b === void 0 ? void 0 : _b.parent) === null || _c === void 0 ? void 0 : _c.key) + "s" : (_d = dom.parent) === null || _d === void 0 ? void 0 : _d.key;
                if (!parent || !this.delgMap.has(pkey)) {
                    return;
                }
                const cfgKey = parent.moduleId !== dom.moduleId ? pkey : parent.key;
                const cfg = this.delgMap.get(cfgKey);
                if (!cfg || !cfg.has(ev.name)) {
                    return;
                }
                const obj = cfg.get(ev.name);
                const index = obj.events.findIndex(item => item.event === ev);
                if (index !== -1) {
                    obj.events.splice(index, 1);
                }
                if (obj.events.length === 0) {
                    this.unbind(cfgKey, ev, true);
                }
            }
            else {
                this.unbind(dom.key, ev);
            }
        }
    }
    /**
     * 绑定dom节点所有事件
     * @param dom - 渲染dom
     * @param events - 事件对象数组
     */
    bind(dom, events) {
        const el = dom.node;
        for (const ev of events) {
            if (ev.delg) {
                const parent = dom.key === 1 ? this.module.srcDom.parent : dom.parent;
                if (parent) {
                    this.bindDelg(parent, dom, ev);
                }
            }
            else {
                const controller = new AbortController();
                el.addEventListener(ev.name, (e) => {
                    if (ev.nopopo) {
                        e.stopPropagation();
                    }
                    this.invoke(ev, dom, e);
                }, {
                    capture: ev.capture,
                    once: ev.once,
                    signal: controller.signal
                });
                if (!ev.once) {
                    const o = { eventName: ev.name, controller: controller };
                    if (!this.eventMap.has(dom.key)) {
                        this.eventMap.set(dom.key, [o]);
                    }
                    else {
                        this.eventMap.get(dom.key).push(o);
                    }
                }
            }
        }
    }
    /**
     * 绑定到代理对象
     * @param dom - 代理dom
     * @param dom1 - 被代理dom
     * @param event - 事件对象
     */
    bindDelg(dom, dom1, event) {
        let map;
        const pkey = dom.moduleId !== dom1.moduleId ? dom.key + "s" : dom.key;
        if (!this.delgMap.has(pkey)) {
            map = new Map();
            this.delgMap.set(pkey, map);
        }
        else {
            map = this.delgMap.get(pkey);
        }
        let cfg;
        if (map.has(event.name)) {
            cfg = map.get(event.name);
            cfg.events.push({ event: event, dom: dom1 });
        }
        else {
            cfg = { controller: new AbortController, events: [{ event: event, dom: dom1 }] };
            map.set(event.name, cfg);
            dom.node.addEventListener(event.name, (e) => {
                this.doDelgEvent(dom, event.name, e);
            }, {
                signal: cfg.controller.signal
            });
        }
    }
    /**
     * 解绑dom节点事件
     * @param key - dom key
     * @param event - 事件对象或事件名
     * @param delg - 是否为代理事件
     */
    unbind(key, event, delg) {
        var _a, _b, _c;
        if (event && event instanceof NEvent) {
            delg || (delg = event.delg);
        }
        if (delg) {
            if (!this.delgMap.has(key)) {
                return;
            }
            const obj = this.delgMap.get(key);
            if (event) {
                const eventName = event instanceof NEvent ? event.name : event;
                if (obj.has(eventName)) {
                    (_b = (_a = obj.get(eventName)) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.abort();
                }
            }
            else {
                for (const k of obj.keys()) {
                    (_c = obj.get(k).controller) === null || _c === void 0 ? void 0 : _c.abort();
                }
            }
        }
        else {
            if (!this.eventMap.has(key)) {
                return;
            }
            const arr = this.eventMap.get(key);
            if (event) {
                const o = arr.find(item => item.eventName === event);
                if (o) {
                    o.controller.abort();
                }
            }
            else {
                for (const o of arr) {
                    o.controller.abort();
                }
            }
            if (arr.length === 0) {
                this.eventMap.delete(key);
            }
        }
    }
    /**
     * 执行代理事件
     * @param dom - 代理节点
     * @param eventName - 事件名
     * @param e - html event对象
     */
    doDelgEvent(dom, eventName, e) {
        const key = dom.moduleId !== this.module.id ? dom.key + "s" : dom.key;
        if (!this.delgMap.has(key)) {
            return;
        }
        const map = this.delgMap.get(key);
        if (!map.has(eventName)) {
            return;
        }
        const cfg = map.get(eventName);
        const elArr = e.path || (e.composedPath ? e.composedPath() : undefined);
        if (!elArr) {
            return;
        }
        for (let ii = 0; ii < cfg.events.length; ii++) {
            const obj = cfg.events[ii];
            const ev = obj.event;
            const dom1 = obj.dom;
            const el = dom1.node;
            for (let i = 0; i < elArr.length && elArr[i] !== dom.node; i++) {
                if (elArr[i] === el) {
                    this.invoke(ev, dom1, e);
                    if (ev.once) {
                        cfg.events.splice(ii--, 1);
                        if (cfg.events.length === 0) {
                            this.unbind(key, eventName, true);
                        }
                    }
                    break;
                }
            }
        }
    }
    /**
     * 调用方法
     * @param event - 事件对象
     * @param dom - 渲染节点
     * @param e - html 事件对象
     */
    invoke(event, dom, e) {
        let model;
        if (event.module && event.module.id !== this.module.id) {
            model = this.module.srcDom.model;
            dom = this.module.srcDom;
        }
        else {
            dom = event.module.getRenderedDom(dom.key);
            model = dom.model;
        }
        if (typeof event.handler === "string") {
            event.module.invokeMethod(event.handler, model, dom, event, e);
        }
        else if (typeof event.handler === "function") {
            event.handler.apply(event.module || this.module, [model, dom, event, e]);
        }
    }
    /**
     * 清除所有事件
     */
    clear() {
        for (const key of this.eventMap.keys()) {
            this.unbind(key);
        }
        this.eventMap.clear();
        for (const key of this.delgMap.keys()) {
            this.unbind(key, null, true);
        }
        this.delgMap.clear();
    }
    /**
     * 处理dom event
     * @param dom - 新dom
     * @param oldDom - 旧dom
     */
    handleDomEvent(dom, oldDom) {
        const events = dom.events;
        let arr = [];
        if (oldDom && Array.isArray(oldDom.events)) {
            const oldEvents = oldDom.events;
            if (Array.isArray(events)) {
                events.forEach((ev) => {
                    let index;
                    if ((index = oldEvents.indexOf(ev)) !== -1) {
                        oldEvents.splice(index, 1);
                    }
                    else {
                        arr.push(ev);
                    }
                });
            }
            if (oldEvents.length > 0) {
                for (const ev of oldEvents) {
                    this.removeEvent(oldDom, ev);
                }
            }
        }
        else {
            arr = events || [];
        }
        if ((arr === null || arr === void 0 ? void 0 : arr.length) > 0) {
            this.bind(dom, arr);
        }
    }
}

class RequestManager {
    static setRejectTime(time) {
        this.rejectReqTick = time;
    }
    static request(config) {
        return __awaiter(this, void 0, void 0, function* () {
            if (typeof config === "string") {
                config = { url: config };
            }
            config = config || {};
            config.params = config.params || {};
            this.clearCache();
            const time = Date.now();
            if (this.rejectReqTick > 0) {
                const cached = this.requestMap.get(config.url);
                if (cached && time - cached.time < this.rejectReqTick && Util.compare(cached.params, config.params)) {
                    return null;
                }
                this.requestMap.set(config.url, {
                    time,
                    params: config.params
                });
            }
            return new Promise((resolve, reject) => {
                if (config.rand) {
                    config.params.$rand = Math.random();
                }
                let url = config.url;
                const async = config.async === false ? false : true;
                const req = new XMLHttpRequest();
                req.withCredentials = config.withCredentials;
                const method = (config.method || "GET").toUpperCase();
                req.timeout = async ? config.timeout : 0;
                req.onload = () => {
                    if (req.status === 200) {
                        let response = req.responseText;
                        if (config.type === "json") {
                            try {
                                response = JSON.parse(req.responseText);
                            }
                            catch (_a) {
                                reject({ type: "jsonparse" });
                                return;
                            }
                        }
                        resolve(response);
                        return;
                    }
                    reject({ type: "error", url });
                };
                req.ontimeout = () => reject({ type: "timeout" });
                req.onerror = () => reject({ type: "error", url });
                let data = null;
                if (method === "GET") {
                    const query = this.buildQuery(config.params);
                    if (query) {
                        url += url.includes("?") ? `&${query}` : `?${query}`;
                    }
                }
                else if (method === "POST") {
                    data = config.params instanceof FormData ? config.params : this.buildFormData(config.params);
                }
                req.open(method, url, async, config.user, config.pwd);
                if (config.header) {
                    Util.getOwnProps(config.header).forEach((item) => {
                        req.setRequestHeader(item, config.header[item]);
                    });
                }
                req.send(data);
            }).catch((error) => {
                switch (error.type) {
                    case "error":
                        throw new NError("notexist1", NodomMessage.TipWords["resource"], error.url);
                    case "timeout":
                        throw new NError("timeout");
                    case "jsonparse":
                        throw new NError("jsonparse");
                }
            });
        });
    }
    static clearCache() {
        const time = Date.now();
        if (this.rejectReqTick <= 0) {
            return;
        }
        for (const [key, value] of this.requestMap) {
            if (time - value.time > this.rejectReqTick) {
                this.requestMap.delete(key);
            }
        }
    }
    static buildQuery(params) {
        if (!Util.isObject(params)) {
            return "";
        }
        const parts = [];
        for (const key of Object.keys(params)) {
            let value = params[key];
            if (value === undefined || value === null) {
                continue;
            }
            if (typeof value === "object") {
                value = JSON.stringify(value);
            }
            parts.push(`${key}=${value}`);
        }
        return parts.join("&");
    }
    static buildFormData(params) {
        const fd = new FormData();
        for (const key of Object.keys(params || {})) {
            let value = params[key];
            if (value === undefined || value === null) {
                continue;
            }
            if (typeof value === "object") {
                value = JSON.stringify(value);
            }
            fd.append(key, value);
        }
        return fd;
    }
}
RequestManager.rejectReqTick = 0;
RequestManager.requestMap = new Map();

class Scheduler {
    static dispatch() {
        for (const item of Scheduler.tasks) {
            if (!Util.isFunction(item.func)) {
                continue;
            }
            if (item.thiser) {
                item.func.call(item.thiser);
            }
            else {
                item.func();
            }
        }
    }
    static start(scheduleTick) {
        if (Scheduler.started) {
            return;
        }
        Scheduler.started = true;
        if (typeof scheduleTick === "number" && scheduleTick > 0) {
            Scheduler.scheduleTick = scheduleTick;
        }
        Scheduler.request();
    }
    static request() {
        if (!Scheduler.started || Scheduler.pending) {
            return;
        }
        Scheduler.pending = true;
        const flush = () => {
            Scheduler.pending = false;
            if (!Scheduler.started) {
                return;
            }
            Scheduler.dispatch();
        };
        if (typeof window !== "undefined" && window.requestAnimationFrame) {
            window.requestAnimationFrame(() => flush());
        }
        else if (typeof window !== "undefined") {
            window.setTimeout(flush, Scheduler.scheduleTick);
        }
        else {
            setTimeout(flush, Scheduler.scheduleTick);
        }
    }
    static addTask(foo, thiser) {
        if (!Util.isFunction(foo)) {
            throw new NError("invoke", "Scheduler.addTask", "0", "function");
        }
        if (Scheduler.tasks.some(item => item.func === foo && item.thiser === thiser)) {
            return;
        }
        Scheduler.tasks.push({ func: foo, thiser });
        Scheduler.request();
    }
    static removeTask(foo, thiser) {
        if (!Util.isFunction(foo)) {
            throw new NError("invoke", "Scheduler.removeTask", "0", "function");
        }
        const index = Scheduler.tasks.findIndex(item => item.func === foo && (thiser === undefined || item.thiser === thiser));
        if (index !== -1) {
            Scheduler.tasks.splice(index, 1);
        }
    }
}
Scheduler.tasks = [];
Scheduler.started = false;
Scheduler.pending = false;
Scheduler.scheduleTick = 50;

function resolveRenderedKey(src, key) {
    return key === undefined || key === null ? src.key : `${src.key}_${key}`;
}
function appendRenderedChild(parent, child) {
    if (!parent) {
        return;
    }
    parent.children || (parent.children = []);
    parent.locMap || (parent.locMap = new Map());
    child.parent = parent;
    parent.locMap.set(child.key, parent.children.length);
    parent.children.push(child);
}
function findPreviousChild(previousDom, src, key) {
    var _a;
    if (!(previousDom === null || previousDom === void 0 ? void 0 : previousDom.children) || previousDom.children.length === 0) {
        return;
    }
    const renderedKey = resolveRenderedKey(src, key);
    const index = (_a = previousDom.locMap) === null || _a === void 0 ? void 0 : _a.get(renderedKey);
    if (index !== undefined) {
        return previousDom.children[index];
    }
    return previousDom.children.find(item => (item === null || item === void 0 ? void 0 : item.key) === renderedKey);
}
function canReuseRenderedSubtree(src, previousDom, dirtyPaths) {
    if (!previousDom) {
        return false;
    }
    if (previousDom.vdom && previousDom.vdom !== src) {
        return false;
    }
    if (src.tagName !== previousDom.tagName) {
        return false;
    }
    if (src.key === 1) {
        return false;
    }
    if (src.hoisted) {
        return true;
    }
    if (src.subtreeForceFullRender) {
        return false;
    }
    if (!dirtyPaths || dirtyPaths.length === 0 || dirtyPaths.includes("*")) {
        return src.subtreeDepPaths.length === 0;
    }
    if (src.subtreeDepPaths.length === 0) {
        return true;
    }
    return !hasDependencyMatch(src.subtreeDepPaths, dirtyPaths);
}
function reuseRenderedDom(previousDom, src, model, parent) {
    previousDom.__skipDiff = true;
    previousDom.parent = parent;
    previousDom.vdom = src;
    previousDom.model = model;
    return previousDom;
}

const transitionRuntimeStates = new WeakMap();
class Renderer {
    static setRootEl(rootEl) {
        this.rootEl = rootEl;
    }
    static getRootEl() {
        return this.rootEl;
    }
    static add(module) {
        if (!module || this.waitSet.has(module.id)) {
            return;
        }
        this.waitSet.add(module.id);
        this.waitList.push(module.id);
        Scheduler.request();
    }
    static remove(module) {
        const index = this.waitList.indexOf(module.id);
        if (index !== -1) {
            this.waitList.splice(index, 1, null);
        }
        this.waitSet.delete(module.id);
    }
    static render() {
        var _a;
        while (this.waitList.length > 0) {
            const id = this.waitList.shift();
            if (!id) {
                continue;
            }
            this.waitSet.delete(id);
            (_a = ModuleFactory.get(id)) === null || _a === void 0 ? void 0 : _a.render();
        }
    }
    static flush(maxRounds = 20) {
        let rounds = 0;
        while (this.waitList.length > 0 && rounds < maxRounds) {
            this.render();
            rounds++;
        }
    }
    static renderDom(module, src, model, parent, key, notRenderChild, previousDom, dirtyPaths) {
        const srcModule = ModuleFactory.get(src.moduleId) || module;
        const renderedKey = resolveRenderedKey(src, resolveNodeKey(src, srcModule, model, key));
        if (canReuseRenderedSubtree(src, previousDom, dirtyPaths)) {
            const reused = reuseRenderedDom(previousDom, src, model, parent);
            reused.key = renderedKey;
            reused.moduleId = src.moduleId;
            reused.slotModuleId = src.slotModuleId;
            reused.staticNum = src.staticNum;
            reused.patchFlag = src.patchFlag;
            reused.dynamicProps = [...(src.dynamicProps || [])];
            reused.hoisted = src.hoisted;
            reused.blockRoot = src.blockRoot;
            reused.structureFlags = src.structureFlags;
            reused.childrenPatchFlag = src.childrenPatchFlag;
            reused.childrenStructureFlags = src.childrenStructureFlags;
            appendRenderedChild(parent, reused);
            return reused;
        }
        const clonedBlueprint = !previousDom
            ? cloneStaticRenderBlueprint(module, src, model, parent, key)
            : undefined;
        if (clonedBlueprint) {
            appendRenderedChild(parent, clonedBlueprint);
            return clonedBlueprint;
        }
        const dst = {
            key: renderedKey,
            model,
            vdom: src,
            parent,
            moduleId: src.moduleId,
            slotModuleId: src.slotModuleId,
            staticNum: src.staticNum,
            patchFlag: src.patchFlag,
            dynamicProps: [...(src.dynamicProps || [])],
            hoisted: src.hoisted,
            blockRoot: src.blockRoot,
            structureFlags: src.structureFlags,
            childrenPatchFlag: src.childrenPatchFlag,
            childrenStructureFlags: src.childrenStructureFlags,
            __skipDiff: false
        };
        if (src.staticNum > 0) {
            src.staticNum--;
        }
        if (src.tagName) {
            dst.tagName = src.tagName;
            dst.locMap = new Map();
            dst.props = {};
            if (src.isSvg) {
                dst.isSvg = src.isSvg;
            }
        }
        const modelDirective = src.getDirective("model");
        if (modelDirective) {
            modelDirective.exec(module, dst);
        }
        if (dst.tagName) {
            this.handleProps(module, src, dst, srcModule);
            if (src.tagName === "style") {
                CssManager.handleStyleDom(module, dst);
            }
            else if (src.assets && src.assets.size > 0) {
                dst.assets || (dst.assets = {});
                for (const asset of src.assets) {
                    dst.assets[asset[0]] = asset[1];
                }
            }
            if (!this.handleDirectives(module, src, dst)) {
                return null;
            }
            if (src.events) {
                dst.events = [...src.events];
            }
            if (!notRenderChild && src.children && src.children.length > 0) {
                dst.children = [];
                this.renderChildren(module, src, dst, key, previousDom, dirtyPaths);
            }
        }
        else if (src.expressions) {
            let value = "";
            for (const expr of src.expressions) {
                if (expr instanceof Expression) {
                    const nextValue = expr.val(srcModule, dst.model);
                    value += nextValue !== undefined && nextValue !== null ? nextValue : "";
                }
                else {
                    value += expr;
                }
            }
            dst.textContent = value;
        }
        else {
            dst.textContent = src.textContent;
        }
        cacheStaticRenderBlueprint(src, dst);
        appendRenderedChild(parent, dst);
        return dst;
    }
    static handleDirectives(module, src, dst) {
        if (!src.directives || src.directives.length === 0) {
            return true;
        }
        for (const directive of src.directives) {
            if (directive.type.name === "model") {
                continue;
            }
            if (!directive.exec(module, dst)) {
                return false;
            }
        }
        return true;
    }
    static handleProps(module, src, dst, srcModule) {
        var _a;
        if (((_a = src.props) === null || _a === void 0 ? void 0 : _a.size) > 0) {
            for (const prop of src.props) {
                if (prop[0] === "key") {
                    continue;
                }
                const value = prop[1] instanceof Expression ? prop[1].val(srcModule, dst.model) : prop[1];
                dst.props[prop[0]] = normalizePropValue(value);
            }
        }
        if (src.key === 1) {
            mergeRootProps(module, dst);
        }
    }
    static renderChildren(module, src, dst, key, previousDom, dirtyPaths) {
        var _a;
        const dynamicChildIndexes = new Set(src.dynamicChildIndexes || []);
        for (let index = 0; index < (((_a = src.children) === null || _a === void 0 ? void 0 : _a.length) || 0); index++) {
            const child = src.children[index];
            const previousChild = findPreviousChild(previousDom, child, key);
            const isDynamicChild = dynamicChildIndexes.has(index);
            if (src.blockTree
                && !isDynamicChild
                && previousChild
                && canReuseRenderedSubtree(child, previousChild, dirtyPaths)) {
                const reused = reuseRenderedDom(previousChild, child, dst.model, dst);
                reused.key = previousChild.key;
                reused.moduleId = child.moduleId;
                reused.slotModuleId = child.slotModuleId;
                reused.staticNum = child.staticNum;
                reused.patchFlag = child.patchFlag;
                reused.dynamicProps = [...(child.dynamicProps || [])];
                reused.hoisted = child.hoisted;
                reused.blockRoot = child.blockRoot;
                reused.structureFlags = child.structureFlags;
                reused.childrenPatchFlag = child.childrenPatchFlag;
                reused.childrenStructureFlags = child.childrenStructureFlags;
                appendRenderedChild(dst, reused);
                continue;
            }
            const renderedChild = this.renderDom(module, child, dst.model, dst, key, false, previousChild, dirtyPaths);
            if (src.blockTree && isDynamicChild && renderedChild) {
                dst.dynamicChildKeys || (dst.dynamicChildKeys = []);
                dst.dynamicChildKeys.push(renderedChild.key);
            }
        }
    }
    static updateToHtml(module, dom, oldDom) {
        var _a, _b;
        const el = oldDom.node;
        if (!el) {
            dom.node = this.renderToHtml(module, dom, (_a = oldDom.parent) === null || _a === void 0 ? void 0 : _a.node);
            return dom.node;
        }
        dom.node = el;
        if (dom.tagName) {
            syncDomState(module, dom, oldDom, el);
            moveTeleportNode(dom, el, (_b = oldDom.parent) === null || _b === void 0 ? void 0 : _b.node);
        }
        else {
            el.textContent = dom.textContent;
        }
        return el;
    }
    static renderToHtml(module, src, parentEl) {
        const el = src.tagName ? createElementNode(src) : createTextNode(src);
        if (el && src.tagName && !src.childModuleId) {
            appendChildren(el, src);
        }
        if (el) {
            moveTeleportNode(src, el, parentEl || undefined);
        }
        return el;
        function createElementNode(dom) {
            if (dom.childModuleId) {
                const childModule = ModuleFactory.get(dom.childModuleId);
                if (childModule) {
                    const comment = document.createComment(`module ${childModule.constructor.name}:${childModule.id}`);
                    Renderer.add(childModule);
                    dom.node = comment;
                    return comment;
                }
                return;
            }
            let el;
            if (dom.tagName === "style") {
                el = document.createElement("style");
            }
            else if (dom.isSvg) {
                el = document.createElementNS("http://www.w3.org/2000/svg", dom.tagName);
                if (dom.tagName === "svg") {
                    el.setAttribute("xmlns", "http://www.w3.org/2000/svg");
                }
            }
            else {
                el = document.createElement(dom.tagName);
            }
            dom.node = el;
            if (dom.props) {
                for (const prop of Object.keys(dom.props)) {
                    el.setAttribute(prop, dom.props[prop]);
                }
            }
            if (dom.assets) {
                for (const asset of Object.keys(dom.assets)) {
                    el[asset] = dom.assets[asset];
                }
            }
            module.eventFactory.handleDomEvent(dom);
            queueTransitionEnter(module, dom, el);
            return el;
        }
        function createTextNode(dom) {
            if (CssManager.handleStyleTextDom(module, dom)) {
                return;
            }
            dom.node = document.createTextNode(dom.textContent || "");
            return dom.node;
        }
        function appendChildren(parentNode, dom) {
            if (!dom.children || dom.children.length === 0) {
                return;
            }
            for (const child of dom.children) {
                let childNode;
                if (child.tagName) {
                    childNode = createElementNode(child);
                    if (childNode instanceof Element) {
                        appendChildren(childNode, child);
                    }
                }
                else {
                    childNode = createTextNode(child);
                }
                if (childNode) {
                    parentNode.appendChild(childNode);
                }
            }
        }
    }
    static syncTeleports(dom) {
        var _a;
        if (!dom) {
            return;
        }
        if (dom.node) {
            moveTeleportNode(dom, dom.node, (_a = dom.parent) === null || _a === void 0 ? void 0 : _a.node);
        }
        if (dom.children) {
            for (const child of dom.children) {
                this.syncTeleports(child);
            }
        }
    }
    static runLeaveTransition(module, dom, removeNode) {
        const transition = resolveTransitionDescriptor(dom);
        const node = dom.node;
        if (!transition || !(node instanceof Element)) {
            return false;
        }
        const state = getTransitionRuntimeState(node);
        const { leaveActiveClass, leaveDuration, leaveFromClass, leaveToClass } = transition;
        cancelTransitionPhase(module, node, state, "enter", transition);
        cancelTransitionPhase(module, node, state, "leave", transition);
        state.phase = "leave";
        emitTransitionHook(module, "onBeforeLeave", node);
        removeTransitionClasses(node, [
            transition.enterActiveClass,
            transition.enterFromClass,
            transition.enterToClass
        ]);
        addTransitionClasses(node, [leaveFromClass, leaveActiveClass]);
        state.cancelLeaveFrame = scheduleNextFrame(() => {
            state.cancelLeaveFrame = undefined;
            removeTransitionClasses(node, [leaveFromClass]);
            addTransitionClasses(node, [leaveToClass]);
            emitTransitionHook(module, "onLeave", node);
            state.cancelLeaveTimer = scheduleDelay(leaveDuration, () => {
                state.cancelLeaveTimer = undefined;
                removeTransitionClasses(node, [leaveActiveClass, leaveToClass]);
                state.phase = undefined;
                removeNode();
                emitTransitionHook(module, "onAfterLeave", node);
            });
        });
        return true;
    }
    static handleChangedDoms(module, changeDoms) {
        var _a;
        const slotDoms = {};
        const replaceList = [];
        const addOrMove = [];
        for (const item of changeDoms) {
            if (item[1].slotModuleId && item[1].slotModuleId !== module.id) {
                const slotKey = String(item[1].slotModuleId);
                slotDoms[slotKey] || (slotDoms[slotKey] = []);
                slotDoms[slotKey].push(item);
                continue;
            }
            switch (item[0]) {
                case 1:
                case 4:
                    addOrMove.push(item);
                    break;
                case 2:
                    if (item[1].childModuleId) {
                        Renderer.add(ModuleFactory.get(item[1].childModuleId));
                    }
                    else {
                        this.updateToHtml(module, item[1], item[2]);
                    }
                    break;
                case 3:
                    module.domManager.freeNode(item[1], true);
                    break;
                default:
                    replaceList.push(item);
            }
        }
        for (const item of replaceList) {
            this.replace(module, item[1], item[2]);
        }
        if (addOrMove.length > 1) {
            addOrMove.sort((left, right) => (left[4] > right[4] ? 1 : -1));
        }
        while (addOrMove.length > 0) {
            const item = addOrMove.shift();
            const parentNode = (_a = item[3]) === null || _a === void 0 ? void 0 : _a.node;
            if (!parentNode) {
                continue;
            }
            const teleportActive = isActiveTeleport(item[1]);
            const node = item[0] === 1
                ? Renderer.renderToHtml(module, item[1], teleportActive ? parentNode : null)
                : item[1].node;
            if (!node) {
                continue;
            }
            if (teleportActive) {
                moveTeleportNode(item[1], node, parentNode);
                continue;
            }
            const previousRect = item[0] === 4 ? captureTransitionMoveRect(item[1], node) : null;
            let index = item[4];
            const offset = addOrMove.filter(change => {
                var _a;
                return change[0] === 4
                    && ((_a = change[3]) === null || _a === void 0 ? void 0 : _a.node) === parentNode
                    && change[4] >= index
                    && change[5] < index;
            }).length;
            moveNode(node, parentNode, index + offset);
            if (item[0] === 4) {
                queueTransitionMove(module, item[1], node, previousRect);
            }
        }
        for (const key of Object.keys(slotDoms)) {
            const slotModule = ModuleFactory.get(parseInt(key, 10));
            if (slotModule) {
                Renderer.add(slotModule);
            }
        }
        function moveNode(node, parentNode, loc) {
            const moduleNode = findModuleNode(node);
            let inserted = false;
            for (let i = 0, index = 0; i < parentNode.childNodes.length; i++, index++) {
                const current = parentNode.childNodes[i];
                if (findModuleNode(current) !== null) {
                    i++;
                }
                if (index !== loc) {
                    continue;
                }
                if (moduleNode === null) {
                    parentNode.insertBefore(node, current);
                }
                else {
                    parentNode.insertBefore(moduleNode, current);
                    parentNode.insertBefore(node, moduleNode);
                }
                inserted = true;
                break;
            }
            if (inserted) {
                return;
            }
            if (moduleNode === null) {
                parentNode.appendChild(node);
            }
            else {
                parentNode.appendChild(node);
                parentNode.appendChild(moduleNode);
            }
        }
        function findModuleNode(node) {
            var _a;
            return node
                && node instanceof Comment
                && node.nextSibling
                && node.nextSibling instanceof Element
                && ((_a = node.textContent) === null || _a === void 0 ? void 0 : _a.endsWith(node.nextSibling.getAttribute("role") || ""))
                ? node.nextSibling
                : null;
        }
    }
    static replace(module, src, dst) {
        var _a, _b, _c, _d, _e, _f;
        const el = this.renderToHtml(module, src, null);
        if (isActiveTeleport(src)) {
            moveTeleportNode(src, el, (_a = dst.parent) === null || _a === void 0 ? void 0 : _a.node);
            if ((_b = dst.node) === null || _b === void 0 ? void 0 : _b.parentElement) {
                dst.node.parentElement.removeChild(dst.node);
            }
            module.domManager.freeNode(dst, true);
            return;
        }
        if (dst.childModuleId) {
            const childModule = ModuleFactory.get(dst.childModuleId);
            const parentEl = (_d = (_c = childModule === null || childModule === void 0 ? void 0 : childModule.srcDom) === null || _c === void 0 ? void 0 : _c.node) === null || _d === void 0 ? void 0 : _d.parentElement;
            if (!parentEl) {
                return;
            }
            const previousSibling = (_e = childModule.srcDom.node) === null || _e === void 0 ? void 0 : _e.previousSibling;
            childModule.destroy();
            if (previousSibling) {
                Util.insertAfter(el, previousSibling);
            }
            else if (parentEl.childNodes.length === 0) {
                parentEl.appendChild(el);
            }
            else {
                parentEl.insertBefore(el, parentEl.childNodes[0]);
            }
            return;
        }
        const parentEl = (_f = dst.node) === null || _f === void 0 ? void 0 : _f.parentElement;
        if (!parentEl || !dst.node) {
            return;
        }
        parentEl.replaceChild(el, dst.node);
        module.domManager.freeNode(dst, true);
    }
}
Renderer.waitList = [];
Renderer.waitSet = new Set();
function cloneStaticRenderBlueprint(module, src, model, parent, scopeKey) {
    if (!canCacheStaticRenderBlueprint(src) || !src.renderBlueprint) {
        return;
    }
    return cloneRenderBlueprintNode(module, src, src.renderBlueprint, model, parent, scopeKey);
}
function cloneRenderBlueprintNode(module, src, blueprint, model, parent, scopeKey) {
    var _a, _b, _c, _d;
    const srcModule = ModuleFactory.get(src.moduleId) || module;
    const renderedKey = resolveRenderedKey(src, resolveNodeKey(src, srcModule, model, scopeKey));
    const cloned = {
        key: renderedKey,
        model,
        vdom: src,
        parent,
        moduleId: src.moduleId,
        slotModuleId: src.slotModuleId,
        staticNum: src.staticNum,
        patchFlag: src.patchFlag,
        dynamicProps: [...(src.dynamicProps || [])],
        hoisted: src.hoisted,
        blockRoot: src.blockRoot,
        structureFlags: src.structureFlags,
        childrenPatchFlag: src.childrenPatchFlag,
        childrenStructureFlags: src.childrenStructureFlags,
        __skipDiff: false
    };
    cloned.childModuleId = blueprint.childModuleId;
    cloned.keepAlive = cloneKeepAliveState(blueprint.keepAlive);
    cloned.transition = blueprint.transition
        ? Object.assign({}, blueprint.transition) : undefined;
    cloned.teleportDisabled = blueprint.teleportDisabled;
    cloned.teleportTarget = blueprint.teleportTarget;
    if (blueprint.tagName) {
        cloned.tagName = blueprint.tagName;
        cloned.props = blueprint.props ? Object.assign({}, blueprint.props) : {};
        cloned.locMap = new Map();
        if (blueprint.assets) {
            cloned.assets = Object.assign({}, blueprint.assets);
        }
        if (blueprint.events) {
            cloned.events = [...blueprint.events];
        }
        if (blueprint.isSvg) {
            cloned.isSvg = true;
        }
    }
    else {
        cloned.textContent = blueprint.textContent;
    }
    if (((_a = blueprint.children) === null || _a === void 0 ? void 0 : _a.length) && ((_b = src.children) === null || _b === void 0 ? void 0 : _b.length)) {
        cloned.children = [];
        for (let index = 0; index < blueprint.children.length; index++) {
            const childSrc = src.children[index];
            const childBlueprint = blueprint.children[index];
            if (!childSrc || !childBlueprint) {
                continue;
            }
            appendRenderedChild(cloned, cloneRenderBlueprintNode(module, childSrc, childBlueprint, model, cloned, scopeKey));
        }
    }
    if (((_c = src.dynamicChildIndexes) === null || _c === void 0 ? void 0 : _c.length) && ((_d = cloned.children) === null || _d === void 0 ? void 0 : _d.length)) {
        const dynamicChildKeys = src.dynamicChildIndexes
            .map(index => { var _a, _b; return (_b = (_a = cloned.children) === null || _a === void 0 ? void 0 : _a[index]) === null || _b === void 0 ? void 0 : _b.key; })
            .filter((value) => value !== undefined && value !== null);
        if (dynamicChildKeys.length > 0) {
            cloned.dynamicChildKeys = dynamicChildKeys;
        }
    }
    return cloned;
}
function cloneKeepAliveState(value) {
    if (!value || typeof value !== "object") {
        return value;
    }
    const cloned = Object.assign({}, value);
    if (Array.isArray(cloned.include)) {
        cloned.include = [...cloned.include];
    }
    if (Array.isArray(cloned.exclude)) {
        cloned.exclude = [...cloned.exclude];
    }
    return cloned;
}
function cacheStaticRenderBlueprint(src, dom) {
    if (!canCacheStaticRenderBlueprint(src) || src.renderBlueprint) {
        return;
    }
    src.renderBlueprint = createRenderBlueprint(dom);
}
function createRenderBlueprint(dom) {
    var _a, _b;
    const blueprint = {
        key: dom.key,
        staticNum: dom.staticNum,
        patchFlag: dom.patchFlag,
        dynamicProps: [...(dom.dynamicProps || [])],
        hoisted: dom.hoisted,
        blockRoot: dom.blockRoot,
        structureFlags: dom.structureFlags,
        moduleId: dom.moduleId,
        slotModuleId: dom.slotModuleId,
        childModuleId: dom.childModuleId
    };
    blueprint.keepAlive = cloneKeepAliveState(dom.keepAlive);
    blueprint.transition = dom.transition
        ? Object.assign({}, dom.transition) : undefined;
    blueprint.teleportDisabled = dom.teleportDisabled;
    blueprint.teleportTarget = dom.teleportTarget;
    if (dom.tagName) {
        blueprint.tagName = dom.tagName;
        blueprint.props = dom.props ? Object.assign({}, dom.props) : {};
        if (dom.assets) {
            blueprint.assets = Object.assign({}, dom.assets);
        }
        if (dom.events) {
            blueprint.events = [...dom.events];
        }
        if (dom.isSvg) {
            blueprint.isSvg = true;
        }
    }
    else {
        blueprint.textContent = dom.textContent;
    }
    if ((_a = dom.children) === null || _a === void 0 ? void 0 : _a.length) {
        blueprint.children = dom.children.map(child => createRenderBlueprint(child));
    }
    if ((_b = dom.dynamicChildKeys) === null || _b === void 0 ? void 0 : _b.length) {
        blueprint.dynamicChildKeys = [...dom.dynamicChildKeys];
    }
    if (dom.childrenPatchFlag) {
        blueprint.childrenPatchFlag = dom.childrenPatchFlag;
    }
    if (dom.childrenStructureFlags) {
        blueprint.childrenStructureFlags = dom.childrenStructureFlags;
    }
    return blueprint;
}
function canCacheStaticRenderBlueprint(src) {
    var _a;
    return src.hoisted
        && src.key !== 1
        && !((_a = src.directives) === null || _a === void 0 ? void 0 : _a.length)
        && !hasStatefulRuntimeSubtree(src);
}
function hasStatefulRuntimeSubtree(src) {
    var _a, _b;
    if ((_a = src.directives) === null || _a === void 0 ? void 0 : _a.some(directive => {
        var _a, _b, _c, _d;
        return ((_a = directive.type) === null || _a === void 0 ? void 0 : _a.name) === "module"
            || ((_b = directive.type) === null || _b === void 0 ? void 0 : _b.name) === "keepalive"
            || ((_c = directive.type) === null || _c === void 0 ? void 0 : _c.name) === "transition"
            || ((_d = directive.type) === null || _d === void 0 ? void 0 : _d.name) === "teleport";
    })) {
        return true;
    }
    return !!((_b = src.children) === null || _b === void 0 ? void 0 : _b.some(child => hasStatefulRuntimeSubtree(child)));
}
function normalizePropValue(value) {
    return value === undefined
        || value === null
        || value === ""
        || (typeof value === "string" && value.trim() === "")
        ? ""
        : value;
}
function mergeRootProps(module, dom) {
    var _a, _b;
    if (!module.props) {
        return;
    }
    for (const key of Object.keys(module.props)) {
        if ((_a = module.excludedProps) === null || _a === void 0 ? void 0 : _a.includes(key)) {
            continue;
        }
        let value = (_b = dom.props) === null || _b === void 0 ? void 0 : _b[key];
        let nextValue = module.props[key];
        if (typeof nextValue === "string") {
            nextValue = nextValue.trim();
        }
        if (!nextValue) {
            dom.props[key] = normalizePropValue(value);
            continue;
        }
        if (key === "style") {
            value = value ? `${nextValue};${value}`.replace(/;{2,}/g, ";") : nextValue;
        }
        else if (key === "class") {
            value = value ? `${value} ${nextValue}` : nextValue;
        }
        else if (!value) {
            value = nextValue;
        }
        dom.props[key] = normalizePropValue(value);
    }
}
function resolveNodeKey(src, srcModule, model, fallbackKey) {
    const keyProp = src.getProp("key");
    if (keyProp instanceof Expression) {
        const resolved = keyProp.val(srcModule, model);
        if (resolved !== undefined && resolved !== null && resolved !== "") {
            return resolved;
        }
    }
    else if (keyProp !== undefined && keyProp !== null && keyProp !== "") {
        return keyProp;
    }
    return fallbackKey;
}
function syncDomState(module, dom, oldDom, el) {
    var _a, _b;
    const patchFlag = (_b = (_a = dom.patchFlag) !== null && _a !== void 0 ? _a : oldDom.patchFlag) !== null && _b !== void 0 ? _b : PatchFlags.BAIL;
    if (!isTargetedPatch(patchFlag)) {
        syncProps(el, dom.props, oldDom.props);
        syncAssets(el, dom.assets, oldDom.assets);
        module.eventFactory.handleDomEvent(dom, oldDom);
        return;
    }
    if (patchFlag & PatchFlags.CLASS) {
        syncNamedProp(el, "class", dom.props, oldDom.props);
    }
    if (patchFlag & PatchFlags.STYLE) {
        syncNamedProp(el, "style", dom.props, oldDom.props);
    }
    if (patchFlag & PatchFlags.PROPS) {
        for (const key of dom.dynamicProps || []) {
            syncNamedProp(el, key, dom.props, oldDom.props);
        }
    }
    if (patchFlag & PatchFlags.ASSETS) {
        for (const key of dom.dynamicProps || []) {
            syncNamedAsset(el, key, dom.assets, oldDom.assets);
        }
    }
    if (patchFlag & PatchFlags.EVENTS) {
        module.eventFactory.handleDomEvent(dom, oldDom);
    }
}
function isTargetedPatch(flag) {
    if (!flag || (flag & PatchFlags.BAIL) !== 0 || (flag & PatchFlags.DIRECTIVES) !== 0) {
        return false;
    }
    return true;
}
function syncProps(el, nextProps, prevProps) {
    var _a;
    if (nextProps) {
        for (const key of Object.keys(nextProps)) {
            el.setAttribute(key, String((_a = nextProps[key]) !== null && _a !== void 0 ? _a : ""));
            if (prevProps) {
                delete prevProps[key];
            }
        }
    }
    if (prevProps) {
        for (const key of Object.keys(prevProps)) {
            el.removeAttribute(key);
        }
    }
}
function syncAssets(el, nextAssets, prevAssets) {
    if (nextAssets) {
        for (const key of Object.keys(nextAssets)) {
            el[key] = nextAssets[key];
            if (prevAssets) {
                delete prevAssets[key];
            }
        }
    }
    if (prevAssets) {
        for (const key of Object.keys(prevAssets)) {
            el[key] = null;
        }
    }
}
function syncNamedProp(el, key, nextProps, prevProps) {
    const nextValue = nextProps === null || nextProps === void 0 ? void 0 : nextProps[key];
    const prevValue = prevProps === null || prevProps === void 0 ? void 0 : prevProps[key];
    if (nextValue === prevValue) {
        return;
    }
    if (nextValue === undefined || nextValue === null || nextValue === "") {
        el.removeAttribute(key);
    }
    else {
        el.setAttribute(key, String(nextValue));
    }
}
function syncNamedAsset(el, key, nextAssets, prevAssets) {
    const nextValue = nextAssets === null || nextAssets === void 0 ? void 0 : nextAssets[key];
    const prevValue = prevAssets === null || prevAssets === void 0 ? void 0 : prevAssets[key];
    if (nextValue === prevValue) {
        return;
    }
    el[key] = nextValue === undefined ? null : nextValue;
}
function resolveTeleportTarget(target) {
    if (typeof target === "string" && target.trim()) {
        return document.querySelector(target);
    }
    return target instanceof Element ? target : null;
}
function moveTeleportNode(dom, node, fallbackParent) {
    const teleportDom = dom;
    if (!dom.tagName) {
        if (fallbackParent) {
            fallbackParent.appendChild(node);
        }
        return;
    }
    const teleportTarget = !teleportDom.teleportDisabled
        ? resolveTeleportTarget(teleportDom.teleportTarget)
        : null;
    if (teleportTarget) {
        if (node.parentElement !== teleportTarget) {
            teleportTarget.appendChild(node);
        }
        return;
    }
    if (fallbackParent) {
        fallbackParent.appendChild(node);
    }
}
function isActiveTeleport(dom) {
    const teleportDom = dom;
    return !!dom.tagName && !teleportDom.teleportDisabled && !!resolveTeleportTarget(teleportDom.teleportTarget);
}
function captureTransitionMoveRect(dom, node) {
    const transition = resolveTransitionDescriptor(dom);
    if (!(transition === null || transition === void 0 ? void 0 : transition.group) || !(node instanceof Element) || typeof node.getBoundingClientRect !== "function") {
        return null;
    }
    return node.getBoundingClientRect();
}
function queueTransitionEnter(module, dom, node) {
    const transition = resolveTransitionDescriptor(dom);
    if (!transition || !(node instanceof Element)) {
        return;
    }
    const state = getTransitionRuntimeState(node);
    const { enterActiveClass, enterDuration, enterFromClass, enterToClass, leaveActiveClass, leaveFromClass, leaveToClass } = transition;
    cancelTransitionPhase(module, node, state, "leave", transition);
    cancelTransitionPhase(module, node, state, "enter", transition);
    state.phase = "enter";
    emitTransitionHook(module, "onBeforeEnter", node);
    removeTransitionClasses(node, [leaveActiveClass, leaveFromClass, leaveToClass]);
    addTransitionClasses(node, [enterFromClass, enterActiveClass]);
    state.cancelEnterFrame = scheduleNextFrame(() => {
        state.cancelEnterFrame = undefined;
        removeTransitionClasses(node, [enterFromClass]);
        addTransitionClasses(node, [enterToClass]);
        emitTransitionHook(module, "onEnter", node);
        state.cancelEnterTimer = scheduleDelay(enterDuration, () => {
            state.cancelEnterTimer = undefined;
            removeTransitionClasses(node, [enterActiveClass, enterToClass]);
            state.phase = undefined;
            emitTransitionHook(module, "onAfterEnter", node);
        });
    });
}
function queueTransitionMove(module, dom, node, previousRect) {
    var _a, _b;
    const transition = resolveTransitionDescriptor(dom);
    if (!(transition === null || transition === void 0 ? void 0 : transition.group) || !(node instanceof HTMLElement) || !previousRect) {
        return;
    }
    const nextRect = (_a = node.getBoundingClientRect) === null || _a === void 0 ? void 0 : _a.call(node);
    if (!nextRect) {
        return;
    }
    const deltaX = previousRect.left - nextRect.left;
    const deltaY = previousRect.top - nextRect.top;
    if (deltaX === 0 && deltaY === 0) {
        return;
    }
    const state = getTransitionRuntimeState(node);
    cancelTransitionPhase(module, node, state, "move", transition);
    const previousTransition = node.style.transition;
    const previousTransform = node.style.transform;
    state.restoreMoveStyles = () => {
        node.style.transition = previousTransition;
        node.style.transform = previousTransform;
    };
    state.phase = "move";
    emitTransitionHook(module, "onBeforeMove", node);
    node.style.transition = "none";
    node.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    (_b = node.getBoundingClientRect) === null || _b === void 0 ? void 0 : _b.call(node);
    state.cancelMoveFrame = scheduleNextFrame(() => {
        state.cancelMoveFrame = undefined;
        addTransitionClasses(node, [transition.moveClass]);
        node.style.transition = previousTransition || `transform ${transition.moveDuration}ms ease`;
        node.style.transform = previousTransform || "";
        emitTransitionHook(module, "onMove", node);
        state.cancelMoveTimer = scheduleDelay(transition.moveDuration, () => {
            var _a;
            state.cancelMoveTimer = undefined;
            removeTransitionClasses(node, [transition.moveClass]);
            (_a = state.restoreMoveStyles) === null || _a === void 0 ? void 0 : _a.call(state);
            state.restoreMoveStyles = undefined;
            state.phase = undefined;
            emitTransitionHook(module, "onAfterMove", node);
        });
    });
}
function resolveTransitionDescriptor(dom) {
    const transition = dom.transition;
    if (!transition) {
        return null;
    }
    const name = typeof transition.name === "string" && transition.name.trim()
        ? transition.name.trim()
        : "nd";
    const duration = normalizeTransitionDuration(transition.duration, 250);
    return {
        duration,
        enterActiveClass: transition.enterActiveClass || `${name}-enter-active`,
        enterDuration: normalizeTransitionDuration(transition.enterDuration, duration),
        enterFromClass: transition.enterFromClass || `${name}-enter-from`,
        enterToClass: transition.enterToClass || `${name}-enter-to`,
        group: transition.group === true,
        leaveActiveClass: transition.leaveActiveClass || `${name}-leave-active`,
        leaveDuration: normalizeTransitionDuration(transition.leaveDuration, duration),
        leaveFromClass: transition.leaveFromClass || `${name}-leave-from`,
        leaveToClass: transition.leaveToClass || `${name}-leave-to`,
        moveClass: transition.moveClass || `${name}-move`,
        moveDuration: normalizeTransitionDuration(transition.moveDuration, duration),
        name
    };
}
function normalizeTransitionDuration(value, fallback) {
    return typeof value === "number" && Number.isFinite(value)
        ? Math.max(0, value)
        : fallback;
}
function addTransitionClasses(node, classes) {
    const tokens = classes
        .flatMap(value => typeof value === "string" ? value.split(/\s+/) : [])
        .map(value => value.trim())
        .filter(Boolean);
    if (tokens.length > 0) {
        node.classList.add(...tokens);
    }
}
function removeTransitionClasses(node, classes) {
    const tokens = classes
        .flatMap(value => typeof value === "string" ? value.split(/\s+/) : [])
        .map(value => value.trim())
        .filter(Boolean);
    if (tokens.length > 0) {
        node.classList.remove(...tokens);
    }
}
function scheduleNextFrame(callback) {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        let cancelled = false;
        let secondFrame;
        const firstFrame = window.requestAnimationFrame(() => {
            if (cancelled) {
                return;
            }
            secondFrame = window.requestAnimationFrame(() => {
                if (!cancelled) {
                    callback();
                }
            });
        });
        return () => {
            var _a, _b;
            cancelled = true;
            (_a = window.cancelAnimationFrame) === null || _a === void 0 ? void 0 : _a.call(window, firstFrame);
            if (secondFrame !== undefined) {
                (_b = window.cancelAnimationFrame) === null || _b === void 0 ? void 0 : _b.call(window, secondFrame);
            }
        };
    }
    const timerId = window.setTimeout(callback, 16);
    return () => clearTimeout(timerId);
}
function emitTransitionHook(module, eventName, node) {
    var _a, _b;
    (_b = (_a = module).emitHook) === null || _b === void 0 ? void 0 : _b.call(_a, eventName, node);
}
function scheduleDelay(delay, callback) {
    const timerId = window.setTimeout(callback, delay);
    return () => clearTimeout(timerId);
}
function getTransitionRuntimeState(node) {
    let state = transitionRuntimeStates.get(node);
    if (!state) {
        state = {};
        transitionRuntimeStates.set(node, state);
    }
    return state;
}
function cancelTransitionPhase(module, node, state, phase, transition) {
    var _a;
    const cancelFrameKey = phase === "enter"
        ? "cancelEnterFrame"
        : phase === "leave"
            ? "cancelLeaveFrame"
            : "cancelMoveFrame";
    const cancelTimerKey = phase === "enter"
        ? "cancelEnterTimer"
        : phase === "leave"
            ? "cancelLeaveTimer"
            : "cancelMoveTimer";
    const cancelFrame = state[cancelFrameKey];
    const cancelTimer = state[cancelTimerKey];
    if (!cancelFrame && !cancelTimer && state.phase !== phase) {
        return;
    }
    cancelFrame === null || cancelFrame === void 0 ? void 0 : cancelFrame();
    cancelTimer === null || cancelTimer === void 0 ? void 0 : cancelTimer();
    state[cancelFrameKey] = undefined;
    state[cancelTimerKey] = undefined;
    if (phase === "move") {
        removeTransitionClasses(node, [transition.moveClass]);
        (_a = state.restoreMoveStyles) === null || _a === void 0 ? void 0 : _a.call(state);
        state.restoreMoveStyles = undefined;
    }
    else {
        const isEnter = phase === "enter";
        removeTransitionClasses(node, isEnter
            ? [transition.enterActiveClass, transition.enterFromClass, transition.enterToClass]
            : [transition.leaveActiveClass, transition.leaveFromClass, transition.leaveToClass]);
    }
    if (state.phase === phase) {
        emitTransitionHook(module, phase === "enter"
            ? "onEnterCancelled"
            : phase === "leave"
                ? "onLeaveCancelled"
                : "onMoveCancelled", node);
        state.phase = undefined;
    }
}

/**
 * dom管理器
 * @remarks
 * 用于管理module的虚拟dom树，渲染树，html节点
 */
class DomManager {
    /**
     * 构造方法
     * @param module -  所属模块
     */
    constructor(module) {
        this.keepAliveScopes = new Map();
        this.module = module;
    }
    /**
     * 从virtual dom 树获取虚拟dom节点
     * @param key - dom key 或 props键值对
     * @returns     编译后虚拟节点
     */
    getVirtualDom(key) {
        if (!this.vdomTree) {
            return null;
        }
        return find(this.vdomTree);
        function find(dom) {
            //对象表示未props查找
            if (typeof key === 'object') {
                if (!Object.keys(key).find(k => key[k] !== dom.props.get(k))) {
                    return dom;
                }
            }
            else if (dom.key === key) { //key查找
                return dom;
            }
            if (dom.children) {
                for (const d of dom.children) {
                    const d1 = find(d);
                    if (d1) {
                        return d1;
                    }
                }
            }
        }
    }
    /**
     * 从渲染树获取key对应的渲染节点
     * @param key - dom key 或 props键值对
     * @returns     渲染后虚拟节点
     */
    getRenderedDom(key) {
        if (!this.renderedTree) {
            return;
        }
        return find(this.renderedTree, key);
        /**
         * 递归查找
         * @param dom - 渲染dom
         * @param key -   待查找key
         * @returns     key对应renderdom 或 undefined
         */
        function find(dom, key) {
            //对象表示未props查找
            if (typeof key === 'object') {
                if (dom.props && !Object.keys(key).find(k => key[k] !== dom.props[k])) {
                    return dom;
                }
            }
            else if (dom.key === key) { //key查找
                return dom;
            }
            if (dom.children) {
                for (const d of dom.children) {
                    if (!d) {
                        continue;
                    }
                    const d1 = find(d, key);
                    if (d1) {
                        return d1;
                    }
                }
            }
        }
    }
    /**
     * 释放节点
     * @remarks
     * 释放操作包括：如果被释放节点包含子模块，则子模块需要unmount；释放对应节点资源
     * @param dom -         虚拟dom
     * @param destroy -     是否销毁，当dom带有子模块时，如果设置为true，则子模块执行destroy，否则执行unmount
     */
    freeNode(dom, destroy, skipTransition) {
        var _a, _b, _c, _d, _e, _f;
        const managedDom = dom;
        const transitionDom = !skipTransition && destroy ? findTransitionDom(dom) : undefined;
        let retainDomParams = false;
        if (transitionDom) {
            const didScheduleLeave = ((_b = (_a = Renderer).runLeaveTransition) === null || _b === void 0 ? void 0 : _b.call(_a, this.module, transitionDom, () => this.freeNode(dom, destroy, true))) || false;
            if (didScheduleLeave) {
                return;
            }
        }
        if (dom.childModuleId) { //子模块
            const m = ModuleFactory.get(dom.childModuleId);
            if (m) {
                const keepAliveConfig = normalizeKeepAliveConfig(managedDom.keepAlive, dom);
                if (shouldCacheKeepAlive(keepAliveConfig, m)) {
                    retainDomParams = true;
                    (_d = (_c = m).setKeepAliveManaged) === null || _d === void 0 ? void 0 : _d.call(_c, true);
                    const evictedEntries = this.registerKeepAliveCache(dom, m, keepAliveConfig);
                    m.unmount(true);
                    this.evictKeepAliveEntries(evictedEntries);
                }
                else {
                    (_f = (_e = m).setKeepAliveManaged) === null || _f === void 0 ? void 0 : _f.call(_e, false);
                    this.removeKeepAliveCacheEntry(dom.key);
                    destroy ? m.destroy() : m.unmount();
                }
            }
        }
        else { //普通节点
            const el = dom.node;
            //解绑所有事件
            this.module.eventFactory.removeEvent(dom);
            //子节点递归操作
            if (dom.children) {
                for (const d of dom.children) {
                    this.freeNode(d, destroy, skipTransition);
                }
            }
            // 从html移除
            if (el && el.parentElement) {
                el.parentElement.removeChild(el);
            }
        }
        //清除缓存
        if (!retainDomParams) {
            const m1 = ModuleFactory.get(dom.moduleId);
            if (m1) {
                m1.objectManager.clearDomParams(dom.key);
            }
        }
    }
    registerKeepAliveCache(dom, module, config) {
        const scopeKey = getKeepAliveScopeKey(config, dom.key);
        const entries = this.keepAliveScopes.get(scopeKey) || [];
        const filtered = entries.filter(item => item.domKey !== dom.key && item.moduleId !== module.id);
        filtered.push({
            domKey: dom.key,
            moduleId: module.id
        });
        const max = typeof config.max === 'number' ? config.max : undefined;
        if (max === undefined || filtered.length <= max) {
            this.keepAliveScopes.set(scopeKey, filtered);
            return [];
        }
        const evictedEntries = filtered.splice(0, filtered.length - max);
        if (filtered.length > 0) {
            this.keepAliveScopes.set(scopeKey, filtered);
        }
        else {
            this.keepAliveScopes.delete(scopeKey);
        }
        return evictedEntries;
    }
    evictKeepAliveEntries(entries) {
        var _a;
        for (const entry of entries) {
            const cachedModule = this.module.objectManager.getDomParam(entry.domKey, '$savedModule');
            this.module.objectManager.clearDomParams(entry.domKey);
            this.detachChildModule(cachedModule);
            (_a = cachedModule === null || cachedModule === void 0 ? void 0 : cachedModule.setKeepAliveManaged) === null || _a === void 0 ? void 0 : _a.call(cachedModule, false);
            cachedModule === null || cachedModule === void 0 ? void 0 : cachedModule.destroy();
        }
    }
    removeKeepAliveCacheEntry(domKey) {
        for (const [scopeKey, entries] of this.keepAliveScopes.entries()) {
            const filtered = entries.filter(item => item.domKey !== domKey);
            if (filtered.length === entries.length) {
                continue;
            }
            if (filtered.length > 0) {
                this.keepAliveScopes.set(scopeKey, filtered);
            }
            else {
                this.keepAliveScopes.delete(scopeKey);
            }
        }
    }
    detachChildModule(module) {
        if (!module) {
            return;
        }
        const index = this.module.children.indexOf(module);
        if (index !== -1) {
            this.module.children.splice(index, 1);
        }
    }
}
function normalizeKeepAliveConfig(value, dom) {
    if (value === undefined || value === false) {
        return undefined;
    }
    if (value === true) {
        return {
            disabled: false,
            scopeKey: dom.key
        };
    }
    return value;
}
function shouldCacheKeepAlive(config, module) {
    if (!config || config.disabled) {
        return false;
    }
    if (typeof config.max === 'number' && config.max <= 0) {
        return false;
    }
    const moduleName = module.constructor.name;
    if (config.include && !matchesKeepAlivePattern(config.include, moduleName)) {
        return false;
    }
    if (config.exclude && matchesKeepAlivePattern(config.exclude, moduleName)) {
        return false;
    }
    return true;
}
function matchesKeepAlivePattern(pattern, moduleName) {
    if (pattern instanceof RegExp) {
        return pattern.test(moduleName);
    }
    if (Array.isArray(pattern)) {
        return pattern.some(item => matchesKeepAlivePattern(item, moduleName));
    }
    if (typeof pattern === 'string') {
        return pattern
            .split(',')
            .map(item => item.trim())
            .filter(item => item.length > 0)
            .includes(moduleName);
    }
    return false;
}
function getKeepAliveScopeKey(config, fallbackKey) {
    var _a;
    return String((_a = config.scopeKey) !== null && _a !== void 0 ? _a : fallbackKey);
}
function findTransitionDom(dom) {
    const managedDom = dom;
    if (managedDom.transition && dom.node instanceof Element) {
        return dom;
    }
    for (const child of dom.children || []) {
        const matched = findTransitionDom(child);
        if (matched) {
            return matched;
        }
    }
    return undefined;
}

/**
 * watch 管理器
 */
class Watcher {
    /**
     * 添加监听
     * @remarks 相同model、key、module只能添加一次
     * @param module -  所属模块
     * @param model -   监听model
     * @param key -     监听属性或属性数组，如果为深度watch，则为func
     * @param func -    触发函数，参数依次为 model,key,oldValue,newValue，如果为深度watch，则为deep
     * @returns
     */
    static watch(module, model, key, func) {
        //深度监听
        if (typeof key === 'function') {
            return this.watchDeep(module, model, key);
        }
        if (!Array.isArray(key)) {
            key = [key];
        }
        for (let k of key) {
            if (!this.map.has(model)) {
                const o = {};
                o[k] = [{ module: module, func: func }];
                this.map.set(model, o);
            }
            else {
                const o = this.map.get(model);
                if (!o.hasOwnProperty(k)) {
                    o[k] = [{ module: module, func: func }];
                    this.map.set(model, o);
                }
                else {
                    const a = o[k];
                    //相同module只能监听一次
                    if (a.find(item => item.module === module)) {
                        continue;
                    }
                    a.push({ module: module, func: func });
                }
            }
        }
        //返回取消watch函数
        return () => {
            const o = this.map.get(model);
            for (let k of key) {
                let ii;
                //找到对应module的watch
                if ((ii = o[k].findIndex(item => item.module === module)) !== -1) {
                    o[k].splice(ii, 1);
                }
                if (o[k].length === 0) {
                    delete o[k];
                }
            }
        };
    }
    /**
     * 深度监听
     * @param module
     * @param model
     * @param func
     * @returns
     */
    static watchDeep(module, model, func) {
        if (this.deepMap.has(model)) {
            const arr = this.deepMap.get(model);
            if (arr.find(item => item.module === module)) {
                return;
            }
            arr.push({ module: module, func: func });
        }
        else {
            this.deepMap.set(model, [{ module: module, func: func }]);
        }
        return () => {
            this.deepMap.delete(model);
        };
    }
    /**
     * 处理监听
     * @param model -       model
     * @param key -         监听的属性名
     * @param oldValue -    旧值
     * @param newValue -    新值
     */
    static handle(model, key, oldValue, newValue) {
        if (this.map.size === 0 && this.deepMap.size === 0) {
            return;
        }
        let arr = [];
        if (this.map.has(model)) {
            const a = this.map.get(model)[key];
            if (a) {
                arr = a;
            }
        }
        //查找父model watch为true的对象
        if (this.deepMap.size > 0) {
            for (let m = model['__parent']; m; m = m['__parent']) {
                if (this.deepMap.has(m)) {
                    arr = arr.concat(this.deepMap.get(m));
                }
            }
        }
        if (arr.length > 0) {
            for (let o of arr) {
                o.func.call(o.module, model, key, oldValue, newValue);
            }
        }
    }
}
/**
 * model map
 * key: model
 * value: {key:{module:来源module,func:触发函数,deep:深度监听}}，其中key为监听属性
 */
Watcher.map = new Map();
/**
 * 深度watch map
 * key: model
 * value: {module:来源module,func:触发函数,deep:深度监听}
 */
Watcher.deepMap = new Map();

class ModelManager {
    static addShareModel(model, module) {
        if (!this.shareModelMap.has(model)) {
            this.shareModelMap.set(model, [model["__module"], module]);
            return;
        }
        const arr = this.shareModelMap.get(model);
        if (arr.indexOf(module) === -1) {
            arr.push(module);
        }
    }
    static getModule(model) {
        if (this.shareModelMap.has(model)) {
            return this.shareModelMap.get(model);
        }
        return model["__module"];
    }
    static update(model, key, oldValue, newValue) {
        const dirtyPath = this.getDirtyPath(model, key);
        if (this.shareModelMap.size > 0) {
            for (let current = model; current; current = current["__parent"]) {
                if (!this.shareModelMap.has(current)) {
                    continue;
                }
                for (const module of this.shareModelMap.get(current)) {
                    module.markDirty();
                    Renderer.add(module);
                }
                Watcher.handle(model, key, oldValue, newValue);
                return;
            }
        }
        const module = model["__module"];
        if (module) {
            module.markDirty(dirtyPath);
            Renderer.add(module);
        }
        Watcher.handle(model, key, oldValue, newValue);
    }
    static get(model, key) {
        if (key) {
            if (key.indexOf(".") !== -1) {
                const arr = key.split(".");
                for (let i = 0; i < arr.length - 1; i++) {
                    model = model[arr[i]];
                    if (!model) {
                        break;
                    }
                }
                if (!model) {
                    return;
                }
                key = arr[arr.length - 1];
            }
            model = model[key];
        }
        return model;
    }
    static set(model, key, value) {
        if (key.includes(".")) {
            const arr = key.split(".");
            for (let i = 0; i < arr.length - 1; i++) {
                if (!model[arr[i]]) {
                    model[arr[i]] = {};
                }
                model = model[arr[i]];
            }
            key = arr[arr.length - 1];
        }
        model[key] = value;
    }
    static getDirtyPath(model, key) {
        if (typeof key === "symbol") {
            return;
        }
        const parts = [key];
        for (let current = model; current; current = current["__parent"]) {
            const name = current["__name"];
            if (typeof name === "string" && name !== "") {
                parts.unshift(name);
            }
        }
        return parts.join(".");
    }
}
ModelManager.shareModelMap = new Map();

configureReactivityRuntime({
    notifyBindingUpdate(model, key, oldValue, newValue) {
        ModelManager.update(model, key, oldValue, newValue);
    }
});
/**
 * model proxy
 */
class Model {
    /**
     * @param data - data source
     * @param module - owner module
     * @param parent - parent model
     * @param name - property name in parent
     * @returns model proxy
     */
    constructor(data, module, parent, name) {
        const source = data;
        if (!data || typeof data !== "object" || source["__module"]) {
            return data;
        }
        source["__key"] = Util.genId();
        const proxy = new Proxy(source, {
            set(src, key, value, receiver) {
                if (typeof key === "symbol") {
                    src[key] = value;
                    return true;
                }
                const current = src[key];
                if ((isRef(current) || isComputed(current))
                    && !Object.is(current, value)
                    && !isRef(value)
                    && !isComputed(value)) {
                    current.value = value;
                    return true;
                }
                if (Object.is(current, value)) {
                    return true;
                }
                unbindStateHost(current, receiver, key);
                const newValue = value;
                if (value && newValue["__module"] && src["__module"] !== newValue["__module"]) {
                    ModelManager.addShareModel(value, src["__module"] || module);
                }
                bindStateHost(value, receiver, key);
                src[key] = value;
                ModelManager.update(receiver, key, current, value);
                trigger(receiver, key);
                return true;
            },
            get(src, key, receiver) {
                if (typeof key === "symbol") {
                    return Reflect.get(src, key, receiver);
                }
                if (key === "__module") {
                    return receiver ? module : undefined;
                }
                if (key === "__parent") {
                    return parent;
                }
                if (key === "__name") {
                    return name;
                }
                if (key !== "__key") {
                    track(receiver, key);
                }
                let value = src[key];
                if (shouldSkipModelProxy(value)) {
                    return unwrapState(value);
                }
                if (value && typeof value === "object" && !value["__module"]) {
                    value = new Model(value, module, receiver, name || key);
                    src[key] = value;
                }
                return value;
            },
            deleteProperty(src, key) {
                if (typeof key === "symbol") {
                    return Reflect.deleteProperty(src, key);
                }
                const oldValue = src[key];
                unbindStateHost(oldValue, proxy, key);
                delete src[key];
                ModelManager.update(proxy, key, oldValue, undefined);
                trigger(proxy, key);
                return true;
            }
        });
        for (const key of Object.keys(source)) {
            bindStateHost(source[key], proxy, key);
        }
        return proxy;
    }
}

/**
 * 对象管理器
 * @remarks
 * 用于存储模块的内存变量，`$`开始的数据项可能被nodom占用，使用时禁止使用。
 *
 * 默认属性集
 *
 *  $events     事件集
 *
 *  $domparam   dom参数
 */
class ObjectManager {
    /**
     * module   模块
     * @param module - 模块
     */
    constructor(module) {
        this.cache = new NCache();
    }
    /**
     * 保存到cache
     * @param key -     键，支持"."（多级数据分割）
     * @param value -   值
     */
    set(key, value) {
        this.cache.set(key + '', value);
    }
    /**
     * 从cache读取
     * @param key - 键，支持多级数据，如"x.y.z"
     * @returns     缓存的值或undefined
     */
    get(key) {
        return this.cache.get(key);
    }
    /**
     * 从cache移除
     * @param key -   键，支持"."（多级数据分割）
     */
    remove(key) {
        this.cache.remove(key);
    }
    /**
     * 设置事件参数
     * @param id -      事件id
     * @param key -     dom key
     * @param name -    参数名
     * @param value -   参数值
     */
    setEventParam(id, key, name, value) {
        this.cache.set('$events.' + id + '.$params.' + key + '.' + name, value);
    }
    /**
     * 获取事件参数值
     * @param id -      事件id
     * @param key -     dom key
     * @param name -    参数名
     * @returns         参数值
     */
    getEventParam(id, key, name) {
        return this.get('$events.' + id + '.$params.' + key + '.' + name);
    }
    /**
     * 移除事件参数
     * @param id -      事件id
     * @param key -     dom key
     * @param name -    参数名
     */
    removeEventParam(id, key, name) {
        this.remove('$events.' + id + '.$params.' + key + '.' + name);
    }
    /**
     * 清空事件参数
     * @param id -      事件id
     * @param key -     dom key
     */
    clearEventParams(id, key) {
        if (key !== undefined && key !== null) { //删除对应dom的事件参数
            this.remove('$events.' + id + '.$params.' + key);
        }
        else { //删除所有事件参数
            this.remove('$events.' + id + '.$params');
        }
    }
    /**
     * 设置dom参数值
     * @param key -     dom key
     * @param name -    参数名
     * @param value -   参数值
     */
    setDomParam(key, name, value) {
        this.set('$domparam.' + key + '.' + name, value);
    }
    /**
     * 获取dom参数值
     * @param key -     dom key
     * @param name -    参数名
     * @returns         参数值
     */
    getDomParam(key, name) {
        return this.get('$domparam.' + key + '.' + name);
    }
    /**
     * 移除dom参数值
     * @param key -     dom key
     * @param name -    参数名
     */
    removeDomParam(key, name) {
        this.remove('$domparam.' + key + '.' + name);
    }
    /**
     * 清除element 参数集
     * @param key -     dom key
     */
    clearDomParams(key) {
        this.remove('$domparam.' + key);
    }
    /**
     * 清除缓存dom对象集
     */
    clearAllDomParams() {
        this.remove('$domparam');
    }
}

const DEVTOOLS_TIMELINE_HOOKS = new Set([
    "onMount",
    "onUnMount",
    "onActivated",
    "onDeactivated",
    "onBeforeEnter",
    "onEnter",
    "onAfterEnter",
    "onEnterCancelled",
    "onBeforeLeave",
    "onLeave",
    "onAfterLeave",
    "onLeaveCancelled",
    "onBeforeMove",
    "onMove",
    "onAfterMove",
    "onMoveCancelled",
    "onSuspensePending",
    "onSuspenseFallback",
    "onSuspenseResolve",
    "onSuspenseError",
    "onSuspenseRetry"
]);
class Module {
    constructor(id) {
        this.children = [];
        this.slots = new Map();
        this.compositionCleanups = [];
        this.compositionHooks = new Map();
        this.dirtyPaths = new Set(["*"]);
        this.keepAliveManaged = false;
        this.keepAliveDeactivated = false;
        this.id = id || Util.genId();
        this.domManager = new DomManager(this);
        this.objectManager = new ObjectManager(this);
        this.eventFactory = new EventFactory(this);
        this.appContext = ModuleFactory.getAppContext();
        ModuleFactory.add(this);
    }
    init() {
        this.state = EModuleState.INIT;
        if (Array.isArray(this.modules)) {
            for (const item of this.modules) {
                registerModuleDefinition(item);
            }
            delete this.modules;
        }
        this.appContext = this.appContext || ModuleFactory.getAppContext();
        this.applyGlobalProperties();
        this.model = new Model(this.data() || {}, this);
        this.initSetupState();
        this.doModuleEvent('onInit');
    }
    template(props) {
        return null;
    }
    data() {
        return {};
    }
    setup() {
        return;
    }
    render() {
        if (this !== ModuleFactory.getMain() && (!this.srcDom || this.state === EModuleState.UNMOUNTED)) {
            return;
        }
        const firstRender = this.oldTemplate === undefined;
        let templateStr = this.template(this.props);
        if (!templateStr) {
            return;
        }
        templateStr = templateStr.trim();
        if (templateStr === '') {
            return;
        }
        const templateChanged = templateStr !== this.oldTemplate;
        if (templateChanged) {
            this.oldTemplate = templateStr;
            this.compile(templateStr);
        }
        if (!this.domManager.vdomTree) {
            return;
        }
        if (firstRender) {
            this.doModuleEvent('onBeforeFirstRender');
        }
        this.doModuleEvent('onBeforeRender');
        const oldTree = this.domManager.renderedTree;
        const dirtyPaths = firstRender || templateChanged || !oldTree
            ? ["*"]
            : this.consumeDirtyPaths();
        const root = Renderer.renderDom(this, this.domManager.vdomTree, this.model, undefined, undefined, undefined, oldTree, dirtyPaths);
        this.domManager.renderedTree = root;
        this.dirtyPaths.clear();
        this.doModuleEvent('onRender');
        if (firstRender) {
            this.doModuleEvent('onFirstRender');
        }
        if (!this.domManager.renderedTree) {
            this.unmount();
            return;
        }
        if (this.state === EModuleState.MOUNTED) {
            if (oldTree && this.model) {
                const changeDoms = DiffTool.compare(this.domManager.renderedTree, oldTree);
                if (changeDoms.length > 0) {
                    this.doModuleEvent('onBeforeUpdate');
                    Renderer.handleChangedDoms(this, changeDoms);
                    this.doModuleEvent('onUpdate');
                }
            }
        }
        else {
            this.mount();
        }
        notifyDevtoolsForModule(this, firstRender ? 'first-render' : 'render');
    }
    addChild(module) {
        if (!this.children.includes(module)) {
            this.children.push(module);
            module.parentId = this.id;
        }
    }
    removeChild(module) {
        const ind = this.children.indexOf(module);
        if (ind !== -1) {
            module.unmount();
            this.children.splice(ind, 1);
        }
    }
    active() {
        if (this.state === EModuleState.UNMOUNTED) {
            this.state = EModuleState.INIT;
        }
        this.markDirty();
        Renderer.add(this);
    }
    markDirty(path) {
        if (!path) {
            this.dirtyPaths.clear();
            this.dirtyPaths.add("*");
            return;
        }
        if (this.dirtyPaths.has("*")) {
            return;
        }
        this.dirtyPaths.add(path);
    }
    mount() {
        var _a, _b, _c, _d, _e, _f;
        if (this !== ModuleFactory.getMain() && !((_b = (_a = this.srcDom) === null || _a === void 0 ? void 0 : _a.node) === null || _b === void 0 ? void 0 : _b.parentElement)) {
            return;
        }
        const isKeepAliveReactivation = this.keepAliveManaged && this.keepAliveDeactivated;
        if (!isKeepAliveReactivation) {
            this.doModuleEvent('onBeforeMount');
        }
        const rootEl = new DocumentFragment();
        const el = Renderer.renderToHtml(this, this.domManager.renderedTree, rootEl);
        if (this === ModuleFactory.getMain()) {
            Renderer.getRootEl().appendChild(el);
        }
        else if ((_d = (_c = this.srcDom) === null || _c === void 0 ? void 0 : _c.node) === null || _d === void 0 ? void 0 : _d.parentElement) {
            Util.insertAfter(el, this.srcDom.node);
        }
        (_f = (_e = Renderer).syncTeleports) === null || _f === void 0 ? void 0 : _f.call(_e, this.domManager.renderedTree);
        if (!isKeepAliveReactivation) {
            this.doModuleEvent('onMount');
        }
        if (this.keepAliveManaged) {
            this.keepAliveDeactivated = false;
            this.doModuleEvent('onActivated');
        }
        this.state = EModuleState.MOUNTED;
    }
    unmount(passive) {
        var _a;
        if (this.state !== EModuleState.MOUNTED || ModuleFactory.getMain() === this) {
            return;
        }
        const isKeepAliveDeactivation = !!passive && this.keepAliveManaged;
        Renderer.remove(this);
        if (!isKeepAliveDeactivation) {
            this.doModuleEvent('onBeforeUnMount');
        }
        this.eventFactory.clear();
        this.domManager.renderedTree = null;
        if (passive) {
            this.state = EModuleState.INIT;
        }
        else {
            this.state = EModuleState.UNMOUNTED;
        }
        for (const m of this.children) {
            m.unmount(true);
        }
        if ((_a = this.srcDom.node) === null || _a === void 0 ? void 0 : _a.parentElement) {
            if (this.srcDom.node.nextSibling && !(this.srcDom.node.nextSibling instanceof Comment)) {
                this.srcDom.node.parentElement.removeChild(this.srcDom.node.nextSibling);
            }
            if (passive) {
                this.srcDom.node.parentElement.removeChild(this.srcDom.node);
            }
        }
        if (isKeepAliveDeactivation) {
            this.keepAliveDeactivated = true;
            this.doModuleEvent('onDeactivated');
        }
        else {
            this.keepAliveDeactivated = false;
            this.doModuleEvent('onUnMount');
        }
    }
    destroy() {
        var _a, _b, _c;
        Renderer.remove(this);
        this.keepAliveManaged = false;
        this.keepAliveDeactivated = false;
        this.unmount(true);
        for (const m of this.children) {
            m.destroy();
        }
        this.eventFactory.clear();
        if ((_c = (_b = (_a = this.domManager) === null || _a === void 0 ? void 0 : _a.renderedTree) === null || _b === void 0 ? void 0 : _b.node) === null || _c === void 0 ? void 0 : _c.parentElement) {
            this.domManager.renderedTree.node.parentElement.removeChild(this.domManager.renderedTree.node);
        }
        this.domManager.renderedTree = null;
        this.clearCompositionCleanups();
        CssManager.clearModuleRules(this);
        this.objectManager.clearAllDomParams();
        ModuleFactory.remove(this.id);
    }
    captureSetupState() {
        const snapshot = {};
        if (!this.setupState) {
            return snapshot;
        }
        for (const key of Object.keys(this.setupState)) {
            const binding = this.setupState[key];
            if (typeof binding === 'function' || isComputed(binding)) {
                continue;
            }
            if (isRef(binding)) {
                snapshot[key] = cloneStateValue(binding.value);
            }
            else if (isReactive(binding)) {
                snapshot[key] = cloneStateValue(toRaw(binding));
            }
            else {
                snapshot[key] = cloneStateValue(binding);
            }
        }
        return snapshot;
    }
    captureHotSnapshot() {
        return {
            children: this.children.map(item => item.captureHotSnapshot()),
            hotId: this.getHotId(),
            state: this.captureSetupState()
        };
    }
    applyHotSnapshot(snapshot) {
        if (!snapshot || snapshot.hotId !== this.getHotId()) {
            return;
        }
        this.applySetupState(snapshot.state);
        const childQueues = new Map();
        for (const childSnapshot of snapshot.children || []) {
            const arr = childQueues.get(childSnapshot.hotId) || [];
            arr.push(childSnapshot);
            childQueues.set(childSnapshot.hotId, arr);
        }
        for (const child of this.children) {
            const queue = childQueues.get(child.getHotId());
            const nextSnapshot = queue === null || queue === void 0 ? void 0 : queue.shift();
            if (nextSnapshot) {
                child.applyHotSnapshot(nextSnapshot);
            }
        }
    }
    getParent() {
        if (this.parentId) {
            return ModuleFactory.get(this.parentId);
        }
    }
    doModuleEvent(eventName) {
        return this.emitHook(eventName, this.model);
    }
    emitHook(eventName, ...args) {
        var _a, _b;
        const foo = this[eventName];
        let result;
        if (foo && typeof foo === 'function') {
            result = foo.apply(this, args);
        }
        this.runCompositionHooks(eventName, ...args);
        if (DEVTOOLS_TIMELINE_HOOKS.has(eventName)) {
            notifyDevtoolsForModule(this, 'hook', {
                hookArgs: summarizeHookArgs(args),
                hookName: eventName,
                hotId: (_a = this.getHotId) === null || _a === void 0 ? void 0 : _a.call(this),
                moduleId: this.id,
                moduleName: ((_b = this.constructor) === null || _b === void 0 ? void 0 : _b.name) || 'AnonymousModule'
            });
        }
        return result;
    }
    setProps(props, dom) {
        if (!props) {
            return;
        }
        const keepAliveValue = dom.keepAlive;
        if (isKeepAliveManagedValue(keepAliveValue)) {
            this.setKeepAliveManaged(true);
        }
        const dataObj = props['$data'];
        delete props['$data'];
        if (dataObj) {
            for (const d of Object.keys(dataObj)) {
                this.model[d] = dataObj[d];
            }
        }
        this.srcDom = dom;
        let change = false;
        if (!this.props) {
            change = true;
        }
        else {
            for (const k of Object.keys(props)) {
                if (props[k] !== this.props[k]) {
                    change = true;
                    break;
                }
            }
            if (!change && Object.keys(this.props).length !== Object.keys(props).length) {
                change = true;
            }
        }
        if (change) {
            this.markDirty();
        }
        if (change && this.state === EModuleState.MOUNTED) {
            Renderer.add(this);
        }
        this.props = props;
    }
    compile(templateStr) {
        var _a;
        this.children = [];
        CssManager.clearModuleRules(this);
        this.objectManager.clearAllDomParams();
        this.eventFactory.clear();
        this.domManager.vdomTree = new Compiler(this).compile(templateStr);
        if (!this.domManager.vdomTree) {
            return;
        }
        const root = this.domManager.vdomTree;
        if ((_a = this.srcDom) === null || _a === void 0 ? void 0 : _a.events) {
            if (root.events) {
                root.events = root.events.concat(this.srcDom.events);
            }
            else {
                root.events = this.srcDom.events;
            }
        }
        this.doModuleEvent('onCompile');
    }
    setExcludeProps(props) {
        this.excludedProps = props;
    }
    getModule(name, attrs, deep) {
        if (!this.children) {
            return;
        }
        const cls = ModuleFactory.getClass(name);
        if (!cls) {
            return;
        }
        return find(this);
        function find(mdl) {
            for (const m of mdl.children) {
                if (m.constructor === cls) {
                    if (attrs) {
                        let matched = true;
                        for (const k of Object.keys(attrs)) {
                            if (!m.props || m.props[k] !== attrs[k]) {
                                matched = false;
                                break;
                            }
                        }
                        if (matched) {
                            return m;
                        }
                    }
                    else {
                        return m;
                    }
                }
                if (deep) {
                    const r = find(m);
                    if (r) {
                        return r;
                    }
                }
            }
        }
    }
    getModules(className, attrs, deep) {
        if (!this.children) {
            return;
        }
        const cls = className ? ModuleFactory.getClass(className) : undefined;
        if (className && !cls) {
            return [];
        }
        const arr = [];
        find(this);
        return arr;
        function find(module) {
            if (!module.children) {
                return;
            }
            for (const m of module.children) {
                if (cls && m.constructor !== cls) {
                    if (deep) {
                        find(m);
                    }
                    continue;
                }
                if (attrs) {
                    let matched = true;
                    for (const k of Object.keys(attrs)) {
                        if (!m.props || m.props[k] !== attrs[k]) {
                            matched = false;
                            break;
                        }
                    }
                    if (matched) {
                        arr.push(m);
                    }
                }
                else {
                    arr.push(m);
                }
                if (deep) {
                    find(m);
                }
            }
        }
    }
    watch(model, key, func) {
        const tp = typeof model;
        if (tp === 'string' || Array.isArray(model)) {
            return Watcher.watch(this, this.model, model, key);
        }
        else if (tp === 'object') {
            return Watcher.watch(this, model, key, func);
        }
        else if (tp === 'function') {
            return Watcher.watch(this, this.model, model);
        }
    }
    set(model, key, value) {
        if (typeof model === 'object') {
            ModelManager.set(model, key, value);
        }
        else {
            ModelManager.set(this.model, model, key);
        }
    }
    get(model, key) {
        if (typeof model === 'object') {
            return ModelManager.get(model, key);
        }
        else {
            return ModelManager.get(this.model, model);
        }
    }
    invokeMethod(methodName, ...args) {
        if (typeof this[methodName] === 'function') {
            return this[methodName](...args);
        }
    }
    getRenderedDom(params) {
        return this.domManager.getRenderedDom(params);
    }
    getNode(params) {
        var _a;
        return (_a = this.domManager.getRenderedDom(params)) === null || _a === void 0 ? void 0 : _a.node;
    }
    addCompositionHook(name, hook) {
        if (typeof hook !== 'function') {
            return;
        }
        const hooks = this.compositionHooks.get(name) || [];
        hooks.push(hook);
        this.compositionHooks.set(name, hooks);
    }
    provide(key, value) {
        this.provides || (this.provides = new Map());
        this.provides.set(key, value);
    }
    inject(key, defaultValue) {
        var _a, _b, _c;
        if ((_a = this.provides) === null || _a === void 0 ? void 0 : _a.has(key)) {
            return this.provides.get(key);
        }
        let parent = this.getParent();
        while (parent) {
            if ((_b = parent.provides) === null || _b === void 0 ? void 0 : _b.has(key)) {
                return parent.provides.get(key);
            }
            parent = parent.getParent();
        }
        if ((_c = this.appContext) === null || _c === void 0 ? void 0 : _c.provides.has(key)) {
            return this.appContext.provides.get(key);
        }
        return defaultValue;
    }
    setExposed(exposed) {
        this.exposed = exposed;
    }
    addCompositionCleanup(cleanup) {
        if (typeof cleanup === 'function') {
            this.compositionCleanups.push(cleanup);
        }
    }
    setKeepAliveManaged(managed) {
        this.keepAliveManaged = managed;
        if (!managed) {
            this.keepAliveDeactivated = false;
        }
    }
    initSetupState() {
        const result = withCurrentScope(this, () => this.setup());
        if (!result || typeof result !== 'object') {
            return;
        }
        this.setupState = result;
        for (const key of Object.keys(result)) {
            const value = result[key];
            if (typeof value === 'function') {
                this[key] = value.bind(this);
            }
            else {
                this.model[key] = value;
            }
        }
        this.restoreSetupState();
    }
    applyGlobalProperties() {
        var _a;
        const globalProperties = (_a = this.appContext) === null || _a === void 0 ? void 0 : _a.config.globalProperties;
        if (!globalProperties) {
            return;
        }
        for (const key of Object.keys(globalProperties)) {
            if (key in this) {
                continue;
            }
            this[key] = globalProperties[key];
        }
    }
    runCompositionHooks(eventName, ...args) {
        const hooks = this.compositionHooks.get(eventName);
        if (!hooks || hooks.length === 0) {
            return;
        }
        for (const hook of hooks) {
            hook.apply(this, args);
        }
    }
    clearCompositionCleanups() {
        if (this.compositionCleanups.length === 0) {
            return;
        }
        for (const cleanup of this.compositionCleanups.splice(0)) {
            cleanup();
        }
    }
    restoreSetupState() {
        const ctor = this.constructor;
        const hotState = ctor['__nodomHotState'];
        if (!hotState || !this.setupState) {
            return;
        }
        this.applySetupState(hotState);
        delete ctor['__nodomHotState'];
    }
    applySetupState(hotState) {
        if (!hotState || !this.setupState) {
            return;
        }
        for (const key of Object.keys(hotState)) {
            if (!Object.prototype.hasOwnProperty.call(this.setupState, key)) {
                continue;
            }
            const binding = this.setupState[key];
            const nextValue = cloneStateValue(hotState[key]);
            if (isRef(binding)) {
                binding.value = nextValue;
            }
            else if (isReactive(binding) && nextValue && typeof nextValue === 'object') {
                syncReactiveState(binding, nextValue);
            }
            else if (!isComputed(binding) && typeof binding !== 'function') {
                this.model[key] = nextValue;
            }
        }
    }
    getHotId() {
        const hotId = this['__ndFile']
            || this.constructor['__ndFile']
            || this.constructor.name;
        return normalizeHotId$1(hotId);
    }
    consumeDirtyPaths() {
        if (this.dirtyPaths.size === 0) {
            return ["*"];
        }
        return Array.from(this.dirtyPaths);
    }
}
function registerModuleDefinition(item) {
    if (!item) {
        return;
    }
    if (typeof item === "function") {
        ModuleFactory.addClass(item);
        return;
    }
    if (typeof item === "object") {
        const namedModule = item;
        if (typeof namedModule.module === "function") {
            ModuleFactory.addClass(namedModule.module, namedModule.name);
        }
    }
}
function syncReactiveState(target, nextValue) {
    const rawTarget = toRaw(target);
    for (const key of Reflect.ownKeys(rawTarget)) {
        if (!Object.prototype.hasOwnProperty.call(nextValue, key)) {
            Reflect.deleteProperty(rawTarget, key);
        }
    }
    for (const key of Reflect.ownKeys(nextValue)) {
        Reflect.set(rawTarget, key, cloneStateValue(Reflect.get(nextValue, key)));
    }
}
function normalizeHotId$1(hotId) {
    return typeof hotId === 'string' ? hotId.replace(/\\/g, '/') : '';
}
function isKeepAliveManagedValue(value) {
    if (value === undefined || value === false) {
        return false;
    }
    if (value === true) {
        return true;
    }
    return !value.disabled;
}
function notifyDevtoolsForModule(module, reason, details) {
    var _a, _b;
    const app = (_a = module.appContext) === null || _a === void 0 ? void 0 : _a.app;
    if (!app) {
        return;
    }
    const globalObject = typeof globalThis !== "undefined" ? globalThis : undefined;
    const windowObject = globalObject === null || globalObject === void 0 ? void 0 : globalObject.window;
    const globalRecord = globalObject;
    const hook = ((windowObject === null || windowObject === void 0 ? void 0 : windowObject["__NODOMX_DEVTOOLS_HOOK__"]) || (globalRecord === null || globalRecord === void 0 ? void 0 : globalRecord["__NODOMX_DEVTOOLS_HOOK__"]));
    if (hook && typeof hook.notifyUpdate === "function") {
        hook.notifyUpdate(app, reason, Object.assign(Object.assign({}, details), { hotId: (_b = module.getHotId) === null || _b === void 0 ? void 0 : _b.call(module) }));
    }
}
function summarizeHookArgs(args) {
    return args.map(value => {
        if (value === null || value === undefined) {
            return String(value);
        }
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        if (value instanceof Element) {
            return `<${value.tagName.toLowerCase()}>`;
        }
        if (Array.isArray(value)) {
            return `[Array(${value.length})]`;
        }
        if (typeof value === 'object') {
            const keys = Object.keys(value);
            return keys.length ? `{${keys.slice(0, 3).join(', ')}}` : '{}';
        }
        return typeof value;
    });
}

function normalizeRoutePath(path) {
    if (!path || path.trim() === "") {
        return "/";
    }
    let value = path.trim();
    if (!value.startsWith("/")) {
        value = "/" + value;
    }
    value = value.replace(/\/{2,}/g, "/");
    if (value.length > 1 && value.endsWith("/")) {
        value = value.slice(0, -1);
    }
    return value || "/";
}
function normalizeChildRoutePath(path) {
    if (!path || path.trim() === "" || path.trim() === "/") {
        return "";
    }
    return path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}
function splitRoutePath(path) {
    const normalized = normalizeRoutePath(path);
    if (normalized === "/") {
        return [];
    }
    return normalized.slice(1).split("/").filter(Boolean).map(decodeURIComponent);
}
function joinRoutePath(parentPath, childPath) {
    if (!childPath || childPath.trim() === "" || childPath.trim() === "/") {
        return normalizeRoutePath(parentPath);
    }
    if (childPath.startsWith("/")) {
        return normalizeRoutePath(childPath);
    }
    return normalizeRoutePath(`${normalizeRoutePath(parentPath)}/${childPath}`);
}
function parseRouteUrl(url) {
    const raw = (url || "/").trim() || "/";
    let path = raw;
    let hash = "";
    const hashIndex = path.indexOf("#");
    if (hashIndex !== -1) {
        hash = path.slice(hashIndex);
        path = path.slice(0, hashIndex);
    }
    let queryString = "";
    const queryIndex = path.indexOf("?");
    if (queryIndex !== -1) {
        queryString = path.slice(queryIndex + 1);
        path = path.slice(0, queryIndex);
    }
    const query = parseRouteQuery(queryString);
    const pathname = normalizeRoutePath(path);
    const normalizedQuery = stringifyRouteQuery(query);
    return {
        path: pathname,
        fullPath: `${pathname}${normalizedQuery ? `?${normalizedQuery}` : ""}${hash}`,
        hash,
        query
    };
}
function parseRouteQuery(queryString) {
    const query = {};
    if (!queryString) {
        return query;
    }
    for (const segment of queryString.split("&")) {
        if (!segment) {
            continue;
        }
        const [rawKey, rawValue = ""] = segment.split("=");
        const key = decodeURIComponent(rawKey);
        const value = decodeURIComponent(rawValue);
        const current = query[key];
        if (current === undefined) {
            query[key] = value;
        }
        else if (Array.isArray(current)) {
            current.push(value);
        }
        else {
            query[key] = [current, value];
        }
    }
    return query;
}
function stringifyRouteQuery(query) {
    if (!query) {
        return "";
    }
    const parts = [];
    for (const key of Object.keys(query)) {
        const value = query[key];
        if (Array.isArray(value)) {
            for (const item of value) {
                parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(item)}`);
            }
        }
        else {
            parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
        }
    }
    return parts.join("&");
}
function mergeRouteMeta(routes) {
    const meta = {};
    for (const route of routes) {
        Object.assign(meta, route.meta || {});
    }
    return meta;
}
function createRouteLocation(routes, path, query, hash, params) {
    var _a;
    const matched = routes.map(route => ({
        path: route.path,
        fullPath: route.fullPath,
        name: route.name,
        meta: route.meta || {},
        route
    }));
    return {
        path,
        fullPath: `${path}${(() => {
            const queryString = stringifyRouteQuery(query);
            return queryString ? `?${queryString}` : "";
        })()}${hash}`,
        hash,
        name: (_a = routes[routes.length - 1]) === null || _a === void 0 ? void 0 : _a.name,
        meta: mergeRouteMeta(routes),
        query,
        params: Object.assign({}, params),
        data: Object.assign({}, params),
        matched
    };
}
function isActiveRoutePath(targetPath, currentPath) {
    if (!currentPath) {
        return false;
    }
    const target = parseRouteUrl(targetPath).path;
    const current = parseRouteUrl(currentPath).path;
    return current === target || current.startsWith(`${target}/`);
}

class Route {
    constructor(config, parent) {
        this.path = "";
        this.fullPath = "/";
        this.pathSegments = [];
        this.params = [];
        this.data = {};
        this.children = [];
        this.meta = {};
        this.id = Util.genId();
        this.parent = parent;
        if (!config) {
            this.fullPath = parent ? parent.fullPath : "/";
            return;
        }
        this.name = config.name;
        this.meta = Object.assign({}, (config.meta || {}));
        this.redirect = config.redirect;
        this.beforeEnter = config.beforeEnter;
        this.loader = config.loader || config.load;
        this.preload = config.preload;
        this.onEnter = config.onEnter;
        this.onLeave = config.onLeave;
        const component = config.component || config.module || config.modulePath;
        if (component instanceof Module) {
            this.module = component;
        }
        else {
            this.component = component;
        }
        this.path = normalizeChildRoutePath(config.path);
        this.fullPath = parent ? joinRoutePath(parent.fullPath, config.path) : normalizeRoutePath(config.path);
        this.pathSegments = splitRoutePath(this.path || "/");
        this.params = this.pathSegments.filter(segment => segment.startsWith(":"))
            .map(segment => segment.slice(1));
        parent === null || parent === void 0 ? void 0 : parent.addChild(this);
        const children = config.children || config.routes;
        if (children && Array.isArray(children)) {
            for (const child of children) {
                new Route(child, this);
            }
        }
    }
    addChild(child) {
        if (!this.children.includes(child)) {
            this.children.push(child);
        }
        child.parent = this;
    }
    hasTarget() {
        return !!(this.module || this.component || this.loadedComponent || this.loader);
    }
    getResolvedComponent() {
        return this.module || this.loadedComponent || this.component;
    }
    setLoadedComponent(component) {
        if (!component) {
            return;
        }
        if (component instanceof Module) {
            this.module = component;
            return;
        }
        this.loadedComponent = component;
    }
    clone() {
        const route = new Route();
        route.id = this.id;
        route.path = this.path;
        route.fullPath = this.fullPath;
        route.pathSegments = [...this.pathSegments];
        route.params = [...this.params];
        route.data = Util.clone(this.data);
        route.children = this.children;
        route.onEnter = this.onEnter;
        route.onLeave = this.onLeave;
        route.module = this.module;
        route.component = this.component;
        route.loadedComponent = this.loadedComponent;
        route.loader = this.loader;
        route.preload = this.preload;
        route.beforeEnter = this.beforeEnter;
        route.redirect = this.redirect;
        route.name = this.name;
        route.meta = Object.assign({}, (this.meta || {}));
        route.parent = this.parent;
        return route;
    }
}

class Router {
    constructor(basePath, defaultEnter, defaultLeave) {
        this.root = new Route();
        this.basePath = "";
        this.currentPath = "";
        this.currentRoute = createRouteLocation([], "/", {}, "", {});
        this.waitList = [];
        this.startType = 0;
        this.routerMap = new Map();
        this.beforeGuards = [];
        this.afterGuards = [];
        this.basePath = basePath ? parseRouteUrl(basePath).path : "";
        this.onDefaultEnter = defaultEnter;
        this.onDefaultLeave = defaultLeave;
        window.addEventListener("popstate", () => {
            var _a;
            const stateUrl = ((_a = history.state) === null || _a === void 0 ? void 0 : _a.url) || `${window.location.pathname}${window.location.search}${window.location.hash}`;
            this.startType = 1;
            this.go(this.stripBasePath(stateUrl), true);
        });
    }
    push(path) {
        this.go(path);
    }
    replace(path) {
        this.go(path, true);
    }
    go(path, replace) {
        const fullPath = this.normalizeTargetPath(path);
        if (!fullPath) {
            return;
        }
        if (this.waitList.find(item => item.path === fullPath && !!item.replace === !!replace)) {
            return;
        }
        this.waitList.push({ path: fullPath, replace });
        const ensureRoot = () => {
            if (!this.rootModule) {
                setTimeout(ensureRoot, 0);
                return;
            }
            this.load();
        };
        ensureRoot();
    }
    resolve(path) {
        const target = this.resolveTarget(path);
        return target.location;
    }
    preload(path) {
        return __awaiter(this, void 0, void 0, function* () {
            const resolved = yield this.resolveNavigation(path, this.currentRoute);
            if (!resolved) {
                return this.currentRoute;
            }
            yield this.preloadMatchedRoutes(resolved.routes, resolved.location, this.currentRoute, true);
            return resolved.location;
        });
    }
    beforeEach(guard) {
        if (typeof guard === "function") {
            this.beforeGuards.push(guard);
        }
        return this;
    }
    afterEach(hook) {
        if (typeof hook === "function") {
            this.afterGuards.push(hook);
        }
        return this;
    }
    addActiveDom(module, dom) {
        if (!this.routerMap.has(module.id)) {
            this.routerMap.set(module.id, { activeDoms: [] });
        }
        const cfg = this.routerMap.get(module.id);
        cfg.activeDoms || (cfg.activeDoms = []);
        const index = cfg.activeDoms.findIndex(item => item.key === dom.key);
        if (index === -1) {
            cfg.activeDoms.push(dom);
        }
        else {
            cfg.activeDoms.splice(index, 1, dom);
        }
    }
    registRouter(module, dom) {
        if (!this.rootModule) {
            this.rootModule = module;
        }
        if (!this.routerMap.has(module.id)) {
            this.routerMap.set(module.id, { dom });
        }
        const cfg = this.routerMap.get(module.id);
        cfg.dom = dom;
        if (cfg.wait) {
            this.prepModuleDom(module, cfg.wait);
            delete cfg.wait;
        }
    }
    activePath(path) {
        const current = parseRouteUrl(this.currentPath).path;
        const target = parseRouteUrl(path).path;
        if (!this.currentPath || target === current || target.startsWith(`${current}/`)) {
            this.go(path);
        }
    }
    getRoot() {
        return this.root;
    }
    load() {
        if (this.waitList.length === 0) {
            return;
        }
        const next = this.waitList.shift();
        this.start(next.path, next.replace).finally(() => this.load());
    }
    start(path, replaceState) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const from = this.currentRoute;
            const resolved = yield this.resolveNavigation(path, from);
            if (!resolved) {
                return;
            }
            const { location, routes } = resolved;
            if (location.fullPath === this.currentPath) {
                return;
            }
            const diff = this.diffRoutes(this.getMatchedRoutes(from), routes);
            const guardRoutes = diff.entering.length > 0
                ? diff.entering
                : (from.fullPath !== location.fullPath && routes.length > 0 ? [routes[routes.length - 1]] : []);
            const guardResult = yield this.runGuards(guardRoutes, location, from);
            if (typeof guardResult === "string") {
                this.go(guardResult, replaceState);
                return;
            }
            if (guardResult === false) {
                return;
            }
            for (const route of diff.leaving.slice().reverse()) {
                if (!route.module) {
                    continue;
                }
                const module = yield this.getModule(route);
                if (Util.isFunction(this.onDefaultLeave)) {
                    (_a = this.onDefaultLeave) === null || _a === void 0 ? void 0 : _a.call(this, module, from.path);
                }
                if (Util.isFunction(route.onLeave)) {
                    (_b = route.onLeave) === null || _b === void 0 ? void 0 : _b.call(route, module, from.path);
                }
                module.unmount();
            }
            let parentModule = diff.parentRoute ? yield this.getModule(diff.parentRoute) : this.rootModule;
            for (const route of diff.entering) {
                if (!route.hasTarget()) {
                    continue;
                }
                const module = yield this.getModule(route);
                this.handleRouteModule(route, parentModule, location);
                if (Util.isFunction(this.onDefaultEnter)) {
                    (_c = this.onDefaultEnter) === null || _c === void 0 ? void 0 : _c.call(this, module, location.path);
                }
                if (Util.isFunction(route.onEnter)) {
                    (_d = route.onEnter) === null || _d === void 0 ? void 0 : _d.call(route, module, location.path);
                }
                parentModule = module;
            }
            yield this.syncRouteState(routes, location);
            if (this.startType !== 1) {
                const browserPath = `${this.basePath}${location.fullPath}` || "/";
                if (replaceState) {
                    history.replaceState({ url: browserPath }, "", browserPath);
                }
                else {
                    history.pushState({ url: browserPath }, "", browserPath);
                }
            }
            this.currentPath = location.fullPath;
            this.currentRoute = location;
            this.startType = 0;
            yield this.runAfterEach(location, from);
            void this.preloadMatchedRoutes(routes, location, from);
        });
    }
    resolveNavigation(path_1, from_1) {
        return __awaiter(this, arguments, void 0, function* (path, from, depth = 0) {
            var _a;
            if (depth > 10) {
                return;
            }
            const target = this.resolveTarget(path);
            const redirect = (_a = target.routes[target.routes.length - 1]) === null || _a === void 0 ? void 0 : _a.redirect;
            if (redirect) {
                const nextPath = typeof redirect === "function" ? redirect(target.location) : redirect;
                if (nextPath && nextPath !== target.location.fullPath) {
                    return this.resolveNavigation(nextPath, from, depth + 1);
                }
            }
            return target;
        });
    }
    resolveTarget(path) {
        const parsed = parseRouteUrl(this.stripBasePath(path));
        const matched = this.matchRoutes(parsed.path);
        const location = createRouteLocation(matched.routes, parsed.path, parsed.query, parsed.hash, matched.params);
        return {
            location,
            routes: matched.routes
        };
    }
    matchRoutes(path) {
        const segments = splitRoutePath(path);
        return this.matchBranch(this.root.children, segments, 0, {}) || { routes: [], params: {} };
    }
    matchBranch(routes, segments, startIndex, parentParams) {
        for (const route of routes) {
            const matched = this.matchRoute(route, segments, startIndex);
            if (!matched) {
                continue;
            }
            const params = Object.assign(Object.assign({}, parentParams), matched.params);
            const nextIndex = startIndex + matched.consumed;
            if (route.children.length > 0) {
                const childMatch = this.matchBranch(route.children, segments, nextIndex, params);
                if (childMatch) {
                    return {
                        routes: [route, ...childMatch.routes],
                        params: childMatch.params
                    };
                }
            }
            if (nextIndex === segments.length) {
                return {
                    routes: [route],
                    params
                };
            }
        }
        return;
    }
    matchRoute(route, segments, startIndex) {
        if (route.pathSegments.length === 0) {
            return { consumed: 0, params: {} };
        }
        if (startIndex + route.pathSegments.length > segments.length) {
            return;
        }
        const params = {};
        for (let i = 0; i < route.pathSegments.length; i++) {
            const routeSegment = route.pathSegments[i];
            const currentSegment = segments[startIndex + i];
            if (routeSegment.startsWith(":")) {
                params[routeSegment.slice(1)] = currentSegment;
                continue;
            }
            if (routeSegment !== currentSegment) {
                return;
            }
        }
        return {
            consumed: route.pathSegments.length,
            params
        };
    }
    diffRoutes(fromRoutes, toRoutes) {
        let index = 0;
        while (index < fromRoutes.length && index < toRoutes.length && fromRoutes[index].id === toRoutes[index].id) {
            index++;
        }
        const sharedRoutes = toRoutes.slice(0, index);
        return {
            parentRoute: this.findLastModuleRoute(sharedRoutes),
            leaving: fromRoutes.slice(index).filter(route => !!route.module),
            entering: toRoutes.slice(index).filter(route => route.hasTarget())
        };
    }
    runGuards(routes, to, from) {
        return __awaiter(this, void 0, void 0, function* () {
            for (const guard of this.beforeGuards) {
                const result = yield guard(to, from);
                if (result === false || typeof result === "string") {
                    return result;
                }
            }
            for (const route of routes) {
                if (!route.beforeEnter) {
                    continue;
                }
                const result = yield route.beforeEnter(to, from);
                if (result === false || typeof result === "string") {
                    return result;
                }
            }
            return true;
        });
    }
    runAfterEach(to, from) {
        return __awaiter(this, void 0, void 0, function* () {
            for (const hook of this.afterGuards) {
                yield hook(to, from);
            }
        });
    }
    getModule(route) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.ensureRouteComponentLoaded(route);
            let current = route.getResolvedComponent();
            if (current instanceof Module) {
                route.module = current;
                return current;
            }
            if (typeof current === "string") {
                const registered = ModuleFactory.get(current);
                if (registered) {
                    route.module = registered;
                    return registered;
                }
                const loaded = yield ModuleFactory.load(current);
                if (loaded) {
                    route.setLoadedComponent(loaded);
                    route.module = ModuleFactory.get(loaded);
                }
                return route.module;
            }
            if (typeof current === "function") {
                route.module = ModuleFactory.get(current);
                return route.module;
            }
            return route.module;
        });
    }
    syncRouteState(routes, location) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            for (const route of routes) {
                if (!route.hasTarget()) {
                    continue;
                }
                const module = yield this.getModule(route);
                applyRouteLocation(module, location);
                if (((_a = route.parent) === null || _a === void 0 ? void 0 : _a.module) instanceof Module) {
                    this.setActiveDom(route.parent.module, location.fullPath);
                }
            }
        });
    }
    setActiveDom(module, path) {
        var _a, _b;
        const cfg = this.routerMap.get(module.id);
        if (!(cfg === null || cfg === void 0 ? void 0 : cfg.activeDoms)) {
            return;
        }
        for (const dom of cfg.activeDoms) {
            const activeField = (_a = dom.props) === null || _a === void 0 ? void 0 : _a["active"];
            if (!activeField) {
                continue;
            }
            dom.model[activeField] = isActiveRoutePath(String(((_b = dom.props) === null || _b === void 0 ? void 0 : _b["path"]) || ""), path);
        }
    }
    handleRouteModule(route, parentModule, location) {
        const module = route.module;
        applyRouteLocation(module, location);
        if (!parentModule) {
            return;
        }
        if (!this.routerMap.has(parentModule.id)) {
            this.routerMap.set(parentModule.id, {});
        }
        const cfg = this.routerMap.get(parentModule.id);
        if (!cfg.dom) {
            cfg.wait = route;
        }
        else {
            this.setActiveDom(parentModule, location.fullPath);
        }
        this.prepModuleDom(parentModule, route);
    }
    prepModuleDom(module, route) {
        var _a;
        var _b;
        const cfg = this.routerMap.get(module.id);
        if (!(cfg === null || cfg === void 0 ? void 0 : cfg.dom)) {
            return;
        }
        (_b = cfg.dom.vdom).children || (_b.children = []);
        const childModule = route.module;
        const key = `${childModule.id}_r`;
        const dom = (_a = cfg.dom.children) === null || _a === void 0 ? void 0 : _a.find(item => item.key === key);
        if (!dom) {
            const vdom = new VirtualDom("div", key, module);
            const directive = new Directive("module");
            directive.value = childModule.id;
            vdom.addDirective(directive);
            cfg.dom.vdom.add(vdom);
            module.active();
            return;
        }
        childModule.srcDom = dom;
        childModule.active();
    }
    getMatchedRoutes(location) {
        return ((location === null || location === void 0 ? void 0 : location.matched) || [])
            .map(item => item.route)
            .filter((item) => !!item);
    }
    findLastModuleRoute(routes) {
        for (let i = routes.length - 1; i >= 0; i--) {
            if (routes[i].hasTarget()) {
                return routes[i];
            }
        }
        return;
    }
    ensureRouteComponentLoaded(route) {
        return __awaiter(this, void 0, void 0, function* () {
            if (route.module || route.loadedComponent) {
                return;
            }
            if (route.loading) {
                yield route.loading;
                return;
            }
            route.loading = (() => __awaiter(this, void 0, void 0, function* () {
                if (route.loader) {
                    route.setLoadedComponent(yield this.resolveLoadedModule(yield route.loader()));
                    return;
                }
                const component = route.component;
                if (typeof component === "string" && isModulePath(component)) {
                    const loaded = yield ModuleFactory.load(component);
                    if (loaded) {
                        route.setLoadedComponent(loaded);
                    }
                }
            }))();
            try {
                yield route.loading;
            }
            finally {
                route.loading = undefined;
            }
        });
    }
    preloadMatchedRoutes(routes_1, to_1, from_1) {
        return __awaiter(this, arguments, void 0, function* (routes, to, from, forceMatched = false) {
            for (const route of routes) {
                if (forceMatched || route.hasTarget()) {
                    yield this.ensureRouteComponentLoaded(route);
                }
            }
            const candidates = [];
            for (const route of routes) {
                for (const child of route.children) {
                    candidates.push(child);
                }
            }
            for (const route of candidates) {
                if (yield this.shouldPreloadRoute(route, to, from)) {
                    yield this.ensureRouteComponentLoaded(route);
                }
            }
        });
    }
    shouldPreloadRoute(route, to, from) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!route.hasTarget() || !route.preload) {
                return false;
            }
            if (route.preload === true) {
                return true;
            }
            return yield route.preload(to, from);
        });
    }
    resolveLoadedModule(result) {
        return __awaiter(this, void 0, void 0, function* () {
            if (result && typeof result === "object" && "default" in result) {
                return result.default;
            }
            return result;
        });
    }
    stripBasePath(path) {
        if (!path) {
            return "/";
        }
        if (this.basePath && path.startsWith(this.basePath)) {
            return path.slice(this.basePath.length) || "/";
        }
        return path;
    }
    normalizeTargetPath(path) {
        return parseRouteUrl(this.stripBasePath(path)).fullPath;
    }
}
function applyRouteLocation(module, location) {
    if (!module.model["$route"] || typeof module.model["$route"] !== "object") {
        module.model["$route"] = Util.clone(location);
        return;
    }
    const routeState = module.model["$route"];
    routeState.path = location.path;
    routeState.fullPath = location.fullPath;
    routeState.hash = location.hash;
    routeState.name = location.name;
    routeState.meta = Util.clone(location.meta);
    routeState.query = Util.clone(location.query);
    routeState.params = Util.clone(location.params);
    routeState.data = Util.clone(location.data);
    routeState.matched = Util.clone(location.matched);
}
function isModulePath(value) {
    return /^(?:\.{1,2}[\\/]|\/)|[\\/]|\.m?js$|\.nd$|\.ts$/i.test(value);
}

function installPlugin(app, plugin, ...options) {
    if (app.context.installedPlugins.has(plugin)) {
        return app;
    }
    app.context.installedPlugins.add(plugin);
    if (typeof plugin === "function") {
        plugin(app, ...options);
        return app;
    }
    if (plugin && typeof plugin.install === "function") {
        plugin.install(app, ...options);
        return app;
    }
    throw new TypeError("Invalid NodomX plugin. Expected a function or an object with install().");
}
class App {
    constructor(rootComponent, selector, seed) {
        this.rootComponent = rootComponent;
        this.selector = selector;
        this.context = createAppContext(seed);
        this.context.app = this;
        this.config = this.context.config;
    }
    mount(selector = this.selector) {
        const rootEl = selector ? document.querySelector(selector) : null;
        const target = (rootEl || Renderer.getRootEl() || document.body);
        Renderer.setRootEl(target);
        ModuleFactory.setAppContext(this.context);
        Scheduler.addTask(Renderer.render, Renderer);
        Scheduler.addTask(RequestManager.clearCache, RequestManager);
        Scheduler.start();
        const module = ModuleFactory.get(this.rootComponent);
        if (module) {
            ModuleFactory.setMain(module);
            module.active();
            this.instance = module;
            this.selector = selector;
            notifyDevtools(this, "mount");
        }
        return module;
    }
    unmount() {
        if (this.instance) {
            notifyDevtools(this, "before-unmount");
            this.instance.destroy();
            if (Renderer.getRootEl()) {
                Renderer.getRootEl().innerHTML = "";
            }
            if (ModuleFactory.getMain() === this.instance) {
                ModuleFactory.setMain(undefined);
            }
            this.instance = undefined;
            notifyDevtools(this, "unmount");
        }
        return this;
    }
    use(plugin, ...options) {
        installPlugin(this, plugin, ...options);
        return this;
    }
    component(name, clazz) {
        this.context.components.set(name.toLowerCase(), clazz);
        ModuleFactory.addClass(clazz, name);
        return this;
    }
    directive(name, handler, priority) {
        this.context.directives.set(name, { handler, priority });
        DirectiveManager.addType(name, handler, priority);
        return this;
    }
    provide(key, value) {
        this.context.provides.set(key, value);
        return this;
    }
}
function createApp(rootComponent, selector, seed) {
    return new App(rootComponent, selector, seed);
}
function notifyDevtools(app, reason) {
    const globalObject = typeof globalThis !== "undefined" ? globalThis : undefined;
    const windowObject = globalObject === null || globalObject === void 0 ? void 0 : globalObject.window;
    const globalRecord = globalObject;
    const hook = ((windowObject === null || windowObject === void 0 ? void 0 : windowObject["__NODOMX_DEVTOOLS_HOOK__"]) || (globalRecord === null || globalRecord === void 0 ? void 0 : globalRecord["__NODOMX_DEVTOOLS_HOOK__"]));
    if (reason === "unmount" && hook && typeof hook.unregisterApp === "function") {
        hook.unregisterApp(app);
        return;
    }
    if (hook && typeof hook.notifyUpdate === "function") {
        hook.notifyUpdate(app, reason);
        return;
    }
    if (hook && reason === "mount" && typeof hook.registerApp === "function") {
        hook.registerApp(app);
        return;
    }
    if (hook && reason === "unmount" && typeof hook.unregisterApp === "function") {
        hook.unregisterApp(app);
    }
}

function defineAsyncComponent(loaderOrOptions) {
    const options = normalizeAsyncComponentOptions(loaderOrOptions);
    const meta = {
        attempts: 0,
        delay: options.delay,
        errorComponent: options.errorComponent,
        instances: new Set(),
        listeners: new Set(),
        loader: options.loader,
        loading: false,
        onError: options.onError,
        loadingComponent: options.loadingComponent,
        timeout: options.timeout
    };
    if (meta.loadingComponent) {
        ModuleFactory.addClass(meta.loadingComponent);
    }
    if (meta.errorComponent) {
        ModuleFactory.addClass(meta.errorComponent);
    }
    class AsyncComponentWrapper extends Module {
        template() {
            return resolveAsyncTemplate(meta, this);
        }
        onInit() {
            const self = this;
            meta.instances.add(self);
            self.__asyncShowLoading = !meta.resolved && !meta.error && meta.delay === 0;
            scheduleAsyncVisibility(meta, self, options.onError);
            void ensureAsyncResolved(meta, options.onError).catch(() => undefined);
        }
        onBeforeUnMount() {
            cleanupAsyncInstance(this, meta);
        }
        onUnMount() {
            cleanupAsyncInstance(this, meta);
        }
    }
    const ctor = AsyncComponentWrapper;
    ctor.__asyncComponentMeta__ = meta;
    return ctor;
}
function resolveAsyncComponentClass(component) {
    const meta = getAsyncComponentMeta(component);
    return meta === null || meta === void 0 ? void 0 : meta.resolved;
}
function getAsyncComponentStatus(component) {
    const meta = getAsyncComponentMeta(component);
    return meta ? snapshotAsyncStatus(meta) : undefined;
}
function subscribeAsyncComponent(component, listener) {
    const meta = getAsyncComponentMeta(component);
    if (!meta || typeof listener !== "function") {
        return () => { };
    }
    meta.listeners.add(listener);
    return () => {
        meta.listeners.delete(listener);
    };
}
function retryAsyncComponent(component) {
    const meta = getAsyncComponentMeta(component);
    if (!meta) {
        return Promise.resolve(undefined);
    }
    meta.error = undefined;
    meta.loading = false;
    meta.pending = undefined;
    meta.resolved = undefined;
    notifyAsyncInstances(meta);
    return ensureAsyncResolved(meta, meta.onError).catch(() => undefined);
}
function ensureAsyncResolved(meta, onError) {
    if (meta.resolved) {
        return Promise.resolve(meta.resolved);
    }
    if (meta.pending) {
        return meta.pending;
    }
    meta.loading = true;
    meta.attempts += 1;
    meta.error = undefined;
    meta.resolved = undefined;
    meta.pending = Promise.resolve()
        .then(() => meta.loader())
        .then(result => {
        const resolved = normalizeAsyncResult(result);
        if (!resolved) {
            throw new Error("Async component loader resolved without a component.");
        }
        meta.loading = false;
        meta.error = undefined;
        meta.resolved = resolved;
        meta.pending = undefined;
        ModuleFactory.addClass(resolved);
        notifyAsyncInstances(meta);
        return resolved;
    })
        .catch(error => {
        meta.loading = false;
        meta.pending = undefined;
        meta.error = error;
        try {
            onError === null || onError === void 0 ? void 0 : onError(error);
        }
        catch (_a) {
            // ignore user callback errors and keep async failure visible
        }
        notifyAsyncInstances(meta);
        throw error;
    });
    notifyAsyncInstances(meta);
    return meta.pending;
}
function scheduleAsyncVisibility(meta, instance, onError) {
    clearAsyncTimers(instance);
    if (!meta.resolved && !meta.error && meta.delay > 0) {
        instance.__asyncDelayTimer = setTimeout(() => {
            instance.__asyncShowLoading = true;
            requestAsyncRender(instance);
        }, meta.delay);
    }
    if (!meta.resolved && !meta.error && typeof meta.timeout === "number" && meta.timeout > 0) {
        instance.__asyncTimeoutTimer = setTimeout(() => {
            if (meta.resolved || meta.error) {
                return;
            }
            const timeoutError = new Error(`Async component timed out after ${meta.timeout}ms.`);
            meta.loading = false;
            meta.pending = undefined;
            meta.error = timeoutError;
            try {
                onError === null || onError === void 0 ? void 0 : onError(timeoutError);
            }
            catch (_a) {
                // ignore user callback errors and keep async failure visible
            }
            notifyAsyncInstances(meta);
        }, meta.timeout);
    }
}
function resolveAsyncTemplate(meta, instance) {
    if (meta.resolved) {
        return `<${meta.resolved.name}></${meta.resolved.name}>`;
    }
    if (meta.error) {
        if (meta.errorComponent) {
            return `<${meta.errorComponent.name}></${meta.errorComponent.name}>`;
        }
        return `<div class="nd-async-error" role="alert">${escapeHtml(meta.error instanceof Error ? meta.error.message : "Async component failed to load.")}</div>`;
    }
    if (instance.__asyncShowLoading) {
        if (meta.loadingComponent) {
            return `<${meta.loadingComponent.name}></${meta.loadingComponent.name}>`;
        }
        return `<div class="nd-async-loading" role="status">Loading...</div>`;
    }
    return `<div class="nd-async-placeholder" style="display:none" aria-hidden="true"></div>`;
}
function notifyAsyncInstances(meta) {
    for (const instance of meta.instances) {
        instance.__asyncShowLoading = !meta.resolved && !meta.error && meta.delay === 0;
        clearAsyncTimers(instance);
        if (!meta.resolved && !meta.error) {
            scheduleAsyncVisibility(meta, instance, meta.onError);
        }
        requestAsyncRender(instance);
    }
    const status = snapshotAsyncStatus(meta);
    for (const listener of meta.listeners) {
        listener(status);
    }
}
function requestAsyncRender(instance) {
    var _a;
    (_a = instance.markDirty) === null || _a === void 0 ? void 0 : _a.call(instance);
    Renderer.add(instance);
}
function cleanupAsyncInstance(instance, meta) {
    clearAsyncTimers(instance);
    meta.instances.delete(instance);
}
function clearAsyncTimers(instance) {
    if (instance.__asyncDelayTimer) {
        clearTimeout(instance.__asyncDelayTimer);
        delete instance.__asyncDelayTimer;
    }
    if (instance.__asyncTimeoutTimer) {
        clearTimeout(instance.__asyncTimeoutTimer);
        delete instance.__asyncTimeoutTimer;
    }
}
function normalizeAsyncComponentOptions(loaderOrOptions) {
    var _a;
    if (typeof loaderOrOptions === "function") {
        return {
            delay: 0,
            loader: loaderOrOptions
        };
    }
    return Object.assign({ delay: (_a = loaderOrOptions.delay) !== null && _a !== void 0 ? _a : 0 }, loaderOrOptions);
}
function normalizeAsyncResult(result) {
    const value = (result && typeof result === "object" && "default" in result
        ? result.default
        : result);
    if (!value) {
        return undefined;
    }
    if (typeof value === "string") {
        return ModuleFactory.getClass(value);
    }
    return value;
}
function getAsyncComponentMeta(component) {
    if (!component || typeof component !== "function") {
        return undefined;
    }
    return component.__asyncComponentMeta__;
}
function snapshotAsyncStatus(meta) {
    return {
        attempts: meta.attempts,
        delay: meta.delay,
        error: meta.error,
        loading: meta.loading,
        resolved: !!meta.resolved,
        timeout: meta.timeout
    };
}
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

class Teleport extends Module {
    template() {
        return `
            <div class="nd-teleport-host" style="display:contents">
                <slot />
            </div>
        `;
    }
    onUpdate() {
        this.syncTeleportTarget();
    }
    mount() {
        if (this.state === EModuleState.MOUNTED || !this.domManager.renderedTree) {
            return;
        }
        this.doModuleEvent("onBeforeMount");
        const root = new DocumentFragment();
        const el = Renderer.renderToHtml(this, this.domManager.renderedTree, root);
        this.moveTeleportNode(el);
        this.doModuleEvent("onMount");
        this.state = EModuleState.MOUNTED;
    }
    unmount(passive) {
        var _a;
        if (this.state !== EModuleState.MOUNTED || ModuleFactory.getMain() === this) {
            return;
        }
        Renderer.remove(this);
        this.doModuleEvent("onBeforeUnMount");
        this.eventFactory.clear();
        const renderedTree = this.domManager.renderedTree;
        this.domManager.renderedTree = null;
        if (passive) {
            this.state = EModuleState.INIT;
        }
        else {
            this.state = EModuleState.UNMOUNTED;
        }
        for (const child of this.children) {
            child.unmount(true);
        }
        if ((_a = renderedTree === null || renderedTree === void 0 ? void 0 : renderedTree.node) === null || _a === void 0 ? void 0 : _a.parentElement) {
            renderedTree.node.parentElement.removeChild(renderedTree.node);
        }
        this.lastTeleportTarget = undefined;
        this.doModuleEvent("onUnMount");
    }
    syncTeleportTarget() {
        var _a;
        const node = (_a = this.domManager.renderedTree) === null || _a === void 0 ? void 0 : _a.node;
        if (!node) {
            return;
        }
        this.moveTeleportNode(node);
    }
    moveTeleportNode(node) {
        var _a;
        const target = this.resolveTeleportTarget();
        if (target) {
            if (node.parentElement !== target) {
                target.appendChild(node);
            }
            this.lastTeleportTarget = target;
            return;
        }
        const sourceAnchor = (_a = this.srcDom) === null || _a === void 0 ? void 0 : _a.node;
        const sourceParent = sourceAnchor === null || sourceAnchor === void 0 ? void 0 : sourceAnchor.parentElement;
        if (sourceAnchor && sourceParent) {
            Util.insertAfter(node, sourceAnchor);
            this.lastTeleportTarget = sourceParent;
        }
    }
    resolveTeleportTarget() {
        var _a, _b, _c, _d;
        if (isTruthyTeleportFlag((_a = this.props) === null || _a === void 0 ? void 0 : _a.disabled)) {
            return null;
        }
        const target = (_c = (_b = this.props) === null || _b === void 0 ? void 0 : _b.to) !== null && _c !== void 0 ? _c : (_d = this.props) === null || _d === void 0 ? void 0 : _d.target;
        if (typeof target === "string" && target.trim()) {
            return document.querySelector(target);
        }
        if (target instanceof Element) {
            return target;
        }
        return null;
    }
}
ModuleFactory.addClass(Teleport, "Teleport");
class Suspense extends Module {
    constructor() {
        super(...arguments);
        this.suspenseBranchCleanupTimers = new Map();
        this.suspensePaused = false;
        this.suspensePending = false;
        this.suspensePendingCount = 0;
        this.suspensePhase = "idle";
        this.suspenseRetryKey = "";
        this.suspenseShowError = false;
        this.suspenseShowFallback = false;
        this.suspenseSubscriptions = new Map();
        this.suspenseTimeout = 0;
        this.suspenseTrackedComponents = new Set();
    }
    data() {
        return {
            defaultStyle: "display:contents",
            branchTransitionDuration: undefined,
            branchTransitionEnabled: false,
            branchTransitionEnterActiveClass: undefined,
            branchTransitionEnterDuration: undefined,
            branchTransitionEnterFromClass: undefined,
            branchTransitionEnterToClass: undefined,
            branchTransitionLeaveActiveClass: undefined,
            branchTransitionLeaveDuration: undefined,
            branchTransitionLeaveFromClass: undefined,
            branchTransitionLeaveToClass: undefined,
            branchTransitionName: "nd-suspense",
            errorMessage: "",
            errorStyle: "display:none",
            errorText: "Async content failed to load.",
            fallbackStyle: "display:none",
            fallbackText: "Loading...",
            pendingCount: 0,
            phase: "idle",
            retryKey: "",
            showError: false,
            showErrorPlain: false,
            showErrorText: false,
            showErrorTransition: false,
            showFallback: false,
            showFallbackPlain: false,
            showFallbackText: false,
            showFallbackTransition: false,
            suspenseOwner: ""
        };
    }
    template() {
        return `
            <div class="nd-suspense-host" style="display:contents">
                <div
                    class="nd-suspense-default"
                    data-nd-suspense-branch="default"
                    data-nd-suspense-owner={{suspenseOwner}}
                    style={{defaultStyle}}
                >
                    <slot />
                </div>
                <if cond={{showErrorTransition}}>
                    <Transition
                        name={{branchTransitionName}}
                        duration={{branchTransitionDuration}}
                        enter-duration={{branchTransitionEnterDuration}}
                        leave-duration={{branchTransitionLeaveDuration}}
                        enter-from-class={{branchTransitionEnterFromClass}}
                        enter-active-class={{branchTransitionEnterActiveClass}}
                        enter-to-class={{branchTransitionEnterToClass}}
                        leave-from-class={{branchTransitionLeaveFromClass}}
                        leave-active-class={{branchTransitionLeaveActiveClass}}
                        leave-to-class={{branchTransitionLeaveToClass}}
                    >
                        <div
                            x-if={{showError}}
                            class="nd-suspense-error"
                            data-nd-suspense-branch="error"
                            data-nd-suspense-owner={{suspenseOwner}}
                            style={{errorStyle}}
                        >
                            <slot name="error" innerrender />
                            <div x-if={{showErrorText}} class="nd-suspense-error-text">{{errorText}}</div>
                        </div>
                    </Transition>
                </if>
                <endif />
                <if cond={{showErrorPlain}}>
                    <div
                        x-if={{showError}}
                        class="nd-suspense-error"
                        data-nd-suspense-branch="error"
                        data-nd-suspense-owner={{suspenseOwner}}
                        style={{errorStyle}}
                    >
                        <slot name="error" innerrender />
                        <div x-if={{showErrorText}} class="nd-suspense-error-text">{{errorText}}</div>
                    </div>
                </if>
                <endif />
                <if cond={{showFallbackTransition}}>
                    <Transition
                        name={{branchTransitionName}}
                        duration={{branchTransitionDuration}}
                        enter-duration={{branchTransitionEnterDuration}}
                        leave-duration={{branchTransitionLeaveDuration}}
                        enter-from-class={{branchTransitionEnterFromClass}}
                        enter-active-class={{branchTransitionEnterActiveClass}}
                        enter-to-class={{branchTransitionEnterToClass}}
                        leave-from-class={{branchTransitionLeaveFromClass}}
                        leave-active-class={{branchTransitionLeaveActiveClass}}
                        leave-to-class={{branchTransitionLeaveToClass}}
                    >
                        <div
                            x-if={{showFallback}}
                            class="nd-suspense-fallback"
                            data-nd-suspense-branch="fallback"
                            data-nd-suspense-owner={{suspenseOwner}}
                            style={{fallbackStyle}}
                        >
                            <slot name="fallback" innerrender />
                            <div x-if={{showFallbackText}} class="nd-suspense-fallback-text">{{fallbackText}}</div>
                        </div>
                    </Transition>
                </if>
                <endif />
                <if cond={{showFallbackPlain}}>
                    <div
                        x-if={{showFallback}}
                        class="nd-suspense-fallback"
                        data-nd-suspense-branch="fallback"
                        data-nd-suspense-owner={{suspenseOwner}}
                        style={{fallbackStyle}}
                    >
                        <slot name="fallback" innerrender />
                        <div x-if={{showFallbackText}} class="nd-suspense-fallback-text">{{fallbackText}}</div>
                    </div>
                </if>
                <endif />
            </div>
        `;
    }
    onInit() {
        this.model["suspenseOwner"] = String(this.id);
        this.syncSuspenseViewState();
    }
    onBeforeRender() {
        this.syncSuspenseViewState();
    }
    onRender() {
        this.refreshSuspenseState();
    }
    onActivated() {
        this.suspensePaused = false;
        this.refreshSuspenseState();
    }
    onDeactivated() {
        this.suspensePaused = true;
        this.clearSuspenseFallbackTimer();
        this.clearSuspenseBranchCleanup("error");
        this.clearSuspenseBranchCleanup("fallback");
    }
    onBeforeUnMount() {
        this.clearSuspenseResources();
    }
    onUnMount() {
        this.clearSuspenseResources();
    }
    hasRetryableSuspenseError(cascade = true) {
        const trackedAsyncComponents = collectTrackedAsyncComponents(this);
        if (trackedAsyncComponents.some(item => item.status.error !== undefined)) {
            return true;
        }
        if (!cascade) {
            return false;
        }
        return collectNestedSuspenseBoundaries(this).some(child => child.hasRetryableSuspenseError(true));
    }
    retryBoundary(retryKey, cascade = true) {
        const trackedAsyncComponents = collectTrackedAsyncComponents(this);
        const retriedComponents = trackedAsyncComponents.filter(item => item.status.error !== undefined);
        let nestedRetryCount = 0;
        if (cascade) {
            for (const child of collectNestedSuspenseBoundaries(this)) {
                if (child.retryBoundary(retryKey, true)) {
                    nestedRetryCount += 1;
                }
            }
        }
        if (retriedComponents.length === 0 && nestedRetryCount === 0) {
            return false;
        }
        this.suspenseRetryKey = retryKey || this.suspenseRetryKey;
        this.suspensePending = false;
        this.suspenseShowError = false;
        this.suspenseShowFallback = false;
        this.suspenseError = undefined;
        this.clearSuspenseFallbackTimer();
        this.syncSuspenseViewState();
        this.queueSuspenseRender();
        this.emitSuspenseHook("onSuspenseRetry", {
            boundaryId: this.id,
            nestedRetryCount,
            pendingCount: retriedComponents.length,
            phase: "pending",
            retryKey: this.suspenseRetryKey || undefined,
            sourceBoundaryId: this.id,
            timeout: this.suspenseTimeout
        });
        for (const item of retriedComponents) {
            void retryAsyncComponent(item.component);
        }
        return true;
    }
    refreshSuspenseState() {
        var _a, _b, _c, _d, _e;
        let trackedAsyncComponents = collectTrackedAsyncComponents(this);
        if (trackedAsyncComponents.length > 0) {
            this.suspenseTrackedComponents = new Set(trackedAsyncComponents.map(item => item.component));
        }
        else if (this.suspenseTrackedComponents.size > 0) {
            trackedAsyncComponents = Array.from(this.suspenseTrackedComponents)
                .map(component => {
                const status = getAsyncComponentStatus(component);
                return status
                    ? {
                        component,
                        status
                    }
                    : null;
            })
                .filter(Boolean);
        }
        this.syncSuspenseSubscriptions(trackedAsyncComponents.map(item => item.component));
        let changed = false;
        const timeout = resolveSuspenseTimeout((_a = this.props) === null || _a === void 0 ? void 0 : _a.timeout);
        const retryKey = resolveSuspenseRetryKey((_c = (_b = this.props) === null || _b === void 0 ? void 0 : _b["retry-key"]) !== null && _c !== void 0 ? _c : (_d = this.props) === null || _d === void 0 ? void 0 : _d.retryKey);
        if (shouldRetrySuspense(this, trackedAsyncComponents, this.suspenseRetryKey, retryKey)) {
            this.retryBoundary(retryKey, true);
            return;
        }
        this.suspenseRetryKey = retryKey;
        const pendingCount = trackedAsyncComponents.filter(item => item.status.loading && !item.status.resolved && !item.status.error).length;
        const pending = pendingCount > 0;
        this.suspensePendingCount = pendingCount;
        const errorStatus = (_e = trackedAsyncComponents.find(item => !!item.status.error)) === null || _e === void 0 ? void 0 : _e.status;
        const hadTrackedAsync = trackedAsyncComponents.length > 0;
        const wasAsyncActive = this.suspensePhase === "pending" || this.suspensePhase === "fallback" || this.suspensePhase === "error";
        if ((errorStatus === null || errorStatus === void 0 ? void 0 : errorStatus.error) !== undefined) {
            changed = changed
                || this.suspensePending
                || this.suspenseShowFallback
                || !this.suspenseShowError
                || !Object.is(this.suspenseError, errorStatus.error);
            this.suspensePending = false;
            this.suspenseShowFallback = false;
            this.suspenseShowError = true;
            this.suspenseTimeout = timeout;
            this.clearSuspenseFallbackTimer();
            this.setSuspensePhase("error", {
                boundaryId: this.id,
                error: errorStatus.error,
                pendingCount,
                phase: "error",
                sourceBoundaryId: this.id,
                timeout
            });
            this.suspenseError = errorStatus.error;
            const viewChanged = this.syncSuspenseViewState();
            if (changed || viewChanged) {
                this.queueSuspenseRender();
            }
            return;
        }
        if (!pending) {
            changed = this.suspensePending || this.suspenseShowFallback || this.suspenseShowError || this.suspenseError !== undefined;
            this.suspensePending = false;
            this.suspenseShowFallback = false;
            this.suspenseShowError = false;
            this.suspenseError = undefined;
            this.suspensePendingCount = 0;
            this.suspenseTimeout = 0;
            this.clearSuspenseFallbackTimer();
            if (hadTrackedAsync && wasAsyncActive) {
                this.setSuspensePhase("resolved", {
                    boundaryId: this.id,
                    pendingCount: 0,
                    phase: "resolved",
                    sourceBoundaryId: this.id,
                    timeout: 0
                });
            }
            else if (!hadTrackedAsync) {
                this.suspensePhase = "idle";
            }
        }
        else {
            if (this.suspensePhase !== "pending" && this.suspensePhase !== "fallback") {
                this.setSuspensePhase("pending", {
                    boundaryId: this.id,
                    pendingCount,
                    phase: "pending",
                    retryKey: this.suspenseRetryKey || retryKey || undefined,
                    sourceBoundaryId: this.id,
                    timeout
                });
            }
            changed = !this.suspensePending || this.suspenseShowError || this.suspenseError !== undefined;
            this.suspensePending = true;
            this.suspenseShowError = false;
            this.suspenseError = undefined;
            if (timeout <= 0) {
                changed = changed || !this.suspenseShowFallback;
                this.suspenseShowFallback = true;
                this.suspenseTimeout = timeout;
                this.clearSuspenseFallbackTimer();
                this.setSuspensePhase("fallback", {
                    boundaryId: this.id,
                    pendingCount,
                    phase: "fallback",
                    retryKey: this.suspenseRetryKey || retryKey || undefined,
                    sourceBoundaryId: this.id,
                    timeout
                });
            }
            else if (this.suspenseShowFallback) {
                this.suspenseTimeout = timeout;
                this.clearSuspenseFallbackTimer();
                this.setSuspensePhase("fallback", {
                    boundaryId: this.id,
                    pendingCount,
                    retryKey: this.suspenseRetryKey || retryKey || undefined,
                    timeout
                });
            }
            else if (!this.suspenseFallbackTimer || this.suspenseTimeout !== timeout) {
                this.suspenseTimeout = timeout;
                this.clearSuspenseFallbackTimer();
                this.suspenseFallbackTimer = setTimeout(() => {
                    this.suspenseFallbackTimer = undefined;
                    if (!this.suspensePending || this.suspenseShowFallback || this.suspenseShowError) {
                        return;
                    }
                    this.suspenseShowFallback = true;
                    this.setSuspensePhase("fallback", {
                        boundaryId: this.id,
                        pendingCount: collectTrackedAsyncComponents(this).filter(item => item.status.loading && !item.status.resolved && !item.status.error).length,
                        retryKey: this.suspenseRetryKey || retryKey || undefined,
                        timeout: this.suspenseTimeout
                    });
                    this.syncSuspenseViewState();
                    this.queueSuspenseRender();
                }, timeout);
            }
        }
        const viewChanged = this.syncSuspenseViewState();
        if (changed || viewChanged) {
            this.queueSuspenseRender();
        }
    }
    syncSuspenseViewState() {
        var _a, _b;
        const hasFallbackSlot = this.slots.has("fallback");
        const hasErrorSlot = this.slots.has("error");
        const branchTransition = resolveSuspenseBranchTransition(this.props);
        const errorMessage = normalizeSuspenseErrorMessage(this.suspenseError);
        const errorText = normalizeSuspenseErrorText((_a = this.props) === null || _a === void 0 ? void 0 : _a.error, this.suspenseError);
        const fallbackText = normalizeSuspenseFallbackText((_b = this.props) === null || _b === void 0 ? void 0 : _b.fallback);
        const nextDefaultStyle = this.suspenseShowFallback || this.suspenseShowError ? "display:none" : "display:contents";
        const nextErrorStyle = this.suspenseShowError ? "display:contents" : "display:none";
        const nextFallbackStyle = this.suspenseShowFallback ? "display:contents" : "display:none";
        const nextShowErrorText = this.suspenseShowError && !hasErrorSlot;
        const nextShowFallbackText = this.suspenseShowFallback && !hasFallbackSlot;
        const showErrorTransition = this.suspenseShowError && !!branchTransition;
        const showFallbackTransition = this.suspenseShowFallback && !!branchTransition;
        this.syncSuspenseBranchCleanup("error", this.suspenseShowError, branchTransition);
        this.syncSuspenseBranchCleanup("fallback", this.suspenseShowFallback, branchTransition);
        let changed = false;
        changed = setSuspenseModelValue(this, "branchTransitionDuration", branchTransition === null || branchTransition === void 0 ? void 0 : branchTransition.duration) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionEnabled", !!branchTransition) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionEnterActiveClass", branchTransition === null || branchTransition === void 0 ? void 0 : branchTransition.enterActiveClass) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionEnterDuration", branchTransition === null || branchTransition === void 0 ? void 0 : branchTransition.enterDuration) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionEnterFromClass", branchTransition === null || branchTransition === void 0 ? void 0 : branchTransition.enterFromClass) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionEnterToClass", branchTransition === null || branchTransition === void 0 ? void 0 : branchTransition.enterToClass) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionLeaveActiveClass", branchTransition === null || branchTransition === void 0 ? void 0 : branchTransition.leaveActiveClass) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionLeaveDuration", branchTransition === null || branchTransition === void 0 ? void 0 : branchTransition.leaveDuration) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionLeaveFromClass", branchTransition === null || branchTransition === void 0 ? void 0 : branchTransition.leaveFromClass) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionLeaveToClass", branchTransition === null || branchTransition === void 0 ? void 0 : branchTransition.leaveToClass) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionName", (branchTransition === null || branchTransition === void 0 ? void 0 : branchTransition.name) || "nd-suspense") || changed;
        changed = setSuspenseModelValue(this, "defaultStyle", nextDefaultStyle) || changed;
        changed = setSuspenseModelValue(this, "errorMessage", errorMessage) || changed;
        changed = setSuspenseModelValue(this, "errorStyle", nextErrorStyle) || changed;
        changed = setSuspenseModelValue(this, "errorText", errorText) || changed;
        changed = setSuspenseModelValue(this, "fallbackStyle", nextFallbackStyle) || changed;
        changed = setSuspenseModelValue(this, "fallbackText", fallbackText) || changed;
        changed = setSuspenseModelValue(this, "pendingCount", this.suspensePendingCount) || changed;
        changed = setSuspenseModelValue(this, "phase", this.suspensePhase) || changed;
        changed = setSuspenseModelValue(this, "retryKey", this.suspenseRetryKey) || changed;
        changed = setSuspenseModelValue(this, "showError", this.suspenseShowError) || changed;
        changed = setSuspenseModelValue(this, "showErrorPlain", this.suspenseShowError && !branchTransition) || changed;
        changed = setSuspenseModelValue(this, "showErrorText", nextShowErrorText) || changed;
        changed = setSuspenseModelValue(this, "showErrorTransition", showErrorTransition) || changed;
        changed = setSuspenseModelValue(this, "showFallback", this.suspenseShowFallback) || changed;
        changed = setSuspenseModelValue(this, "showFallbackPlain", this.suspenseShowFallback && !branchTransition) || changed;
        changed = setSuspenseModelValue(this, "showFallbackText", nextShowFallbackText) || changed;
        changed = setSuspenseModelValue(this, "showFallbackTransition", showFallbackTransition) || changed;
        changed = setSuspenseModelValue(this, "suspenseOwner", String(this.id)) || changed;
        return changed;
    }
    syncSuspenseSubscriptions(components) {
        const componentSet = new Set(components.filter(Boolean));
        for (const [component, unsubscribe] of this.suspenseSubscriptions.entries()) {
            if (componentSet.has(component)) {
                continue;
            }
            unsubscribe();
            this.suspenseSubscriptions.delete(component);
        }
        for (const component of componentSet) {
            if (this.suspenseSubscriptions.has(component)) {
                continue;
            }
            const unsubscribe = subscribeAsyncComponent(component, () => {
                this.refreshSuspenseState();
            });
            this.suspenseSubscriptions.set(component, unsubscribe);
        }
    }
    clearSuspenseResources() {
        this.clearSuspenseFallbackTimer();
        this.clearSuspenseBranchCleanup("error");
        this.clearSuspenseBranchCleanup("fallback");
        for (const unsubscribe of this.suspenseSubscriptions.values()) {
            unsubscribe();
        }
        this.suspenseSubscriptions.clear();
        this.suspenseTrackedComponents.clear();
    }
    clearSuspenseFallbackTimer() {
        if (this.suspenseFallbackTimer) {
            clearTimeout(this.suspenseFallbackTimer);
            this.suspenseFallbackTimer = undefined;
        }
    }
    queueSuspenseRender() {
        this.markDirty();
        if (!this.suspensePaused) {
            Renderer.add(this);
        }
    }
    syncSuspenseBranchCleanup(branch, visible, transition) {
        if (visible || !transition) {
            this.clearSuspenseBranchCleanup(branch);
            return;
        }
        if (this.suspenseBranchCleanupTimers.has(branch)) {
            return;
        }
        const delay = resolveSuspenseBranchTransitionDelay(transition);
        const timer = setTimeout(() => {
            this.suspenseBranchCleanupTimers.delete(branch);
            const stillVisible = branch === "error" ? this.suspenseShowError : this.suspenseShowFallback;
            if (stillVisible) {
                return;
            }
            this.cleanupSuspenseBranchDom(branch);
        }, delay);
        this.suspenseBranchCleanupTimers.set(branch, timer);
    }
    clearSuspenseBranchCleanup(branch) {
        const timer = this.suspenseBranchCleanupTimers.get(branch);
        if (timer) {
            clearTimeout(timer);
            this.suspenseBranchCleanupTimers.delete(branch);
        }
    }
    cleanupSuspenseBranchDom(branch) {
        const owner = String(this.id);
        const selector = `.nd-suspense-${branch}[data-nd-suspense-owner="${owner}"]`;
        for (const node of Array.from(document.querySelectorAll(selector))) {
            if (node.parentElement) {
                node.parentElement.removeChild(node);
            }
        }
    }
    setSuspensePhase(nextPhase, detail) {
        const sameError = nextPhase !== "error" || Object.is(this.suspenseError, detail.error);
        if (this.suspensePhase === nextPhase && sameError) {
            return;
        }
        this.suspensePhase = nextPhase;
        switch (nextPhase) {
            case "pending":
                this.emitSuspenseHook("onSuspensePending", detail);
                break;
            case "fallback":
                this.emitSuspenseHook("onSuspenseFallback", detail);
                break;
            case "resolved":
                this.emitSuspenseHook("onSuspenseResolve", detail);
                break;
            case "error":
                this.emitSuspenseHook("onSuspenseError", detail);
                break;
        }
    }
    emitSuspenseHook(name, detail) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const ownDetail = Object.assign(Object.assign({}, detail), { boundaryId: (_a = detail.boundaryId) !== null && _a !== void 0 ? _a : this.id, nested: false, phase: (_b = detail.phase) !== null && _b !== void 0 ? _b : this.suspensePhase, sourceBoundaryId: (_d = (_c = detail.sourceBoundaryId) !== null && _c !== void 0 ? _c : detail.boundaryId) !== null && _d !== void 0 ? _d : this.id });
        this.emitHook(name, ownDetail);
        let parent = this.getParent();
        while (parent && parent !== this) {
            parent.emitHook(name, Object.assign(Object.assign({}, detail), { boundaryId: (_e = detail.boundaryId) !== null && _e !== void 0 ? _e : this.id, nested: true, phase: (_f = detail.phase) !== null && _f !== void 0 ? _f : this.suspensePhase, sourceBoundaryId: (_h = (_g = detail.sourceBoundaryId) !== null && _g !== void 0 ? _g : detail.boundaryId) !== null && _h !== void 0 ? _h : this.id }));
            parent = (_j = parent.getParent) === null || _j === void 0 ? void 0 : _j.call(parent);
        }
    }
}
ModuleFactory.addClass(Suspense, "Suspense");
function isTruthyTeleportFlag(value) {
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        return normalized === "" || normalized === "true" || normalized === "1";
    }
    return value === true;
}
function collectTrackedAsyncComponents(rootModule) {
    var _a;
    const tracked = new Map();
    const walk = (dom, branch = "default") => {
        var _a;
        if (!dom) {
            return;
        }
        const nextBranch = resolveSuspenseBranch(dom, branch);
        if (dom.childModuleId) {
            const childModule = ModuleFactory.get(dom.childModuleId);
            if (!childModule || nextBranch !== "default") {
                return;
            }
            if (childModule.constructor === Suspense) {
                return;
            }
            const status = getAsyncComponentStatus(childModule.constructor);
            if (status) {
                tracked.set(childModule.constructor, status);
                return;
            }
            walk((_a = childModule.domManager) === null || _a === void 0 ? void 0 : _a.renderedTree, nextBranch);
            return;
        }
        for (const child of dom.children || []) {
            walk(child, nextBranch);
        }
    };
    walk((_a = rootModule.domManager) === null || _a === void 0 ? void 0 : _a.renderedTree);
    return Array.from(tracked.entries()).map(([component, status]) => ({
        component,
        status
    }));
}
function collectNestedSuspenseBoundaries(rootModule) {
    var _a;
    const boundaries = new Set();
    const walk = (dom, branch = "default") => {
        var _a;
        if (!dom) {
            return;
        }
        const nextBranch = resolveSuspenseBranch(dom, branch);
        if (dom.childModuleId) {
            const childModule = ModuleFactory.get(dom.childModuleId);
            if (!childModule || nextBranch !== "default") {
                return;
            }
            if (childModule.constructor === Suspense) {
                boundaries.add(childModule);
                return;
            }
            walk((_a = childModule.domManager) === null || _a === void 0 ? void 0 : _a.renderedTree, nextBranch);
            return;
        }
        for (const child of dom.children || []) {
            walk(child, nextBranch);
        }
    };
    walk((_a = rootModule.domManager) === null || _a === void 0 ? void 0 : _a.renderedTree);
    return Array.from(boundaries);
}
function resolveSuspenseBranch(dom, currentBranch) {
    var _a;
    const branch = (_a = dom.props) === null || _a === void 0 ? void 0 : _a["data-nd-suspense-branch"];
    if (branch === "default" || branch === "error" || branch === "fallback") {
        return branch;
    }
    return currentBranch;
}
function resolveSuspenseTimeout(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.max(0, value);
    }
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed)) {
            return Math.max(0, parsed);
        }
    }
    return 0;
}
function resolveSuspenseBranchTransition(props) {
    const enabledFlag = readSuspenseBranchTransitionProp(props, "transition", "branch-transition", "branchTransition");
    const name = readSuspenseBranchTransitionProp(props, "transition-name", "transitionName");
    const duration = readSuspenseBranchTransitionProp(props, "transition-duration", "transitionDuration");
    const enterDuration = readSuspenseBranchTransitionProp(props, "transition-enter-duration", "transitionEnterDuration");
    const leaveDuration = readSuspenseBranchTransitionProp(props, "transition-leave-duration", "transitionLeaveDuration");
    const enterFromClass = readSuspenseBranchTransitionProp(props, "transition-enter-from-class", "transitionEnterFromClass");
    const enterActiveClass = readSuspenseBranchTransitionProp(props, "transition-enter-active-class", "transitionEnterActiveClass");
    const enterToClass = readSuspenseBranchTransitionProp(props, "transition-enter-to-class", "transitionEnterToClass");
    const leaveFromClass = readSuspenseBranchTransitionProp(props, "transition-leave-from-class", "transitionLeaveFromClass");
    const leaveActiveClass = readSuspenseBranchTransitionProp(props, "transition-leave-active-class", "transitionLeaveActiveClass");
    const leaveToClass = readSuspenseBranchTransitionProp(props, "transition-leave-to-class", "transitionLeaveToClass");
    const enabled = resolveSuspenseBranchTransitionEnabled(enabledFlag)
        || name !== undefined
        || duration !== undefined
        || enterDuration !== undefined
        || leaveDuration !== undefined
        || enterFromClass !== undefined
        || enterActiveClass !== undefined
        || enterToClass !== undefined
        || leaveFromClass !== undefined
        || leaveActiveClass !== undefined
        || leaveToClass !== undefined;
    if (!enabled) {
        return null;
    }
    return {
        duration: normalizeSuspenseTransitionDuration(duration),
        enterActiveClass: normalizeSuspenseTransitionClass(enterActiveClass),
        enterDuration: normalizeSuspenseTransitionDuration(enterDuration),
        enterFromClass: normalizeSuspenseTransitionClass(enterFromClass),
        enterToClass: normalizeSuspenseTransitionClass(enterToClass),
        leaveActiveClass: normalizeSuspenseTransitionClass(leaveActiveClass),
        leaveDuration: normalizeSuspenseTransitionDuration(leaveDuration),
        leaveFromClass: normalizeSuspenseTransitionClass(leaveFromClass),
        leaveToClass: normalizeSuspenseTransitionClass(leaveToClass),
        name: normalizeSuspenseTransitionName(name)
    };
}
function readSuspenseBranchTransitionProp(props, ...names) {
    if (!props) {
        return undefined;
    }
    for (const name of names) {
        if (name in props) {
            return props[name];
        }
    }
    return undefined;
}
function resolveSuspenseBranchTransitionEnabled(value) {
    if (value === undefined || value === null) {
        return false;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        return normalized === "" || normalized === "true" || normalized === "1";
    }
    return value === true;
}
function normalizeSuspenseTransitionName(value) {
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    return "nd-suspense";
}
function normalizeSuspenseTransitionClass(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const normalized = value.trim();
    return normalized || undefined;
}
function normalizeSuspenseTransitionDuration(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.max(0, value);
    }
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    return undefined;
}
function resolveSuspenseBranchTransitionDelay(transition) {
    var _a;
    if (!transition) {
        return 0;
    }
    const duration = (_a = transition.leaveDuration) !== null && _a !== void 0 ? _a : transition.duration;
    if (typeof duration === "number" && Number.isFinite(duration)) {
        return Math.max(0, duration) + 20;
    }
    if (typeof duration === "string" && duration.trim()) {
        const parsed = Number(duration.trim());
        if (Number.isFinite(parsed)) {
            return Math.max(0, parsed) + 20;
        }
    }
    return 270;
}
function resolveSuspenseRetryKey(value) {
    if (value === undefined || value === null) {
        return "";
    }
    if (typeof value === "string") {
        return value.trim();
    }
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
        return String(value);
    }
    try {
        return JSON.stringify(value) || "";
    }
    catch (_a) {
        return String(value);
    }
}
function shouldRetrySuspense(module, trackedAsyncComponents, previousRetryKey, nextRetryKey) {
    if (!nextRetryKey || nextRetryKey === previousRetryKey) {
        return false;
    }
    if (trackedAsyncComponents.some(item => item.status.error !== undefined)) {
        return true;
    }
    return collectNestedSuspenseBoundaries(module).some(child => child.hasRetryableSuspenseError(true));
}
function normalizeSuspenseFallbackText(value) {
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    return "Loading...";
}
function normalizeSuspenseErrorText(value, error) {
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    if (error instanceof Error && error.message.trim()) {
        return error.message.trim();
    }
    if (typeof error === "string" && error.trim()) {
        return error.trim();
    }
    return "Async content failed to load.";
}
function normalizeSuspenseErrorMessage(error) {
    if (error instanceof Error && error.message.trim()) {
        return error.message.trim();
    }
    if (typeof error === "string" && error.trim()) {
        return error.trim();
    }
    return "";
}
function setSuspenseModelValue(module, key, value) {
    if (Object.is(module.model[key], value)) {
        return false;
    }
    module.model[key] = value;
    return true;
}

class Nodom {
    static createApp(clazz, selector) {
        const app = createApp(clazz, selector);
        Object.assign(app.config.globalProperties, this.config.globalProperties);
        for (const [name, component] of this.queuedComponents.entries()) {
            app.component(name, component);
        }
        for (const directive of this.queuedDirectives) {
            app.directive(directive.name, directive.handler, directive.priority);
        }
        for (const provideItem of this.queuedProvides) {
            app.provide(provideItem.key, provideItem.value);
        }
        for (const item of this.queuedPlugins) {
            app.use(item.plugin, ...item.options);
        }
        return app;
    }
    static app(clazz, selector) {
        return this.createApp(clazz, selector).mount(selector);
    }
    static remount(clazz, selector) {
        this.clearMountedApp(selector);
        return this.createApp(clazz, selector).mount(selector);
    }
    static hotReload(clazz, selector, hotState, changedFiles) {
        if (this.reloadChangedModules(this.normalizeChangedFiles(changedFiles))) {
            return;
        }
        const hotSnapshot = isModuleHotSnapshot(hotState) ? hotState : undefined;
        if (!hotSnapshot && hotState && clazz && typeof clazz === "function") {
            clazz["__nodomHotState"] = hotState;
        }
        const module = this.remount(clazz, selector);
        Renderer.flush();
        if (hotSnapshot && module && typeof module.applyHotSnapshot === "function") {
            module.applyHotSnapshot(hotSnapshot);
            Renderer.flush();
        }
    }
    static captureHotState() {
        const main = ModuleFactory.getMain();
        if (!main || typeof main.captureHotSnapshot !== "function") {
            return {};
        }
        return main.captureHotSnapshot();
    }
    static debug() {
        this.isDebug = true;
        setRuntimeDebug(true);
    }
    static setLang(lang) {
        setRuntimeLang(lang || "zh");
    }
    static use(plugin, ...params) {
        if (isQueuedPlugin(plugin)) {
            if (!this.queuedPlugins.find(item => item.plugin === plugin)) {
                this.queuedPlugins.push({
                    options: params,
                    plugin
                });
            }
            return plugin;
        }
        if (!plugin["name"]) {
            throw new NError("notexist", NodomMessage.TipWords.plugin);
        }
        if (!this["$" + plugin["name"]]) {
            this["$" + plugin["name"]] = Reflect.construct(plugin, params || []);
        }
        return this["$" + plugin["name"]];
    }
    static component(name, clazz) {
        this.queuedComponents.set(name, clazz);
        ModuleFactory.addClass(clazz, name);
        return this;
    }
    static directive(name, handler, priority) {
        const existing = this.queuedDirectives.findIndex(item => item.name === name);
        const nextDirective = { handler, name, priority };
        if (existing === -1) {
            this.queuedDirectives.push(nextDirective);
        }
        else {
            this.queuedDirectives.splice(existing, 1, nextDirective);
        }
        DirectiveManager.addType(name, handler, priority);
        return this;
    }
    static provide(key, value) {
        const existing = this.queuedProvides.findIndex(item => item.key === key);
        const nextProvide = { key, value };
        if (existing === -1) {
            this.queuedProvides.push(nextProvide);
        }
        else {
            this.queuedProvides.splice(existing, 1, nextProvide);
        }
        return this;
    }
    static setGlobal(name, value) {
        this.config.globalProperties[name] = value;
        return this;
    }
    static createRoute(config, parent) {
        if (!Nodom["$Router"]) {
            throw new NError("uninit", NodomMessage.TipWords.route);
        }
        let route;
        parent = parent || Nodom["$Router"].getRoot();
        if (Util.isArray(config)) {
            for (const item of config) {
                route = new Route(item, parent);
            }
        }
        else {
            route = new Route(config, parent);
        }
        return route;
    }
    static createDirective(name, handler, priority) {
        return DirectiveManager.addType(name, handler, priority);
    }
    static registModule(clazz, name) {
        ModuleFactory.addClass(clazz, name);
    }
    static request(config) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield RequestManager.request(config);
        });
    }
    static setRejectTime(time) {
        RequestManager.setRejectTime(time);
    }
    static clearMountedApp(selector) {
        const main = ModuleFactory.getMain();
        if (main) {
            main.destroy();
        }
        const rootEl = (selector ? document.querySelector(selector) : null) || Renderer.getRootEl();
        if (rootEl) {
            rootEl.innerHTML = "";
        }
        ModuleFactory.setMain(undefined);
    }
    static reloadChangedModules(changedFiles) {
        if (changedFiles.length === 0) {
            return false;
        }
        const main = ModuleFactory.getMain();
        if (!main || typeof main.getHotId !== "function") {
            return false;
        }
        const hotIds = new Set(changedFiles);
        const mainHotId = normalizeHotId(main.getHotId());
        if (mainHotId && hotIds.has(mainHotId)) {
            return false;
        }
        const targets = this.collectHotReloadTargets(main, hotIds);
        if (targets.length === 0) {
            return false;
        }
        const parents = new Set();
        for (const target of targets) {
            target.parent.children = target.parent.children.filter(child => child !== target.module);
            target.parent.objectManager.removeDomParam(target.srcDomKey, "$savedModule");
            parents.add(target.parent);
        }
        for (const parent of parents) {
            Renderer.add(parent);
        }
        Renderer.flush();
        let restored = false;
        for (const target of targets) {
            const nextModule = target.parent.children.find(child => {
                var _a;
                return ((_a = child === null || child === void 0 ? void 0 : child.srcDom) === null || _a === void 0 ? void 0 : _a.key) === target.srcDomKey
                    && typeof child.getHotId === "function"
                    && normalizeHotId(child.getHotId()) === target.hotId;
            });
            if (nextModule && typeof nextModule.applyHotSnapshot === "function") {
                nextModule.applyHotSnapshot(target.snapshot);
                restored = true;
            }
        }
        if (restored) {
            Renderer.flush();
        }
        return true;
    }
    static collectHotReloadTargets(module, hotIds) {
        var _a, _b;
        const hotId = normalizeHotId((_a = module.getHotId) === null || _a === void 0 ? void 0 : _a.call(module));
        if (hotId && hotIds.has(hotId)) {
            const parent = (_b = module.getParent) === null || _b === void 0 ? void 0 : _b.call(module);
            if (parent && module.srcDom && typeof module.captureHotSnapshot === "function") {
                return [{
                        hotId,
                        module,
                        parent,
                        snapshot: module.captureHotSnapshot(),
                        srcDomKey: module.srcDom.key
                    }];
            }
            return [];
        }
        const targets = [];
        for (const child of module.children || []) {
            targets.push(...this.collectHotReloadTargets(child, hotIds));
        }
        return targets;
    }
    static normalizeChangedFiles(changedFiles) {
        if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
            return [];
        }
        const normalized = [];
        for (const file of changedFiles) {
            const hotId = normalizeHotId(file);
            if (!hotId) {
                continue;
            }
            if (!/\.nd($|\?)/i.test(hotId)) {
                return [];
            }
            normalized.push(hotId.replace(/\?.*$/, ""));
        }
        return normalized;
    }
}
Nodom.config = {
    globalProperties: {}
};
Nodom.queuedPlugins = [];
Nodom.queuedComponents = new Map();
Nodom.queuedDirectives = [];
Nodom.queuedProvides = [];
function normalizeHotId(hotId) {
    return typeof hotId === "string" ? hotId.replace(/\\/g, "/") : "";
}
function isModuleHotSnapshot(value) {
    return !!value
        && typeof value === "object"
        && typeof value.hotId === "string"
        && Array.isArray(value.children)
        && typeof value.state === "object";
}
function isQueuedPlugin(value) {
    if (typeof value === "function") {
        return !/^class\s/.test(Function.prototype.toString.call(value));
    }
    return !!value && typeof value === "object" && typeof value.install === "function";
}

function useRuntimeModule() {
    const scope = getCurrentScope();
    if (!scope) {
        throw new Error("This composition api can only be used during setup().");
    }
    return scope;
}
function registerHook(name, hook) {
    useRuntimeModule().addCompositionHook(name, hook);
}
function useModule() {
    return useRuntimeModule();
}
function useModel() {
    return useRuntimeModule().model;
}
function useApp() {
    var _a;
    return (_a = useRuntimeModule().appContext) === null || _a === void 0 ? void 0 : _a.app;
}
function useAttrs() {
    return (useRuntimeModule().props || {});
}
const useProps = useAttrs;
function useSlots() {
    return useRuntimeModule().slots;
}
function defineSlots() {
    return useSlots();
}
function defineProps() {
    return useAttrs();
}
function withDefaults(props, defaults) {
    return Object.assign(Object.assign({}, (defaults || {})), (props || {}));
}
function defineModel(nameOrOptions, maybeOptions) {
    const module = useRuntimeModule();
    const modelName = typeof nameOrOptions === "string" ? nameOrOptions : "modelValue";
    const options = (typeof nameOrOptions === "string" ? maybeOptions : nameOrOptions) || {};
    const eventName = resolveModelEventName(modelName, options);
    const emit = defineEmits([eventName]);
    const state = useState(resolveModelValue(module, modelName, options));
    const syncState = () => {
        const nextValue = resolveModelValue(module, modelName, options);
        if (!Object.is(state.value, nextValue)) {
            state.value = nextValue;
        }
    };
    syncState();
    registerHook("onBeforeRender", syncState);
    return useComputed({
        get: () => state.value,
        set(value) {
            const emittedValue = options.set ? options.set(value) : value;
            state.value = options.get ? options.get(emittedValue) : emittedValue;
            emit(eventName, emittedValue);
        }
    });
}
function provide(key, value) {
    useRuntimeModule().provide(key, value);
}
function inject(key, defaultValue) {
    return useRuntimeModule().inject(key, defaultValue);
}
const useInject = inject;
function defineEmits(options) {
    const module = useRuntimeModule();
    return ((eventName, ...args) => {
        return emitFromModule(module, eventName, args, options);
    });
}
function defineExpose(exposed) {
    var _a;
    if (exposed && typeof exposed === "object") {
        const module = useRuntimeModule();
        (_a = module.setExposed) === null || _a === void 0 ? void 0 : _a.call(module, exposed);
        return exposed;
    }
    return undefined;
}
function useRouter() {
    return Nodom["$Router"];
}
function useRoute() {
    const module = useRuntimeModule();
    if (!module.model["$route"]) {
        module.model["$route"] = {
            path: "/",
            fullPath: "/",
            hash: "",
            meta: {},
            query: {},
            params: {},
            data: {},
            matched: []
        };
    }
    return module.model["$route"];
}
function emitFromModule(module, eventName, args, options) {
    const normalizedName = normalizeEventName(eventName);
    if (!normalizedName) {
        return false;
    }
    if (!isDeclaredEvent(options, normalizedName)) {
        return false;
    }
    const props = module.props || {};
    const handlers = resolveEmitHandlers(props, normalizedName);
    let handled = false;
    for (const handler of handlers) {
        if (typeof handler === "function") {
            handler.apply(module, args);
            handled = true;
        }
        else if (typeof handler === "string" && typeof module[handler] === "function") {
            module.invokeMethod(handler, ...args);
            handled = true;
        }
    }
    return handled;
}
function resolveModelValue(module, modelName, options) {
    const propValue = readModelPropValue(module.props || {}, modelName);
    const resolvedValue = (propValue === undefined ? options.default : propValue);
    return options.get ? options.get(resolvedValue) : resolvedValue;
}
function resolveModelEventName(modelName, options) {
    return options.event || `update:${toKebabCase(modelName || "modelValue")}`;
}
function readModelPropValue(props, modelName) {
    const candidates = buildPropCandidateKeys(modelName);
    for (const key of candidates) {
        if (Object.prototype.hasOwnProperty.call(props, key)) {
            return props[key];
        }
    }
    return undefined;
}
function buildPropCandidateKeys(modelName) {
    const rawName = String(modelName || "modelValue");
    const camelName = toCamelCase(rawName);
    const kebabName = toKebabCase(rawName);
    return Array.from(new Set([
        rawName,
        rawName.toLowerCase(),
        camelName,
        camelName.toLowerCase(),
        kebabName,
        kebabName.toLowerCase()
    ].filter(Boolean)));
}
function isDeclaredEvent(options, eventName) {
    if (!options) {
        return true;
    }
    if (Array.isArray(options)) {
        return options.some(item => normalizeEventName(item) === eventName);
    }
    return Object.prototype.hasOwnProperty.call(options, eventName);
}
function resolveEmitHandlers(props, eventName) {
    const handlers = [];
    const candidates = buildEmitCandidateKeys(eventName);
    for (const key of candidates) {
        const value = props[key];
        if (Array.isArray(value)) {
            for (const item of value) {
                if (!handlers.includes(item)) {
                    handlers.push(item);
                }
            }
        }
        else if (value !== undefined && !handlers.includes(value)) {
            handlers.push(value);
        }
    }
    return handlers;
}
function buildEmitCandidateKeys(eventName) {
    const camelName = toCamelCase(eventName);
    const pascalName = camelName ? camelName[0].toUpperCase() + camelName.slice(1) : "";
    const kebabName = toKebabCase(eventName);
    const keys = [
        eventName,
        camelName,
        kebabName,
        `on${eventName}`,
        `on${camelName}`,
        `on${pascalName}`,
        `on-${kebabName}`,
        `on:${eventName}`
    ];
    return Array.from(new Set(keys.map(item => item.toLowerCase()).filter(Boolean)));
}
function normalizeEventName(eventName) {
    return toKebabCase(String(eventName || ""));
}
function toCamelCase(value) {
    const normalized = String(value || "")
        .replace(/^on[-:]/i, "")
        .replace(/[^a-zA-Z0-9]+([a-zA-Z0-9])/g, (_, char) => char.toUpperCase())
        .replace(/^[A-Z]/, char => char.toLowerCase());
    return normalized;
}
function toKebabCase(value) {
    return String(value || "")
        .replace(/^on[-:]/i, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/[_:\s]+/g, "-")
        .replace(/--+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
}
function onInit(hook) {
    registerHook("onInit", hook);
}
function onBeforeRender(hook) {
    registerHook("onBeforeRender", hook);
}
function onRender(hook) {
    registerHook("onRender", hook);
}
function onBeforeMount(hook) {
    registerHook("onBeforeMount", hook);
}
function onMounted(hook) {
    registerHook("onMount", hook);
}
function onBeforeUpdate(hook) {
    registerHook("onBeforeUpdate", hook);
}
function onUpdated(hook) {
    registerHook("onUpdate", hook);
}
function onBeforeUnmount(hook) {
    registerHook("onBeforeUnMount", hook);
}
function onUnmounted(hook) {
    registerHook("onUnMount", hook);
}
function onActivated(hook) {
    registerHook("onActivated", hook);
}
function onDeactivated(hook) {
    registerHook("onDeactivated", hook);
}
function onBeforeEnter(hook) {
    registerHook("onBeforeEnter", hook);
}
function onEnter(hook) {
    registerHook("onEnter", hook);
}
function onAfterEnter(hook) {
    registerHook("onAfterEnter", hook);
}
function onEnterCancelled(hook) {
    registerHook("onEnterCancelled", hook);
}
function onBeforeLeave(hook) {
    registerHook("onBeforeLeave", hook);
}
function onLeave(hook) {
    registerHook("onLeave", hook);
}
function onAfterLeave(hook) {
    registerHook("onAfterLeave", hook);
}
function onLeaveCancelled(hook) {
    registerHook("onLeaveCancelled", hook);
}
function onBeforeMove(hook) {
    registerHook("onBeforeMove", hook);
}
function onMove(hook) {
    registerHook("onMove", hook);
}
function onAfterMove(hook) {
    registerHook("onAfterMove", hook);
}
function onMoveCancelled(hook) {
    registerHook("onMoveCancelled", hook);
}
function onSuspensePending(hook) {
    registerHook("onSuspensePending", hook);
}
function onSuspenseFallback(hook) {
    registerHook("onSuspenseFallback", hook);
}
function onSuspenseResolve(hook) {
    registerHook("onSuspenseResolve", hook);
}
function onSuspenseError(hook) {
    registerHook("onSuspenseError", hook);
}
function onSuspenseRetry(hook) {
    registerHook("onSuspenseRetry", hook);
}

function nextTick(handler) {
    return Promise.resolve().then(() => __awaiter(this, void 0, void 0, function* () {
        Renderer.flush();
        return handler ? yield handler() : undefined;
    }));
}

/**
 * module 元素
 * @remarks
 * module指令标签，用`<module name='class name' /> 代替 x-module='class name'`
 */
class MODULE extends DefineElement {
    constructor(node, module) {
        super(node, module);
        //类名
        const clazz = node.getProp('name');
        if (!clazz) {
            throw new NError('itemnotempty', NodomMessage.TipWords['element'], 'MODULE', 'className');
        }
        node.delProp('name');
        node.addDirective(new Directive('module', clazz));
    }
}
/**
 * for 元素
 * @remarks
 * repeat指令标签，用`<for cond={{your expression}} /> 代替 x-repeat={{your expression}}`
 */
class FOR extends DefineElement {
    constructor(node, module) {
        super(node, module);
        //条件
        const cond = node.getProp('cond');
        if (!cond) {
            throw new NError('itemnotempty', NodomMessage.TipWords['element'], 'FOR', 'cond');
        }
        node.delProp('cond');
        node.addDirective(new Directive('repeat', cond));
    }
}
/**
 * 递归元素
 * @remarks
 * recur指令标签，用`<recur cond='recur field' /> 代替 x-recur='recur field'`
 */
class RECUR extends DefineElement {
    constructor(node, module) {
        super(node, module);
        //条件
        const cond = node.getProp('cond');
        node.delProp('cond');
        node.addDirective(new Directive('recur', cond));
    }
}
/**
 * IF 元素
 * @remarks
 * if指令标签，用`<if cond={{your expression}} /> 代替 x-if={{your expression}}`
 */
class IF extends DefineElement {
    constructor(node, module) {
        super(node, module);
        //条件
        const cond = node.getProp('cond');
        if (!cond) {
            throw new NError('itemnotempty', NodomMessage.TipWords['element'], 'IF', 'cond');
        }
        node.delProp('cond');
        node.addDirective(new Directive('if', cond));
    }
}
/**
 * ELSE 元素
 * @remarks
 * else指令标签，用`<else/> 代替 x-else`
 */
class ELSE extends DefineElement {
    constructor(node, module) {
        super(node, module);
        node.addDirective(new Directive('else', null));
    }
}
/**
 * ELSEIF 元素
 * @remarks
 * elseif指令标签，用`<elseif cond={{your expression}} /> 代替 x-elseif={{your expression}}`
 */
class ELSEIF extends DefineElement {
    constructor(node, module) {
        super(node, module);
        //条件
        const cond = node.getProp('cond');
        if (!cond) {
            throw new NError('itemnotempty', NodomMessage.TipWords['element'], 'ELSEIF', 'cond');
        }
        node.delProp('cond');
        node.addDirective(new Directive('elseif', cond));
    }
}
/**
 * ENDIF 元素
 * @remarks
 * endif指令标签，用`<endif /> 代替 x-endif`
 */
class ENDIF extends DefineElement {
    constructor(node, module) {
        super(node, module);
        node.addDirective(new Directive('endif', null));
    }
}
/**
 * SHOW 元素
 * @remarks
 * show指令标签，用`<show cond={{your expression}} /> 代替 x-show={{your expression}}`
 */
class SHOW extends DefineElement {
    constructor(node, module) {
        super(node, module);
        //条件
        const cond = node.getProp('cond');
        if (!cond) {
            throw new NError('itemnotempty', NodomMessage.TipWords['element'], 'SHOW', 'cond');
        }
        node.delProp('cond');
        node.addDirective(new Directive('show', cond));
    }
}
/**
 * 插槽
 * @remarks
 * slot指令标签，用`<slot name='slotname' > 代替 x-slot='slotname'`
 */
class SLOT extends DefineElement {
    constructor(node, module) {
        super(node, module);
        //条件
        const cond = node.getProp('name') || 'default';
        node.delProp('name');
        node.addDirective(new Directive('slot', cond));
    }
}
/**
 * 路由
 * @remarks
 * route指令标签，用`<route path='routepath' > 代替 x-route='routepath'`
 */
class ROUTE extends DefineElement {
    constructor(node, module) {
        //默认标签为a
        if (!node.hasProp('tag')) {
            node.setProp('tag', 'a');
        }
        super(node, module);
        //条件
        const cond = node.getProp('path');
        if (!cond) {
            throw new NError('itemnotempty', NodomMessage.TipWords['element'], 'ROUTE', 'path');
        }
        node.addDirective(new Directive('route', cond));
    }
}
/**
 * 路由容器
 * @remarks
 * router指令标签，用`<router /> 代替 x-router`
 */
class ROUTER extends DefineElement {
    constructor(node, module) {
        super(node, module);
        node.addDirective(new Directive('router', null));
    }
}
/**
 * Teleport 元素
 * @remarks
 * 用 `<Teleport to="#target">...</Teleport>` 把内容移动到其它 DOM 容器
 */
class KEEPALIVE extends DefineElement {
    constructor(node, module) {
        super(node, module);
        const style = node.getProp('style');
        if (typeof style === 'string' && style.trim()) {
            if (!/display\s*:/.test(style)) {
                node.setProp('style', `${style};display:contents`);
            }
        }
        else if (style === undefined) {
            node.setProp('style', 'display:contents');
        }
        const keepAliveValue = {
            disabled: node.hasProp('disabled') ? node.getProp('disabled') : false,
            exclude: node.hasProp('exclude') ? node.getProp('exclude') : undefined,
            include: node.hasProp('include') ? node.getProp('include') : undefined,
            max: node.hasProp('max') ? node.getProp('max') : undefined,
            scopeKey: node.key
        };
        node.delProp('disabled');
        node.delProp('exclude');
        node.delProp('include');
        node.delProp('max');
        for (const child of node.children || []) {
            if (child.hasDirective('module')) {
                child.addDirective(new Directive('keepalive', keepAliveValue));
            }
        }
    }
}
class TRANSITION extends DefineElement {
    constructor(node, module) {
        var _a;
        super(node, module);
        const style = node.getProp('style');
        if (typeof style === 'string' && style.trim()) {
            if (!/display\s*:/.test(style)) {
                node.setProp('style', `${style};display:contents`);
            }
        }
        else if (style === undefined) {
            node.setProp('style', 'display:contents');
        }
        const transitionValue = {
            duration: node.getProp('duration'),
            enterActiveClass: node.getProp('enter-active-class'),
            enterDuration: node.getProp('enter-duration'),
            enterFromClass: node.getProp('enter-from-class'),
            enterToClass: node.getProp('enter-to-class'),
            leaveActiveClass: node.getProp('leave-active-class'),
            leaveDuration: node.getProp('leave-duration'),
            leaveFromClass: node.getProp('leave-from-class'),
            leaveToClass: node.getProp('leave-to-class'),
            moveClass: node.getProp('move-class'),
            moveDuration: node.getProp('move-duration'),
            name: node.getProp('name')
        };
        [
            'duration',
            'enter-active-class',
            'enter-duration',
            'enter-from-class',
            'enter-to-class',
            'leave-active-class',
            'leave-duration',
            'leave-from-class',
            'leave-to-class',
            'move-class',
            'move-duration',
            'name'
        ].forEach(propName => node.delProp(propName));
        for (const child of node.children || []) {
            if (child.tagName || ((_a = child.children) === null || _a === void 0 ? void 0 : _a.length)) {
                child.addDirective(new Directive('transition', transitionValue));
            }
        }
    }
}
class TRANSITIONGROUP extends DefineElement {
    constructor(node, module) {
        var _a;
        super(node, module);
        const style = node.getProp('style');
        if (typeof style === 'string' && style.trim()) {
            if (!/display\s*:/.test(style)) {
                node.setProp('style', `${style};display:contents`);
            }
        }
        else if (style === undefined) {
            node.setProp('style', 'display:contents');
        }
        const transitionValue = {
            duration: node.getProp('duration'),
            enterActiveClass: node.getProp('enter-active-class'),
            enterDuration: node.getProp('enter-duration'),
            enterFromClass: node.getProp('enter-from-class'),
            enterToClass: node.getProp('enter-to-class'),
            group: true,
            leaveActiveClass: node.getProp('leave-active-class'),
            leaveDuration: node.getProp('leave-duration'),
            leaveFromClass: node.getProp('leave-from-class'),
            leaveToClass: node.getProp('leave-to-class'),
            moveClass: node.getProp('move-class'),
            moveDuration: node.getProp('move-duration'),
            name: node.getProp('name')
        };
        [
            'duration',
            'enter-active-class',
            'enter-duration',
            'enter-from-class',
            'enter-to-class',
            'leave-active-class',
            'leave-duration',
            'leave-from-class',
            'leave-to-class',
            'move-class',
            'move-duration',
            'name'
        ].forEach(propName => node.delProp(propName));
        for (const child of node.children || []) {
            if (child.tagName || ((_a = child.children) === null || _a === void 0 ? void 0 : _a.length)) {
                child.addDirective(new Directive('transition', transitionValue));
            }
        }
    }
}
class TELEPORT extends DefineElement {
    constructor(node, module) {
        super(node, module);
        const style = node.getProp('style');
        if (typeof style === 'string' && style.trim()) {
            if (!/display\s*:/.test(style)) {
                node.setProp('style', `${style};display:contents`);
            }
        }
        else if (style === undefined) {
            node.setProp('style', 'display:contents');
        }
        node.addDirective(new Directive('teleport', null));
    }
}
DefineElementManager.add([KEEPALIVE]);
DefineElementManager.add([TRANSITION]);
DefineElementManager.add([TRANSITIONGROUP]);
//添加到自定义元素管理器
DefineElementManager.add([MODULE, FOR, RECUR, IF, ELSE, ELSEIF, ENDIF, SHOW, SLOT, ROUTE, ROUTER, TELEPORT]);

/**
     * 指令类型初始化
     * @remarks
     * 每个指令类型都有一个名字、处理函数和优先级，处理函数`不能用箭头函数`
     * 处理函数在渲染时执行，包含两个参数 module(模块)、dom(目标虚拟dom)
     * 处理函数的this指向指令对象
     * 处理函数的返回值`true`表示继续，`false`表示后续指令不再执行，同时该节点不加入渲染树
     */
(function () {
    /**
     * module 指令
     * 用于指定该元素为模块容器，表示子模块
     * 用法 x-module='模块类名'
     */
    Nodom.createDirective('module', function (module, dom) {
        if (!this.value) {
            return false;
        }
        const requestedClass = typeof this.value === 'string'
            ? ModuleFactory.getClass(this.value)
            : typeof this.value === 'function'
                ? this.value
                : undefined;
        let m = module.objectManager.getDomParam(dom.key, '$savedModule');
        if (m && requestedClass && m.constructor !== requestedClass) {
            m.destroy();
            module.objectManager.removeDomParam(dom.key, '$savedModule');
            m = undefined;
        }
        if (!m) {
            m = ModuleFactory.get(this.value);
            if (!m) {
                return false;
            }
            module.objectManager.setDomParam(dom.key, '$savedModule', m);
        }
        module.addChild(m);
        //保存到dom上，提升渲染性能
        dom.childModuleId = m.id;
        if (!dom.props) {
            dom.props = { role: m.constructor.name };
        }
        else {
            dom.props['role'] = m.constructor.name;
        }
        //设置props
        let o = {};
        for (const p of Object.keys(dom.props)) {
            const v = dom.props[p];
            if (p[0] === '$') { //数据
                if (!o['$data']) {
                    o['$data'] = {};
                }
                o['$data'][p.substring(1)] = v;
                //删除属性
                delete dom.props[p];
            }
            else {
                o[p] = v;
            }
        }
        //传递给模块
        m.setProps(o, dom);
        return true;
    }, 8);
    Nodom.createDirective('keepalive', function (module, dom) {
        var _a;
        const keepAliveConfig = resolveKeepAliveConfig(module, dom, this.value);
        dom.keepAlive = keepAliveConfig;
        const childModule = dom.childModuleId
            ? ModuleFactory.get(dom.childModuleId)
            : module.objectManager.getDomParam(dom.key, '$savedModule');
        (_a = childModule === null || childModule === void 0 ? void 0 : childModule.setKeepAliveManaged) === null || _a === void 0 ? void 0 : _a.call(childModule, isKeepAliveDirectiveActive(keepAliveConfig));
        return true;
    }, 9);
    Nodom.createDirective('transition', function (module, dom) {
        dom.transition = resolveTransitionConfig(module, dom, this.value);
        return true;
    }, 9);
    /**
     *  model指令
     */
    Nodom.createDirective('model', function (module, dom) {
        const model = module.get(dom.model, this.value);
        if (model) {
            dom.model = model;
        }
        return true;
    }, 1);
    /**
     * 指令名 repeat
     * 描述：重复指令
     */
    Nodom.createDirective('repeat', function (module, dom) {
        const rows = this.value;
        // 无数据不渲染
        if (!Util.isArray(rows) || rows.length === 0) {
            return false;
        }
        const src = dom.vdom;
        //索引名
        const idxName = src.getProp('index');
        const parent = dom.parent;
        //禁用该指令
        this.disabled = true;
        //避免在渲染时对src设置了model，此处需要删除
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row) {
                continue;
            }
            if (idxName && typeof row === 'object') {
                row[idxName] = i;
            }
            const renderKey = typeof row === 'object' && row && '__key' in row
                ? row.__key
                : i;
            const d = Renderer.renderDom(module, src, row, parent, renderKey);
            //删除index属性
            if (idxName) {
                delete d.props['index'];
            }
        }
        //启用该指令
        this.disabled = false;
        return false;
    }, 2);
    /**
     * 递归指令
     * 作用：在dom内部递归，用于具有相同数据结构的节点递归生成
     * 递归指令不允许嵌套
     * name表示递归名字，必须与内部的recur标签的ref保持一致，名字默认为default
     * 典型模版
     * ```
     * <recur name='r1'>
     *      <element1>...</element1>
     *      <element2>...</element2>
     *      <recur ref='r1' />
     * </recur>
     * ```
     */
    Nodom.createDirective('recur', function (module, dom) {
        const src = dom.vdom;
        //当前节点是递归节点存放容器
        if (dom.props.hasOwnProperty('ref')) {
            //如果出现在repeat中，src为单例，需要在使用前清空子节点，避免沿用上次的子节点
            src.children = [];
            //递归存储名
            const name = '$recurs.' + (dom.props['ref'] || 'default');
            const node = module.objectManager.get(name);
            if (!node) {
                return true;
            }
            const model = dom.model;
            const cond = node.getDirective('recur');
            const m = model[cond.value];
            //不存在子层数组，不再递归
            if (!m) {
                return true;
            }
            //克隆，后续可以继续用
            const node1 = node.clone();
            node1.removeDirective('recur');
            dom.children || (dom.children = []);
            if (!Array.isArray(m)) { //非数组recur
                Renderer.renderDom(module, node1, m, dom, m.__key);
            }
            else { //数组内recur，依赖repeat得到model，repeat会取一次数组元素，所以需要dom model
                Renderer.renderDom(module, node1, model, dom, m['__key']);
            }
            //删除ref属性
            delete dom.props['ref'];
        }
        else { //递归节点
            const data = dom.model[this.value];
            if (!data) {
                return true;
            }
            //递归名，默认default
            const name = '$recurs.' + (dom.props['name'] || 'default');
            //删除name属性
            delete dom.props['name'];
            //保存递归定义的节点
            if (!module.objectManager.get(name)) {
                module.objectManager.set(name, src);
            }
        }
        return true;
    }, 2);
    /**
     * 指令名 if
     * 描述：条件指令
     */
    Nodom.createDirective('if', function (module, dom) {
        if (!dom.parent) {
            return;
        }
        module.objectManager.setDomParam(dom.parent.key, '$if', this.value);
        return this.value;
    }, 5);
    /**
     * 指令名 else
     * 描述：else指令
     */
    Nodom.createDirective('else', function (module, dom) {
        if (!dom.parent) {
            return;
        }
        return !module.objectManager.getDomParam(dom.parent.key, '$if');
    }, 5);
    /**
     * elseif 指令
     */
    Nodom.createDirective('elseif', function (module, dom) {
        if (!dom.parent) {
            return;
        }
        const v = module.objectManager.getDomParam(dom.parent.key, '$if');
        if (v === true) {
            return false;
        }
        else {
            if (!this.value) {
                return false;
            }
            else {
                module.objectManager.setDomParam(dom.parent.key, '$if', true);
            }
        }
        return true;
    }, 5);
    /**
     * elseif 指令
     */
    Nodom.createDirective('endif', function (module, dom) {
        if (!dom.parent) {
            return;
        }
        module.objectManager.removeDomParam(dom.parent.key, '$if');
        //endif 不显示
        return false;
    }, 5);
    /**
     * 指令名 show
     * 描述：显示指令
     */
    Nodom.createDirective('show', function (module, dom) {
        //show指令参数 {origin:通过style设置的初始display属性,rendered:是否渲染过}
        let showParam = module.objectManager.getDomParam(dom.key, '$show');
        //为false且未渲染过，则不渲染
        if (!this.value && (!showParam || !showParam['rendered'])) {
            return false;
        }
        if (!showParam) {
            showParam = {};
            module.objectManager.setDomParam(dom.key, '$show', showParam);
        }
        let style = dom.props['style'];
        const reg = /display\s*\:[\w\-]+/;
        let regResult;
        let display;
        if (style) {
            regResult = reg.exec(style);
            //保存第一个style display属性
            if (regResult !== null) {
                const ra = regResult[0].split(':');
                display = ra[1].trim();
                //保存第一个display属性
                if (!showParam['origin'] && display !== 'none') {
                    showParam['origin'] = display;
                }
            }
        }
        // 渲染标识，value为false且尚未进行渲染，则不渲染
        if (!this.value) {
            if (style) {
                if (display) {
                    //把之前的display替换为none
                    if (display !== 'none') {
                        style = style.substring(0, regResult.index) + 'display:none' + style.substring(regResult.index + regResult[0].length);
                    }
                }
                else {
                    style += ';display:none';
                }
            }
            else {
                style = 'display:none';
            }
        }
        else {
            //设置渲染标志
            showParam['rendered'] = true;
            if (display === 'none') {
                if (style) {
                    if (showParam['origin']) {
                        style = style.substring(0, regResult.index) + 'display:' + showParam['origin'] + style.substring(regResult.index + regResult[0].length);
                    }
                    else {
                        style = style.substring(0, regResult.index) + style.substring(regResult.index + regResult[0].length);
                    }
                }
            }
        }
        if (style) {
            dom.props['style'] = style;
        }
        return true;
    }, 5);
    /**
     * 指令名 field
     * 描述：字段指令
     */
    Nodom.createDirective('field', function (module, dom) {
        dom.assets || (dom.assets = {});
        //修正staticnum
        if (dom.staticNum === 0) {
            dom.staticNum = 1;
        }
        const dataValue = module.get(dom.model, this.value);
        if (dom.tagName === 'select') {
            dom.props['value'] = dataValue;
            //延迟设置value，避免option尚未渲染
            setTimeout(() => {
                const el = dom.node;
                if (el) {
                    el.value = dataValue;
                }
            }, 0);
        }
        else if (dom.tagName === 'input') {
            switch (dom.props['type']) {
                case 'radio':
                    const value = dom.props['value'];
                    dom.props['name'] = this.value;
                    if (dataValue == value) {
                        dom.props['checked'] = 'checked';
                        dom.assets['checked'] = true;
                    }
                    else {
                        delete dom.props['checked'];
                        dom.assets['checked'] = false;
                    }
                    break;
                case 'checkbox':
                    //设置状态和value
                    const yv = dom.props['yes-value'];
                    //当前值为yes-value
                    if (dataValue == yv) {
                        dom.props['value'] = yv;
                        dom.assets['checked'] = true;
                    }
                    else { //当前值为no-value
                        dom.props['value'] = dom.props['no-value'];
                        dom.assets['checked'] = false;
                    }
                    break;
                default:
                    const v = (dataValue !== undefined && dataValue !== null) ? dataValue : '';
                    dom.props['value'] = v;
                    dom.assets['value'] = v;
            }
        }
        else {
            const v = (dataValue !== undefined && dataValue !== null) ? dataValue : '';
            dom.props['value'] = v;
            dom.assets['value'] = v;
        }
        //设置dom参数，避免二次添加事件
        if (!module.objectManager.getDomParam(dom.vdom.key, '$addedFieldEvent')) {
            module.objectManager.setDomParam(dom.vdom.key, '$addedFieldEvent', true);
            const event = new NEvent(module, 'change', (model, dom) => {
                const el = dom.node;
                if (!el) {
                    return;
                }
                const type = dom.props['type'];
                let field = this.value;
                let v = 'value' in el ? el.value : undefined;
                //根据选中状态设置checkbox的value
                if (type === 'checkbox') {
                    if (dom.props['yes-value'] == v) {
                        v = dom.props['no-value'];
                    }
                    else {
                        v = dom.props['yes-value'];
                    }
                }
                else if (type === 'radio') {
                    if (!('checked' in el) || !el.checked) {
                        v = undefined;
                    }
                }
                //修改字段值,需要处理.运算符
                module.set(model, field, v);
            });
            dom.vdom.addEvent(event, 0);
        }
        return true;
    }, 10);
    /**
     * route指令
     */
    Nodom.createDirective('route', function (module, dom) {
        if (!Nodom['$Router']) {
            throw new NError('uninit', NodomMessage.TipWords.route);
        }
        //a标签需要设置href
        if (dom.tagName === 'a') {
            dom.props['href'] = 'javascript:void(0)';
        }
        const v = this.value;
        dom.props['path'] = (v === undefined || v === null || v === '' || typeof v === 'string' && v.trim() === '') ? '' : v;
        //有激活属性
        const acName = dom.props['active'];
        //添加激活model
        if (acName) {
            const router = Nodom['$Router'];
            router.addActiveDom(module, dom);
            //如果有active属性，尝试激活路径
            if (dom.model && dom.model[acName]) {
                router.activePath(this.value);
            }
        }
        //添加click事件,避免重复创建事件对象，创建后缓存
        if (!module.objectManager.getDomParam(dom.vdom.key, '$addedRouteEvent')) {
            module.objectManager.setDomParam(dom.vdom.key, '$addedRouteEvent', true);
            const event = new NEvent(module, 'click', null, function (model, d) {
                const path = d.props['path'];
                if (Util.isEmpty(path)) {
                    return;
                }
                Nodom['$Router'].go(path);
            });
            dom.vdom.addEvent(event);
        }
        return true;
    }, 10);
    /**
     * 增加router指令
     */
    Nodom.createDirective('router', function (module, dom) {
        const router = Nodom['$Router'];
        if (!router) {
            throw new NError('uninit', NodomMessage.TipWords.route);
        }
        router.registRouter(module, dom);
        return true;
    }, 10);
    /**
     * teleport 指令
     */
    Nodom.createDirective('teleport', function (module, dom) {
        var _a, _b, _c, _d;
        const teleportDom = dom;
        teleportDom.teleportTarget = (_b = (_a = dom.props) === null || _a === void 0 ? void 0 : _a['to']) !== null && _b !== void 0 ? _b : (_c = dom.props) === null || _c === void 0 ? void 0 : _c['target'];
        teleportDom.teleportDisabled = resolveTeleportDisabled((_d = dom.props) === null || _d === void 0 ? void 0 : _d['disabled']);
        if (teleportDom.props) {
            delete teleportDom.props['to'];
            delete teleportDom.props['target'];
            delete teleportDom.props['disabled'];
        }
        return true;
    }, 10);
    /**
     * 插头指令
     * 用于模块中，可实现同名替换
     */
    Nodom.createDirective('slot', function (module, dom) {
        var _a, _b;
        this.value || (this.value = 'default');
        const mid = dom.parent.childModuleId;
        //父dom有module指令，表示为替代节点，替换子模块中的对应的slot节点；否则为子模块定义slot节点
        if (mid) {
            const m = ModuleFactory.get(mid);
            //子模块不存在则不处理
            if (!m) {
                return false;
            }
            const previousSlot = m.slots.get(this.value);
            m.slots.set(this.value, dom);
            dom.slotModuleId = mid;
            //保持key带slot标识
            if (!dom.vdom.slotModuleId) {
                dom.key += 's';
                updateKey(dom.vdom, 's');
            }
            if (previousSlot !== dom) {
                (_a = m.markDirty) === null || _a === void 0 ? void 0 : _a.call(m, `slots.${this.value}`);
                Renderer.add(m);
            }
            //innerrender，此次不渲染
            if ((_b = dom.vdom.props) === null || _b === void 0 ? void 0 : _b.has('innerrender')) {
                return false;
            }
            return true;
            /**
             * 更新虚拟dom key，避免在新模块中重复
             * @param vdom -    虚拟dom
             * @param key -     附加key
             */
            function updateKey(vdom, key) {
                vdom.key += key;
                vdom.slotModuleId = mid;
                if (vdom.children) {
                    for (const c of vdom.children) {
                        updateKey(c, key);
                    }
                }
            }
        }
        else { //源slot节点
            const sdom = module.slots.get(this.value);
            if (sdom) {
                if (dom.vdom.hasProp('innerrender')) { //内部数据渲染
                    if (sdom.vdom.children && dom.parent) {
                        const slotModel = createInnerRenderSlotModel(dom.model, sdom.model);
                        for (let c of sdom.vdom.children) {
                            Renderer.renderDom(module, c, slotModel, dom.parent, dom.key);
                        }
                    }
                }
                else { //替换为存储的已渲染节点
                    if ((sdom === null || sdom === void 0 ? void 0 : sdom.children) && dom.parent) {
                        for (let c of sdom.children) {
                            dom.parent.children.push(c);
                            c.parent = dom.parent;
                        }
                    }
                }
            }
            return false;
        }
    }, 5);
}());
function createInnerRenderSlotModel(innerModel, outerModel) {
    if (!innerModel || typeof innerModel !== 'object') {
        return outerModel || innerModel;
    }
    if (!outerModel || typeof outerModel !== 'object') {
        return innerModel;
    }
    return new Proxy(innerModel, {
        get(target, key, receiver) {
            if (Reflect.has(target, key)) {
                return Reflect.get(target, key, receiver);
            }
            return Reflect.get(outerModel, key, outerModel);
        },
        has(target, key) {
            return Reflect.has(target, key) || Reflect.has(outerModel, key);
        },
        ownKeys(target) {
            return Array.from(new Set([
                ...Reflect.ownKeys(outerModel),
                ...Reflect.ownKeys(target)
            ]));
        },
        getOwnPropertyDescriptor(target, key) {
            return Reflect.getOwnPropertyDescriptor(target, key)
                || Reflect.getOwnPropertyDescriptor(outerModel, key)
                || {
                    configurable: true,
                    enumerable: true,
                    writable: true,
                    value: undefined
                };
        },
        set(target, key, value, receiver) {
            if (Reflect.has(target, key) || !Reflect.has(outerModel, key)) {
                return Reflect.set(target, key, value, receiver);
            }
            return Reflect.set(outerModel, key, value);
        }
    });
}
function resolveTeleportDisabled(value) {
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === '' || normalized === 'true' || normalized === '1';
    }
    return value === true;
}
function resolveKeepAliveEnabled(value) {
    if (value === undefined || value === null) {
        return true;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return !(normalized === 'false' || normalized === '0');
    }
    return value !== false;
}
function resolveKeepAliveConfig(module, dom, value) {
    if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
        return {
            disabled: !resolveKeepAliveEnabled(value),
            scopeKey: dom.key
        };
    }
    const config = value;
    return {
        disabled: resolveKeepAliveDisabled(resolveDirectiveValue(module, dom, config.disabled)),
        exclude: normalizeKeepAlivePattern(resolveDirectiveValue(module, dom, config.exclude)),
        include: normalizeKeepAlivePattern(resolveDirectiveValue(module, dom, config.include)),
        max: resolveKeepAliveMax(resolveDirectiveValue(module, dom, config.max)),
        scopeKey: typeof config.scopeKey === 'number' || typeof config.scopeKey === 'string'
            ? config.scopeKey
            : dom.key
    };
}
function resolveKeepAliveDisabled(value) {
    if (value === undefined || value === null) {
        return false;
    }
    return resolveKeepAliveEnabled(value);
}
function normalizeKeepAlivePattern(value) {
    if (value instanceof RegExp) {
        return value;
    }
    if (Array.isArray(value)) {
        const normalized = value
            .map(item => String(item !== null && item !== void 0 ? item : '').trim())
            .filter(item => item.length > 0);
        return normalized.length > 0 ? normalized : undefined;
    }
    if (typeof value === 'string') {
        const normalized = value.trim();
        return normalized ? normalized : undefined;
    }
    return undefined;
}
function isKeepAliveDirectiveActive(value) {
    if (value === undefined || value === false) {
        return false;
    }
    if (value === true) {
        return true;
    }
    return !value.disabled;
}
function resolveKeepAliveMax(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.floor(value));
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed)) {
            return Math.max(0, Math.floor(parsed));
        }
    }
    return undefined;
}
function resolveTransitionConfig(module, dom, value) {
    if (!value || typeof value !== 'object') {
        return {
            name: 'nd'
        };
    }
    const config = value;
    return {
        duration: resolveTransitionDuration(resolveDirectiveValue(module, dom, config.duration)),
        enterActiveClass: normalizeTransitionClass(resolveDirectiveValue(module, dom, config.enterActiveClass)),
        enterDuration: resolveTransitionDuration(resolveDirectiveValue(module, dom, config.enterDuration)),
        enterFromClass: normalizeTransitionClass(resolveDirectiveValue(module, dom, config.enterFromClass)),
        enterToClass: normalizeTransitionClass(resolveDirectiveValue(module, dom, config.enterToClass)),
        group: resolveDirectiveValue(module, dom, config.group) === true,
        leaveActiveClass: normalizeTransitionClass(resolveDirectiveValue(module, dom, config.leaveActiveClass)),
        leaveDuration: resolveTransitionDuration(resolveDirectiveValue(module, dom, config.leaveDuration)),
        leaveFromClass: normalizeTransitionClass(resolveDirectiveValue(module, dom, config.leaveFromClass)),
        leaveToClass: normalizeTransitionClass(resolveDirectiveValue(module, dom, config.leaveToClass)),
        moveClass: normalizeTransitionClass(resolveDirectiveValue(module, dom, config.moveClass)),
        moveDuration: resolveTransitionDuration(resolveDirectiveValue(module, dom, config.moveDuration)),
        name: normalizeTransitionName(resolveDirectiveValue(module, dom, config.name))
    };
}
function resolveDirectiveValue(module, dom, value) {
    if (value && typeof value === 'object' && typeof value.val === 'function') {
        return value.val(module, dom.model);
    }
    return value;
}
function normalizeTransitionName(value) {
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }
    return 'nd';
}
function normalizeTransitionClass(value) {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim();
    return normalized ? normalized : undefined;
}
function resolveTransitionDuration(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, value);
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed)) {
            return Math.max(0, parsed);
        }
    }
    return undefined;
}

export { App, Compiler, CssManager, DefineElement, DefineElementManager, DiffTool, Directive, DirectiveManager, DirectiveType, DomManager, EModuleState, EventFactory, Expression, GlobalCache, Model, ModelManager, Module, ModuleFactory, NCache, NError, NEvent, Nodom, NodomMessage, NodomMessage_en, NodomMessage_zh, ObjectManager, PatchFlags, Renderer, RequestManager, Route, Router, RuntimeConfig, Scheduler, StructureFlags, Suspense, Teleport, Util, VirtualDom, Watcher, appendRenderedChild, bindStateHost, canReuseRenderedSubtree, cloneStateValue, computed, configureReactivityRuntime, createApp, createAppContext, createRouteLocation, defineAsyncComponent, defineEmits, defineExpose, defineModel, defineProps, defineSlots, findPreviousChild, getAsyncComponentStatus, getCurrentScope, getSequence, hasDependencyMatch, inject, installPlugin, isActiveRoutePath, isComputed, isReactive, isRef, isRelatedDependencyPath, joinRoutePath, mergeDependencyPaths, mergeRouteMeta, nextTick, normalizeChildRoutePath, normalizeDependencyPath, normalizeRoutePath, onActivated, onAfterEnter, onAfterLeave, onAfterMove, onBeforeEnter, onBeforeLeave, onBeforeMount, onBeforeMove, onBeforeRender, onBeforeUnmount, onBeforeUpdate, onDeactivated, onEnter, onEnterCancelled, onInit, onLeave, onLeaveCancelled, onMounted, onMove, onMoveCancelled, onRender, onSuspenseError, onSuspenseFallback, onSuspensePending, onSuspenseResolve, onSuspenseRetry, onUnmounted, onUpdated, parseRouteQuery, parseRouteUrl, provide, reactive, ref, removeReactiveOwner, resolveAsyncComponentClass, resolveRenderedKey, retryAsyncComponent, reuseRenderedDom, setRuntimeDebug, setRuntimeLang, shouldSkipModelProxy, splitRoutePath, stringifyRouteQuery, subscribeAsyncComponent, toRaw, toValue, track, trigger, unbindStateHost, unref, unwrapState, useApp, useAttrs, useComputed, useInject, useModel, useModule, useProps, useReactive, useRef, useRoute, useRouter, useSlots, useState, useWatch, useWatchEffect, watch, watchEffect, withCurrentScope, withDefaults };
//# sourceMappingURL=nodom.esm.js.map
