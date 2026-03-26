import { Module } from "./module";
import { Util } from "./util";
import { EventMethod, RenderedDom} from "./types";
import { Expression } from "./expression";

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
export class NEvent {
    /**
     * 事件id
     */
    public id: number;

    /**
     * 事件所属模块
     */
    public module:Module;

    /**
     * 事件名
     */
    public name: string;

    /**
     * 事件处理方法
     * @remarks
     * 事件钩子对应的方法函数、方法名或表达式，如果为方法名，需要在模块中定义
     */
    public handler: string | EventMethod;

    /**
     * 表达式，当定义的事件串为表达式时有效
     */
    private expr:Expression;

    /**
     * 代理模式，事件代理到父对象
     */
    public delg: boolean;

    /**
     * 禁止冒泡，代理模式下无效
     */
    public nopopo: boolean;

    /**
     * 只执行一次
     */
    public once: boolean;

    /**
     * 使用capture，代理模式下无效
     */
    public capture: boolean;

    /**
     * 依赖事件
     * @remarks 
     * 当事件为扩展事件时，用于存储原始事件
     */
    public dependEvent:NEvent;

    /**
     * @param module -      模块
     * @param eventName -   事件名
     * @param eventCfg -    事件串或事件处理函数,以“:”分割,中间不能有空格,结构为: `方法名:delg:nopopo:once:capture`，`":"`后面的内容选择使用；
     *                      如果eventCfg为函数，则表示为事件处理函数
     * @param handler -     事件处理函数，此时eventCfg可以配置为 :delg:nopopo:once:capture等
     */
    constructor(module:Module,eventName: string, eventCfg?: string|EventMethod,handler?:EventMethod) {
        this.id = Util.genId();
        this.module = module;
        this.name = eventName;
        //如果事件串不为空，则不需要处理
        if(!eventCfg && !handler){
            return;
        }
        if (typeof eventCfg === 'string') {
            this.parseEvent(eventCfg.trim());
        }else if(typeof eventCfg === 'function'){
            this.handler = <EventMethod>eventCfg;
        }
        if(typeof handler === 'function'){
            this.handler = handler;
        }
        this.touchOrNot();
    }

    /**
     * 解析事件字符串
     * @param eventStr -  待解析的字符串
     */
    private parseEvent(eventStr){
        eventStr.split(':').forEach((item, i) => {
            item = item.trim();
            if (i === 0) { //事件方法
                if(item !== ''){
                    this.handler = item;
                }
            } else { //事件附加参数
                switch (item) {
                    case 'delg':
                        this.delg = true;
                        break;
                    case 'nopopo':
                        this.nopopo = true;
                        break;
                    case 'once':
                        this.once = true;
                        break;
                    case 'capture':
                        this.capture = true;
                        break;
                }
            }
        });
    }

    /**
     * 触屏转换
     */
    private touchOrNot(){
        if (document.ontouchend) { //触屏设备
            switch (this.name) {
                case 'click':
                    this.name = 'tap';
                    break;
                case 'mousedown':
                    this.name = 'touchstart';
                    break;
                case 'mouseup':
                    this.name = 'touchend';
                    break;
                case 'mousemove':
                    this.name = 'touchmove';
                    break;
            }
        } else { //转非触屏
            switch (this.name) {
                case 'tap':
                    this.name = 'click';
                    break;
                case 'touchstart':
                    this.name = 'mousedown';
                    break;
                case 'touchend':
                    this.name = 'mouseup';
                    break;
                case 'touchmove':
                    this.name = 'mousemove';
                    break;
            }
        }
    }
    /**
     * 设置附加参数值
     * @param module -    模块
     * @param dom -       虚拟dom
     * @param name -      参数名
     * @param value -     参数值
     */
    public setParam(dom:RenderedDom,name: string, value: unknown) {
        this.module.objectManager.setEventParam(this.id,dom.key,name,value);
    }

    /**
     * 获取附加参数值
     * @param dom -       虚拟dom
     * @param name -      参数名
     * @returns         附加参数值
     */
    public getParam(dom:RenderedDom,name: string):unknown {
        return this.module.objectManager.getEventParam(this.id,dom.key,name);
    }

    /**
     * 移除参数
     * @param dom -       虚拟dom
     * @param name -      参数名
     */
    public removeParam(dom:RenderedDom,name: string) {
        return this.module.objectManager.removeEventParam(this.id,dom.key,name);
    }
    /**
     * 清参数cache
     * @param dom -       虚拟dom
     */
    public clearParam(dom:RenderedDom){
        this.module.objectManager.clearEventParams(this.id,dom.key);
    }
}