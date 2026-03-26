/**
 * watch 管理器
 */
export class Watcher {
    /**
     * 添加监听
     * @remarks 相同model、key、module只能添加一次
     * @param module -  所属模块
     * @param model -   监听model
     * @param key -     监听属性或属性数组，如果为深度watch，则为func
     * @param func -    触发函数，参数依次为 model,key,oldValue,newValue，如果为深度watch，则为deep
     * @returns
     */
    static watch(module, model, key, func) {
        //深度监听
        if (typeof key === 'function') {
            return this.watchDeep(module, model, key);
        }
        if (!Array.isArray(key)) {
            key = [key];
        }
        for (let k of key) {
            if (!this.map.has(model)) {
                const o = {};
                o[k] = [{ module: module, func: func }];
                this.map.set(model, o);
            }
            else {
                const o = this.map.get(model);
                if (!o.hasOwnProperty(k)) {
                    o[k] = [{ module: module, func: func }];
                    this.map.set(model, o);
                }
                else {
                    const a = o[k];
                    //相同module只能监听一次
                    if (a.find(item => item.module === module)) {
                        continue;
                    }
                    a.push({ module: module, func: func });
                }
            }
        }
        //返回取消watch函数
        return () => {
            const o = this.map.get(model);
            for (let k of key) {
                let ii;
                //找到对应module的watch
                if ((ii = o[k].findIndex(item => item.module === module)) !== -1) {
                    o[k].splice(ii, 1);
                }
                if (o[k].length === 0) {
                    delete o[k];
                }
            }
        };
    }
    /**
     * 深度监听
     * @param module
     * @param model
     * @param func
     * @returns
     */
    static watchDeep(module, model, func) {
        if (this.deepMap.has(model)) {
            const arr = this.deepMap.get(model);
            if (arr.find(item => item.module === module)) {
                return;
            }
            arr.push({ module: module, func: func });
        }
        else {
            this.deepMap.set(model, [{ module: module, func: func }]);
        }
        return () => {
            this.deepMap.delete(model);
        };
    }
    /**
     * 处理监听
     * @param model -       model
     * @param key -         监听的属性名
     * @param oldValue -    旧值
     * @param newValue -    新值
     */
    static handle(model, key, oldValue, newValue) {
        if (this.map.size === 0 && this.deepMap.size === 0) {
            return;
        }
        let arr = [];
        if (this.map.has(model)) {
            const a = this.map.get(model)[key];
            if (a) {
                arr = a;
            }
        }
        //查找父model watch为true的对象
        if (this.deepMap.size > 0) {
            for (let m = model['__parent']; m; m = m['__parent']) {
                if (this.deepMap.has(m)) {
                    arr = arr.concat(this.deepMap.get(m));
                }
            }
        }
        if (arr.length > 0) {
            for (let o of arr) {
                o.func.call(o.module, model, key, oldValue, newValue);
            }
        }
    }
}
/**
 * model map
 * key: model
 * value: {key:{module:来源module,func:触发函数,deep:深度监听}}，其中key为监听属性
 */
Watcher.map = new Map();
/**
 * 深度watch map
 * key: model
 * value: {module:来源module,func:触发函数,deep:深度监听}
 */
Watcher.deepMap = new Map();
//# sourceMappingURL=wacher.js.map