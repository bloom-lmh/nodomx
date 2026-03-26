import type { AppContext } from "./app";
import { Module } from "./module";
import { UnknownClass } from "./types";

/**
 * 模块工厂
 * @remarks
 * 管理所有模块类、模块实例
 */
export class ModuleFactory {
    private static modules: Map<number, Module> = new Map();
    public static classes: Map<string, UnknownClass> = new Map();
    public static aliasMap: Map<string, string> = new Map();
    private static mainModule?: Module;
    private static moduleId: number = 0;
    private static appContext?: AppContext;

    public static add(item: Module) {
        if (this.modules.size === 0) {
            this.mainModule = item;
        }
        this.modules.set(item.id, item);
        this.addClass(item.constructor as UnknownClass);
    }

    public static get(name: number | string | UnknownClass): Module | undefined {
        const tp = typeof name;
        let mdl: Module | undefined;
        if (tp === "number") {
            return this.modules.get(name as number);
        }
        if (tp === "string") {
            name = (name as string).toLowerCase();
            if (!this.classes.has(name)) {
                name = this.aliasMap.get(name) as string;
            }
            if (name && this.classes.has(name)) {
                mdl = Reflect.construct(this.classes.get(name) as UnknownClass, [++this.moduleId]);
            }
        } else {
            mdl = Reflect.construct(name as UnknownClass, [++this.moduleId]);
        }
        if (mdl) {
            mdl.init();
            return mdl;
        }
        return undefined;
    }

    public static hasClass(clazzName: string): boolean {
        const name = clazzName.toLowerCase();
        return this.classes.has(name) || this.aliasMap.has(name);
    }

    public static addClass(clazz: unknown, alias?: string) {
        const name = (clazz as UnknownClass).name.toLowerCase();
        this.classes.set(name, clazz as UnknownClass);
        if (alias) {
            this.aliasMap.set(alias.toLowerCase(), name);
        }
    }

    public static getClass(name: string): UnknownClass | undefined {
        name = name.toLowerCase();
        return this.classes.has(name) ? this.classes.get(name) : this.classes.get(this.aliasMap.get(name) as string);
    }

    public static async load(modulePath: string): Promise<UnknownClass | undefined> {
        const m = await import(modulePath);
        if (m) {
            for (const k of Object.keys(m)) {
                if (m[k].name) {
                    this.addClass(m[k]);
                    return m[k];
                }
            }
        }
        return undefined;
    }

    public static remove(id: number) {
        this.modules.delete(id);
    }

    public static setMain(m?: Module) {
        this.mainModule = m;
    }

    public static getMain(): Module | undefined {
        return this.mainModule;
    }

    public static setAppContext(context?: AppContext): void {
        this.appContext = context;
    }

    public static getAppContext(): AppContext | undefined {
        return this.appContext;
    }
}
