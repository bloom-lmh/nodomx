import { ModuleFactory } from "./modulefactory";
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
    freeNode(dom, destroy) {
        if (dom.childModuleId) { //子模块
            const m = ModuleFactory.get(dom.childModuleId);
            if (m) {
                destroy ? m.destroy() : m.unmount();
            }
        }
        else { //普通节点
            const el = dom.node;
            //解绑所有事件
            this.module.eventFactory.removeEvent(dom);
            //子节点递归操作
            if (dom.children) {
                for (const d of dom.children) {
                    this.freeNode(d, destroy);
                }
            }
            // 从html移除
            if (el && el.parentElement) {
                el.parentElement.removeChild(el);
            }
        }
        //清除缓存
        const m1 = ModuleFactory.get(dom.moduleId);
        if (m1) {
            m1.objectManager.clearDomParams(dom.key);
        }
    }
}
//# sourceMappingURL=dommanager.js.map