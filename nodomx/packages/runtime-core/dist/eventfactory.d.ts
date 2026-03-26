import { NEvent } from "./event";
import { Module } from "./module";
import { RenderedDom } from "./types";
/**
 * 事件工厂
 *
 * @remarks
 * 每个模块一个事件工厂，用于管理模块内虚拟dom对应的事件对象
 * 事件配置不支持表达式
 * 代理事件不支持capture和nopopo
 *
 * 当父模块传递事件给子模块时，子模块根节点的参数model为子模块srcDom的model（来源于父模块），根节点自带事件model为子模块model
 * 如果存在传递事件和自带事件，则执行顺序为 1.自带事件 2.传递事件
 * 示例如下：
 * ```ts
 * class M1 extends Module{
 *      template(props){
 *           return `
 *              <button e-click='click1'>${props.title}</button>
 *           `
 *       }
 *       click1(model,dom){
 *           console.log('m1自带事件触发',model,dom);
 *       }
 *   }
 * }
 * class MMain extends Module{
 *      modules=[M1];
 *      template(){
 *          return `
 *              <div>
 *                  <h3>子模块事件测试</h3>
 *                  <p>我是模块main</p>
 *                  <m1 title='aaa' e-click='clickBtn:delg'/>
 *              </div>
 *          `
 *      }
 *      clickBtn(model,dom){
 *          console.log('传递事件',model,dom);
 *      }
 * }
 * ```
 * 当点击按钮时，先执行M1的click1方法，再执行MMain的clickBtn方法，打印的model不相同，dom也不相同
 */
export declare class EventFactory {
    /**
     * 所属模块
     */
    private module;
    /**
     * 自有事件map
     * key: dom key
     * value: 对象
     * ```json
     * {
     *      eventName:事件名,
     *      controller:用于撤销事件绑定的 abortcontroller
     * }
     * ```
     * 相同eventName可能有多个事件
     */
    private eventMap;
    /**
     * 代理事件map
     * key: domkey
     * value: 对象
     * ```json
     * {
     *      eventName:{
     *          controller:abort controller,
     *          events:{
     *              event:事件对象,
     *              dom:渲染节点,
     *              el:dom对应element
     *      }
     * }
     * ```
     * eventName：事件名，如click、mousemove等
     */
    private delgMap;
    /**
     * 构造器
     * @param module - 模块
     */
    constructor(module: Module);
    /**
     * 删除事件
     * @param event -     事件对象
     * @param key -       对应dom keys
     */
    addEvent(dom: RenderedDom, event: NEvent): void;
    /**
     * 删除事件
     * @param dom -     事件对象
     * @param event -   如果没有指定event，则表示移除该节点所有事件
     */
    removeEvent(dom: RenderedDom, event?: NEvent): void;
    /**
     * 绑定dom节点所有事件
     * @remarks
     * 执行addEventListener操作
     * @param dom -   渲染dom
     * @param event - 事件对象数组
     */
    private bind;
    /**
     * 绑定到代理对象
     * @param dom -     代理dom
     * @param dom1 -    被代理dom
     * @param event -   事件对象
     */
    private bindDelg;
    /**
     * 解绑dom节点事件
     * @param dom -     渲染dom或dom key
     * @param event -   事件对象或事件名，如果为空，则解绑该dom的所有事件，如果为事件名，则表示代理事件
     * @param delg -    是否为代理事件，默认false
     */
    private unbind;
    /**
     * 执行代理事件
     * @param dom -         代理节点
     * @param eventName -   事件名
     * @param e -           html event对象
     */
    private doDelgEvent;
    /**
     * 调用方法
     * @param event -   事件对象
     * @param dom -     渲染节点
     * @param e -       html 事件对象
     */
    private invoke;
    /**
     * 清除所有事件
     */
    clear(): void;
    /**
     * 处理dom event
     * @param dom -     新dom
     * @param oldDom -  旧dom，dom进行修改时有效
     */
    handleDomEvent(dom: RenderedDom, oldDom?: RenderedDom): void;
}
