import { bindStateHost, configureReactivityRuntime, isComputed, isRef, shouldSkipModelProxy, track, trigger, unbindStateHost, unwrapState } from "@nodomx/reactivity";
import { ModelManager } from "./modelmanager";
import { Util } from "./util";
configureReactivityRuntime({
    notifyBindingUpdate(model, key, oldValue, newValue) {
        ModelManager.update(model, key, oldValue, newValue);
    }
});
/**
 * model proxy
 */
export class Model {
    /**
     * @param data - data source
     * @param module - owner module
     * @param parent - parent model
     * @param name - property name in parent
     * @returns model proxy
     */
    constructor(data, module, parent, name) {
        const source = data;
        if (!data || typeof data !== "object" || source["__module"]) {
            return data;
        }
        source["__key"] = Util.genId();
        const proxy = new Proxy(source, {
            set(src, key, value, receiver) {
                if (typeof key === "symbol") {
                    src[key] = value;
                    return true;
                }
                const current = src[key];
                if ((isRef(current) || isComputed(current))
                    && !Object.is(current, value)
                    && !isRef(value)
                    && !isComputed(value)) {
                    current.value = value;
                    return true;
                }
                if (Object.is(current, value)) {
                    return true;
                }
                unbindStateHost(current, receiver, key);
                const newValue = value;
                if (value && newValue["__module"] && src["__module"] !== newValue["__module"]) {
                    ModelManager.addShareModel(value, src["__module"] || module);
                }
                bindStateHost(value, receiver, key);
                src[key] = value;
                ModelManager.update(receiver, key, current, value);
                trigger(receiver, key);
                return true;
            },
            get(src, key, receiver) {
                if (typeof key === "symbol") {
                    return Reflect.get(src, key, receiver);
                }
                if (key === "__module") {
                    return receiver ? module : undefined;
                }
                if (key === "__parent") {
                    return parent;
                }
                if (key !== "__key") {
                    track(receiver, key);
                }
                let value = src[key];
                if (shouldSkipModelProxy(value)) {
                    return unwrapState(value);
                }
                if (value && typeof value === "object" && !value["__module"]) {
                    value = new Model(value, module, receiver, name || key);
                    src[key] = value;
                }
                return value;
            },
            deleteProperty(src, key) {
                if (typeof key === "symbol") {
                    return Reflect.deleteProperty(src, key);
                }
                const oldValue = src[key];
                unbindStateHost(oldValue, proxy, key);
                delete src[key];
                ModelManager.update(proxy, key, oldValue, undefined);
                trigger(proxy, key);
                return true;
            }
        });
        for (const key of Object.keys(source)) {
            bindStateHost(source[key], proxy, key);
        }
        return proxy;
    }
}
//# sourceMappingURL=model.js.map