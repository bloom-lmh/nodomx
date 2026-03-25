import { Model } from "./model";
import { ObjectManager } from "./objectmanager";
import { EModuleState, RenderedDom } from "./types";
import { EventFactory } from "./eventfactory";
import { DomManager } from "./dommanager";
import { ModelManager } from "./modelmanager";
type ModuleHotSnapshot = {
    children: ModuleHotSnapshot[];
    hotId: string;
    state: Record<string, unknown>;
};
/**
 * 模块类
 *
 * @remarks
 * 模块方法说明：模板内使用的方法，包括事件方法，都在模块内定义
 *
 *  方法this：指向module实例
 *
 *  事件参数: model(当前按钮对应model),dom(事件对应虚拟dom),eventObj(事件对象),e(实际触发的html event)
 *
 *  表达式方法：参数按照表达式方式给定即可，如：
 * ```html
 *  <div>
 *      <div class={{getCls(st)}} e-click='click'>Hello Nodom</div>
 *  </div>
 * ```
 * ```js
 *  //事件方法
 *  click(model,dom,eventObj,e){
 *      //do something
 *  }
 *  //表达式方法
 *  //state 由表达式中给定，state由表达式传递，为当前dom model的一个属性
 *  getCls(state){
 *      //do something
 *  }
 * ```
 *
 * 模块事件，在模块不同阶段执行
 *
 * onInit              初始化后（constructor后，已经有model对象，但是尚未编译，只执行1次）
 *
 * onBeforeFirstRender 首次渲染前（只执行1次）
 *
 * onFirstRender       首次渲染后（只执行1次）
 *
 * onBeforeRender      渲染前
 *
 * onRender            渲染后
 *
 * onCompile           编译后
 *
 * onBeforeMount       挂载到document前
 *
 * onMount             挂载到document后
 *
 * onBeforeUnMount     从document脱离前
 *
 * onUnmount           从document脱离后
 *
 * onBeforeUpdate      更新到document前
 *
 * onUpdate            更新到document后
 */
export declare class Module {
    /**
     * 模块id(全局唯一)
     */
    id: number;
    /**
     * 模型，代理过的data
     */
    model: Model;
    /**
     * 子模块数组，模板中引用的所有子模块
     */
    children: Array<Module>;
    /**
     * 父模块id，B模块在A模块模板中使用，则指向A模块Id
     *
     */
    private parentId;
    /**
     * 模块状态
     */
    state: EModuleState;
    /**
     * 模型管理器
     */
    modelManager: ModelManager;
    /**
     * 对象管理器，用于管理虚拟dom节点、指令、表达式、事件对象及其运行时参数
     */
    objectManager: ObjectManager;
    /**
     * dom 管理器，管理虚拟dom、渲染dom和html node
     */
    domManager: DomManager;
    /**
     * 事件工厂
     */
    eventFactory: EventFactory;
    /**
     * 源dom，子模块对应dom
     */
    srcDom: RenderedDom;
    /**
     * 父模块通过dom节点传递的属性
     */
    props: object;
    /**
     * 模板中引用的模块类集合
     * 如果引用的模块类已通过registModule注册，这里不再声明
     */
    modules: unknown[];
    /**
     * 不渲染的属性（这些属性用于生产模板，不作为属性渲染到模块根节点）
     */
    excludedProps: string[];
    /**
     * 旧模板串
     */
    private oldTemplate;
    /**
     * slot map
     *
     * key: slot name
     *
     * value: 渲染节点
     *
     */
    slots: Map<string, RenderedDom>;
    /**
     * 模块引入的css rules 名数组
     */
    cssRules: string[];
    /**
     * cleanup callbacks created by composition api
     */
    private compositionCleanups;
    /**
     * bindings returned from setup
     */
    private setupState;
    /**
     * 构造器
     * @param id -  模块id
     */
    constructor(id?: number);
    /**
     * 初始化操作
     */
    init(): void;
    /**
     * 模板串方法，使用时需重载
     * @param props -   props对象，在模板中进行配置，从父模块传入
     * @returns         模板串
     * @virtual
     */
    template(props?: object): string;
    /**
     * 数据方法，使用时需重载
     * @returns  数据对象
     * @virtual
     */
    data(): object;
    /**
     * composition api entry
     */
    setup(): Record<string, unknown> | void;
    /**
     * 模型渲染
     * @remarks
     * 渲染流程：
     *
     * 1. 获取首次渲染标志
     *
     * 2. 执行template方法获得模板串
     *
     * 3. 与旧模板串比较，如果不同，则进行编译
     *
     * 4. 判断是否存在虚拟dom树（编译时可能导致模板串为空），没有则结束
     *
     * 5. 如果为首次渲染，执行onBeforeFirstRender事件
     *
     * 6. 执行onBeforeRender事件
     *
     * 7. 保留旧渲染树，进行新渲染
     *
     * 8. 执行onRender事件
     *
     * 9. 如果为首次渲染，执行onFirstRender事件
     *
     * 10. 渲染树为空，从document解除挂载
     *
     * 11. 如果未挂载，执行12，否则执行13
     *
     * 12. 执行挂载，结束
     *
     * 13. 新旧渲染树比较，比较结果为空，结束，否则执行14
     *
     * 14. 执行onBeforeUpdate事件
     *
     * 15. 更新到document
     *
     * 16. 执行onUpdate事件，结束
     */
    render(): boolean;
    /**
     * 添加子模块
     * @param module -    模块id或模块
     */
    addChild(module: Module): void;
    /**
     * 移除子模块
     * @param module -    子模块
     */
    removeChild(module: Module): void;
    /**
     * 激活模块(准备渲染)
     */
    active(): void;
    /**
     * 挂载到document
     */
    mount(): void;
    /**
     * 从document移除
     * @param passive -     被动卸载，父模块释放或模块被删除时导致的卸载，此时不再保留srcDom.node，状态修改INIT，否则修改为UNMOUNTED
     */
    unmount(passive?: boolean): void;
    /**
     * 销毁
     */
    destroy(): void;
    /**
     * capture setup state for hot reload
     * @returns serializable snapshot
     */
    captureSetupState(): Record<string, unknown>;
    /**
     * capture recursive hot snapshot
     * @returns hot snapshot tree
     */
    captureHotSnapshot(): ModuleHotSnapshot;
    /**
     * apply recursive hot snapshot
     * @param snapshot - hot snapshot tree
     */
    applyHotSnapshot(snapshot: ModuleHotSnapshot): void;
    /**
     * 获取父模块
     * @returns     父模块
     */
    getParent(): Module;
    /**
     * 执行模块事件
     * @param eventName -   事件名
     * @returns             执行结果
     */
    doModuleEvent(eventName: string): boolean;
    /**
     * 设置props
     * @param props -   属性值
     * @param dom -     子模块对应渲染后节点
     */
    setProps(props: object, dom: RenderedDom): void;
    /**
     * 编译
     * 出现编译，表示
     */
    private compile;
    /**
     * 设置不渲染到根dom的属性集合
     * @param props -   待移除的属性名属组
     */
    setExcludeProps(props: string[]): void;
    /**
     * 按模块类名获取子模块
     * @remarks
     * 找到第一个满足条件的子模块，如果deep=true，则深度优先
     *
     * 如果attrs不为空，则同时需要匹配子模块属性
     *
     * @example
     * ```html
     *  <div>
     *      <Module1 />
     *      <!--other code-->
     *      <Module1 v1='a' v2='b' />
     *  </div>
     * ```
     * ```js
     *  const m = getModule('Module1',{v1:'a'},true);
     *  m 为模板中的第二个Module1
     * ```
     * @param name -    子模块类名或别名
     * @param attrs -   属性集合
     * @param deep -    是否深度获取
     * @returns         符合条件的子模块或undefined
     */
    getModule(name: string, attrs?: object, deep?: boolean): Module;
    /**
     * 获取模块类名对应的所有子模块
     * @param className -   子模块类名
     * @param deep -        深度查询
     */
    getModules(className: string, attrs?: object, deep?: boolean): Module[];
    /**
     * 监听model
     * @remarks
     * 参数个数可变，分为几种情况
     * 1 如果第一个参数为object，则表示为被监听的model：
     *      如果第二个为字符串或数组，则表示被监听的属性或属性数组，第三个为钩子函数
     *      如果第二个为函数，则表示钩子，表示深度监听
     * 2 如果第一个参数为属性名，即字符串或字符串数组，则第二个参数为钩子函数，此时监听对象为this.model
     * 3 如果第一个为function，则表示深度监听，此时监听对象为this.model
     * 注：当不指定监听属性时，则统一表示为深度监听，深度监听会影响渲染性能，不建议使用
     *
     * @param model -   模型或属性或钩子函数
     * @param key -     属性/属性数组/监听函数
     * @param func -    钩子函数
     * @returns         回收监听器函数，执行后取消监听
     */
    watch(model: Model | string | string[], key: string | string[] | ((m: any, k: any, ov: any, nv: any) => void), func?: ((m: any, k: any, ov: any, nv: any) => void)): () => void;
    /**
     * 设置模型属性值
     * @remarks
     * 参数个数可变，如果第一个参数为属性名，则第二个参数为属性值，默认model为根模型，否则按照参数说明
     *
     * @param model -     模型
     * @param key -       子属性，可以分级，如 name.firstName
     * @param value -     属性值
     */
    set(model: Model | string, key: unknown, value?: unknown): void;
    /**
     * 获取模型属性值
     * @remarks
     * 参数个数可变，如果第一个参数为属性名，默认model为根模型，否则按照参数说明
     *
     * @param model -   模型
     * @param key -     属性名，可以分级，如 name.firstName，如果为null，则返回自己
     * @returns         属性值
     */
    get(model: Model | string, key?: string): unknown;
    /**
     * 调用模块方法
     * @param methodName -  方法名
     * @param args -        参数
     */
    invokeMethod(methodName: string, ...args: any[]): any;
    /**
     * 根据条件获取渲染节点
     * @param params -  条件，dom key 或 props键值对
     * @returns         渲染节点
     */
    getRenderedDom(params: any): RenderedDom;
    /**
     * 根据条件获取html节点
     * @param params -  条件，dom key 或 props键值对
     * @returns         html node
     */
    getNode(params: any): Node;
    /**
     * register a composition cleanup callback
     * @param cleanup - cleanup callback
     */
    addCompositionCleanup(cleanup: () => void): void;
    /**
     * initialize setup result
     */
    private initSetupState;
    /**
     * run and clear composition cleanups
     */
    private clearCompositionCleanups;
    /**
     * restore setup state from hot payload if present
     */
    private restoreSetupState;
    /**
     * apply setup-level state snapshot
     * @param hotState - state snapshot
     */
    private applySetupState;
    /**
     * get stable hot identity
     * @returns hot id
     */
    getHotId(): string;
}
export {};
