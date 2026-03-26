import { Module } from "./module";
/**
 * model proxy
 */
export declare class Model {
    /**
     * @param data - data source
     * @param module - owner module
     * @param parent - parent model
     * @param name - property name in parent
     * @returns model proxy
     */
    constructor(data: object, module: Module, parent?: Model, name?: string);
}
