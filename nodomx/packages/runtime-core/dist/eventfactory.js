import { NEvent } from "./event";
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
export class EventFactory {
    /**
     * 构造器
     * @param module - 模块
     */
    constructor(module) {
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
        this.eventMap = new Map();
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
        this.delgMap = new Map();
        this.module = module;
    }
    /**
     * 删除事件
     * @param event -     事件对象
     * @param key -       对应dom keys
     */
    addEvent(dom, event) {
        dom.events.push(event);
        if (dom.node) {
            this.bind(dom, [event]);
        }
    }
    /**
     * 删除事件
     * @param dom -     事件对象
     * @param event -   如果没有指定event，则表示移除该节点所有事件
     */
    removeEvent(dom, event) {
        var _a, _b, _c;
        const events = event ? [event] : dom.events;
        if (!events || !Array.isArray(events)) {
            return;
        }
        for (const ev of events) {
            if (ev.delg) { //代理事件
                //为避免key冲突，外部key后面添加s
                const pkey = dom.key === 1 ? ((_b = (_a = this.module.srcDom) === null || _a === void 0 ? void 0 : _a.parent) === null || _b === void 0 ? void 0 : _b.key) + 's' : (_c = dom.parent) === null || _c === void 0 ? void 0 : _c.key;
                //找到父对象
                if (!parent || !this.delgMap.has(pkey)) {
                    return;
                }
                const cfg = this.delgMap.get(dom.parent.key);
                if (!cfg[event.name]) {
                    return;
                }
                const obj = cfg[event.name];
                const index = obj.events.findIndex(item => item.event === event);
                if (index !== -1) {
                    obj.events.splice(index, 1);
                }
                //解绑事件
                if (obj.events.length === 0) {
                    this.unbind(dom.parent.key, event);
                }
            }
            else {
                this.unbind(dom.key, event);
            }
        }
    }
    /**
     * 绑定dom节点所有事件
     * @remarks
     * 执行addEventListener操作
     * @param dom -   渲染dom
     * @param event - 事件对象数组
     */
    bind(dom, events) {
        const el = dom.node;
        for (const ev of events) {
            if (ev.delg) { //代理事件
                //如果为子模块，则取srcDom.parent进行代理
                const parent = dom.key === 1 ? this.module.srcDom.parent : dom.parent;
                if (parent) {
                    this.bindDelg(parent, dom, ev);
                }
            }
            else {
                const controller = new AbortController();
                //绑定事件
                el.addEventListener(ev.name, (e) => {
                    //禁止冒泡
                    if (ev.nopopo) {
                        e.stopPropagation();
                    }
                    this.invoke(ev, dom, e);
                }, {
                    capture: ev.capture,
                    once: ev.once,
                    signal: controller.signal
                });
                //once为true不保存
                if (!ev.once) {
                    const o = { eventName: ev.name, controller: controller };
                    //保存signal用于撤销事件
                    if (!this.eventMap.has(dom.key)) {
                        this.eventMap.set(dom.key, [o]);
                    }
                    else {
                        this.eventMap.get(dom.key).push(o);
                    }
                }
            }
        }
    }
    /**
     * 绑定到代理对象
     * @param dom -     代理dom
     * @param dom1 -    被代理dom
     * @param event -   事件对象
     */
    bindDelg(dom, dom1, event) {
        let map;
        //代理dom和被代理dom节点不一致，则需要在key后面添加s
        const pkey = dom.moduleId !== dom1.moduleId ? dom.key + 's' : dom.key;
        if (!this.delgMap.has(dom.key)) {
            map = new Map();
            this.delgMap.set(pkey, map);
        }
        else {
            map = this.delgMap.get(pkey);
        }
        let cfg;
        if (map.has(event.name)) {
            cfg = map.get(event.name);
            cfg.events.push({ event: event, dom: dom1 });
        }
        else {
            cfg = { controller: new AbortController, events: [{ event: event, dom: dom1 }] };
            map.set(event.name, cfg);
            dom.node.addEventListener(event.name, (e) => {
                this.doDelgEvent(dom, event.name, e);
            }, {
                signal: cfg.controller.signal
            });
        }
    }
    /**
     * 解绑dom节点事件
     * @param dom -     渲染dom或dom key
     * @param event -   事件对象或事件名，如果为空，则解绑该dom的所有事件，如果为事件名，则表示代理事件
     * @param delg -    是否为代理事件，默认false
     */
    unbind(key, event, delg) {
        var _a, _b, _c;
        //获取代理标志
        if (event && event instanceof NEvent) {
            delg || (delg = event.delg);
        }
        if (delg) { //代理事件
            if (!this.delgMap.has(key)) {
                return;
            }
            const obj = this.delgMap.get(key);
            if (event) { //清除指定事件
                const eventName = event instanceof NEvent ? event.name : event;
                if (obj.has(eventName)) {
                    (_b = (_a = obj.get(eventName)) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.abort();
                }
            }
            else {
                for (const k of obj.keys()) {
                    (_c = obj.get(k).controller) === null || _c === void 0 ? void 0 : _c.abort();
                }
            }
        }
        else {
            if (!this.eventMap.has(key)) {
                return;
            }
            const arr = this.eventMap.get(key);
            if (event) {
                const o = arr.find(item => item.eventName === event);
                if (o) {
                    o.controller.abort();
                }
            }
            else {
                for (const o of arr) {
                    o.controller.abort();
                }
            }
            if (arr.length === 0) {
                this.eventMap.delete(key);
            }
        }
    }
    /**
     * 执行代理事件
     * @param dom -         代理节点
     * @param eventName -   事件名
     * @param e -           html event对象
     */
    doDelgEvent(dom, eventName, e) {
        //代理dom和被代理dom节点不一致，则需要在key后面添加s
        const key = dom.moduleId !== this.module.id ? dom.key + 's' : dom.key;
        if (!this.delgMap.has(key)) {
            return;
        }
        const map = this.delgMap.get(key);
        if (!map.has(eventName)) {
            return;
        }
        const cfg = map.get(eventName);
        const elArr = e.path || (e.composedPath ? e.composedPath() : undefined);
        if (!elArr) {
            return;
        }
        for (let ii = 0; ii < cfg.events.length; ii++) {
            const obj = cfg.events[ii];
            const ev = obj.event;
            //被代理的dom
            const dom1 = obj.dom;
            const el = dom1.node;
            for (let i = 0; i < elArr.length && elArr[i] !== dom.node; i++) {
                if (elArr[i] === el) {
                    this.invoke(ev, dom1, e);
                    // 只执行1次,移除事件
                    if (ev.once) {
                        //从当前dom删除
                        cfg.events.splice(ii--, 1);
                        //如果事件为空，则移除绑定的事件
                        if (cfg.events.length === 0) {
                            //解绑代理事件
                            this.unbind(key, eventName, true);
                        }
                    }
                    break;
                }
            }
        }
    }
    /**
     * 调用方法
     * @param event -   事件对象
     * @param dom -     渲染节点
     * @param e -       html 事件对象
     */
    invoke(event, dom, e) {
        // 如果事件所属模块和当前模块一致，则用当前dom model，否则表示为从父模块传递的事件，用子模块对应srcDom的model
        let model;
        if (event.module && event.module.id !== this.module.id) {
            model = this.module.srcDom.model;
            dom = this.module.srcDom;
        }
        else {
            //如果事件未更新，则dom还是之前的dom，需要找到最新的dom
            dom = event.module.getRenderedDom(dom.key);
            model = dom.model;
        }
        if (typeof event.handler === 'string') {
            event.module.invokeMethod(event.handler, model, dom, event, e);
        }
        else if (typeof event.handler === 'function') {
            event.handler.apply(event.module || this.module, [model, dom, event, e]);
        }
    }
    /**
     * 清除所有事件
     */
    clear() {
        //清除普通事件
        for (const key of this.eventMap.keys()) {
            this.unbind(key);
        }
        this.eventMap.clear();
        //清除代理事件
        for (const key of this.delgMap.keys()) {
            this.unbind(key, null, true);
        }
        this.delgMap.clear();
    }
    /**
     * 处理dom event
     * @param dom -     新dom
     * @param oldDom -  旧dom，dom进行修改时有效
     */
    handleDomEvent(dom, oldDom) {
        const events = dom.events;
        let arr = [];
        //存在旧节点时，需要对比旧节点事件
        if (oldDom && Array.isArray(oldDom.events)) {
            const oldEvents = oldDom.events;
            if (Array.isArray(events)) {
                events.forEach((ev) => {
                    let index;
                    //如果在旧节点已存在该事件，则从旧事件中移除
                    if ((index = oldEvents.indexOf(ev)) !== -1) {
                        oldEvents.splice(index, 1);
                    }
                    else { //记录未添加事件
                        arr.push(ev);
                    }
                });
            }
            //删除多余事件
            if (oldEvents.length > 0) {
                for (const ev of oldEvents) {
                    this.removeEvent(oldDom, ev);
                }
            }
        }
        else {
            arr = events;
        }
        //处理新节点剩余事件
        if ((arr === null || arr === void 0 ? void 0 : arr.length) > 0) {
            this.bind(dom, arr);
        }
    }
}
//# sourceMappingURL=eventfactory.js.map