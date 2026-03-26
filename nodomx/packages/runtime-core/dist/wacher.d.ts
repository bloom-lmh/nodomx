import { Model } from "./model";
import { Module } from "./module";
/**
 * watch 管理器
 */
export declare class Watcher {
    /**
     * model map
     * key: model
     * value: {key:{module:来源module,func:触发函数,deep:深度监听}}，其中key为监听属性
     */
    private static map;
    /**
     * 深度watch map
     * key: model
     * value: {module:来源module,func:触发函数,deep:深度监听}
     */
    private static deepMap;
    /**
     * 添加监听
     * @remarks 相同model、key、module只能添加一次
     * @param module -  所属模块
     * @param model -   监听model
     * @param key -     监听属性或属性数组，如果为深度watch，则为func
     * @param func -    触发函数，参数依次为 model,key,oldValue,newValue，如果为深度watch，则为deep
     * @returns
     */
    static watch(module: Module, model: Model, key: string | string[] | Function, func?: Function): () => void;
    /**
     * 深度监听
     * @param module
     * @param model
     * @param func
     * @returns
     */
    private static watchDeep;
    /**
     * 处理监听
     * @param model -       model
     * @param key -         监听的属性名
     * @param oldValue -    旧值
     * @param newValue -    新值
     */
    static handle(model: any, key: any, oldValue: any, newValue: any): void;
}
