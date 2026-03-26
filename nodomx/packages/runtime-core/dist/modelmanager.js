import { Renderer } from "./renderer";
import { Watcher } from "./wacher";
/**
 * 模型工厂
 * @remarks
 * 管理模块的model
 */
export class ModelManager {
    /**
     * 添加共享model
     * @param model
     * @param modules
     */
    static addShareModel(model, module) {
        if (!this.shareModelMap.has(model)) {
            this.shareModelMap.set(model, [model['__module'], module]);
            return;
        }
        const arr = this.shareModelMap.get(model);
        if (arr.indexOf(module) === -1) {
            arr.push(module);
        }
    }
    /**
     * 获取module
     * @param model -   model
     * @returns         module或module数组（共享时）
     */
    static getModule(model) {
        if (this.shareModelMap.has(model)) {
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
    static update(model, key, oldValue, newValue) {
        if (this.shareModelMap.size > 0) {
            for (let m = model; m; m = m['__parent']) {
                if (this.shareModelMap.has(m)) {
                    for (let mdl of this.shareModelMap.get(m)) {
                        Renderer.add(mdl);
                    }
                    Watcher.handle(model, key, oldValue, newValue);
                    return;
                }
            }
        }
        Renderer.add(model['__module']);
        Watcher.handle(model, key, oldValue, newValue);
    }
    /**
     * 获取model属性值
     * @param key -     属性名，可以分级，如 name.firstName
     * @param model -   模型
     * @returns         属性值
     */
    static get(model, key) {
        if (key) {
            if (key.indexOf('.') !== -1) { //层级字段
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
    static set(model, key, value) {
        if (key.includes('.')) { //层级字段
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
/**
 * 共享model，被多个module使用
 *
 */
ModelManager.shareModelMap = new Map();
//# sourceMappingURL=modelmanager.js.map