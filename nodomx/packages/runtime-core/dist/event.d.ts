import { Module } from "./module";
import { EventMethod, RenderedDom } from "./types";
/**
 * 事件类
 * @remarks
 * 事件分为自有事件和代理事件，事件默认传递参数为：
 *
 * 0: model(事件对应数据模型)
 *
 * 1: dom(事件target对应的虚拟dom节点)
 *
 * 2: evObj(Nodom Event对象)
 *
 * 3: e(Html Event对象)
 */
export declare class NEvent {
    /**
     * 事件id
     */
    id: number;
    /**
     * 事件所属模块
     */
    module: Module;
    /**
     * 事件名
     */
    name: string;
    /**
     * 事件处理方法
     * @remarks
     * 事件钩子对应的方法函数、方法名或表达式，如果为方法名，需要在模块中定义
     */
    handler: string | EventMethod;
    /**
     * 表达式，当定义的事件串为表达式时有效
     */
    private expr;
    /**
     * 代理模式，事件代理到父对象
     */
    delg: boolean;
    /**
     * 禁止冒泡，代理模式下无效
     */
    nopopo: boolean;
    /**
     * 只执行一次
     */
    once: boolean;
    /**
     * 使用capture，代理模式下无效
     */
    capture: boolean;
    /**
     * 依赖事件
     * @remarks
     * 当事件为扩展事件时，用于存储原始事件
     */
    dependEvent: NEvent;
    /**
     * @param module -      模块
     * @param eventName -   事件名
     * @param eventCfg -    事件串或事件处理函数,以“:”分割,中间不能有空格,结构为: `方法名:delg:nopopo:once:capture`，`":"`后面的内容选择使用；
     *                      如果eventCfg为函数，则表示为事件处理函数
     * @param handler -     事件处理函数，此时eventCfg可以配置为 :delg:nopopo:once:capture等
     */
    constructor(module: Module, eventName: string, eventCfg?: string | EventMethod, handler?: EventMethod);
    /**
     * 解析事件字符串
     * @param eventStr -  待解析的字符串
     */
    private parseEvent;
    /**
     * 触屏转换
     */
    private touchOrNot;
    /**
     * 设置附加参数值
     * @param module -    模块
     * @param dom -       虚拟dom
     * @param name -      参数名
     * @param value -     参数值
     */
    setParam(dom: RenderedDom, name: string, value: unknown): void;
    /**
     * 获取附加参数值
     * @param dom -       虚拟dom
     * @param name -      参数名
     * @returns         附加参数值
     */
    getParam(dom: RenderedDom, name: string): unknown;
    /**
     * 移除参数
     * @param dom -       虚拟dom
     * @param name -      参数名
     */
    removeParam(dom: RenderedDom, name: string): void;
    /**
     * 清参数cache
     * @param dom -       虚拟dom
     */
    clearParam(dom: RenderedDom): void;
}
