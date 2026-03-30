import { createApp as createNodomApp } from "./app";
import { NodomMessage, setRuntimeDebug, setRuntimeLang } from "@nodomx/shared";
import { DirectiveManager } from "@nodomx/runtime-registry";
import { NError } from "@nodomx/shared";
import { ModuleFactory } from "@nodomx/runtime-registry";
import { Renderer } from "@nodomx/runtime-view";
import { RequestManager } from "@nodomx/runtime-scheduler";
import { Route } from "@nodomx/runtime-router";
import { Util } from "@nodomx/shared";
export class Nodom {
    static createApp(clazz, selector) {
        const app = createNodomApp(clazz, selector);
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
            if (plugin["name"] === "Router" && typeof globalThis !== "undefined") {
                globalThis["__NODOMX_ROUTER__"] = this["$" + plugin["name"]];
            }
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
    static async request(config) {
        return await RequestManager.request(config);
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
//# sourceMappingURL=nodom.js.map