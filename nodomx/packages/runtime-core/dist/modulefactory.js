/**
 * ģ�鹤��
 * @remarks
 * ��������ģ���ࡢģ��ʵ��
 */
export class ModuleFactory {
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
    static async load(modulePath) {
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
//# sourceMappingURL=modulefactory.js.map