import { Module } from "./module";
import { VirtualDom } from "./virtualdom";
import { Model } from "./model";
import { ChangedDom, RenderedDom } from "./types";
/**
 * 渲染器
 * @remarks
 * nodom渲染操作在渲染器中实现
 */
export declare class Renderer {
    /**
     * 应用根El
     */
    private static rootEl;
    /**
     * 等待渲染列表
     */
    private static waitList;
    /**
     * 设置根容器
     * @param rootEl - 根html element
     */
    static setRootEl(rootEl: any): void;
    /**
     * 获取根容器
     * @returns 根 html element
     */
    static getRootEl(): HTMLElement;
    /**
     * 添加到渲染列表
     * @param module - 模块
     */
    static add(module: Module): void;
    /**
     * 从渲染队列移除
     * @param module -  模块
     */
    static remove(module: Module): void;
    /**
     * 渲染
     * @remarks
     * 如果存在渲染队列，则从队列中取出并依次渲染
     */
    static render(): void;
    /**
     * flush pending render queue synchronously
     * @param maxRounds - max render rounds
     */
    static flush(maxRounds?: number): void;
    /**
     * 渲染dom
     * @remarks
     * 此过程将VirtualDom转换为RenderedDom。
     * 当对单个节点进行更新渲染时，可避免整个模块的渲染，这种方式适用于组件、指令等编码过程使用。
     * @param module -          模块
     * @param src -             源dom
     * @param model -           模型
     * @param parent -          父dom
     * @param key -             附加key，放在domkey的后面
     * @param notRenderChild -  不渲染子节点
     * @returns                 渲染后节点
     */
    static renderDom(module: Module, src: VirtualDom, model: Model, parent?: RenderedDom, key?: number | string, notRenderChild?: boolean): RenderedDom;
    /**
     * 处理指令
     * @param module -  模块
     * @param src -     编译节点
     * @param dst -     渲染节点
     * @returns         true继续执行，false不执行后续渲染代码，也不加入渲染树
    */
    private static handleDirectives;
    /**
     * 处理属性
     * @param module -      模块
     * @param src -         编译节点
     * @param dst -         渲染节点
     * @param srcModule -   源模块
     */
    private static handleProps;
    /**
     * 更新到html树
     * @param module -  模块
     * @param dom -     渲染节点
     * @param oldDom -  旧节点
     * @returns         渲染后的节点
     */
    static updateToHtml(module: Module, dom: RenderedDom, oldDom: RenderedDom): Node;
    /**
     * 渲染到html树
     * @param module - 	        模块
     * @param src -             渲染节点
     * @param parentEl - 	    父html
     * @returns                 渲染后的html节点
     */
    static renderToHtml(module: Module, src: RenderedDom, parentEl: Node): Node;
    /**
     * 处理更改的dom节点
     * @param module -        待处理模块
     * @param changeDoms -    修改后的dom节点数组
     */
    static handleChangedDoms(module: Module, changeDoms: ChangedDom[]): void;
    /**
     * 替换节点
     * @param module -  模块
     * @param src -     待替换节点
     * @param dst -     被替换节点
     */
    private static replace;
}
