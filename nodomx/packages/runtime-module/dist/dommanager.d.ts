import { Module } from "./module";
import { RenderedDom } from "@nodomx/shared";
import { VirtualDom } from "@nodomx/runtime-template";
/**
 * dom管理器
 * @remarks
 * 用于管理module的虚拟dom树，渲染树，html节点
 */
export declare class DomManager {
    /**
     * 所属模块
     */
    private module;
    /**
     * 编译后的虚拟dom树
     */
    vdomTree: VirtualDom;
    /**
     * 渲染后的dom树
     */
    renderedTree: RenderedDom;
    private keepAliveScopes;
    /**
     * 构造方法
     * @param module -  所属模块
     */
    constructor(module: Module);
    /**
     * 从virtual dom 树获取虚拟dom节点
     * @param key - dom key 或 props键值对
     * @returns     编译后虚拟节点
     */
    getVirtualDom(key: string | number | object): VirtualDom;
    /**
     * 从渲染树获取key对应的渲染节点
     * @param key - dom key 或 props键值对
     * @returns     渲染后虚拟节点
     */
    getRenderedDom(key: object | string | number): RenderedDom;
    /**
     * 释放节点
     * @remarks
     * 释放操作包括：如果被释放节点包含子模块，则子模块需要unmount；释放对应节点资源
     * @param dom -         虚拟dom
     * @param destroy -     是否销毁，当dom带有子模块时，如果设置为true，则子模块执行destroy，否则执行unmount
     */
    freeNode(dom: RenderedDom, destroy?: boolean, skipTransition?: boolean): void;
    private registerKeepAliveCache;
    private evictKeepAliveEntries;
    private removeKeepAliveCacheEntry;
    private detachChildModule;
}
