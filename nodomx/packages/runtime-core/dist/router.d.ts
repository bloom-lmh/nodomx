import { Module } from "./module";
import { Route } from "./route";
import { RenderedDom } from "./types";
/**
 * 路由管理类
 */
export declare class Router {
    /**
     * 根路由
     */
    private root;
    /**
     * 根路由所属模块
     */
    private rootModule;
    /**
     * 基础路径，实际显示路径为 basePath+routePath
     */
    private basePath;
    /**
     * 当前路径
     */
    currentPath: string;
    /**
     * path等待链表
     */
    private waitList;
    /**
     * 默认路由进入事件方法
     */
    private onDefaultEnter;
    /**
     * 默认路由离开事件
     */
    private onDefaultLeave;
    /**
     * 启动方式 0:直接启动 1:popstate 启动
     */
    private startType;
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
    private routerMap;
    /**
     * 构造器
     * @param basePath -          路由基础路径，显示的完整路径为 basePath + route.path
     * @param defaultEnter -      默认进入时事件函数，传递参数： module,离开前路径
     * @param defaultLeave -      默认离开时事件函数，传递参数： module,进入时路径
     */
    constructor(basePath?: string, defaultEnter?: (module: any, path: any) => void, defaultLeave?: (module: any, path: any) => void);
    /**
     * 跳转
     * @remarks
     * 只是添加到跳转列表，并不会立即进行跳转
     *
     * @param path -    路径
     * @param type -    启动路由类型，参考startType，默认0
     */
    go(path: string): void;
    /**
     * 启动加载
     */
    private load;
    /**
     * 切换路由
     * @param path - 	路径
     */
    private start;
    /**
     * 获取module
     * @param route - 路由对象
     * @returns     路由对应模块
     */
    private getModule;
    /**
     * 比较两个路径对应的路由链
     * @param path1 - 	第一个路径
     * @param path2 - 	第二个路径
     * @returns 		数组 [父路由或不同参数的路由，需要销毁的路由数组，需要增加的路由数组，不同参数路由的父路由]
     */
    private compare;
    /**
     * 添加激活对象
     * @param moduleId -    模块id
     * @param dom -         可激活节点
     * @param field -       激活字段名
     */
    addActiveDom(module: Module, dom: RenderedDom): void;
    /**
     * 设置路由元素激活属性
     * @param module -    模块
     * @param path -      路径
     * @returns
     */
    private setActiveDom;
    /**
     * 路由模块相关处理
     * @param route -   路由
     * @param pm -      父模块
     */
    private handleRouteModule;
    /**
     * 为route.module设置dom
     * @param module -  父模块
     * @param route -   路由
     */
    private prepModuleDom;
    /**
     * 获取路由数组
     * @param path - 	要解析的路径
     * @param clone - 是否clone，如果为false，则返回路由树的路由对象，否则返回克隆对象
     * @returns     路由对象数组
     */
    private getRouteList;
    /**
     * 注册路由容器
     * @param module -      router容器所属模块
     * @param dom -         路由模块 src dom
     */
    registRouter(module: Module, dom: RenderedDom): void;
    /**
     * 尝试激活路径
     * @param path -  待激活的路径
     */
    activePath(path: string): void;
    /**
     * 获取根路由
     * @returns     根路由
     */
    getRoot(): Route;
}
