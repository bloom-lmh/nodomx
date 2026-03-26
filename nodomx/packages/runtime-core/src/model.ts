import {
    bindStateHost,
    configureReactivityRuntime,
    isComputed,
    isRef,
    shouldSkipModelProxy,
    track,
    trigger,
    unbindStateHost,
    unwrapState
} from "@nodomx/reactivity";
import { ModelManager } from "./modelmanager";
import { Module } from "./module";
import { Util } from "./util";

type ModelData = Record<string | symbol, unknown>;

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
    constructor(data: object, module: Module, parent?: Model, name?: string) {
        const source = data as ModelData;
        if (!data || typeof data !== "object" || source["__module"]) {
            return data;
        }
        source["__key"] = Util.genId();

        const proxy = new Proxy(source, {
            set(src: ModelData, key: string | symbol, value: unknown, receiver: Model) {
                if (typeof key === "symbol") {
                    src[key] = value;
                    return true;
                }
                const current = src[key];
                if ((isRef(current) || isComputed(current))
                    && !Object.is(current, value)
                    && !isRef(value)
                    && !isComputed(value)) {
                    (current as { value: unknown }).value = value;
                    return true;
                }
                if (Object.is(current, value)) {
                    return true;
                }
                unbindStateHost(current, receiver, key);
                const newValue = value as ModelData;
                if (value && newValue["__module"] && src["__module"] !== newValue["__module"]) {
                    ModelManager.addShareModel(
                        value as Model,
                        (src["__module"] as Module) || module
                    );
                }
                bindStateHost(value, receiver, key);
                src[key] = value;
                ModelManager.update(receiver, key, current, value);
                trigger(receiver, key);
                return true;
            },
            get(src: ModelData, key: string | symbol, receiver: Model) {
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
                if (value && typeof value === "object" && !(value as ModelData)["__module"]) {
                    value = new Model(value, module, receiver, name || key);
                    src[key] = value;
                }
                return value;
            },
            deleteProperty(src: ModelData, key: string | symbol) {
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
