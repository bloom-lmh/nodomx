import { Model } from "./model";
import { Module } from "./module";
/**
 * 模型工厂
 * @remarks
 * 管理模块的model
 */
export declare class ModelManager {
    /**
     * 共享model，被多个module使用
     *
     */
    private static shareModelMap;
    /**
     * 添加共享model
     * @param model
     * @param modules
     */
    static addShareModel(model: Model, module: Module): void;
    /**
     * 获取module
     * @param model -   model
     * @returns         module或module数组（共享时）
     */
    static getModule(model: Model): Module | Module[];
    /**
     * 更新model
     * @param model
     * @param key
     * @param oldValue
     * @param newValue
     * @returns
     */
    static update(model: any, key: any, oldValue: any, newValue: any): void;
    /**
     * 获取model属性值
     * @param key -     属性名，可以分级，如 name.firstName
     * @param model -   模型
     * @returns         属性值
     */
    static get(model: Model, key?: string): unknown;
    /**
     * 设置model属性值
     * @param model -   模型
     * @param key -     属性名，可以分级，如 name.firstName
     * @param value -   属性值
     */
    static set(model: Model, key: string, value: unknown): void;
}
