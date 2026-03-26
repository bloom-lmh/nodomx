import { DirectiveManager } from "./directivemanager";
import { ModuleFactory } from "./modulefactory";
import { Renderer } from "./renderer";
import { RequestManager } from "./requestmanager";
import { Scheduler } from "./scheduler";
export function createAppContext(seed) {
    return {
        app: undefined,
        components: new Map((seed === null || seed === void 0 ? void 0 : seed.components) || []),
        config: {
            globalProperties: {
                ...((seed === null || seed === void 0 ? void 0 : seed.config.globalProperties) || {})
            }
        },
        directives: new Map((seed === null || seed === void 0 ? void 0 : seed.directives) || []),
        installedPlugins: new Set((seed === null || seed === void 0 ? void 0 : seed.installedPlugins) || []),
        provides: new Map((seed === null || seed === void 0 ? void 0 : seed.provides) || [])
    };
}
export function installPlugin(app, plugin, ...options) {
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
export class App {
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
export function createApp(rootComponent, selector, seed) {
    return new App(rootComponent, selector, seed);
}
//# sourceMappingURL=app.js.map