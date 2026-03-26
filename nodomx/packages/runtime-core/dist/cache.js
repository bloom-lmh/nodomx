/**
 * 缓存模块
 */
export class NCache {
    constructor() {
        /**
         * 缓存数据容器
         */
        this.cacheData = {};
        /**
         * 订阅map，格式为
         * ```js
         * {
         *  key:[{
         *      module:订阅模块,
         *      handler:回调钩子
         * },...]}
         * ```
         */
        this.subscribeMap = new Map();
    }
    /**
     * 通过提供的键名从内存中拿到对应的值
     * @param key - 键，支持"."（多级数据分割）
     * @returns     值或undefined
     */
    get(key) {
        let p = this.cacheData;
        if (key.indexOf('.') !== -1) {
            const arr = key.split('.');
            if (arr.length > 1) {
                for (let i = 0; i < arr.length - 1 && p; i++) {
                    p = p[arr[i]];
                }
                if (p) {
                    key = arr[arr.length - 1];
                }
            }
        }
        if (p) {
            return p[key];
        }
    }
    /**
     * 通过提供的键名和值将其存储在内存中
     * @param key -     键
     * @param value -   值
     */
    set(key, value) {
        let p = this.cacheData;
        const key1 = key;
        if (key.indexOf('.') !== -1) {
            const arr = key.split('.');
            if (arr.length > 1) {
                for (let i = 0; i < arr.length - 1; i++) {
                    if (!p[arr[i]] || typeof p[arr[i]] !== 'object') {
                        p[arr[i]] = {};
                    }
                    p = p[arr[i]];
                }
                key = arr[arr.length - 1];
            }
        }
        if (p) {
            p[key] = value;
        }
        //处理订阅
        if (this.subscribeMap.has(key1)) {
            const arr = this.subscribeMap.get(key1);
            for (const a of arr) {
                this.invokeSubscribe(a.module, a.handler, value);
            }
        }
    }
    /**
     * 通过提供的键名将其移除
     * @param key -   键
     */
    remove(key) {
        let p = this.cacheData;
        if (key.indexOf('.') !== -1) {
            const arr = key.split('.');
            if (arr.length > 1) {
                for (let i = 0; i < arr.length - 1 && p; i++) {
                    p = p[arr[i]];
                }
                if (p) {
                    key = arr[arr.length - 1];
                }
            }
        }
        if (p) {
            delete p[key];
        }
    }
    /**
     * 订阅
     * @param module -    订阅的模块
     * @param key -       订阅的属性名
     * @param handler -   回调函数或方法名（方法属于module），方法传递参数为订阅属性名对应的值
     */
    subscribe(module, key, handler) {
        if (!this.subscribeMap.has(key)) {
            this.subscribeMap.set(key, [{ module: module, handler: handler }]);
        }
        else {
            const arr = this.subscribeMap.get(key);
            if (!arr.find(item => item.module === module && item.handler === handler)) {
                arr.push({ module: module, handler: handler });
            }
        }
        //如果存在值，则执行订阅回调
        const v = this.get(key);
        if (v) {
            this.invokeSubscribe(module, handler, v);
        }
    }
    /**
     * 调用订阅方法
     * @param module -  模块
     * @param foo -     方法或方法名
     * @param v -       值
     */
    invokeSubscribe(module, foo, v) {
        if (typeof foo === 'string') {
            module.invokeMethod(foo, v);
        }
        else {
            foo.call(module, v);
        }
    }
}
//# sourceMappingURL=cache.js.map