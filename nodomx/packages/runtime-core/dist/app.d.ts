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
    directives: Map<string, {
        handler: DirectiveMethod;
        priority?: number;
    }>;
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
export declare function createAppContext(seed?: AppContext): AppContext;
export declare function installPlugin(app: NodomApp, plugin: NodomPlugin, ...options: unknown[]): NodomApp;
export declare class App implements NodomApp {
    readonly rootComponent: UnknownClass;
    selector?: string;
    readonly context: AppContext;
    readonly config: AppContext["config"];
    instance?: Module;
    constructor(rootComponent: UnknownClass, selector?: string, seed?: AppContext);
    mount(selector?: string): Module | undefined;
    unmount(): this;
    use(plugin: NodomPlugin, ...options: unknown[]): this;
    component(name: string, clazz: UnknownClass): this;
    directive(name: string, handler: DirectiveMethod, priority?: number): this;
    provide<T>(key: InjectionKey<T>, value: T): this;
}
export declare function createApp(rootComponent: UnknownClass, selector?: string, seed?: AppContext): App;
