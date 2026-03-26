import { DirectiveManager } from "./directivemanager";
import { ModuleFactory } from "./modulefactory";
import { Renderer } from "./renderer";
import { RequestManager } from "./requestmanager";
import { Scheduler } from "./scheduler";
import type { DirectiveMethod, UnknownClass } from "./types";
import type { Module } from "./module";

export type InjectionKey<T = unknown> = string | symbol;

export type NodomPlugin = {
    install(app: NodomApp, ...options: unknown[]): unknown;
} | ((app: NodomApp, ...options: unknown[]) => unknown);

export type AppContext = {
    app?: NodomApp;
    components: Map<string, UnknownClass>;
    config: {
        globalProperties: Record<string, unknown>;
    };
    directives: Map<string, { handler: DirectiveMethod; priority?: number }>;
    installedPlugins: Set<unknown>;
    provides: Map<InjectionKey, unknown>;
};

export interface NodomApp {
    readonly config: AppContext["config"];
    readonly context: AppContext;
    readonly rootComponent: UnknownClass;
    selector?: string;
    mount(selector?: string): Module | undefined;
    unmount(): this;
    use(plugin: NodomPlugin, ...options: unknown[]): this;
    component(name: string, clazz: UnknownClass): this;
    directive(name: string, handler: DirectiveMethod, priority?: number): this;
    provide<T>(key: InjectionKey<T>, value: T): this;
}

export function createAppContext(seed?: AppContext): AppContext {
    return {
        app: undefined,
        components: new Map(seed?.components || []),
        config: {
            globalProperties: {
                ...(seed?.config.globalProperties || {})
            }
        },
        directives: new Map(seed?.directives || []),
        installedPlugins: new Set(seed?.installedPlugins || []),
        provides: new Map(seed?.provides || [])
    };
}

export function installPlugin(app: NodomApp, plugin: NodomPlugin, ...options: unknown[]): NodomApp {
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

export class App implements NodomApp {
    public readonly context: AppContext;
    public readonly config: AppContext["config"];
    public instance?: Module;

    constructor(
        public readonly rootComponent: UnknownClass,
        public selector?: string,
        seed?: AppContext
    ) {
        this.context = createAppContext(seed);
        this.context.app = this;
        this.config = this.context.config;
    }

    public mount(selector: string = this.selector as string): Module | undefined {
        const rootEl = selector ? document.querySelector(selector) : null;
        const target = (rootEl || Renderer.getRootEl() || document.body) as HTMLElement;
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

    public unmount(): this {
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

    public use(plugin: NodomPlugin, ...options: unknown[]): this {
        installPlugin(this, plugin, ...options);
        return this;
    }

    public component(name: string, clazz: UnknownClass): this {
        this.context.components.set(name.toLowerCase(), clazz);
        ModuleFactory.addClass(clazz, name);
        return this;
    }

    public directive(name: string, handler: DirectiveMethod, priority?: number): this {
        this.context.directives.set(name, { handler, priority });
        DirectiveManager.addType(name, handler, priority);
        return this;
    }

    public provide<T>(key: InjectionKey<T>, value: T): this {
        this.context.provides.set(key, value);
        return this;
    }
}

export function createApp(rootComponent: UnknownClass, selector?: string, seed?: AppContext): App {
    return new App(rootComponent, selector, seed);
}
