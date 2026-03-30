import { ModuleFactory } from "@nodomx/runtime-registry";
import { Renderer } from "@nodomx/runtime-view";
/**
 * dom管理器
 * @remarks
 * 用于管理module的虚拟dom树，渲染树，html节点
 */
export class DomManager {
    /**
     * 构造方法
     * @param module -  所属模块
     */
    constructor(module) {
        this.keepAliveScopes = new Map();
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
    freeNode(dom, destroy, skipTransition) {
        var _a, _b, _c, _d, _e, _f;
        const managedDom = dom;
        const transitionDom = !skipTransition && destroy ? findTransitionDom(dom) : undefined;
        let retainDomParams = false;
        if (transitionDom) {
            const didScheduleLeave = ((_b = (_a = Renderer).runLeaveTransition) === null || _b === void 0 ? void 0 : _b.call(_a, this.module, transitionDom, () => this.freeNode(dom, destroy, true))) || false;
            if (didScheduleLeave) {
                return;
            }
        }
        if (dom.childModuleId) { //子模块
            const m = ModuleFactory.get(dom.childModuleId);
            if (m) {
                const keepAliveConfig = normalizeKeepAliveConfig(managedDom.keepAlive, dom);
                if (shouldCacheKeepAlive(keepAliveConfig, m)) {
                    retainDomParams = true;
                    (_d = (_c = m).setKeepAliveManaged) === null || _d === void 0 ? void 0 : _d.call(_c, true);
                    const evictedEntries = this.registerKeepAliveCache(dom, m, keepAliveConfig);
                    m.unmount(true);
                    this.evictKeepAliveEntries(evictedEntries);
                }
                else {
                    (_f = (_e = m).setKeepAliveManaged) === null || _f === void 0 ? void 0 : _f.call(_e, false);
                    this.removeKeepAliveCacheEntry(dom.key);
                    destroy ? m.destroy() : m.unmount();
                }
            }
        }
        else { //普通节点
            const el = dom.node;
            //解绑所有事件
            this.module.eventFactory.removeEvent(dom);
            //子节点递归操作
            if (dom.children) {
                for (const d of dom.children) {
                    this.freeNode(d, destroy, skipTransition);
                }
            }
            // 从html移除
            if (el && el.parentElement) {
                el.parentElement.removeChild(el);
            }
        }
        //清除缓存
        if (!retainDomParams) {
            const m1 = ModuleFactory.get(dom.moduleId);
            if (m1) {
                m1.objectManager.clearDomParams(dom.key);
            }
        }
    }
    registerKeepAliveCache(dom, module, config) {
        const scopeKey = getKeepAliveScopeKey(config, dom.key);
        const entries = this.keepAliveScopes.get(scopeKey) || [];
        const filtered = entries.filter(item => item.domKey !== dom.key && item.moduleId !== module.id);
        filtered.push({
            domKey: dom.key,
            moduleId: module.id
        });
        const max = typeof config.max === 'number' ? config.max : undefined;
        if (max === undefined || filtered.length <= max) {
            this.keepAliveScopes.set(scopeKey, filtered);
            return [];
        }
        const evictedEntries = filtered.splice(0, filtered.length - max);
        if (filtered.length > 0) {
            this.keepAliveScopes.set(scopeKey, filtered);
        }
        else {
            this.keepAliveScopes.delete(scopeKey);
        }
        return evictedEntries;
    }
    evictKeepAliveEntries(entries) {
        var _a;
        for (const entry of entries) {
            const cachedModule = this.module.objectManager.getDomParam(entry.domKey, '$savedModule');
            this.module.objectManager.clearDomParams(entry.domKey);
            this.detachChildModule(cachedModule);
            (_a = cachedModule === null || cachedModule === void 0 ? void 0 : cachedModule.setKeepAliveManaged) === null || _a === void 0 ? void 0 : _a.call(cachedModule, false);
            cachedModule === null || cachedModule === void 0 ? void 0 : cachedModule.destroy();
        }
    }
    removeKeepAliveCacheEntry(domKey) {
        for (const [scopeKey, entries] of this.keepAliveScopes.entries()) {
            const filtered = entries.filter(item => item.domKey !== domKey);
            if (filtered.length === entries.length) {
                continue;
            }
            if (filtered.length > 0) {
                this.keepAliveScopes.set(scopeKey, filtered);
            }
            else {
                this.keepAliveScopes.delete(scopeKey);
            }
        }
    }
    detachChildModule(module) {
        if (!module) {
            return;
        }
        const index = this.module.children.indexOf(module);
        if (index !== -1) {
            this.module.children.splice(index, 1);
        }
    }
}
function normalizeKeepAliveConfig(value, dom) {
    if (value === undefined || value === false) {
        return undefined;
    }
    if (value === true) {
        return {
            disabled: false,
            scopeKey: dom.key
        };
    }
    return value;
}
function shouldCacheKeepAlive(config, module) {
    if (!config || config.disabled) {
        return false;
    }
    if (typeof config.max === 'number' && config.max <= 0) {
        return false;
    }
    const moduleName = module.constructor.name;
    if (config.include && !matchesKeepAlivePattern(config.include, moduleName)) {
        return false;
    }
    if (config.exclude && matchesKeepAlivePattern(config.exclude, moduleName)) {
        return false;
    }
    return true;
}
function matchesKeepAlivePattern(pattern, moduleName) {
    if (pattern instanceof RegExp) {
        return pattern.test(moduleName);
    }
    if (Array.isArray(pattern)) {
        return pattern.some(item => matchesKeepAlivePattern(item, moduleName));
    }
    if (typeof pattern === 'string') {
        return pattern
            .split(',')
            .map(item => item.trim())
            .filter(item => item.length > 0)
            .includes(moduleName);
    }
    return false;
}
function getKeepAliveScopeKey(config, fallbackKey) {
    var _a;
    return String((_a = config.scopeKey) !== null && _a !== void 0 ? _a : fallbackKey);
}
function findTransitionDom(dom) {
    const managedDom = dom;
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
//# sourceMappingURL=dommanager.js.map