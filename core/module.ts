import { Compiler } from "./compiler";
import { CssManager } from "./cssmanager";
import { Model } from "./model";
import { ModuleFactory } from "./modulefactory";
import { ObjectManager } from "./objectmanager";
import { Renderer } from "./renderer";
import { Util } from "./util";
import { DiffTool } from "./difftool";
import { EModuleState, RenderedDom, UnknownMethod } from "./types";
import { EventFactory } from "./eventfactory";
import { DomManager } from "./dommanager";
import { ModelManager } from "./modelmanager";
import { Watcher } from "./wacher";
import { withCurrentModule } from "./composition";

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
export class Module {
    /**
     * 模块id(全局唯一)
     */
    public id: number;

    /**
     * 模型，代理过的data
     */
    public model:Model;

    /**
     * 子模块数组，模板中引用的所有子模块
     */
    public children: Array<Module> = [];

    /**
     * 父模块id，B模块在A模块模板中使用，则指向A模块Id
     * 
     */
    private parentId: number;

    /**
     * 模块状态
     */
    public state: EModuleState;

    /**
     * 模型管理器
     */
    public modelManager:ModelManager;
    
    /**
     * 对象管理器，用于管理虚拟dom节点、指令、表达式、事件对象及其运行时参数
     */
    public objectManager:ObjectManager;

    /**
     * dom 管理器，管理虚拟dom、渲染dom和html node
     */
    public domManager:DomManager;

    /**
     * 事件工厂
     */
    public eventFactory:EventFactory;

    /**
     * 源dom，子模块对应dom
     */
    public srcDom:RenderedDom;

    /**
     * 父模块通过dom节点传递的属性
     */
    public props:object;

    /**
     * 模板中引用的模块类集合
     * 如果引用的模块类已通过registModule注册，这里不再声明
     */
    public modules: unknown[];

    /**
     * 不渲染的属性（这些属性用于生产模板，不作为属性渲染到模块根节点）
     */
    public excludedProps:string[];

    /**
     * 旧模板串
     */
    private oldTemplate:string;

    /**
     * slot map
     * 
     * key: slot name
     * 
     * value: 渲染节点
     * 
     */
    public slots:Map<string,RenderedDom> = new Map();

    /**
     * 模块引入的css rules 名数组
     */
    public cssRules:string[];

    /**
     * cleanup callbacks created by composition api
     */
    private compositionCleanups:Array<() => void> = [];

    /**
     * 构造器
     * @param id -  模块id
     */
    constructor(id?:number) {
        this.id = id || Util.genId();
        // this.modelManager = new ModelManager(this);
        this.domManager = new DomManager(this);
        this.objectManager = new ObjectManager(this);
        this.eventFactory = new EventFactory(this);
        //加入模块工厂
        ModuleFactory.add(this);
    }

    /**
     * 初始化操作
     */
    public init(){
        this.state = EModuleState.INIT;
        //注册子模块
        if(Array.isArray(this.modules)){
            for (const cls of this.modules) {
                ModuleFactory.addClass(cls);
            }
            delete this.modules;
        }
        //初始化model
        this.model = new Model(this.data()||{} , this);
        this.initSetupState();
        this.doModuleEvent('onInit');
    }

    /**
     * 模板串方法，使用时需重载
     * @param props -   props对象，在模板中进行配置，从父模块传入
     * @returns         模板串
     * @virtual
     */
    public template(props?:object):string{
        return null;
    }

    /**
     * 数据方法，使用时需重载
     * @returns  数据对象
     * @virtual
     */
    public data():object{
        return {};
    }

    /**
     * composition api entry
     */
    public setup(): Record<string, unknown> | void {
        return;
    }
    
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
    public render(): boolean {
        //不是主模块，也没有srcDom，则不渲染
        if(this !== ModuleFactory.getMain() && (!this.srcDom || this.state === EModuleState.UNMOUNTED )){
            return;
        }
        //获取首次渲染标志
        const firstRender = this.oldTemplate===undefined;
        //检测模板并编译
        let templateStr = this.template(this.props);
        if(!templateStr){
            return;
        }
        templateStr = templateStr.trim();
        if(templateStr === ''){
            return;
        }
        //与旧模板不一样，需要重新编译
        if(templateStr !== this.oldTemplate){
            this.oldTemplate = templateStr;
            this.compile(templateStr);
        }
        //不存在domManager.vdomTree，不渲染
        if(!this.domManager.vdomTree){
            return;
        }
        //首次渲染
        if(firstRender){
            this.doModuleEvent('onBeforeFirstRender');
        }
        //渲染前事件
        this.doModuleEvent('onBeforeRender');
        //保留旧树
        const oldTree = this.domManager.renderedTree;
        //渲染
        const root = Renderer.renderDom(this,this.domManager.vdomTree,this.model);
        this.domManager.renderedTree = root;
        //每次渲染后事件
        this.doModuleEvent('onRender');
        //首次渲染
        if(firstRender){
            this.doModuleEvent('onFirstRender');    
        }
        
        //渲染树为空，从html卸载
        if(!this.domManager.renderedTree){
            this.unmount();
            return;
        }
        //已经挂载
        if(this.state === EModuleState.MOUNTED){
            if(oldTree && this.model){
                //新旧渲染树节点diff
                const changeDoms = DiffTool.compare(this.domManager.renderedTree,oldTree);
                //执行更改
                if(changeDoms.length>0){
                    //html节点更新前事件
                    this.doModuleEvent('onBeforeUpdate');
                    Renderer.handleChangedDoms(this,changeDoms);
                    //html节点更新后事件
                    this.doModuleEvent('onUpdate');
                }
            }
        }else { //未挂载
            this.mount();
        }
    }

    /**
     * 添加子模块
     * @param module -    模块id或模块
     */
    public addChild(module: Module) {
        if (!this.children.includes(module)) {
            this.children.push(module);
            module.parentId = this.id;
        }
    }

    /**
     * 移除子模块
     * @param module -    子模块
     */
    public removeChild(module: Module) {
        const ind=this.children.indexOf(module);
        if (ind !== -1) {
            module.unmount();
            this.children.splice(ind,1);
        }
    }

    /**
     * 激活模块(准备渲染)
     */
    public active() {
        if(this.state === EModuleState.UNMOUNTED){
            this.state = EModuleState.INIT;
        }
        Renderer.add(this);
    }

    /**
     * 挂载到document
     */
    public mount(){
        //不是主模块或srcDom.node没有父element，则不执行挂载
        if(this !== ModuleFactory.getMain() && !this.srcDom?.node?.parentElement){
            return;
        }
        //执行挂载前事件
        this.doModuleEvent('onBeforeMount');
        //渲染到fragment
        const rootEl = new DocumentFragment();
        const el = Renderer.renderToHtml(this,this.domManager.renderedTree,rootEl);
        //主模块，直接添加到根模块
        if(this === ModuleFactory.getMain()){
            Renderer.getRootEl().appendChild(el);
        }else if(this.srcDom?.node?.parentElement){ //挂载到父模块中
            Util.insertAfter(el,this.srcDom.node);
        }
        
        //执行挂载后事件
        this.doModuleEvent('onMount');
        this.state = EModuleState.MOUNTED;
    }

    /**
     * 从document移除
     * @param passive -     被动卸载，父模块释放或模块被删除时导致的卸载，此时不再保留srcDom.node，状态修改INIT，否则修改为UNMOUNTED
     */
    public unmount(passive?:boolean){
        // 主模块或状态为unmounted的模块不用处理
        if (this.state !== EModuleState.MOUNTED || ModuleFactory.getMain() === this) {
            return;
        }
        //从render列表移除
        Renderer.remove(this);
        //执行卸载前事件
        this.doModuleEvent('onBeforeUnMount');
        //清空event factory
        this.eventFactory.clear();
        //删除渲染树
        this.domManager.renderedTree = null;
        
        //设置状态，如果为被动卸载，则设置为init，否则设置为unmounted
        if(passive){
            this.state = EModuleState.INIT;
        }else{
            this.state = EModuleState.UNMOUNTED;
        }

        //子模块被动卸载
        for(const m of this.children){
            m.unmount(true);
        }

        //从html dom树摘除
        if(this.srcDom.node?.parentElement){
            //后节点不为comment，则为模块节点
            if(this.srcDom.node.nextSibling && !(this.srcDom.node.nextSibling instanceof Comment)){
                this.srcDom.node.parentElement.removeChild(this.srcDom.node.nextSibling);
            }
            //如果是被动卸载，表示为父模块发起，则删除占位符
            if(passive){
                this.srcDom.node.parentElement.removeChild(this.srcDom.node);
            }
        }
        //执行卸载后事件
        this.doModuleEvent('onUnMount');
    }

    /**
     * 销毁
     */
    public destroy(){
        Renderer.remove(this);
        this.unmount(true);
        for(const m of this.children){
            m.destroy();
        }
        this.eventFactory.clear();
        if(this.domManager?.renderedTree?.node?.parentElement){
            this.domManager.renderedTree.node.parentElement.removeChild(this.domManager.renderedTree.node);
        }
        this.domManager.renderedTree = null;
        this.clearCompositionCleanups();
        //清理css url
        CssManager.clearModuleRules(this);
        //清除dom参数
        this.objectManager.clearAllDomParams();
        //从modulefactory移除
        ModuleFactory.remove(this.id);
    } 

    /**
     * 获取父模块
     * @returns     父模块   
     */
    public getParent(): Module {
        if (this.parentId) {
            return ModuleFactory.get(this.parentId);
        }
    }

    /**
     * 执行模块事件
     * @param eventName -   事件名
     * @returns             执行结果
     */
    public doModuleEvent(eventName: string):boolean{
        const foo = this[eventName];
        if(foo && typeof foo==='function'){
            return foo.apply(this,[this.model]);
        }
    }

    /**
     * 设置props
     * @param props -   属性值
     * @param dom -     子模块对应渲染后节点
     */
    public setProps(props:object,dom:RenderedDom){
        if(!props){
            return;
        }
        const dataObj = props['$data'];
        delete props['$data'];
        //props数据复制到模块model
        if(dataObj){
            for(const d of Object.keys(dataObj)){
                this.model[d] = dataObj[d];

            }
        }
        //保留src dom
        this.srcDom = dom;
        //如果不存在旧的props，则change为true，否则初始化为false
        let change:boolean = false;
        if(!this.props){
            change = true;
        }else{
            for(const k of Object.keys(props)){
                if(props[k] !== this.props[k]){
                    change = true;
                }
            }
        }
        //对于 MOUNTED 状态进行渲染
        if(change && this.state === EModuleState.MOUNTED){
            Renderer.add(this);
        }
        //保存props
        this.props = props;
    }

    /**
     * 编译
     * 出现编译，表示
     */
    private compile(templateStr:string){
        this.children = [];
        //清理css url
        CssManager.clearModuleRules(this);
        //清除dom参数
        this.objectManager.clearAllDomParams();
        
        this.eventFactory.clear();
        this.domManager.vdomTree = new Compiler(this).compile(templateStr);
        if(!this.domManager.vdomTree){
            return;
        }
        //添加从源dom传递的事件
        const root = this.domManager.vdomTree;
        if(this.srcDom?.events){
            if(root.events){
                root.events = root.events.concat(this.srcDom.events);
            }else{
                root.events = this.srcDom.events;
            }
        }
        //增加编译后事件
        this.doModuleEvent('onCompile');
    }

    /**
     * 设置不渲染到根dom的属性集合
     * @param props -   待移除的属性名属组
     */
    public setExcludeProps(props:string[]){
        this.excludedProps = props;
    }

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
    public getModule(name:string,attrs?:object,deep?:boolean):Module{
        if(!this.children){
            return;
        }
        const cls = ModuleFactory.getClass(name);
        if(!cls){
            return;
        }
        return find(this);
        /**
         * 查询
         * @param mdl -   模块
         * @returns     符合条件的子模块
         */
        function find(mdl){
            for(const m of mdl.children){
                if(m.constructor === cls){
                    if(attrs){  //属性集合不为空
                        //全匹配标识
                        let matched:boolean = true;
                        for(const k of Object.keys(attrs)){
                            if(!m.props || m.props[k] !== attrs[k]){
                                matched = false;
                                break;
                            }
                        }
                        if(matched){
                            return m;
                        }
                    }else{
                        return m;
                    }
                }
                //递归查找
                if(deep){
                    const r = find(m);
                    if(r){
                        return r;
                    }
                }
            }
        }
        
    }

    /**
     * 获取模块类名对应的所有子模块
     * @param className -   子模块类名
     * @param deep -        深度查询
     */
     public getModules(className:string,attrs?:object,deep?:boolean):Module[]{
        if(!this.children){
            return;
        }
        const arr = [];
        find(this);
        return arr;

        /**
         * 查询
         * @param module -  模块
         */
        function find(module:Module){
            if(!module.children){
                return;
            }
            for(const m of module.children){
                if(attrs){  //属性集合不为空
                    //全匹配标识
                    let matched:boolean = true;
                    for(const k of Object.keys(attrs)){
                        if(!m.props || m.props[k] !== attrs[k]){
                            matched = false;
                            break;
                        }
                    }
                    if(matched){
                        arr.push(m);
                    }
                }else{
                    arr.push(m);
                }
                //递归查找
                if(deep){
                    find(m);
                }
            }   
        }
    }

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
    public watch(model:Model|string|string[],key:string|string[]|((m,k,ov,nv)=>void),func?:((m,k,ov,nv)=>void)){
        const tp = typeof model;
        if(tp === 'string' || Array.isArray(model)){  //字符串或数组
            return Watcher.watch(this,this.model,<string>model,<Function>key);
        }else if(tp === 'object'){ // 数据对象
            return Watcher.watch(this,model,key,func);
        }else if(tp === 'function'){ // 钩子函数
            return Watcher.watch(this,this.model,<Function>model);
        }
    }

    /**
     * 设置模型属性值
     * @remarks
     * 参数个数可变，如果第一个参数为属性名，则第二个参数为属性值，默认model为根模型，否则按照参数说明
     * 
     * @param model -     模型
     * @param key -       子属性，可以分级，如 name.firstName
     * @param value -     属性值
     */
    public set(model:Model|string,key:unknown,value?:unknown){
        if (typeof model === 'object') {
            ModelManager.set(model,<string>key,value);
        }else{
            ModelManager.set(this.model,<string>model,key);
        }
    }

    /**
     * 获取模型属性值
     * @remarks
     * 参数个数可变，如果第一个参数为属性名，默认model为根模型，否则按照参数说明
     * 
     * @param model -   模型
     * @param key -     属性名，可以分级，如 name.firstName，如果为null，则返回自己
     * @returns         属性值
     */
    public get(model:Model|string, key?:string):unknown {
        if (typeof model === 'object') {
            return ModelManager.get(model,key);
        }else{
            return ModelManager.get(this.model,<string>model);
        }
    }

    /**
     * 调用模块方法
     * @param methodName -  方法名
     * @param args -        参数
     */
    public invokeMethod(methodName:string,...args){
        if(typeof this[methodName] === 'function'){
            return this[methodName](...args);
        }
    }

    /**
     * 根据条件获取渲染节点
     * @param params -  条件，dom key 或 props键值对
     * @returns         渲染节点 
     */
    public getRenderedDom(params):RenderedDom{
        return this.domManager.getRenderedDom(params);
    }
    
    /**
     * 根据条件获取html节点
     * @param params -  条件，dom key 或 props键值对
     * @returns         html node 
     */
    public getNode(params):Node{
        return this.domManager.getRenderedDom(params)?.node;
    }

    /**
     * register a composition cleanup callback
     * @param cleanup - cleanup callback
     */
    public addCompositionCleanup(cleanup: () => void): void {
        if(typeof cleanup === 'function'){
            this.compositionCleanups.push(cleanup);
        }
    }

    /**
     * initialize setup result
     */
    private initSetupState(): void {
        const result = withCurrentModule(this,()=>this.setup());
        if(!result || typeof result !== 'object'){
            return;
        }
        for(const key of Object.keys(result)){
            const value = result[key];
            if(typeof value === 'function'){
                (<Record<string, unknown>><unknown>this)[key] = value.bind(this);
            }else{
                (<Record<string, unknown>><unknown>this.model)[key] = value;
            }
        }
    }

    /**
     * run and clear composition cleanups
     */
    private clearCompositionCleanups(): void {
        if(this.compositionCleanups.length === 0){
            return;
        }
        for(const cleanup of this.compositionCleanups.splice(0)){
            cleanup();
        }
    }
}
