import { Model } from "./model";
import { Module } from "./module";
import { Renderer } from "./renderer";
import { Watcher } from "./wacher";

/**
 * 模型工厂
 * @remarks
 * 管理模块的model
 */
export class ModelManager {
    /**
     * 共享model，被多个module使用
     * 
     */
    private static shareModelMap:Map<Model,Module[]> = new Map();

    /**
     * 添加共享model
     * @param model 
     * @param modules 
     */
    public static addShareModel(model:Model,module:Module){
        if(!this.shareModelMap.has(model)){
            this.shareModelMap.set(model,[model['__module'],module]);
            return;
        }
        const arr = this.shareModelMap.get(model);
        if(arr.indexOf(module) === -1){
            arr.push(module);
        }
    }
    
    /**
     * 获取module
     * @param model -   model
     * @returns         module或module数组（共享时） 
     */
    public static getModule(model:Model):Module|Module[]{
        if(this.shareModelMap.has(model)){
            return this.shareModelMap.get(model);
        }
        return model['__module'];
    }

    /**
     * 更新model
     * @param model 
     * @param key 
     * @param oldValue 
     * @param newValue 
     * @returns 
     */
    public static update(model,key,oldValue,newValue){
        if(this.shareModelMap.size > 0){
            for(let m=model;m;m=m['__parent']){
                if(this.shareModelMap.has(m)){
                    for(let mdl of this.shareModelMap.get(m)){
                        Renderer.add(mdl);
                    }
                    Watcher.handle(model,key,oldValue,newValue);
                    return;
                }
            }
        }
        Renderer.add(model['__module']);
        Watcher.handle(model,key,oldValue,newValue);
    }

    
    
    /**
     * 获取model属性值
     * @param key -     属性名，可以分级，如 name.firstName
     * @param model -   模型
     * @returns         属性值
     */
    public static get(model:Model, key?: string):unknown {
        if(key){
            if (key.indexOf('.') !== -1) {    //层级字段
                const arr = key.split('.');
                for (let i = 0; i < arr.length - 1; i++) {
                    model = model[arr[i]];
                    if (!model) {
                        break;
                    }
                }
                if (!model) {
                    return;
                }
                key = arr[arr.length - 1];
            }
            model = model[key];
        }
        return model;
    }

    /**
     * 设置model属性值
     * @param model -   模型
     * @param key -     属性名，可以分级，如 name.firstName
     * @param value -   属性值
     */
    public static set(model:Model,key:string,value:unknown){
        if (key.includes('.')) {    //层级字段
            const arr = key.split('.');
            for (let i = 0; i < arr.length - 1; i++) {
                //不存在，则创建新的model
                if (!model[arr[i]]) {
                    model[arr[i]] = {};
                }
                model = model[arr[i]];
            }
            key = arr[arr.length - 1];
        }
        model[key] = value;
    }
}