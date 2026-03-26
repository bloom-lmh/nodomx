import { App, createApp as createNodomApp, type InjectionKey, type NodomPlugin } from "./app";
import { DirectiveManager } from "./directivemanager";
import { NError } from "./error";
import { NodomMessage_en } from "./locales/msg_en";
import { NodomMessage_zh } from "./locales/msg_zh";
import { Module } from "./module";
import { ModuleFactory } from "./modulefactory";
import { Renderer } from "./renderer";
import { RequestManager } from "./requestmanager";
import { Route } from "./route";
import { Scheduler } from "./scheduler";
import { DirectiveMethod, RouteCfg, UnknownClass } from "./types";
import { Util } from "./util";

export let NodomMessage = NodomMessage_zh;

type ModuleHotSnapshot = {
    children: ModuleHotSnapshot[];
    hotId: string;
    state: Record<string, unknown>;
};

type HotReloadTarget = {
    hotId: string;
    module: Module;
    parent: Module;
    snapshot: ModuleHotSnapshot;
    srcDomKey: number | string;
};

type QueuedPlugin = {
    options: unknown[];
    plugin: NodomPlugin;
};

type QueuedDirective = {
    handler: DirectiveMethod;
    name: string;
    priority?: number;
};

type QueuedProvide = {
    key: InjectionKey<unknown>;
    value: unknown;
};

export class Nodom {
    public static isDebug: boolean;
    public static config = {
        globalProperties: {} as Record<string, unknown>
    };

    private static queuedPlugins: QueuedPlugin[] = [];
    private static queuedComponents: Map<string, UnknownClass> = new Map();
    private static queuedDirectives: QueuedDirective[] = [];
    private static queuedProvides: QueuedProvide[] = [];

    public static createApp(clazz: unknown, selector?: string): App {
        const app = createNodomApp(clazz as UnknownClass, selector);
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

    public static app(clazz: unknown, selector?: string) {
        return this.createApp(clazz, selector).mount(selector);
    }

    public static remount(clazz: unknown, selector?: string) {
        this.clearMountedApp(selector);
        return this.createApp(clazz, selector).mount(selector);
    }

    public static hotReload(clazz: unknown, selector?: string, hotState?: Record<string, unknown>, changedFiles?: string[]) {
        if (this.reloadChangedModules(this.normalizeChangedFiles(changedFiles))) {
            return;
        }
        const hotSnapshot = isModuleHotSnapshot(hotState) ? hotState : undefined;
        if (!hotSnapshot && hotState && clazz && typeof clazz === "function") {
            (clazz as unknown as Record<string, unknown>)["__nodomHotState"] = hotState;
        }
        const module = this.remount(clazz, selector);
        Renderer.flush();
        if (hotSnapshot && module && typeof module.applyHotSnapshot === "function") {
            module.applyHotSnapshot(hotSnapshot);
            Renderer.flush();
        }
    }

    public static captureHotState(): Record<string, unknown> {
        const main = ModuleFactory.getMain();
        if (!main || typeof main.captureHotSnapshot !== "function") {
            return {};
        }
        return main.captureHotSnapshot();
    }

    public static debug() {
        this.isDebug = true;
    }

    public static setLang(lang: string) {
        switch (lang || "zh") {
            case "zh":
                NodomMessage = NodomMessage_zh;
                break;
            case "en":
                NodomMessage = NodomMessage_en;
                break;
        }
    }

    public static use(plugin: unknown, ...params: unknown[]): unknown {
        if (isQueuedPlugin(plugin)) {
            if (!this.queuedPlugins.find(item => item.plugin === plugin)) {
                this.queuedPlugins.push({
                    options: params,
                    plugin
                });
            }
            return plugin;
        }
        if (!(plugin as Record<string, unknown>)["name"]) {
            throw new NError("notexist", NodomMessage.TipWords.plugin);
        }
        if (!this["$" + (plugin as Record<string, unknown>)["name"]]) {
            this["$" + (plugin as Record<string, unknown>)["name"]] = Reflect.construct(plugin as UnknownClass, params || []);
        }
        return this["$" + (plugin as Record<string, unknown>)["name"]];
    }

    public static component(name: string, clazz: UnknownClass): typeof Nodom {
        this.queuedComponents.set(name, clazz);
        ModuleFactory.addClass(clazz, name);
        return this;
    }

    public static directive(name: string, handler: DirectiveMethod, priority?: number): typeof Nodom {
        const existing = this.queuedDirectives.findIndex(item => item.name === name);
        const nextDirective = { handler, name, priority };
        if (existing === -1) {
            this.queuedDirectives.push(nextDirective);
        } else {
            this.queuedDirectives.splice(existing, 1, nextDirective);
        }
        DirectiveManager.addType(name, handler, priority);
        return this;
    }

    public static provide<T>(key: InjectionKey<T>, value: T): typeof Nodom {
        const existing = this.queuedProvides.findIndex(item => item.key === key);
        const nextProvide = { key, value };
        if (existing === -1) {
            this.queuedProvides.push(nextProvide);
        } else {
            this.queuedProvides.splice(existing, 1, nextProvide);
        }
        return this;
    }

    public static setGlobal(name: string, value: unknown): typeof Nodom {
        this.config.globalProperties[name] = value;
        return this;
    }

    public static createRoute(config: RouteCfg | Array<RouteCfg>, parent?: Route): Route {
        if (!Nodom["$Router"]) {
            throw new NError("uninit", NodomMessage.TipWords.route);
        }
        let route: Route | undefined;
        parent = parent || Nodom["$Router"].getRoot();
        if (Util.isArray(config)) {
            for (const item of config as Array<RouteCfg>) {
                route = new Route(item, parent);
            }
        } else {
            route = new Route(config as RouteCfg, parent);
        }
        return route as Route;
    }

    public static createDirective(name: string, handler: DirectiveMethod, priority?: number) {
        return DirectiveManager.addType(name, handler, priority);
    }

    public static registModule(clazz: unknown, name?: string) {
        ModuleFactory.addClass(clazz as UnknownClass, name);
    }

    public static async request(config): Promise<unknown> {
        return await RequestManager.request(config);
    }

    public static setRejectTime(time: number) {
        RequestManager.setRejectTime(time);
    }

    private static clearMountedApp(selector?: string): void {
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

    private static reloadChangedModules(changedFiles: string[]): boolean {
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

        const parents = new Set<Module>();
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
            const nextModule = target.parent.children.find(child =>
                child?.srcDom?.key === target.srcDomKey
                && typeof child.getHotId === "function"
                && normalizeHotId(child.getHotId()) === target.hotId
            );
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

    private static collectHotReloadTargets(module: Module, hotIds: Set<string>): HotReloadTarget[] {
        const hotId = normalizeHotId(module.getHotId?.());
        if (hotId && hotIds.has(hotId)) {
            const parent = module.getParent?.();
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

        const targets: HotReloadTarget[] = [];
        for (const child of module.children || []) {
            targets.push(...this.collectHotReloadTargets(child, hotIds));
        }
        return targets;
    }

    private static normalizeChangedFiles(changedFiles?: string[]): string[] {
        if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
            return [];
        }
        const normalized: string[] = [];
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

function normalizeHotId(hotId?: string): string {
    return typeof hotId === "string" ? hotId.replace(/\\/g, "/") : "";
}

function isModuleHotSnapshot(value: unknown): value is ModuleHotSnapshot {
    return !!value
        && typeof value === "object"
        && typeof (value as Record<string, unknown>).hotId === "string"
        && Array.isArray((value as Record<string, unknown>).children)
        && typeof (value as Record<string, unknown>).state === "object";
}

function isQueuedPlugin(value: unknown): value is NodomPlugin {
    if (typeof value === "function") {
        return !/^class\s/.test(Function.prototype.toString.call(value));
    }
    return !!value && typeof value === "object" && typeof (value as Record<string, unknown>).install === "function";
}