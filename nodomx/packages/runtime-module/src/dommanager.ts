import { Module } from "./module";
import { ModuleFactory } from "@nodomx/runtime-registry";
import { KeepAliveConfig, KeepAliveMatchPattern, RenderedDom } from "@nodomx/shared";
import { VirtualDom } from "@nodomx/runtime-template";
import { Renderer } from "@nodomx/runtime-view";

type KeepAliveRenderedDom = RenderedDom & {
    keepAlive?: boolean | KeepAliveConfig;
    transition?: unknown;
};

type KeepAliveCacheEntry = {
    domKey: number | string;
    moduleId: number;
};

type RendererWithLeaveTransition = typeof Renderer & {
    runLeaveTransition?: (module: Module, dom: RenderedDom, removeNode: () => void) => boolean;
};

/**
 * dom管理器
 * @remarks
 * 用于管理module的虚拟dom树，渲染树，html节点
 */
export class DomManager{
    /**
     * 所属模块
     */
    private module:Module;

    /**
     * 编译后的虚拟dom树
     */
    public vdomTree:VirtualDom;

    /**
     * 渲染后的dom树
     */
    public renderedTree:RenderedDom;

    private keepAliveScopes:Map<string, KeepAliveCacheEntry[]> = new Map();

    /**
     * 构造方法
     * @param module -  所属模块
     */
    constructor(module:Module){
        this.module = module;
    }
    
    /**
     * 从virtual dom 树获取虚拟dom节点
     * @param key - dom key 或 props键值对
     * @returns     编译后虚拟节点 
     */
    public getVirtualDom(key:string|number|object):VirtualDom{
        if(!this.vdomTree){
            return null;
        }
        return find(this.vdomTree);
        function find(dom:VirtualDom){
            //对象表示未props查找
            if(typeof key === 'object'){
                if(!Object.keys(key).find(k=>key[k] !== dom.props.get(k))){
                    return dom;
                }
            }else if(dom.key === key){ //key查找
                return dom;
            }
            if(dom.children){
                for(const d of dom.children){
                    const d1 = find(d);
                    if(d1){
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
    public getRenderedDom(key:object|string|number):RenderedDom{
        if(!this.renderedTree){
            return;
        }
        return find(this.renderedTree,key);
        /**
         * 递归查找
         * @param dom - 渲染dom  
         * @param key -   待查找key
         * @returns     key对应renderdom 或 undefined
         */
        function find(dom:RenderedDom,key:object|string|number):RenderedDom{
            //对象表示未props查找
            if(typeof key === 'object'){
                if(dom.props && !Object.keys(key).find(k=>key[k] !== dom.props[k])){
                    return dom;
                }
            }else if(dom.key === key){ //key查找
                return dom;
            }
            if(dom.children){
                for(const d of dom.children){
                    if(!d){
                        continue;
                    }
                    const d1 = find(d,key);
                    if(d1){
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
    public freeNode(dom:RenderedDom,destroy?:boolean,skipTransition?:boolean){
        const managedDom = dom as KeepAliveRenderedDom;
        const transitionDom = !skipTransition && destroy ? findTransitionDom(dom) : undefined;
        let retainDomParams = false;
        if(transitionDom){
            const didScheduleLeave = (Renderer as RendererWithLeaveTransition).runLeaveTransition?.(
                this.module,
                transitionDom,
                () => this.freeNode(dom, destroy, true)
            ) || false;
            if(didScheduleLeave){
                return;
            }
        }
        if(dom.childModuleId){  //子模块
            const m = ModuleFactory.get(dom.childModuleId);
            if(m){
                const keepAliveConfig = normalizeKeepAliveConfig(managedDom.keepAlive, dom);
                if(shouldCacheKeepAlive(keepAliveConfig, m as Module)){
                    retainDomParams = true;
                    (m as Module & { setKeepAliveManaged?: (managed: boolean) => void }).setKeepAliveManaged?.(true);
                    const evictedEntries = this.registerKeepAliveCache(dom, m as Module, keepAliveConfig as KeepAliveConfig);
                    m.unmount(true);
                    this.evictKeepAliveEntries(evictedEntries);
                }else{
                    (m as Module & { setKeepAliveManaged?: (managed: boolean) => void }).setKeepAliveManaged?.(false);
                    this.removeKeepAliveCacheEntry(dom.key);
                    destroy?m.destroy():m.unmount();
                }
            }
        }else{      //普通节点
            const el = dom.node;
            //解绑所有事件
            this.module.eventFactory.removeEvent(dom);
            //子节点递归操作
            if(dom.children){
                for(const d of dom.children){
                    this.freeNode(d,destroy,skipTransition);
                }
            }
            // 从html移除
            if(el && el.parentElement){
                el.parentElement.removeChild(el);
            }
        }
        //清除缓存
        if(!retainDomParams){
            const m1 = ModuleFactory.get(dom.moduleId);
            if(m1){
                m1.objectManager.clearDomParams(dom.key);
            }
        }
    }

    private registerKeepAliveCache(dom: RenderedDom, module: Module, config: KeepAliveConfig): KeepAliveCacheEntry[] {
        const scopeKey = getKeepAliveScopeKey(config, dom.key);
        const entries = this.keepAliveScopes.get(scopeKey) || [];
        const filtered = entries.filter(item => item.domKey !== dom.key && item.moduleId !== module.id);
        filtered.push({
            domKey: dom.key,
            moduleId: module.id
        });
        const max = typeof config.max === 'number' ? config.max : undefined;
        if(max === undefined || filtered.length <= max){
            this.keepAliveScopes.set(scopeKey, filtered);
            return [];
        }
        const evictedEntries = filtered.splice(0, filtered.length - max);
        if(filtered.length > 0){
            this.keepAliveScopes.set(scopeKey, filtered);
        }else{
            this.keepAliveScopes.delete(scopeKey);
        }
        return evictedEntries;
    }

    private evictKeepAliveEntries(entries: KeepAliveCacheEntry[]): void {
        for(const entry of entries){
            const cachedModule = this.module.objectManager.getDomParam(entry.domKey, '$savedModule') as Module | undefined;
            this.module.objectManager.clearDomParams(entry.domKey);
            this.detachChildModule(cachedModule);
            (cachedModule as Module & { setKeepAliveManaged?: (managed: boolean) => void })?.setKeepAliveManaged?.(false);
            cachedModule?.destroy();
        }
    }

    private removeKeepAliveCacheEntry(domKey: number | string): void {
        for(const [scopeKey, entries] of this.keepAliveScopes.entries()){
            const filtered = entries.filter(item => item.domKey !== domKey);
            if(filtered.length === entries.length){
                continue;
            }
            if(filtered.length > 0){
                this.keepAliveScopes.set(scopeKey, filtered);
            }else{
                this.keepAliveScopes.delete(scopeKey);
            }
        }
    }

    private detachChildModule(module?: Module): void {
        if(!module){
            return;
        }
        const index = this.module.children.indexOf(module);
        if(index !== -1){
            this.module.children.splice(index, 1);
        }
    }
}

function normalizeKeepAliveConfig(value: boolean | KeepAliveConfig | undefined, dom: RenderedDom): KeepAliveConfig | undefined {
    if(value === undefined || value === false){
        return undefined;
    }
    if(value === true){
        return {
            disabled: false,
            scopeKey: dom.key
        };
    }
    return value;
}

function shouldCacheKeepAlive(config: KeepAliveConfig | undefined, module: Module): boolean {
    if(!config || config.disabled){
        return false;
    }
    if(typeof config.max === 'number' && config.max <= 0){
        return false;
    }
    const moduleName = module.constructor.name;
    if(config.include && !matchesKeepAlivePattern(config.include, moduleName)){
        return false;
    }
    if(config.exclude && matchesKeepAlivePattern(config.exclude, moduleName)){
        return false;
    }
    return true;
}

function matchesKeepAlivePattern(pattern: KeepAliveMatchPattern, moduleName: string): boolean {
    if(pattern instanceof RegExp){
        return pattern.test(moduleName);
    }
    if(Array.isArray(pattern)){
        return pattern.some(item => matchesKeepAlivePattern(item, moduleName));
    }
    if(typeof pattern === 'string'){
        return pattern
            .split(',')
            .map(item => item.trim())
            .filter(item => item.length > 0)
            .includes(moduleName);
    }
    return false;
}

function getKeepAliveScopeKey(config: KeepAliveConfig, fallbackKey: number | string): string {
    return String(config.scopeKey ?? fallbackKey);
}

function findTransitionDom(dom: RenderedDom): RenderedDom | undefined {
    const managedDom = dom as KeepAliveRenderedDom;
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

