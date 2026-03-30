import { Compiler } from "@nodomx/runtime-template";
import { CssManager } from "@nodomx/runtime-view";
import { Model } from "./model";
import { ModuleFactory } from "@nodomx/runtime-registry";
import { ObjectManager } from "./objectmanager";
import { Renderer } from "@nodomx/runtime-view";
import { Util } from "@nodomx/shared";
import { DiffTool } from "@nodomx/runtime-view";
import { EModuleState } from "@nodomx/shared";
import { EventFactory } from "@nodomx/runtime-view";
import { DomManager } from "./dommanager";
import { ModelManager } from "./modelmanager";
import { Watcher } from "./wacher";
import { cloneStateValue, isComputed, isReactive, isRef, toRaw, withCurrentScope } from "@nodomx/reactivity";
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
export class Module {
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
        return normalizeHotId(hotId);
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
function normalizeHotId(hotId) {
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
        hook.notifyUpdate(app, reason, {
            ...details,
            hotId: (_b = module.getHotId) === null || _b === void 0 ? void 0 : _b.call(module)
        });
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
//# sourceMappingURL=module.js.map