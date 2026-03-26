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
 * ģ�鹤��
 * @remarks
 * ��������ģ���ࡢģ��ʵ��
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
            mdl.init();
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

class RequestManager {
    /**
     * 设置相同请求拒绝时间间隔
     * @param time -  时间间隔（ms）
     */
    static setRejectTime(time) {
        this.rejectReqTick = time;
    }
    /**
     * ajax 请求
     *
     * @param config -  object 或 string，如果为string，则表示url，直接以get方式获取资源，如果为 object，配置项如下:
     * ```
     *  参数名|类型|默认值|必填|可选值|描述
     *  -|-|-|-|-|-
     *  url|string|无|是|无|请求url
     *	method|string|GET|否|GET,POST,HEAD|请求类型
     *	params|object/FormData|空object|否|无|参数，json格式
     *	async|bool|true|否|true,false|是否异步
     *  timeout|number|0|否|无|请求超时时间
     *  type|string|text|否|json,text|
     *	withCredentials|bool|false|否|true,false|同源策略，跨域时cookie保存
     *  header|Object|无|否|无|request header 对象
     *  user|string|无|否|无|需要认证的请求对应的用户名
     *  pwd|string|无|否|无|需要认证的请求对应的密码
     *  rand|bool|无|否|无|请求随机数，设置则浏览器缓存失效
     * ```
     */
    static request(config) {
        return __awaiter(this, void 0, void 0, function* () {
            const time = Date.now();
            //如果设置了rejectReqTick，则需要进行判断
            if (this.rejectReqTick > 0) {
                if (this.requestMap.has(config.url)) {
                    const obj = this.requestMap.get(config.url);
                    if (time - obj['time'] < this.rejectReqTick && Util.compare(obj['params'], config.params)) {
                        return new Promise((resolve) => {
                            resolve(null);
                        });
                    }
                }
                //加入请求集合
                this.requestMap.set(config.url, {
                    time: time,
                    params: config.params
                });
            }
            return new Promise((resolve, reject) => {
                if (typeof config === 'string') {
                    config = {
                        url: config
                    };
                }
                config.params = config.params || {};
                //随机数
                if (config.rand) { //针对数据部分，仅在app中使用
                    config.params.$rand = Math.random();
                }
                let url = config.url;
                const async = config.async === false ? false : true;
                const req = new XMLHttpRequest();
                //设置同源策略
                req.withCredentials = config.withCredentials;
                //类型默认为get
                const method = (config.method || 'GET').toUpperCase();
                //超时，同步时不能设置
                req.timeout = async ? config.timeout : 0;
                req.onload = () => {
                    //正常返回处理
                    if (req.status === 200) {
                        let r = req.responseText;
                        if (config.type === 'json') {
                            try {
                                r = JSON.parse(r);
                            }
                            catch (e) {
                                reject({ type: "jsonparse" });
                            }
                        }
                        resolve(r);
                    }
                    else { //异常返回处理
                        reject({ type: 'error', url: url });
                    }
                };
                //设置timeout和error
                req.ontimeout = () => reject({ type: 'timeout' });
                req.onerror = () => reject({ type: 'error', url: url });
                //上传数据
                let data = null;
                switch (method) {
                    case 'GET':
                        //参数
                        let pa;
                        if (Util.isObject(config.params)) {
                            const ar = [];
                            for (const k of Object.keys(config.params)) {
                                let v = config.params[k];
                                if (v === undefined || v === null) {
                                    continue;
                                }
                                //对象转串
                                if (typeof v === 'object') {
                                    v = JSON.stringify(v);
                                }
                                ar.push(k + '=' + v);
                            }
                            pa = ar.join('&');
                        }
                        if (pa !== undefined) {
                            if (url.indexOf('?') !== -1) {
                                url += '&' + pa;
                            }
                            else {
                                url += '?' + pa;
                            }
                        }
                        break;
                    case 'POST':
                        if (config.params instanceof FormData) {
                            data = config.params;
                        }
                        else {
                            const fd = new FormData();
                            for (const k of Object.keys(config.params)) {
                                let v = config.params[k];
                                if (v === undefined || v === null) {
                                    continue;
                                }
                                if (typeof v === 'object') {
                                    v = JSON.stringify(v);
                                }
                                //对象转串
                                fd.append(k, v);
                            }
                            data = fd;
                        }
                        break;
                }
                //打开请求
                req.open(method, url, async, config.user, config.pwd);
                //设置request header
                if (config.header) {
                    Util.getOwnProps(config.header).forEach((item) => {
                        req.setRequestHeader(item, config.header[item]);
                    });
                }
                //发送请求
                req.send(data);
            }).catch((re) => {
                switch (re.type) {
                    case "error":
                        throw new NError("notexist1", NodomMessage.TipWords['resource'], re.url);
                    case "timeout":
                        throw new NError("timeout");
                    case "jsonparse":
                        throw new NError("jsonparse");
                }
            });
        });
    }
    /**
     * 清除超时的缓存请求
     */
    static clearCache() {
        const time = Date.now();
        if (this.rejectReqTick > 0) {
            if (this.requestMap) {
                for (const kv of this.requestMap) {
                    if (time - kv[1]['time'] > this.rejectReqTick) {
                        this.requestMap.delete(kv[0]);
                    }
                }
            }
        }
    }
}
/**
 * 拒绝相同请求（url，参数）时间间隔
 */
RequestManager.rejectReqTick = 0;
/**
 * 请求map，用于缓存之前的请求url和参数
 * key:     url
 * value:   请求参数
 */
RequestManager.requestMap = new Map();

/**
 * 路由类
 */
class Route {
    /**
     * 构造器
     * @param config - 路由配置项
     */
    constructor(config, parent) {
        /**
         * 路由参数名数组
         */
        this.params = [];
        /**
         * 路由参数数据
         */
        this.data = {};
        /**
         * 子路由
         */
        this.children = [];
        if (!config || Util.isEmpty(config.path)) {
            return;
        }
        this.id = Util.genId();
        //参数赋值
        for (const o of Object.keys(config)) {
            this[o] = config[o];
        }
        this.parent = parent;
        //解析路径
        if (this.path) {
            this.parse();
        }
        if (parent) {
            parent.addChild(this);
        }
        //子路由
        if (config.routes && Array.isArray(config.routes)) {
            config.routes.forEach((item) => {
                new Route(item, this);
            });
        }
    }
    /**
     * 添加子路由
     * @param child - 字路由
     */
    addChild(child) {
        this.children.push(child);
        child.parent = this;
    }
    /**
     * 通过路径解析路由对象
     */
    parse() {
        const pathArr = this.path.split('/');
        let node = this.parent;
        let param = [];
        let paramIndex = -1; //最后一个参数开始
        let prePath = ''; //前置路径
        for (let i = 0; i < pathArr.length; i++) {
            const v = pathArr[i].trim();
            if (v === '') {
                pathArr.splice(i--, 1);
                continue;
            }
            if (v.startsWith(':')) { //参数
                if (param.length === 0) {
                    paramIndex = i;
                }
                param.push(v.substring(1));
            }
            else {
                paramIndex = -1;
                param = []; //上级路由的参数清空
                this.path = v; //暂存path
                let j = 0;
                for (; j < node.children.length; j++) {
                    const r = node.children[j];
                    if (r.path === v) {
                        node = r;
                        break;
                    }
                }
                //没找到，创建新节点
                if (j === node.children.length) {
                    if (prePath !== '') {
                        new Route({ path: prePath }, node);
                        node = node.children[node.children.length - 1];
                    }
                    prePath = v;
                }
            }
            //不存在参数
            this.params = paramIndex === -1 ? [] : param;
        }
    }
    /**
     * 克隆
     * @returns 克隆对象
     */
    clone() {
        const r = new Route();
        Object.getOwnPropertyNames(this).forEach(item => {
            if (item === 'data') {
                return;
            }
            r[item] = this[item];
        });
        if (this.data) {
            r.data = Util.clone(this.data);
        }
        return r;
    }
}

let NodomMessage = NodomMessage_zh;
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
    }
    static setLang(lang) {
        switch (lang || "zh") {
            case "zh":
                NodomMessage = NodomMessage_zh;
                break;
            case "en":
                NodomMessage = NodomMessage_en;
                break;
        }
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
        const mainHotId = normalizeHotId$1(main.getHotId());
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
                    && normalizeHotId$1(child.getHotId()) === target.hotId;
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
        const hotId = normalizeHotId$1((_a = module.getHotId) === null || _a === void 0 ? void 0 : _a.call(module));
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
            const hotId = normalizeHotId$1(file);
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
function normalizeHotId$1(hotId) {
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
        this.message = Util.compileStr(msg, params);
    }
}

/**
 * 表达式类
 * @remarks
 * 表达式中的特殊符号
 *
 *  this:指向渲染的module
 *
 *  $model:指向当前dom的model
 */
class Expression {
    /**
     * @param exprStr -	表达式串
     */
    constructor(exprStr) {
        this.id = Util.genId();
        if (!exprStr || (exprStr = exprStr.trim()) === '') {
            return;
        }
        if (Nodom.isDebug) {
            this.exprStr = exprStr;
        }
        const funStr = this.compile(exprStr);
        this.execFunc = new Function('$model', 'return ' + funStr);
    }
    /**
     * 编译表达式串，替换字段和方法
     * @param exprStr -   表达式串
     * @returns         编译后的表达式串
     */
    compile(exprStr) {
        //字符串，object key，有效命名(函数或字段)
        const reg = /('[\s\S]*?')|("[\s\S]*?")|(`[\s\S]*?`)|([a-zA-Z$_][\w$]*\s*?:)|((\.{3}|\.)?[a-zA-Z$_][\w$]*(\.[a-zA-Z$_][\w$]*)*(\s*[\[\(](\s*\))?)?)/g;
        let r;
        let retS = '';
        let index = 0; //当前位置
        while ((r = reg.exec(exprStr)) !== null) {
            let s = r[0];
            if (index < r.index) {
                retS += exprStr.substring(index, r.index);
            }
            if (s[0] === "'" || s[0] === '"' || s[0] === '`') { //字符串
                retS += s;
            }
            else {
                const lch = s[s.length - 1];
                if (lch === ':') { //object key
                    retS += s;
                }
                else if (lch === '(' || lch === ')') { //函数，非内部函数
                    retS += handleFunc(s);
                }
                else { //字段 this $model .field等不做处理
                    if (s.startsWith('this.')
                        || Util.isKeyWord(s)
                        || (s[0] === '.' && s[1] !== '.')
                        || s === '$model') { //非model属性
                        retS += s;
                    }
                    else { //model属性
                        let s1 = '';
                        if (s.startsWith('...')) { // ...属性名
                            s1 = '...';
                            s = s.substring(3);
                        }
                        retS += s1 + '$model.' + s;
                    }
                }
            }
            index = reg.lastIndex;
        }
        if (index < exprStr.length) {
            retS += exprStr.substring(index);
        }
        return retS;
        /**
         * 处理函数串
         * @param str -   源串
         * @returns     处理后的串
         */
        function handleFunc(str) {
            //去除空格
            str = str.replace(/\s+/g, '');
            const ind1 = str.lastIndexOf('(');
            const ind2 = str.indexOf('.');
            //第一段
            const fn1 = (ind2 !== -1 ? str.substring(0, ind2) : str.substring(0, ind1));
            //函数名带 .
            if (ind2 !== -1) {
                return str;
            }
            if (ind2 === -1) {
                let s = "this.invokeMethod('" + fn1 + "'";
                s += str[str.length - 1] !== ')' ? ',' : ')';
                return s;
            }
            return '$model.' + str;
        }
    }
    /**
     * 表达式计算
     * @param module -  模块
     * @param model - 	模型
     * @returns 		计算结果
     */
    val(module, model) {
        if (!this.execFunc) {
            return;
        }
        let v;
        try {
            v = this.execFunc.call(module, model);
        }
        catch (e) {
            if (Nodom.isDebug) {
                console.error(new NError("wrongExpression", this.exprStr).message);
                console.error(e);
            }
        }
        return v;
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
     * @param module -  模块
     * @param dom -     虚拟dom
     * @returns         如果是styledom，则返回true，否则返回false
     */
    static handleStyleDom(module, dom) {
        if (dom.props['scope'] === 'this') {
            let root;
            //找到根节点
            for (root = dom.parent; root === null || root === void 0 ? void 0 : root.parent; root = root.parent)
                ;
            const cls = this.cssPreName + module.id;
            if (root.props['class']) {
                root.props['class'] = root.props['class'] + ' ' + cls;
            }
            else {
                root.props['class'] = cls;
            }
        }
    }
    /**
     * 处理 style 下的文本元素
     * @param module -  模块
     * @param dom -     style text element
     * @returns         如果是styleTextdom返回true，否则返回false
     */
    static handleStyleTextDom(module, dom) {
        if (!dom.parent || dom.parent.tagName !== 'style') {
            return false;
        }
        //scope=this，在模块根节点添加 限定 class
        CssManager.addRules(module, dom.textContent, dom.parent && dom.parent.props['scope'] === 'this' ? '.' + this.cssPreName + module.id : undefined);
        return true;
    }
    /**
     * 添加多个css rule
     * @param cssText -     rule集合
     * @param module -      模块
     * @param scopeName -   作用域名(前置选择器)
     */
    static addRules(module, cssText, scopeName) {
        //sheet 初始化
        if (!this.sheet) {
            //safari不支持 cssstylesheet constructor，用 style代替
            const sheet = document.createElement('style');
            document.head.appendChild(sheet);
            this.sheet = document.styleSheets[0];
        }
        //如果有作用域，则清除作用域下的rule
        if (scopeName) {
            this.clearModuleRules(module);
        }
        //是否限定在模块内
        //cssRule 获取正则式  @import
        const reg = /(@[a-zA-Z]+\s+url\(.+?\))|([.#@a-zA-Z]\S*(\s*\S*\s*?)?{)|\}/g;
        //import support url正则式
        const regImp = /@[a-zA-Z]+\s+url/;
        // keyframe font page support... 开始 位置
        let startIndex = -1;
        // { 个数，遇到 } -1 
        let beginNum = 0;
        let re;
        while ((re = reg.exec(cssText)) !== null) {
            if (regImp.test(re[0])) { //@import
                handleImport(re[0]);
            }
            else if (re[0] === '}') { //回收括号，单个样式结束判断
                if (startIndex >= 0 && --beginNum <= 0) { //style @ end
                    const txt = cssText.substring(startIndex, re.index + 1);
                    if (txt[0] === '@') { //@开头
                        this.sheet.insertRule(txt, CssManager.sheet.cssRules ? CssManager.sheet.cssRules.length : 0);
                    }
                    else { //style
                        handleStyle(module, txt, scopeName);
                    }
                    startIndex = -1;
                    beginNum = 0;
                }
            }
            else { //style 或 @内部
                if (startIndex === -1) {
                    startIndex = re.index;
                }
                beginNum++;
            }
        }
        /**
         * 处理style rule
         * @param module -      模块
         * @param cssText -     css 文本
         * @param scopeName -   作用域名(前置选择器)
         */
        function handleStyle(module, cssText, scopeName) {
            const reg = /.+(?=\{)/; //匹配字符"{"前出现的所有字符
            const r = reg.exec(cssText);
            if (!r) {
                return;
            }
            // 保存样式名，在模块 object manager 中以数组存储
            if (scopeName) {
                let arr = module.cssRules;
                if (!arr) {
                    arr = [];
                    module.cssRules = arr;
                }
                arr.push((scopeName + ' ' + r[0]));
                //为样式添加 scope name
                cssText = scopeName + ' ' + cssText;
            }
            //加入到样式表
            CssManager.sheet.insertRule(cssText, CssManager.sheet.cssRules ? CssManager.sheet.cssRules.length : 0);
        }
        /**
         * 处理import rule
         * @param cssText - css文本
         * @returns         如果cssText中"()"内有字符串且importMap中存在键值为"()"内字符串的第一个字符，则返回void
         */
        function handleImport(cssText) {
            const ind = cssText.indexOf('(');
            const ind1 = cssText.lastIndexOf(')');
            if (ind === -1 || ind1 === -1 || ind >= ind1) {
                return;
            }
            const css = cssText.substring(ind + 1, ind1);
            if (CssManager.importMap.has(css)) {
                return;
            }
            //插入import rule
            CssManager.sheet.insertRule(cssText, CssManager.importIndex++);
            CssManager.importMap.set(css, true);
        }
    }
    /**
     * 清除模块css rules
     * @param module -  模块
     */
    static clearModuleRules(module) {
        const rules = module.cssRules;
        if (!rules || rules.length === 0) {
            return;
        }
        //从sheet清除
        for (let i = 0; i < this.sheet.cssRules.length; i++) {
            const r = this.sheet.cssRules[i];
            if (r.selectorText && rules.indexOf(r.selectorText) !== -1) {
                this.sheet.deleteRule(i--);
            }
        }
        //置空cache
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
CssManager.cssPreName = '___nodom_module_css_';

/**
 * 渲染器
 * @remarks
 * nodom渲染操作在渲染器中实现
 */
class Renderer {
    /**
     * 设置根容器
     * @param rootEl - 根html element
     */
    static setRootEl(rootEl) {
        this.rootEl = rootEl;
    }
    /**
     * 获取根容器
     * @returns 根 html element
     */
    static getRootEl() {
        return this.rootEl;
    }
    /**
     * 添加到渲染列表
     * @param module - 模块
     */
    static add(module) {
        if (!module) {
            return;
        }
        //如果已经在列表中，不再添加
        if (!this.waitList.includes(module.id)) {
            //计算优先级
            this.waitList.push(module.id);
        }
    }
    /**
     * 从渲染队列移除
     * @param module -  模块
     */
    static remove(module) {
        let index;
        if ((index = this.waitList.indexOf(module.id)) !== -1) {
            //不能破坏watiList顺序，用null替换
            this.waitList.splice(index, 1, null);
        }
    }
    /**
     * 渲染
     * @remarks
     * 如果存在渲染队列，则从队列中取出并依次渲染
     */
    static render() {
        for (; this.waitList.length > 0;) {
            const id = this.waitList[0];
            if (id) { //存在id为null情况，remove方法造成
                const m = ModuleFactory.get(id);
                m === null || m === void 0 ? void 0 : m.render();
            }
            //渲染后移除
            this.waitList.shift();
        }
    }
    /**
     * flush pending render queue synchronously
     * @param maxRounds - max render rounds
     */
    static flush(maxRounds = 20) {
        let rounds = 0;
        while (this.waitList.length > 0 && rounds < maxRounds) {
            this.render();
            rounds++;
        }
    }
    /**
     * 渲染dom
     * @remarks
     * 此过程将VirtualDom转换为RenderedDom。
     * 当对单个节点进行更新渲染时，可避免整个模块的渲染，这种方式适用于组件、指令等编码过程使用。
     * @param module -          模块
     * @param src -             源dom
     * @param model -           模型
     * @param parent -          父dom
     * @param key -             附加key，放在domkey的后面
     * @param notRenderChild -  不渲染子节点
     * @returns                 渲染后节点
     */
    static renderDom(module, src, model, parent, key, notRenderChild) {
        //初始化渲染节点
        const dst = {
            key: key ? src.key + '_' + key : src.key,
            model: model,
            vdom: src,
            parent: parent,
            moduleId: src.moduleId,
            slotModuleId: src.slotModuleId,
            staticNum: src.staticNum
        };
        //静态节点只渲染1次
        if (src.staticNum > 0) {
            src.staticNum--;
        }
        //源模块（编译模板时产生的模块）
        //表达式不能用module，因为涉及到方法调用时，必须用srcModule
        const srcModule = ModuleFactory.get(dst.moduleId);
        //标签
        if (src.tagName) {
            dst.tagName = src.tagName;
            //字节点map
            dst.locMap = new Map();
            //添加key属性
            dst.props = {};
            //设置svg标志
            if (src.isSvg) {
                dst.isSvg = src.isSvg;
            }
        }
        //处理model指令
        const mdlDir = src.getDirective('model');
        if (mdlDir) {
            mdlDir.exec(module, dst);
        }
        if (dst.tagName) { //标签节点
            this.handleProps(module, src, dst, srcModule);
            //处理style标签，如果为style，则不处理assets
            if (src.tagName === 'style') {
                CssManager.handleStyleDom(module, dst);
            }
            else if (src.assets && src.assets.size > 0) {
                dst.assets || (dst.assets = {});
                for (const p of src.assets) {
                    dst.assets[p[0]] = p[1];
                }
            }
            //处理directive时，导致禁止后续渲染，则不再渲染，如show指令
            if (!this.handleDirectives(module, src, dst)) {
                return null;
            }
            //非子模块节点，处理事件
            if (src.events) {
                dst.events || (dst.events = []);
                for (const ev of src.events) {
                    dst.events.push(ev);
                }
            }
            //子节点渲染
            if (!notRenderChild) {
                if (src.children && src.children.length > 0) {
                    dst.children = [];
                    for (const c of src.children) {
                        this.renderDom(module, c, dst.model, dst, key);
                    }
                }
            }
        }
        else { //文本节点
            if (src.expressions) { //文本节点
                let value = '';
                for (const expr of src.expressions) {
                    if (expr instanceof Expression) { //处理表达式
                        const v1 = expr.val(srcModule, dst.model);
                        value += v1 !== undefined && v1 !== null ? v1 : '';
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
        }
        //添加到dom tree，必须放在handleDirectives后，因为有可能directive执行后返回false
        if (parent) {
            if (!parent.children) {
                parent.children = [];
            }
            //添加到childMap
            parent.locMap.set(dst.key, parent.children.length);
            //添加到children树组
            parent.children.push(dst);
        }
        return dst;
    }
    /**
     * 处理指令
     * @param module -  模块
     * @param src -     编译节点
     * @param dst -     渲染节点
     * @returns         true继续执行，false不执行后续渲染代码，也不加入渲染树
    */
    static handleDirectives(module, src, dst) {
        if (!src.directives || src.directives.length === 0) {
            return true;
        }
        for (const d of src.directives) {
            //model指令不执行
            if (d.type.name === 'model') {
                continue;
            }
            if (!d.exec(module, dst)) {
                return false;
            }
        }
        return true;
    }
    /**
     * 处理属性
     * @param module -      模块
     * @param src -         编译节点
     * @param dst -         渲染节点
     * @param srcModule -   源模块
     */
    static handleProps(module, src, dst, srcModule) {
        var _a;
        if (((_a = src.props) === null || _a === void 0 ? void 0 : _a.size) > 0) {
            for (const k of src.props) {
                const v = k[1] instanceof Expression ? k[1].val(srcModule, dst.model) : k[1];
                dst.props[k[0]] = handleValue(v);
            }
        }
        //如果为子模块，则合并srcDom属性
        if (src.key === 1) {
            mergeProps(module, dst);
        }
        /**
         * 对空value进行处理
         * @param v -   待处理value
         * @returns     空字符串或原value
         */
        function handleValue(v) {
            // 属性值为空，则设置为''
            return (v === undefined || v === null || v === '' || typeof v === 'string' && v.trim() === '') ? '' : v;
        }
        /**
         * 处理根节点属性
         * @param module -  所属模块
         * @param dom -     dom节点
         */
        function mergeProps(module, dom) {
            var _a;
            if (module.props) {
                for (const k of Object.keys(module.props)) {
                    let value = dom.props[k];
                    if ((_a = module.excludedProps) === null || _a === void 0 ? void 0 : _a.includes(k)) {
                        continue;
                    }
                    let v = module.props[k];
                    if (v) {
                        if (typeof v === 'string') {
                            v = v.trim();
                        }
                        //合并style  props.style + dst.style
                        if ('style' === k) {
                            if (!value) {
                                value = v;
                            }
                            else {
                                value = (v + ';' + value).replace(/;{2,}/g, ';');
                            }
                        }
                        else if ('class' === k) { //合并class,dst.class + props.class 
                            if (!value) {
                                value = v;
                            }
                            else {
                                value += ' ' + v;
                            }
                        }
                        else if (!value) { //其他情况，如果不存在dst.props[k]，则直接用module.props[k]
                            value = v;
                        }
                    }
                    dom.props[k] = handleValue(value);
                }
            }
        }
    }
    /**
     * 更新到html树
     * @param module -  模块
     * @param dom -     渲染节点
     * @param oldDom -  旧节点
     * @returns         渲染后的节点
     */
    static updateToHtml(module, dom, oldDom) {
        var _a;
        const el = oldDom.node;
        if (!el) {
            dom.node = this.renderToHtml(module, dom, (_a = oldDom.parent) === null || _a === void 0 ? void 0 : _a.node);
            return dom.node;
        }
        else if (dom.tagName) { //html dom节点已存在
            //设置element key属性
            for (const prop of ['props', 'assets']) {
                const old = oldDom[prop];
                //设置属性
                if (dom[prop]) {
                    for (const k of Object.keys(dom[prop])) {
                        const pv = dom[prop][k];
                        if (prop === 'props') { //attribute
                            el.setAttribute(k, pv);
                        }
                        else { //asset
                            el[k] = pv;
                        }
                        //删除旧节点对应k
                        if (old) {
                            delete old[k];
                        }
                    }
                }
                //清理多余属性
                if (old) {
                    const keys = Object.keys(old);
                    if (keys.length > 0) {
                        for (const k of keys) {
                            if (prop === 'props') { //attribute
                                el.removeAttribute(k);
                            }
                            else { //asset
                                el[k] = null;
                            }
                        }
                    }
                }
            }
            //删除旧事件
            // module.eventFactory.removeEvent(dom);
            //绑定事件
            module.eventFactory.handleDomEvent(dom, oldDom);
        }
        else { //文本节点
            el['textContent'] = dom.textContent;
        }
        return el;
    }
    /**
     * 渲染到html树
     * @param module - 	        模块
     * @param src -             渲染节点
     * @param parentEl - 	    父html
     * @returns                 渲染后的html节点
     */
    static renderToHtml(module, src, parentEl) {
        let el;
        if (src.tagName) {
            el = newEl(src);
        }
        else {
            el = newText(src);
        }
        // element、渲染子节点且不为子模块，处理子节点
        if (el && src.tagName && !src.childModuleId) {
            genSub(el, src);
        }
        if (el && parentEl) {
            parentEl.appendChild(el);
        }
        return el;
        /**
         * 新建element节点
         * @param dom - 	虚拟dom
         * @returns 		新的html element
         */
        function newEl(dom) {
            let el;
            // 子模块自行渲染
            if (dom.childModuleId) {
                const m = ModuleFactory.get(dom.childModuleId);
                //创建替代节点
                if (m) {
                    const comment = document.createComment("module " + m.constructor.name + ':' + m.id);
                    Renderer.add(m);
                    dom.node = comment;
                    return comment;
                }
                return;
            }
            //style，只处理文本节点
            if (dom.tagName === 'style') {
                genSub(el, dom);
                return;
            }
            //处理svg节点
            if (dom.isSvg) {
                el = document.createElementNS("http://www.w3.org/2000/svg", dom.tagName);
                if (dom.tagName === 'svg') {
                    el.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
                }
            }
            else { //普通节点
                el = document.createElement(dom.tagName);
            }
            //保存element
            dom.node = el;
            //设置属性
            for (const p of Object.keys(dom.props)) {
                el.setAttribute(p, dom.props[p]);
            }
            //asset
            if (dom.assets) {
                for (const p of Object.keys(dom.assets)) {
                    el[p] = dom.assets[p];
                }
            }
            module.eventFactory.handleDomEvent(dom);
            return el;
        }
        /**
         * 新建文本节点
         */
        function newText(dom) {
            //样式表处理，如果是样式表文本，则不添加到dom树
            if (CssManager.handleStyleTextDom(module, dom)) {
                return;
            }
            dom.node = document.createTextNode(dom.textContent || '');
            return dom.node;
        }
        /**
         * 生成子节点
         * @param pEl -     父节点
         * @param dom -     dom节点
         */
        function genSub(pEl, dom) {
            if (dom.children && dom.children.length > 0) {
                dom.children.forEach(item => {
                    let el1;
                    if (item.tagName) {
                        el1 = newEl(item);
                        //element节点，产生子节点
                        if (el1 instanceof Element) {
                            genSub(el1, item);
                        }
                    }
                    else {
                        el1 = newText(item);
                    }
                    if (el1) {
                        pEl.appendChild(el1);
                    }
                });
            }
        }
    }
    /**
     * 处理更改的dom节点
     * @param module -        待处理模块
     * @param changeDoms -    修改后的dom节点数组
     */
    static handleChangedDoms(module, changeDoms) {
        const slotDoms = {};
        //替换数组
        const repArr = [];
        //添加或移动节点
        const addOrMove = [];
        //保留原有html节点
        for (const item of changeDoms) {
            //如果为slot节点，则记录，单独处理
            if (item[1].slotModuleId && item[1].slotModuleId !== module.id) {
                if (slotDoms[item[1].slotModuleId]) {
                    slotDoms[item[1].slotModuleId].push(item);
                }
                else {
                    slotDoms[item[1].slotModuleId] = [item];
                }
                continue;
            }
            switch (item[0]) {
                case 1: //添加
                    addOrMove.push(item);
                    break;
                case 2: //修改
                    //子模块不处理，由setProps处理
                    if (item[1].childModuleId) {
                        Renderer.add(ModuleFactory.get(item[1].childModuleId));
                    }
                    else {
                        this.updateToHtml(module, item[1], item[2]);
                    }
                    break;
                case 3: //删除
                    module.domManager.freeNode(item[1], true);
                    break;
                case 4: //移动
                    addOrMove.push(item);
                    break;
                default: //替换
                    repArr.push(item);
            }
        }
        //替换
        if (repArr.length > 0) {
            for (const item of repArr) {
                this.replace(module, item[1], item[2]);
            }
        }
        if (addOrMove.length > 1) {
            addOrMove.sort((a, b) => a[4] > b[4] ? 1 : -1);
        }
        for (; addOrMove.length > 0;) {
            const item = addOrMove[0];
            const pEl = item[3].node;
            if (!pEl) {
                continue;
            }
            //如果为add，则新建节点，否则直接取旧节点
            const n1 = item[0] === 1 ? Renderer.renderToHtml(module, item[1], null) : item[1].node;
            if (n1) {
                let index = item[4];
                //检查 目标位置 > item[4]且 原位置 < item[4] 的兄弟节点，此类节点后续要移走，会影响节点位置，需要在当前
                const arr = addOrMove.filter(ii => ii[0] === 4 && ii[3].node === pEl && ii[4] >= item[4] && ii[5] < item[4]);
                index += arr.length;
                moveNode2Loc(n1, pEl, index);
            }
            //首节点处理后移除
            addOrMove.shift();
        }
        //处理slot节点改变后影响的子模块
        const keys = Object.keys(slotDoms);
        if (keys && keys.length > 0) {
            for (const k of keys) {
                const m = ModuleFactory.get(parseInt(k));
                if (m) {
                    Renderer.add(m);
                }
            }
        }
        /**
         * 移动节点到指定位置
         * @param node -    待插入节点
         * @param pEl -     父节点
         * @param loc -     位置
         */
        function moveNode2Loc(node, pEl, loc) {
            const mdl = findMdlNode(node);
            let findLoc = false;
            for (let i = 0, index = 0; i < pEl.childNodes.length; i++, index++) {
                const c = pEl.childNodes[i];
                //子模块占位符和模块算一个计数位置
                if (findMdlNode(c) !== null) {
                    i++;
                }
                //找到插入位置
                if (index === loc) {
                    if (mdl === null) {
                        pEl.insertBefore(node, c);
                    }
                    else { //占位符和模块一并移动
                        pEl.insertBefore(mdl, c);
                        pEl.insertBefore(node, mdl);
                    }
                    findLoc = true;
                    break;
                }
            }
            //只能作为pEl的最后节点
            if (!findLoc) {
                if (mdl === null) {
                    pEl.appendChild(node);
                }
                else {
                    pEl.appendChild(node);
                    pEl.appendChild(mdl);
                }
            }
        }
        /**
         * 找到注释节点对应的子模块节点
         * @param node      注释节点
         * @returns         注释节点对应的子模块节点或null
         */
        function findMdlNode(node) {
            return node && node instanceof Comment && node.nextSibling && node.nextSibling instanceof Element
                && node.textContent.endsWith(node.nextSibling.getAttribute('role')) ? node.nextSibling : null;
        }
    }
    /**
     * 替换节点
     * @param module -  模块
     * @param src -     待替换节点
     * @param dst -     被替换节点
     */
    static replace(module, src, dst) {
        var _a, _b;
        const el = this.renderToHtml(module, src, null);
        if (dst.childModuleId) { //被替换节点为子模块
            const m1 = ModuleFactory.get(dst.childModuleId);
            const pEl = (_a = m1.srcDom.node) === null || _a === void 0 ? void 0 : _a.parentElement;
            if (!pEl) {
                return;
            }
            const el1 = m1.srcDom.node.previousSibling;
            m1.destroy();
            if (el1) {
                Util.insertAfter(el, el1);
            }
            else if (pEl.childNodes.length === 0) {
                pEl.appendChild(el);
            }
            else {
                pEl.insertBefore(el, pEl.childNodes[0]);
            }
        }
        else {
            const pEl = (_b = dst.node) === null || _b === void 0 ? void 0 : _b.parentElement;
            if (!pEl) {
                return;
            }
            pEl.replaceChild(el, dst.node);
            module.domManager.freeNode(dst, true);
        }
    }
}
/**
 * 等待渲染列表
 */
Renderer.waitList = [];

/**
 * 调度器
 * @remarks
 * 管理所有需调度的任务并进行循环调度，默认采用requestAnimationFrame方式进行循环
 */
class Scheduler {
    /**
     * 执行任务
     */
    static dispatch() {
        Scheduler.tasks.forEach((item) => {
            if (Util.isFunction(item['func'])) {
                if (item['thiser']) {
                    item['func'].call(item['thiser']);
                }
                else {
                    item['func']();
                }
            }
        });
    }
    /**
     * 启动调度器
     * @param scheduleTick - 	渲染间隔（ms），默认50ms
     */
    static start(scheduleTick) {
        if (Scheduler.started) {
            return;
        }
        Scheduler.started = true;
        const tick = () => {
            Scheduler.dispatch();
            if (window.requestAnimationFrame) {
                window.requestAnimationFrame(tick);
            }
            else {
                window.setTimeout(tick, scheduleTick || 50);
            }
        };
        tick();
    }
    /**
     * 添加任务
     * @param foo - 	待执行任务函数
     * @param thiser - 	this指向
     */
    static addTask(foo, thiser) {
        if (!Util.isFunction(foo)) {
            throw new NError("invoke", "Scheduler.addTask", "0", "function");
        }
        if (Scheduler.tasks.some(item => item.func === foo && item.thiser === thiser)) {
            return;
        }
        Scheduler.tasks.push({ func: foo, thiser: thiser });
    }
    /**
     * 移除任务
     * @param foo - 	任务函数
     */
    static removeTask(foo, thiser) {
        if (!Util.isFunction(foo)) {
            throw new NError("invoke", "Scheduler.removeTask", "0", "function");
        }
        const ind = Scheduler.tasks.findIndex(item => item.func === foo && (thiser === undefined || item.thiser === thiser));
        if (ind !== -1) {
            Scheduler.tasks.splice(ind, 1);
        }
    }
}
/**
 * 待执行任务列表
 */
Scheduler.tasks = [];
/**
 * 调度器是否已经启动
 */
Scheduler.started = false;

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
        Scheduler.addTask(RequestManager.clearCache);
        Scheduler.start();
        const module = ModuleFactory.get(this.rootComponent);
        if (module) {
            ModuleFactory.setMain(module);
            module.active();
            this.instance = module;
            this.selector = selector;
        }
        return module;
    }
    unmount() {
        if (this.instance) {
            this.instance.destroy();
            if (Renderer.getRootEl()) {
                Renderer.getRootEl().innerHTML = "";
            }
            if (ModuleFactory.getMain() === this.instance) {
                ModuleFactory.setMain(undefined);
            }
            this.instance = undefined;
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
function defineProps() {
    return useAttrs();
}
function withDefaults(props, defaults) {
    return Object.assign(Object.assign({}, (defaults || {})), (props || {}));
}
function provide(key, value) {
    useRuntimeModule().provide(key, value);
}
function inject(key, defaultValue) {
    return useRuntimeModule().inject(key, defaultValue);
}
const useInject = inject;
function useRouter() {
    return Nodom["$Router"];
}
function useRoute() {
    var _a;
    return (((_a = useRuntimeModule().model) === null || _a === void 0 ? void 0 : _a["$route"]) || {});
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

function nextTick(handler) {
    return Promise.resolve().then(() => __awaiter(this, void 0, void 0, function* () {
        Renderer.flush();
        return handler ? yield handler() : undefined;
    }));
}

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
        if (index) {
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
                        }
                        else if (value.startsWith('"') || value.startsWith("'")) { //字符串
                            value = value.substring(1, value.length - 1);
                        }
                    }
                    if (name.startsWith('x-')) {
                        // 指令
                        this.current.addDirective(new Directive(name.substring(2), value));
                    }
                    else if (name.startsWith('e-')) {
                        this.current.addEvent(new NEvent(this.module, name.substring(2), value));
                    }
                    else {
                        //普通属性
                        this.current.setProp(name, value);
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
            if (index) {
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
        }
        else {
            text.textContent = this.textArr.join('');
        }
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
        if (!isSelfClose) {
            this.handleSlot(dom);
        }
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

/**
 * dom比较器
 */
class DiffTool {
    /**
     * 比较节点
     *
     * @param src -         待比较节点（新树节点）
     * @param dst - 	    被比较节点 (旧树节点)
     * @param changeArr -   增删改的节点数组
     * @returns	            改变的节点数组
     */
    static compare(src, dst) {
        const changeArr = [];
        compare(src, dst);
        return changeArr;
        /**
         * 比较节点
         * @param src -     待比较节点（新节点）
         * @param dst - 	被比较节点 (旧节点)
         */
        function compare(src, dst) {
            //保留node
            src.node = dst.node;
            //设置继续使用标志
            dst['__used'] = true;
            if (!src.tagName) { //文本节点
                if (!dst.tagName) {
                    if ((src.staticNum || dst.staticNum) && src.textContent !== dst.textContent) {
                        addChange(2, src, dst, dst.parent);
                    }
                    else if (src.childModuleId !== dst.childModuleId) { //子模块不同
                        addChange(5, src, dst, dst.parent);
                    }
                }
                else { //节点类型不同，替换
                    addChange(5, src, dst, dst.parent);
                }
            }
            else {
                //节点类型不同或对应的子模块不同，替换
                if ((src.childModuleId || dst.childModuleId) && src.childModuleId !== dst.childModuleId || src.tagName !== dst.tagName) {
                    addChange(5, src, dst, dst.parent);
                }
                else { //节点类型相同，但有一个不是静态节点或为根节点，进行属性比较
                    if ((src.staticNum || dst.staticNum || dst.key === 1) && isChanged(src, dst)) {
                        addChange(2, src, dst, dst.parent);
                    }
                    // 非子模块不比较子节点或者作为slot的子模块
                    compareChildren(src, dst);
                }
            }
        }
        /**
         * 比较子节点
         * @param newNode -     新节点
         * @param oldNode -     旧节点
         */
        function compareChildren(newNode, oldNode) {
            //子节点处理
            if (!newNode.children || newNode.children.length === 0) {
                // 旧节点的子节点全部删除
                if (oldNode.children && oldNode.children.length > 0) {
                    oldNode.children.forEach(item => addChange(3, item, null, oldNode));
                }
            }
            else {
                //全部新加节点
                if (!oldNode.children || oldNode.children.length === 0) {
                    newNode.children.forEach((item, index) => addChange(1, item, null, oldNode, index));
                }
                else { //都有子节点
                    //旧树子节点索引
                    let oldIndex = 0;
                    for (let ii = 0; ii < newNode.children.length; ii++) {
                        const node = newNode.children[ii];
                        //相同序号节点
                        if (oldNode.children[oldIndex] && oldNode.children[oldIndex].key === node.key) {
                            if (oldIndex !== ii) {
                                addChange(4, node, null, oldNode, ii, oldIndex);
                            }
                            compare(node, oldNode.children[oldIndex]);
                        }
                        else {
                            //存在旧节点
                            //如果位置不同，则移动
                            //如果有修改，则修改
                            if (oldNode.locMap.has(node.key)) {
                                const nLoc = newNode.locMap.get(node.key);
                                const oLoc = oldNode.locMap.get(node.key);
                                //移动
                                if (nLoc !== oLoc) {
                                    addChange(4, node, null, oldNode, nLoc, oLoc);
                                    //旧树索引重新定位
                                    oldIndex = oLoc;
                                }
                                // 如果修改则添加到修改树组
                                compare(node, oldNode.children[oLoc]);
                            }
                            else { //新建节点
                                addChange(1, node, null, oldNode, ii);
                            }
                        }
                        //旧树索引后移
                        oldIndex++;
                    }
                    //删除多余节点
                    for (let o of oldNode.children) {
                        if (!o['__used']) {
                            addChange(3, o, dst);
                        }
                    }
                }
            }
        }
        /**
         * 判断节点是否修改
         * @param src - 新树节点
         * @param dst - 旧树节点
         * @returns     true/false
         */
        function isChanged(src, dst) {
            for (const p of ['props', 'assets', 'events']) {
                //属性比较
                if (!src[p] && dst[p] || src[p] && !dst[p]) {
                    return true;
                }
                else if (src[p] && dst[p]) {
                    const keys = Object.keys(src[p]);
                    const keys1 = Object.keys(dst[p]);
                    if (keys.length !== keys1.length) {
                        return true;
                    }
                    else {
                        for (const k of keys) {
                            if (src[p][k] !== dst[p][k]) {
                                return true;
                            }
                        }
                    }
                }
            }
            return false;
        }
        /**
         * 添加到修改数组
         * @param type -    类型 add 1, upd 2,del 3,move 4 ,rep 5
         * @param dom -     目标节点
         * @param dom1 -    相对节点（被替换时有效）
         * @param parent -  父节点
         * @param loc -     添加或移动的目标index
         * @param loc1 -    被移动前位置
         * @returns         changed dom
        */
        function addChange(type, dom, dom1, parent, loc, loc1) {
            const o = [type, dom, dom1, parent, loc, loc1];
            // 被替换的不需要保留node
            if (type === 5) {
                delete dom.node;
            }
            changeArr.push(o);
            return o;
        }
    }
}

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
     * @param node -    虚拟dom节点
     * @param module -  模块
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
 * 事件工厂
 *
 * @remarks
 * 每个模块一个事件工厂，用于管理模块内虚拟dom对应的事件对象
 * 事件配置不支持表达式
 * 代理事件不支持capture和nopopo
 *
 * 当父模块传递事件给子模块时，子模块根节点的参数model为子模块srcDom的model（来源于父模块），根节点自带事件model为子模块model
 * 如果存在传递事件和自带事件，则执行顺序为 1.自带事件 2.传递事件
 * 示例如下：
 * ```ts
 * class M1 extends Module{
 *      template(props){
 *           return `
 *              <button e-click='click1'>${props.title}</button>
 *           `
 *       }
 *       click1(model,dom){
 *           console.log('m1自带事件触发',model,dom);
 *       }
 *   }
 * }
 * class MMain extends Module{
 *      modules=[M1];
 *      template(){
 *          return `
 *              <div>
 *                  <h3>子模块事件测试</h3>
 *                  <p>我是模块main</p>
 *                  <m1 title='aaa' e-click='clickBtn:delg'/>
 *              </div>
 *          `
 *      }
 *      clickBtn(model,dom){
 *          console.log('传递事件',model,dom);
 *      }
 * }
 * ```
 * 当点击按钮时，先执行M1的click1方法，再执行MMain的clickBtn方法，打印的model不相同，dom也不相同
 */
class EventFactory {
    /**
     * 构造器
     * @param module - 模块
     */
    constructor(module) {
        /**
         * 自有事件map
         * key: dom key
         * value: 对象
         * ```json
         * {
         *      eventName:事件名,
         *      controller:用于撤销事件绑定的 abortcontroller
         * }
         * ```
         * 相同eventName可能有多个事件
         */
        this.eventMap = new Map();
        /**
         * 代理事件map
         * key: domkey
         * value: 对象
         * ```json
         * {
         *      eventName:{
         *          controller:abort controller,
         *          events:{
         *              event:事件对象,
         *              dom:渲染节点,
         *              el:dom对应element
         *      }
         * }
         * ```
         * eventName：事件名，如click、mousemove等
         */
        this.delgMap = new Map();
        this.module = module;
    }
    /**
     * 删除事件
     * @param event -     事件对象
     * @param key -       对应dom keys
     */
    addEvent(dom, event) {
        dom.events.push(event);
        if (dom.node) {
            this.bind(dom, [event]);
        }
    }
    /**
     * 删除事件
     * @param dom -     事件对象
     * @param event -   如果没有指定event，则表示移除该节点所有事件
     */
    removeEvent(dom, event) {
        var _a, _b, _c;
        const events = event ? [event] : dom.events;
        if (!events || !Array.isArray(events)) {
            return;
        }
        for (const ev of events) {
            if (ev.delg) { //代理事件
                //为避免key冲突，外部key后面添加s
                const pkey = dom.key === 1 ? ((_b = (_a = this.module.srcDom) === null || _a === void 0 ? void 0 : _a.parent) === null || _b === void 0 ? void 0 : _b.key) + 's' : (_c = dom.parent) === null || _c === void 0 ? void 0 : _c.key;
                //找到父对象
                if (!parent || !this.delgMap.has(pkey)) {
                    return;
                }
                const cfg = this.delgMap.get(dom.parent.key);
                if (!cfg[event.name]) {
                    return;
                }
                const obj = cfg[event.name];
                const index = obj.events.findIndex(item => item.event === event);
                if (index !== -1) {
                    obj.events.splice(index, 1);
                }
                //解绑事件
                if (obj.events.length === 0) {
                    this.unbind(dom.parent.key, event);
                }
            }
            else {
                this.unbind(dom.key, event);
            }
        }
    }
    /**
     * 绑定dom节点所有事件
     * @remarks
     * 执行addEventListener操作
     * @param dom -   渲染dom
     * @param event - 事件对象数组
     */
    bind(dom, events) {
        const el = dom.node;
        for (const ev of events) {
            if (ev.delg) { //代理事件
                //如果为子模块，则取srcDom.parent进行代理
                const parent = dom.key === 1 ? this.module.srcDom.parent : dom.parent;
                if (parent) {
                    this.bindDelg(parent, dom, ev);
                }
            }
            else {
                const controller = new AbortController();
                //绑定事件
                el.addEventListener(ev.name, (e) => {
                    //禁止冒泡
                    if (ev.nopopo) {
                        e.stopPropagation();
                    }
                    this.invoke(ev, dom, e);
                }, {
                    capture: ev.capture,
                    once: ev.once,
                    signal: controller.signal
                });
                //once为true不保存
                if (!ev.once) {
                    const o = { eventName: ev.name, controller: controller };
                    //保存signal用于撤销事件
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
     * @param dom -     代理dom
     * @param dom1 -    被代理dom
     * @param event -   事件对象
     */
    bindDelg(dom, dom1, event) {
        let map;
        //代理dom和被代理dom节点不一致，则需要在key后面添加s
        const pkey = dom.moduleId !== dom1.moduleId ? dom.key + 's' : dom.key;
        if (!this.delgMap.has(dom.key)) {
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
     * @param dom -     渲染dom或dom key
     * @param event -   事件对象或事件名，如果为空，则解绑该dom的所有事件，如果为事件名，则表示代理事件
     * @param delg -    是否为代理事件，默认false
     */
    unbind(key, event, delg) {
        var _a, _b, _c;
        //获取代理标志
        if (event && event instanceof NEvent) {
            delg || (delg = event.delg);
        }
        if (delg) { //代理事件
            if (!this.delgMap.has(key)) {
                return;
            }
            const obj = this.delgMap.get(key);
            if (event) { //清除指定事件
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
     * @param dom -         代理节点
     * @param eventName -   事件名
     * @param e -           html event对象
     */
    doDelgEvent(dom, eventName, e) {
        //代理dom和被代理dom节点不一致，则需要在key后面添加s
        const key = dom.moduleId !== this.module.id ? dom.key + 's' : dom.key;
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
            //被代理的dom
            const dom1 = obj.dom;
            const el = dom1.node;
            for (let i = 0; i < elArr.length && elArr[i] !== dom.node; i++) {
                if (elArr[i] === el) {
                    this.invoke(ev, dom1, e);
                    // 只执行1次,移除事件
                    if (ev.once) {
                        //从当前dom删除
                        cfg.events.splice(ii--, 1);
                        //如果事件为空，则移除绑定的事件
                        if (cfg.events.length === 0) {
                            //解绑代理事件
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
     * @param event -   事件对象
     * @param dom -     渲染节点
     * @param e -       html 事件对象
     */
    invoke(event, dom, e) {
        // 如果事件所属模块和当前模块一致，则用当前dom model，否则表示为从父模块传递的事件，用子模块对应srcDom的model
        let model;
        if (event.module && event.module.id !== this.module.id) {
            model = this.module.srcDom.model;
            dom = this.module.srcDom;
        }
        else {
            //如果事件未更新，则dom还是之前的dom，需要找到最新的dom
            dom = event.module.getRenderedDom(dom.key);
            model = dom.model;
        }
        if (typeof event.handler === 'string') {
            event.module.invokeMethod(event.handler, model, dom, event, e);
        }
        else if (typeof event.handler === 'function') {
            event.handler.apply(event.module || this.module, [model, dom, event, e]);
        }
    }
    /**
     * 清除所有事件
     */
    clear() {
        //清除普通事件
        for (const key of this.eventMap.keys()) {
            this.unbind(key);
        }
        this.eventMap.clear();
        //清除代理事件
        for (const key of this.delgMap.keys()) {
            this.unbind(key, null, true);
        }
        this.delgMap.clear();
    }
    /**
     * 处理dom event
     * @param dom -     新dom
     * @param oldDom -  旧dom，dom进行修改时有效
     */
    handleDomEvent(dom, oldDom) {
        const events = dom.events;
        let arr = [];
        //存在旧节点时，需要对比旧节点事件
        if (oldDom && Array.isArray(oldDom.events)) {
            const oldEvents = oldDom.events;
            if (Array.isArray(events)) {
                events.forEach((ev) => {
                    let index;
                    //如果在旧节点已存在该事件，则从旧事件中移除
                    if ((index = oldEvents.indexOf(ev)) !== -1) {
                        oldEvents.splice(index, 1);
                    }
                    else { //记录未添加事件
                        arr.push(ev);
                    }
                });
            }
            //删除多余事件
            if (oldEvents.length > 0) {
                for (const ev of oldEvents) {
                    this.removeEvent(oldDom, ev);
                }
            }
        }
        else {
            arr = events;
        }
        //处理新节点剩余事件
        if ((arr === null || arr === void 0 ? void 0 : arr.length) > 0) {
            this.bind(dom, arr);
        }
    }
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
     * @returns     值或undefined
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
     * @param key -     键
     * @param value -   值
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
        //处理订阅
        if (this.subscribeMap.has(key1)) {
            const arr = this.subscribeMap.get(key1);
            for (const a of arr) {
                this.invokeSubscribe(a.module, a.handler, value);
            }
        }
    }
    /**
     * 通过提供的键名将其移除
     * @param key -   键
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
     * @param module -    订阅的模块
     * @param key -       订阅的属性名
     * @param handler -   回调函数或方法名（方法属于module），方法传递参数为订阅属性名对应的值
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
        //如果存在值，则执行订阅回调
        const v = this.get(key);
        if (v) {
            this.invokeSubscribe(module, handler, v);
        }
    }
    /**
     * 调用订阅方法
     * @param module -  模块
     * @param foo -     方法或方法名
     * @param v -       值
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

/**
 * 全局缓存
 *
 * @remarks
 * 用于所有模块共享数据，实现模块通信
 */
class GlobalCache {
    /**
     * 保存到cache
     * @param key -     键，支持"."（多级数据分割）
     * @param value -   值
     */
    static set(key, value) {
        this.cache.set(key, value);
    }
    /**
     * 从cache读取
     * @param key - 键，支持"."（多级数据分割）
     * @returns     缓存的值或undefined
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
     * @param module -    订阅的模块
     * @param key -       订阅的属性名
     * @param handler -   回调函数或方法名（方法属于module），方法传递参数为订阅属性名对应的值
     */
    static subscribe(module, key, handler) {
        this.cache.subscribe(module, key, handler);
    }
    /**
     * 从cache移除
     * @param key -   键，支持"."（多级数据分割）
     */
    static remove(key) {
        this.cache.remove(key);
    }
}
/**
 * NCache实例，用于存放缓存对象
 */
GlobalCache.cache = new NCache();

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

/**
 * 模型工厂
 * @remarks
 * 管理模块的model
 */
class ModelManager {
    /**
     * 添加共享model
     * @param model
     * @param modules
     */
    static addShareModel(model, module) {
        if (!this.shareModelMap.has(model)) {
            this.shareModelMap.set(model, [model['__module'], module]);
            return;
        }
        const arr = this.shareModelMap.get(model);
        if (arr.indexOf(module) === -1) {
            arr.push(module);
        }
    }
    /**
     * 获取module
     * @param model -   model
     * @returns         module或module数组（共享时）
     */
    static getModule(model) {
        if (this.shareModelMap.has(model)) {
            return this.shareModelMap.get(model);
        }
        return model['__module'];
    }
    /**
     * 更新model
     * @param model
     * @param key
     * @param oldValue
     * @param newValue
     * @returns
     */
    static update(model, key, oldValue, newValue) {
        if (this.shareModelMap.size > 0) {
            for (let m = model; m; m = m['__parent']) {
                if (this.shareModelMap.has(m)) {
                    for (let mdl of this.shareModelMap.get(m)) {
                        Renderer.add(mdl);
                    }
                    Watcher.handle(model, key, oldValue, newValue);
                    return;
                }
            }
        }
        Renderer.add(model['__module']);
        Watcher.handle(model, key, oldValue, newValue);
    }
    /**
     * 获取model属性值
     * @param key -     属性名，可以分级，如 name.firstName
     * @param model -   模型
     * @returns         属性值
     */
    static get(model, key) {
        if (key) {
            if (key.indexOf('.') !== -1) { //层级字段
                const arr = key.split('.');
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
    /**
     * 设置model属性值
     * @param model -   模型
     * @param key -     属性名，可以分级，如 name.firstName
     * @param value -   属性值
     */
    static set(model, key, value) {
        if (key.includes('.')) { //层级字段
            const arr = key.split('.');
            for (let i = 0; i < arr.length - 1; i++) {
                //不存在，则创建新的model
                if (!model[arr[i]]) {
                    model[arr[i]] = {};
                }
                model = model[arr[i]];
            }
            key = arr[arr.length - 1];
        }
        model[key] = value;
    }
}
/**
 * 共享model，被多个module使用
 *
 */
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
        this.module = module;
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
        if (key) { //删除对应dom的事件参数
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

/**
 * 模块状态类型
 */
var EModuleState;
(function (EModuleState) {
    /**
     * 已初始化
     */
    EModuleState[EModuleState["INIT"] = 1] = "INIT";
    /**
     * 取消挂载
     */
    EModuleState[EModuleState["UNMOUNTED"] = 2] = "UNMOUNTED";
    /**
     * 已挂载到dom树
     */
    EModuleState[EModuleState["MOUNTED"] = 3] = "MOUNTED";
})(EModuleState || (EModuleState = {}));

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
    freeNode(dom, destroy) {
        if (dom.childModuleId) { //子模块
            const m = ModuleFactory.get(dom.childModuleId);
            if (m) {
                destroy ? m.destroy() : m.unmount();
            }
        }
        else { //普通节点
            const el = dom.node;
            //解绑所有事件
            this.module.eventFactory.removeEvent(dom);
            //子节点递归操作
            if (dom.children) {
                for (const d of dom.children) {
                    this.freeNode(d, destroy);
                }
            }
            // 从html移除
            if (el && el.parentElement) {
                el.parentElement.removeChild(el);
            }
        }
        //清除缓存
        const m1 = ModuleFactory.get(dom.moduleId);
        if (m1) {
            m1.objectManager.clearDomParams(dom.key);
        }
    }
}

class Module {
    constructor(id) {
        this.children = [];
        this.slots = new Map();
        this.compositionCleanups = [];
        this.compositionHooks = new Map();
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
            for (const cls of this.modules) {
                ModuleFactory.addClass(cls);
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
        if (templateStr !== this.oldTemplate) {
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
        const root = Renderer.renderDom(this, this.domManager.vdomTree, this.model);
        this.domManager.renderedTree = root;
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
        Renderer.add(this);
    }
    mount() {
        var _a, _b, _c, _d;
        if (this !== ModuleFactory.getMain() && !((_b = (_a = this.srcDom) === null || _a === void 0 ? void 0 : _a.node) === null || _b === void 0 ? void 0 : _b.parentElement)) {
            return;
        }
        this.doModuleEvent('onBeforeMount');
        const rootEl = new DocumentFragment();
        const el = Renderer.renderToHtml(this, this.domManager.renderedTree, rootEl);
        if (this === ModuleFactory.getMain()) {
            Renderer.getRootEl().appendChild(el);
        }
        else if ((_d = (_c = this.srcDom) === null || _c === void 0 ? void 0 : _c.node) === null || _d === void 0 ? void 0 : _d.parentElement) {
            Util.insertAfter(el, this.srcDom.node);
        }
        this.doModuleEvent('onMount');
        this.state = EModuleState.MOUNTED;
    }
    unmount(passive) {
        var _a;
        if (this.state !== EModuleState.MOUNTED || ModuleFactory.getMain() === this) {
            return;
        }
        Renderer.remove(this);
        this.doModuleEvent('onBeforeUnMount');
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
        this.doModuleEvent('onUnMount');
    }
    destroy() {
        var _a, _b, _c;
        Renderer.remove(this);
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
        const foo = this[eventName];
        let result;
        if (foo && typeof foo === 'function') {
            result = foo.apply(this, [this.model]);
        }
        this.runCompositionHooks(eventName);
        return result;
    }
    setProps(props, dom) {
        if (!props) {
            return;
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
                }
            }
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
        const arr = [];
        find(this);
        return arr;
        function find(module) {
            if (!module.children) {
                return;
            }
            for (const m of module.children) {
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
    addCompositionCleanup(cleanup) {
        if (typeof cleanup === 'function') {
            this.compositionCleanups.push(cleanup);
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
    runCompositionHooks(eventName) {
        const hooks = this.compositionHooks.get(eventName);
        if (!hooks || hooks.length === 0) {
            return;
        }
        for (const hook of hooks) {
            hook.apply(this, [this.model]);
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
        return normalizeHotId(hotId);
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
function normalizeHotId(hotId) {
    return typeof hotId === 'string' ? hotId.replace(/\\/g, '/') : '';
}

/**
 * 路由管理类
 */
class Router {
    /**
     * 构造器
     * @param basePath -          路由基础路径，显示的完整路径为 basePath + route.path
     * @param defaultEnter -      默认进入时事件函数，传递参数： module,离开前路径
     * @param defaultLeave -      默认离开时事件函数，传递参数： module,进入时路径
     */
    constructor(basePath, defaultEnter, defaultLeave) {
        /**
         * 根路由
         */
        this.root = new Route();
        /**
         * path等待链表
         */
        this.waitList = [];
        /**
         * 激活Dom map
         * key: path
         * value: object，格式为：
         * ```js
         *  {
         *      moduleId:dom所属模板模块id，
         *      model:对应model,
         *      field:激活字段名
         *  }
         * ```
         */
        // private activeModelMap: Map<string, object> = new Map();
        /**
         * 绑定到module的router指令对应的key，即router容器对应的key，格式为:
         * ```js
         *  {
         *      moduleId1:{
         *          //active节点
         *          activeDoms:[{
         *              dom:节点
         *              name:激活属性名
         *          }],
         *          dom:带router指令的dom节点
         *          //等待路由
         *          wait:route
         *      },
         *      moduleId2:...
         *  }
         * ```
         *  moduleId: router所属模块id
         */
        this.routerMap = new Map();
        this.basePath = basePath;
        this.onDefaultEnter = defaultEnter;
        this.onDefaultLeave = defaultLeave;
        //添加popstate事件
        window.addEventListener('popstate', () => {
            //根据state切换module
            const state = history.state;
            if (!state) {
                return;
            }
            this.startType = 1;
            this.go(state.url);
        });
    }
    /**
     * 跳转
     * @remarks
     * 只是添加到跳转列表，并不会立即进行跳转
     *
     * @param path -    路径
     * @param type -    启动路由类型，参考startType，默认0
     */
    go(path) {
        const me = this;
        // 当前路径的父路径不处理
        if (this.currentPath && this.currentPath.startsWith(path)) {
            return;
        }
        //添加路径到等待列表，已存在，不加入
        if (this.waitList.indexOf(path) === -1) {
            this.waitList.push(path);
        }
        checkRoot();
        /**
         * 检测routemodule是否已经存在，不存在则一致检查，直到出现为止
         */
        function checkRoot() {
            if (!me.rootModule) {
                setTimeout(checkRoot, 0);
            }
            else {
                me.load();
            }
        }
    }
    /**
     * 启动加载
     */
    load() {
        //在加载，或无等待列表，则返回
        if (this.waitList.length === 0) {
            return;
        }
        //从等待队列拿路径加载
        this.start(this.waitList.shift()).then(() => {
            //继续加载
            this.load();
        });
    }
    /**
     * 切换路由
     * @param path - 	路径
     */
    start(path) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            // 当前路径的父路径不处理
            if ((_a = this.currentPath) === null || _a === void 0 ? void 0 : _a.startsWith(path)) {
                return;
            }
            //保存旧path
            const oldPath = this.currentPath;
            //设置当前path
            this.currentPath = path;
            const diff = this.compare(oldPath, path);
            // 不存在上一级模块,则为主模块，否则为上一级模块
            let parentModule = diff[0] === null ? this.rootModule : yield this.getModule(diff[0]);
            //onleave事件，从末往前执行
            for (let i = diff[1].length - 1; i >= 0; i--) {
                const r = diff[1][i];
                if (!r.module) {
                    continue;
                }
                const module = yield this.getModule(r);
                if (Util.isFunction(this.onDefaultLeave)) {
                    this.onDefaultLeave(module, oldPath);
                }
                if (Util.isFunction(r.onLeave)) {
                    r.onLeave(module, oldPath);
                }
                // 取消挂载
                module.unmount();
            }
            if (diff[2].length === 0) { //路由相同，参数不同
                const route = diff[0];
                if (route !== null) {
                    yield this.getModule(route);
                    // 模块处理
                    this.handleRouteModule(route, diff[3] ? diff[3].module : null);
                }
            }
            else { //路由不同
                //加载模块
                for (let ii = 0; ii < diff[2].length; ii++) {
                    const route = diff[2][ii];
                    //路由不存在或路由没有模块（空路由）
                    if (!route || !route.module) {
                        continue;
                    }
                    const module = yield this.getModule(route);
                    // 模块处理
                    this.handleRouteModule(route, parentModule);
                    //默认全局路由enter事件
                    if (Util.isFunction(this.onDefaultEnter)) {
                        this.onDefaultEnter(module, path);
                    }
                    //当前路由进入事件
                    if (Util.isFunction(route.onEnter)) {
                        route.onEnter(module, path);
                    }
                    parentModule = module;
                }
            }
            //如果是history popstate或新路径是当前路径的子路径，则不加入history
            if (this.startType !== 1) {
                const path1 = (this.basePath || '') + path;
                //子路由或父路由，替换state
                if (path.startsWith(oldPath)) {
                    history.replaceState({ url: path1 }, '', path1);
                }
                else { //路径push进history
                    history.pushState({ url: path1 }, '', path1);
                }
            }
            //设置start类型为正常start
            this.startType = 0;
        });
    }
    /**
     * 获取module
     * @param route - 路由对象
     * @returns     路由对应模块
     */
    getModule(route) {
        return __awaiter(this, void 0, void 0, function* () {
            let module = route.module;
            //已经是模块实例
            if (typeof module === 'object') {
                return module;
            }
            //模块路径
            if (typeof module === 'string') {
                module = yield ModuleFactory.load(module);
            }
            //模块类
            if (typeof module === 'function') {
                route.module = ModuleFactory.get(module);
            }
            return route.module;
        });
    }
    /**
     * 比较两个路径对应的路由链
     * @param path1 - 	第一个路径
     * @param path2 - 	第二个路径
     * @returns 		数组 [父路由或不同参数的路由，需要销毁的路由数组，需要增加的路由数组，不同参数路由的父路由]
     */
    compare(path1, path2) {
        // 获取路由id数组
        let arr1 = null;
        let arr2 = null;
        if (path1) {
            //采用克隆方式复制，避免被第二个路径返回的路由覆盖参数
            arr1 = this.getRouteList(path1, true);
        }
        if (path2) {
            arr2 = this.getRouteList(path2);
        }
        let len = 0;
        if (arr1 !== null) {
            len = arr1.length;
        }
        if (arr2 !== null) {
            if (arr2.length < len) {
                len = arr2.length;
            }
        }
        else {
            len = 0;
        }
        //需要销毁的旧路由数组
        let retArr1 = [];
        //需要加入的新路由数组
        let retArr2 = [];
        let i = 0;
        for (i = 0; i < len; i++) {
            //找到不同路由开始位置
            if (arr1[i].id === arr2[i].id) {
                //比较参数
                if (JSON.stringify(arr1[i].data) !== JSON.stringify(arr2[i].data)) {
                    i++;
                    break;
                }
            }
            else {
                break;
            }
        }
        //旧路由改变数组
        if (arr1 !== null) {
            retArr1 = arr1.slice(i);
        }
        //新路由改变数组（相对于旧路由）
        if (arr2 !== null) {
            retArr2 = arr2.slice(i);
        }
        //上一级路由或参数不同的当前路由
        let p1 = null;
        //上二级路由或参数不同路由的上一级路由
        let p2 = null;
        if (arr2 && i > 0) {
            // 可能存在空路由，需要向前遍历
            for (let j = i - 1; j >= 0; j--) {
                if (!p1) {
                    if (arr2[j].module) {
                        p1 = arr2[j];
                        continue;
                    }
                }
                else if (!p2) {
                    if (arr2[j].module) {
                        p2 = arr2[j];
                        break;
                    }
                }
            }
        }
        return [p1, retArr1, retArr2, p2];
    }
    /**
     * 添加激活对象
     * @param moduleId -    模块id
     * @param dom -         可激活节点
     * @param field -       激活字段名
     */
    addActiveDom(module, dom) {
        if (!this.routerMap.has(module.id)) {
            this.routerMap.set(module.id, { activeDoms: [] });
        }
        const cfg = this.routerMap.get(module.id);
        if (!cfg.activeDoms) {
            cfg.activeDoms = [];
        }
        const index = cfg.activeDoms.findIndex(item => item.key === dom.key);
        if (index === -1) {
            cfg.activeDoms.push(dom);
        }
        else { //替换
            cfg.activeDoms.splice(index, 1, dom);
        }
    }
    /**
     * 设置路由元素激活属性
     * @param module -    模块
     * @param path -      路径
     * @returns
     */
    setActiveDom(module, path) {
        if (!this.routerMap.has(module.id)) {
            return;
        }
        const cfg = this.routerMap.get(module.id);
        if (!cfg.activeDoms) {
            return;
        }
        //与path一致的dom，设置其active=true，否则设置为false
        for (const dom of cfg.activeDoms) {
            if (dom.props['path'] === path) {
                dom.model[dom.props['active']] = true;
            }
            else {
                dom.model[dom.props['active']] = false;
            }
        }
    }
    /**
     * 路由模块相关处理
     * @param route -   路由
     * @param pm -      父模块
     */
    handleRouteModule(route, pm) {
        //设置参数
        const o = {
            path: route.path
        };
        if (!Util.isEmpty(route.data)) {
            o['data'] = route.data;
        }
        const module = route.module;
        module.model['$route'] = o;
        if (pm) {
            if (!this.routerMap.has(pm.id)) {
                this.routerMap.set(pm.id, {});
            }
            const cfg = this.routerMap.get(pm.id);
            //父模块router dom尚不存在，则添加到wait
            if (!cfg.dom) {
                cfg.wait = route;
            }
            else {
                this.setActiveDom(pm, route.fullPath);
            }
            this.prepModuleDom(pm, route);
        }
    }
    /**
     * 为route.module设置dom
     * @param module -  父模块
     * @param route -   路由
     */
    prepModuleDom(module, route) {
        var _a;
        if (!this.routerMap.has(module.id)) {
            return;
        }
        const cfg = this.routerMap.get(module.id);
        if (!cfg.dom) {
            return;
        }
        if (!cfg.dom.vdom.children) {
            cfg.dom.vdom.children = [];
        }
        const m = route.module;
        //dom key
        const key = m.id + '_r';
        const dom = (_a = cfg.dom.children) === null || _a === void 0 ? void 0 : _a.find(item => item.key === key);
        if (!dom) {
            const vdom = new VirtualDom('div', key, module);
            const d = new Directive('module');
            d.value = m.id;
            vdom.addDirective(d);
            cfg.dom.vdom.add(vdom);
            module.active();
        }
        else {
            m.srcDom = dom;
            m.active();
        }
    }
    /**
     * 获取路由数组
     * @param path - 	要解析的路径
     * @param clone - 是否clone，如果为false，则返回路由树的路由对象，否则返回克隆对象
     * @returns     路由对象数组
     */
    getRouteList(path, clone) {
        if (!this.root) {
            return [];
        }
        const pathArr = path.split('/');
        let node = this.root;
        let paramIndex = 0; //参数索引
        const retArr = [];
        let fullPath = ''; //完整路径
        let preNode = this.root; //前一个节点
        for (let i = 0; i < pathArr.length; i++) {
            const v = pathArr[i].trim();
            if (v === '') {
                continue;
            }
            let find = false;
            for (let j = 0; j < node.children.length; j++) {
                if (node.children[j].path === v) {
                    //设置完整路径
                    if (preNode !== this.root) {
                        preNode.fullPath = fullPath;
                        preNode.data = node.data;
                        retArr.push(preNode);
                    }
                    //设置新的查找节点
                    node = clone ? node.children[j].clone() : node.children[j];
                    //参数清空
                    node.data = {};
                    preNode = node;
                    find = true;
                    //参数索引置0
                    paramIndex = 0;
                    break;
                }
            }
            //路径叠加
            fullPath += '/' + v;
            //不是孩子节点,作为参数
            if (!find) {
                if (paramIndex < node.params.length) { //超出参数长度的废弃
                    node.data[node.params[paramIndex++]] = v;
                }
            }
        }
        //最后一个节点
        if (node !== this.root) {
            node.fullPath = fullPath;
            retArr.push(node);
        }
        return retArr;
    }
    /**
     * 注册路由容器
     * @param module -      router容器所属模块
     * @param dom -         路由模块 src dom
     */
    registRouter(module, dom) {
        if (!this.rootModule) {
            this.rootModule = module;
        }
        if (!this.routerMap.has(module.id)) {
            this.routerMap.set(module.id, { dom: dom });
        }
        const cfg = this.routerMap.get(module.id);
        cfg.dom = dom;
        //存在待处理路由
        if (cfg.wait) {
            this.prepModuleDom(module, cfg.wait);
            //执行后删除
            delete cfg.wait;
        }
    }
    /**
     * 尝试激活路径
     * @param path -  待激活的路径
     */
    activePath(path) {
        // 如果当前路径为空或待激活路径是当前路径的子路径
        if (!this.currentPath || path.startsWith(this.currentPath)) {
            this.go(path);
        }
    }
    /**
     * 获取根路由
     * @returns     根路由
     */
    getRoot() {
        return this.root;
    }
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
//添加到自定义元素管理器
DefineElementManager.add([MODULE, FOR, RECUR, IF, ELSE, ELSEIF, ENDIF, SHOW, SLOT, ROUTE, ROUTER]);

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
        let m = module.objectManager.getDomParam(dom.key, '$savedModule');
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
            if (!rows[i]) {
                continue;
            }
            if (idxName && typeof rows[i] === 'object') {
                rows[i][idxName] = i;
            }
            const d = Renderer.renderDom(module, src, rows[i], parent, rows[i].__key);
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
                let v = el.value;
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
                    if (!el.checked) {
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
            if (dom.model[acName]) {
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
     * 插头指令
     * 用于模块中，可实现同名替换
     */
    Nodom.createDirective('slot', function (module, dom) {
        var _a;
        this.value || (this.value = 'default');
        const mid = dom.parent.childModuleId;
        //父dom有module指令，表示为替代节点，替换子模块中的对应的slot节点；否则为子模块定义slot节点
        if (mid) {
            const m = ModuleFactory.get(mid);
            //子模块不存在则不处理
            if (!m) {
                return false;
            }
            m.slots.set(this.value, dom);
            dom.slotModuleId = mid;
            //保持key带slot标识
            if (!dom.vdom.slotModuleId) {
                dom.key += 's';
                updateKey(dom.vdom, 's');
            }
            //innerrender，此次不渲染
            if ((_a = dom.vdom.props) === null || _a === void 0 ? void 0 : _a.has('innerrender')) {
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
                        for (let c of sdom.vdom.children) {
                            Renderer.renderDom(module, c, dom.model, dom.parent, dom.key);
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

export { App, Compiler, CssManager, DefineElement, DefineElementManager, DiffTool, Directive, DirectiveManager, DirectiveType, EModuleState, EventFactory, Expression, GlobalCache, Model, ModelManager, Module, ModuleFactory, NCache, NError, NEvent, Nodom, NodomMessage, NodomMessage_en, NodomMessage_zh, Renderer, Route, Router, Scheduler, Util, VirtualDom, bindStateHost, cloneStateValue, computed, configureReactivityRuntime, createApp, createAppContext, defineProps, getCurrentScope, inject, installPlugin, isComputed, isReactive, isRef, nextTick, onBeforeMount, onBeforeRender, onBeforeUnmount, onBeforeUpdate, onInit, onMounted, onRender, onUnmounted, onUpdated, provide, reactive, ref, removeReactiveOwner, shouldSkipModelProxy, toRaw, toValue, track, trigger, unbindStateHost, unref, unwrapState, useApp, useAttrs, useComputed, useInject, useModel, useModule, useProps, useReactive, useRef, useRoute, useRouter, useSlots, useState, useWatch, useWatchEffect, watch, watchEffect, withCurrentScope, withDefaults };
//# sourceMappingURL=nodom.esm.js.map
