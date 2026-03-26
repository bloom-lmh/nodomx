import { Directive } from "./directive";
import { Module } from "./module";
import { ModuleFactory } from "./modulefactory";
import { Route } from "./route";
import { RenderedDom } from "./types";
import { Util } from "./util";
import { VirtualDom } from "./virtualdom";

/**
 * 路由管理类
 */
export class Router {
    /**
     * 根路由
     */
    private root:Route = new Route();

    /**
     * 根路由所属模块
     */
    private rootModule:Module;

    /**
     * 基础路径，实际显示路径为 basePath+routePath
     */
    private basePath:string;
    
    /**
     * 当前路径
     */
    public currentPath: string;

    /**
     * path等待链表
     */
    private waitList: Array<string> = [];

    /**
     * 默认路由进入事件方法
     */
    private onDefaultEnter: (module,path)=>void;
    /**
     * 默认路由离开事件
     */
    private onDefaultLeave: (module,path)=>void;

    /**
     * 启动方式 0:直接启动 1:popstate 启动
     */
    private startType: number;


    /**
     * 激活Dom map
     * key: path
     * value: object，格式为：
     * ```js
     *  {
     *      moduleId:dom所属模板模块id，
     *      model:对应model,
     *      field:激活字段名
     *  }
     * ```
     */
    // private activeModelMap: Map<string, object> = new Map();

    /**
     * 绑定到module的router指令对应的key，即router容器对应的key，格式为:
     * ```js
     *  {
     *      moduleId1:{
     *          //active节点
     *          activeDoms:[{
     *              dom:节点
     *              name:激活属性名
     *          }],
     *          dom:带router指令的dom节点
     *          //等待路由
     *          wait:route 
     *      },
     *      moduleId2:...
     *  }
     * ```
     *  moduleId: router所属模块id
     */
    private routerMap: Map<number, {activeDoms?:RenderedDom[],wait?:Route,dom?:RenderedDom}> = new Map();
    

    
    /**
     * 构造器
     * @param basePath -          路由基础路径，显示的完整路径为 basePath + route.path
     * @param defaultEnter -      默认进入时事件函数，传递参数： module,离开前路径
     * @param defaultLeave -      默认离开时事件函数，传递参数： module,进入时路径
     */
    constructor(basePath?:string,defaultEnter?:(module,path)=>void,defaultLeave?:(module,path)=>void){
        this.basePath = basePath;
        this.onDefaultEnter = defaultEnter;
        this.onDefaultLeave = defaultLeave;
        //添加popstate事件
        window.addEventListener('popstate', ()=>{
            //根据state切换module
            const state = history.state;
            if (!state) {
                return;
            }
            this.startType = 1;
            this.go(state.url);
        });
    }

    /**
     * 跳转
     * @remarks
     * 只是添加到跳转列表，并不会立即进行跳转
     * 
     * @param path -    路径 
     * @param type -    启动路由类型，参考startType，默认0
     */
    public go(path: string) {
        const me = this;
        // 当前路径的父路径不处理
        if (this.currentPath && this.currentPath.startsWith(path)) {
            return;
        }
        //添加路径到等待列表，已存在，不加入
        if (this.waitList.indexOf(path) === -1) {
            this.waitList.push(path);
        }

        checkRoot();
        /**
         * 检测routemodule是否已经存在，不存在则一致检查，直到出现为止
         */
        function checkRoot(){
            if(!me.rootModule){
                setTimeout(checkRoot,0);
            }else{
                me.load();
            }
        }
    }

    /**
     * 启动加载
     */
    private load() {
        //在加载，或无等待列表，则返回
        if (this.waitList.length === 0) {
            return;
        }
        //从等待队列拿路径加载
        this.start(this.waitList.shift()).then(() => {
            //继续加载
            this.load();
        });
    }

    /**
     * 切换路由
     * @param path - 	路径
     */
    private async start(path: string) {
        // 当前路径的父路径不处理
        if (this.currentPath?.startsWith(path)) {
            return;
        }
        //保存旧path
        const oldPath = this.currentPath;
        //设置当前path
        this.currentPath = path;
        const diff = this.compare(oldPath, path);
        // 不存在上一级模块,则为主模块，否则为上一级模块
        let parentModule: Module = diff[0] === null?this.rootModule:await this.getModule(diff[0]);
        //onleave事件，从末往前执行
        for (let i = diff[1].length - 1; i >= 0; i--) {
            const r = diff[1][i];
            if (!r.module) {
                continue;
            }
            const module: Module = await this.getModule(r);
            if (Util.isFunction(this.onDefaultLeave)) {
                this.onDefaultLeave(module,oldPath);
            }
            if (Util.isFunction(r.onLeave)) {
                r.onLeave(module,oldPath);
            }
            // 取消挂载
            module.unmount();
        }
        if (diff[2].length === 0) { //路由相同，参数不同
            const route: Route = diff[0];
            if (route !== null) {
                await this.getModule(route);
                // 模块处理
                this.handleRouteModule(route, diff[3] ? <Module>diff[3].module : null);
            }
        } else { //路由不同
            //加载模块
            for (let ii = 0; ii < diff[2].length; ii++) {
                const route: Route = diff[2][ii];
                //路由不存在或路由没有模块（空路由）
                if (!route || !route.module) {
                    continue;
                }
                const module: Module = await this.getModule(route);
                // 模块处理
                this.handleRouteModule(route, parentModule);
                //默认全局路由enter事件
                if (Util.isFunction(this.onDefaultEnter)) {
                    this.onDefaultEnter(module,path);
                }
                //当前路由进入事件
                if (Util.isFunction(route.onEnter)) {
                    route.onEnter(module,path);
                }
                parentModule = module;
            }
        }
        //如果是history popstate或新路径是当前路径的子路径，则不加入history
        if (this.startType !== 1) {
            const path1:string = (this.basePath||'') + path;
            //子路由或父路由，替换state
            if (path.startsWith(oldPath)) {
                history.replaceState({url:path1}, '', path1);
            } else { //路径push进history
                history.pushState({url:path1}, '', path1);
            }
        }
        //设置start类型为正常start
        this.startType = 0;
    }

    /**
     * 获取module
     * @param route - 路由对象 
     * @returns     路由对应模块
     */
    private async getModule(route: Route): Promise<Module> {
        let module = route.module;
        //已经是模块实例
        if (typeof module === 'object') {
            return module;
        }
        //模块路径
        if(typeof module === 'string'){
            module = await ModuleFactory.load(module);
        }
        //模块类
        if (typeof module === 'function') {
            route.module = ModuleFactory.get(module);
        }
        return <Module>route.module;
    }
    /**
     * 比较两个路径对应的路由链
     * @param path1 - 	第一个路径
     * @param path2 - 	第二个路径
     * @returns 		数组 [父路由或不同参数的路由，需要销毁的路由数组，需要增加的路由数组，不同参数路由的父路由]
     */
    private compare(path1: string, path2: string): [Route,Route[],Route[],Route] {
        // 获取路由id数组
        let arr1: Array<Route> = null;
        let arr2: Array<Route> = null;
        if (path1) {
            //采用克隆方式复制，避免被第二个路径返回的路由覆盖参数
            arr1 = this.getRouteList(path1, true);
        }
        if (path2) {
            arr2 = this.getRouteList(path2);
        }
        let len = 0;
        if (arr1 !== null) {
            len = arr1.length;
        }

        if (arr2 !== null) {
            if (arr2.length < len) {
                len = arr2.length;
            }
        } else {
            len = 0;
        }
        //需要销毁的旧路由数组
        let retArr1 = [];
        //需要加入的新路由数组
        let retArr2 = [];
        let i = 0;
        for (i = 0; i < len; i++) {
            //找到不同路由开始位置
            if (arr1[i].id === arr2[i].id) {
                //比较参数
                if (JSON.stringify(arr1[i].data) !== JSON.stringify(arr2[i].data)) {
                    i++;
                    break;
                }
            } else {
                break;
            }
        }
        //旧路由改变数组
        if (arr1 !== null) {
            retArr1 = arr1.slice(i);
        }
        //新路由改变数组（相对于旧路由）
        if (arr2 !== null) {
            retArr2 = arr2.slice(i);
        }
        //上一级路由或参数不同的当前路由
        let p1: Route = null;
        //上二级路由或参数不同路由的上一级路由
        let p2: Route = null;
        if (arr2 && i > 0) {
            // 可能存在空路由，需要向前遍历
            for (let j = i - 1; j >= 0; j--) {
                if (!p1) {
                    if (arr2[j].module) {
                        p1 = arr2[j];
                        continue;
                    }
                } else if (!p2) {
                    if (arr2[j].module) {
                        p2 = arr2[j];
                        break;
                    }
                }
            }
        }
        return [p1, retArr1, retArr2, p2];
    }

    /**
     * 添加激活对象
     * @param moduleId -    模块id
     * @param dom -         可激活节点
     * @param field -       激活字段名
     */
    public addActiveDom(module:Module,dom:RenderedDom) {
        if(!this.routerMap.has(module.id)){
            this.routerMap.set(module.id,{activeDoms:[]});
        }
        const cfg = this.routerMap.get(module.id);
        if(!cfg.activeDoms){
            cfg.activeDoms = [];
        }
        const index = cfg.activeDoms.findIndex(item=>item.key === dom.key)
        if(index === -1){
            cfg.activeDoms.push(dom);
        }else{ //替换
            cfg.activeDoms.splice(index,1,dom);
        }
    }

    /**
     * 设置路由元素激活属性
     * @param module -    模块 
     * @param path -      路径
     * @returns 
     */
    private setActiveDom(module:Module,path:string) {
        if(!this.routerMap.has(module.id)){
            return;
        }
        const cfg = this.routerMap.get(module.id);
        if(!cfg.activeDoms){
            return;
        }
        //与path一致的dom，设置其active=true，否则设置为false
        for(const dom of cfg.activeDoms){
            if(dom.props['path'] === path){
                dom.model[dom.props['active']] = true;
            }else{
                dom.model[dom.props['active']] = false;
            }
        }
    }
    
    /**
     * 路由模块相关处理
     * @param route -   路由 
     * @param pm -      父模块
     */
    private handleRouteModule(route: Route, pm: Module) {
        //设置参数
        const o = {
            path: route.path
        };
        if (!Util.isEmpty(route.data)) {
            o['data'] = route.data;
        }
        const module = <Module>route.module;
        module.model['$route'] = o;
        if(pm){
            if(!this.routerMap.has(pm.id)){
                this.routerMap.set(pm.id,{});
            }
            const cfg = this.routerMap.get(pm.id);
            //父模块router dom尚不存在，则添加到wait
            if(!cfg.dom){
                cfg.wait = route;
            }else{
                this.setActiveDom(pm,route.fullPath);
            }
            this.prepModuleDom(pm,route);
        }
    }

    /**
     * 为route.module设置dom
     * @param module -  父模块
     * @param route -   路由
     */
    private prepModuleDom(module:Module,route:Route){
        if(!this.routerMap.has(module.id)){
            return;
        }
        const cfg = this.routerMap.get(module.id);
        if(!cfg.dom){
            return;
        }
        if(!cfg.dom.vdom.children){
            cfg.dom.vdom.children = [];
        }
        const m = <Module>route.module;
        //dom key
        const key = m.id + '_r';
        const dom = cfg.dom.children?.find(item=>item.key === key);
        if(!dom){
            const vdom = new VirtualDom('div',key,module);
            const d = new Directive('module');
            d.value = m.id;
            vdom.addDirective(d);
            cfg.dom.vdom.add(vdom);
            module.active();
        }else {
            m.srcDom = dom;
            m.active();
        }
    }

    /**
     * 获取路由数组
     * @param path - 	要解析的路径
     * @param clone - 是否clone，如果为false，则返回路由树的路由对象，否则返回克隆对象
     * @returns     路由对象数组
     */
    private getRouteList(path: string, clone?: boolean): Array<Route> {
        if (!this.root) {
            return [];
        }
        const pathArr: string[] = path.split('/');
        let node: Route = this.root;
        let paramIndex: number = 0;      //参数索引
        const retArr: Array<Route> = [];
        let fullPath: string = '';       //完整路径
        let preNode: Route = this.root;  //前一个节点
        for (let i = 0; i < pathArr.length; i++) {
            const v: string = pathArr[i].trim();
            if (v === '') {
                continue;
            }
            let find: boolean = false;
            for (let j = 0; j < node.children.length; j++) {
                if (node.children[j].path === v) {
                    //设置完整路径
                    if (preNode !== this.root) {
                        preNode.fullPath = fullPath;
                        preNode.data = node.data;
                        retArr.push(preNode);
                    }
                    //设置新的查找节点
                    node = clone ? node.children[j].clone() : node.children[j];
                    //参数清空
                    node.data = {};
                    preNode = node;
                    find = true;
                    //参数索引置0
                    paramIndex = 0;
                    break;
                }
            }
            //路径叠加
            fullPath += '/' + v;
            //不是孩子节点,作为参数
            if (!find) {
                if (paramIndex < node.params.length) { //超出参数长度的废弃
                    node.data[node.params[paramIndex++]] = v;
                }
            }
        }
        //最后一个节点
        if (node !== this.root) {
            node.fullPath = fullPath;
            retArr.push(node);
        }
        return retArr;
    }

    /**
     * 注册路由容器
     * @param module -      router容器所属模块
     * @param dom -         路由模块 src dom
     */
    public registRouter(module:Module,dom:RenderedDom){
        if(!this.rootModule){
            this.rootModule = module;
        }
        if(!this.routerMap.has(module.id)){
            this.routerMap.set(module.id,{dom:dom});
        }
        const cfg = this.routerMap.get(module.id);
        cfg.dom = dom;
        //存在待处理路由
        if(cfg.wait){
            this.prepModuleDom(module,cfg.wait);
            //执行后删除
            delete cfg.wait;
        }
    }

    /**
     * 尝试激活路径
     * @param path -  待激活的路径
     */
    public activePath(path:string){
        // 如果当前路径为空或待激活路径是当前路径的子路径
        if(!this.currentPath || path.startsWith(this.currentPath)){
            this.go(path);
        }
    }

    /**
     * 获取根路由
     * @returns     根路由
     */
    public getRoot():Route{
        return this.root;
    }
}
