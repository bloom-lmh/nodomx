import { getCurrentScope, useComputed, useState } from "@nodomx/reactivity";
import { Nodom } from "./nodom";
function useRuntimeModule() {
    const scope = getCurrentScope();
    if (!scope) {
        throw new Error("This composition api can only be used during setup().");
    }
    return scope;
}
function registerHook(name, hook) {
    useRuntimeModule().addCompositionHook(name, hook);
}
export function useModule() {
    return useRuntimeModule();
}
export function useModel() {
    return useRuntimeModule().model;
}
export function useApp() {
    var _a;
    return (_a = useRuntimeModule().appContext) === null || _a === void 0 ? void 0 : _a.app;
}
export function useAttrs() {
    return (useRuntimeModule().props || {});
}
export const useProps = useAttrs;
export function useSlots() {
    return useRuntimeModule().slots;
}
export function defineSlots() {
    return useSlots();
}
export function defineProps() {
    return useAttrs();
}
export function withDefaults(props, defaults) {
    return {
        ...(defaults || {}),
        ...(props || {})
    };
}
export function defineModel(nameOrOptions, maybeOptions) {
    const module = useRuntimeModule();
    const modelName = typeof nameOrOptions === "string" ? nameOrOptions : "modelValue";
    const options = (typeof nameOrOptions === "string" ? maybeOptions : nameOrOptions) || {};
    const eventName = resolveModelEventName(modelName, options);
    const emit = defineEmits([eventName]);
    const state = useState(resolveModelValue(module, modelName, options));
    const syncState = () => {
        const nextValue = resolveModelValue(module, modelName, options);
        if (!Object.is(state.value, nextValue)) {
            state.value = nextValue;
        }
    };
    syncState();
    registerHook("onBeforeRender", syncState);
    return useComputed({
        get: () => state.value,
        set(value) {
            const emittedValue = options.set ? options.set(value) : value;
            state.value = options.get ? options.get(emittedValue) : emittedValue;
            emit(eventName, emittedValue);
        }
    });
}
export function provide(key, value) {
    useRuntimeModule().provide(key, value);
}
export function inject(key, defaultValue) {
    return useRuntimeModule().inject(key, defaultValue);
}
export const useInject = inject;
export function defineEmits(options) {
    const module = useRuntimeModule();
    return ((eventName, ...args) => {
        return emitFromModule(module, eventName, args, options);
    });
}
export function defineExpose(exposed) {
    var _a;
    if (exposed && typeof exposed === "object") {
        const module = useRuntimeModule();
        (_a = module.setExposed) === null || _a === void 0 ? void 0 : _a.call(module, exposed);
        return exposed;
    }
    return undefined;
}
export function useRouter() {
    return Nodom["$Router"];
}
export function useRoute() {
    const module = useRuntimeModule();
    if (!module.model["$route"]) {
        module.model["$route"] = {
            path: "/",
            fullPath: "/",
            hash: "",
            meta: {},
            query: {},
            params: {},
            data: {},
            matched: []
        };
    }
    return module.model["$route"];
}
function emitFromModule(module, eventName, args, options) {
    const normalizedName = normalizeEventName(eventName);
    if (!normalizedName) {
        return false;
    }
    if (!isDeclaredEvent(options, normalizedName)) {
        return false;
    }
    const props = module.props || {};
    const handlers = resolveEmitHandlers(props, normalizedName);
    let handled = false;
    for (const handler of handlers) {
        if (typeof handler === "function") {
            handler.apply(module, args);
            handled = true;
        }
        else if (typeof handler === "string" && typeof module[handler] === "function") {
            module.invokeMethod(handler, ...args);
            handled = true;
        }
    }
    return handled;
}
function resolveModelValue(module, modelName, options) {
    const propValue = readModelPropValue(module.props || {}, modelName);
    const resolvedValue = (propValue === undefined ? options.default : propValue);
    return options.get ? options.get(resolvedValue) : resolvedValue;
}
function resolveModelEventName(modelName, options) {
    return options.event || `update:${toKebabCase(modelName || "modelValue")}`;
}
function readModelPropValue(props, modelName) {
    const candidates = buildPropCandidateKeys(modelName);
    for (const key of candidates) {
        if (Object.prototype.hasOwnProperty.call(props, key)) {
            return props[key];
        }
    }
    return undefined;
}
function buildPropCandidateKeys(modelName) {
    const rawName = String(modelName || "modelValue");
    const camelName = toCamelCase(rawName);
    const kebabName = toKebabCase(rawName);
    return Array.from(new Set([
        rawName,
        rawName.toLowerCase(),
        camelName,
        camelName.toLowerCase(),
        kebabName,
        kebabName.toLowerCase()
    ].filter(Boolean)));
}
function isDeclaredEvent(options, eventName) {
    if (!options) {
        return true;
    }
    if (Array.isArray(options)) {
        return options.some(item => normalizeEventName(item) === eventName);
    }
    return Object.prototype.hasOwnProperty.call(options, eventName);
}
function resolveEmitHandlers(props, eventName) {
    const handlers = [];
    const candidates = buildEmitCandidateKeys(eventName);
    for (const key of candidates) {
        const value = props[key];
        if (Array.isArray(value)) {
            for (const item of value) {
                if (!handlers.includes(item)) {
                    handlers.push(item);
                }
            }
        }
        else if (value !== undefined && !handlers.includes(value)) {
            handlers.push(value);
        }
    }
    return handlers;
}
function buildEmitCandidateKeys(eventName) {
    const camelName = toCamelCase(eventName);
    const pascalName = camelName ? camelName[0].toUpperCase() + camelName.slice(1) : "";
    const kebabName = toKebabCase(eventName);
    const keys = [
        eventName,
        camelName,
        kebabName,
        `on${eventName}`,
        `on${camelName}`,
        `on${pascalName}`,
        `on-${kebabName}`,
        `on:${eventName}`
    ];
    return Array.from(new Set(keys.map(item => item.toLowerCase()).filter(Boolean)));
}
function normalizeEventName(eventName) {
    return toKebabCase(String(eventName || ""));
}
function toCamelCase(value) {
    const normalized = String(value || "")
        .replace(/^on[-:]/i, "")
        .replace(/[^a-zA-Z0-9]+([a-zA-Z0-9])/g, (_, char) => char.toUpperCase())
        .replace(/^[A-Z]/, char => char.toLowerCase());
    return normalized;
}
function toKebabCase(value) {
    return String(value || "")
        .replace(/^on[-:]/i, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/[_:\s]+/g, "-")
        .replace(/--+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
}
export function onInit(hook) {
    registerHook("onInit", hook);
}
export function onBeforeRender(hook) {
    registerHook("onBeforeRender", hook);
}
export function onRender(hook) {
    registerHook("onRender", hook);
}
export function onBeforeMount(hook) {
    registerHook("onBeforeMount", hook);
}
export function onMounted(hook) {
    registerHook("onMount", hook);
}
export function onBeforeUpdate(hook) {
    registerHook("onBeforeUpdate", hook);
}
export function onUpdated(hook) {
    registerHook("onUpdate", hook);
}
export function onBeforeUnmount(hook) {
    registerHook("onBeforeUnMount", hook);
}
export function onUnmounted(hook) {
    registerHook("onUnMount", hook);
}
export function onActivated(hook) {
    registerHook("onActivated", hook);
}
export function onDeactivated(hook) {
    registerHook("onDeactivated", hook);
}
export function onBeforeEnter(hook) {
    registerHook("onBeforeEnter", hook);
}
export function onEnter(hook) {
    registerHook("onEnter", hook);
}
export function onAfterEnter(hook) {
    registerHook("onAfterEnter", hook);
}
export function onEnterCancelled(hook) {
    registerHook("onEnterCancelled", hook);
}
export function onBeforeLeave(hook) {
    registerHook("onBeforeLeave", hook);
}
export function onLeave(hook) {
    registerHook("onLeave", hook);
}
export function onAfterLeave(hook) {
    registerHook("onAfterLeave", hook);
}
export function onLeaveCancelled(hook) {
    registerHook("onLeaveCancelled", hook);
}
export function onBeforeMove(hook) {
    registerHook("onBeforeMove", hook);
}
export function onMove(hook) {
    registerHook("onMove", hook);
}
export function onAfterMove(hook) {
    registerHook("onAfterMove", hook);
}
export function onMoveCancelled(hook) {
    registerHook("onMoveCancelled", hook);
}
export function onSuspensePending(hook) {
    registerHook("onSuspensePending", hook);
}
export function onSuspenseFallback(hook) {
    registerHook("onSuspenseFallback", hook);
}
export function onSuspenseResolve(hook) {
    registerHook("onSuspenseResolve", hook);
}
export function onSuspenseError(hook) {
    registerHook("onSuspenseError", hook);
}
export function onSuspenseRetry(hook) {
    registerHook("onSuspenseRetry", hook);
}
//# sourceMappingURL=lifecycle.js.map