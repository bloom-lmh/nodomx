import { getCurrentScope, useComputed, useState } from "@nodomx/reactivity";
import type { InjectionKey } from "@nodomx/shared";
import type { Module } from "@nodomx/runtime-module";
import { Nodom } from "./nodom";

type ModelOptions<T = unknown, TValue = T> = {
    default?: TValue;
    event?: string;
    get?: (value: TValue) => T;
    set?: (value: T) => TValue;
};

function useRuntimeModule(): Module {
    const scope = getCurrentScope<Module>();
    if (!scope) {
        throw new Error("This composition api can only be used during setup().");
    }
    return scope;
}

function registerHook(name: string, hook: (...args: unknown[]) => void): void {
    useRuntimeModule().addCompositionHook(name, hook);
}

export function useModule(): Module {
    return useRuntimeModule();
}

export function useModel(): object {
    return useRuntimeModule().model;
}

export function useApp() {
    return useRuntimeModule().appContext?.app;
}

export function useAttrs<T = Record<string, unknown>>(): T {
    return (useRuntimeModule().props || {}) as T;
}

export const useProps = useAttrs;

export function useSlots() {
    return useRuntimeModule().slots;
}

export function defineSlots<T = ReturnType<typeof useSlots>>(): T {
    return useSlots() as T;
}

export function defineProps<T = Record<string, unknown>>(): T {
    return useAttrs<T>();
}

export function withDefaults<T extends Record<string, unknown>>(props: T, defaults: Partial<T>): T {
    return {
        ...(defaults || {}),
        ...(props || {})
    } as T;
}

export function defineModel<T = unknown>(options?: ModelOptions<T>): { value: T };
export function defineModel<T = unknown>(name: string, options?: ModelOptions<T>): { value: T };
export function defineModel<T = unknown>(
    nameOrOptions?: string | ModelOptions<T>,
    maybeOptions?: ModelOptions<T>
): { value: T } {
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

    return useComputed<T>({
        get: () => state.value as T,
        set(value: T) {
            const emittedValue = options.set ? options.set(value) : value;
            state.value = options.get ? options.get(emittedValue) : emittedValue as T;
            emit(eventName, emittedValue);
        }
    });
}

export function provide<T>(key: InjectionKey<T>, value: T): void {
    useRuntimeModule().provide(key, value);
}

export function inject<T>(key: InjectionKey<T>, defaultValue?: T): T | undefined {
    return useRuntimeModule().inject(key, defaultValue);
}

export const useInject = inject;

export function defineEmits<T extends (...args: any[]) => any = (event: string, ...args: unknown[]) => boolean>(
    options?: string[] | Record<string, unknown>
): T {
    const module = useRuntimeModule();
    return ((eventName: string, ...args: unknown[]) => {
        return emitFromModule(module, eventName, args, options);
    }) as T;
}

export function defineExpose<T extends Record<string, unknown>>(exposed?: T): T | undefined {
    if (exposed && typeof exposed === "object") {
        const module = useRuntimeModule() as Module & {
            setExposed?: (value: Record<string, unknown>) => void;
        };
        module.setExposed?.(exposed);
        return exposed;
    }
    return undefined;
}

export function useRouter<T = unknown>(): T {
    return (Nodom as unknown as Record<string, unknown>)["$Router"] as T;
}

export function useRoute<T = Record<string, unknown>>(): T {
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
    return module.model["$route"] as T;
}

function emitFromModule(
    module: Module,
    eventName: string,
    args: unknown[],
    options?: string[] | Record<string, unknown>
): boolean {
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
        } else if (typeof handler === "string" && typeof (module as unknown as Record<string, unknown>)[handler] === "function") {
            module.invokeMethod(handler, ...args);
            handled = true;
        }
    }
    return handled;
}

function resolveModelValue<T, TValue = T>(module: Module, modelName: string, options: ModelOptions<T, TValue>): T {
    const propValue = readModelPropValue(module.props || {}, modelName) as TValue | undefined;
    const resolvedValue = (propValue === undefined ? options.default : propValue) as TValue;
    return options.get ? options.get(resolvedValue) : resolvedValue as unknown as T;
}

function resolveModelEventName(modelName: string, options: ModelOptions<unknown>): string {
    return options.event || `update:${toKebabCase(modelName || "modelValue")}`;
}

function readModelPropValue(props: Record<string, unknown>, modelName: string): unknown {
    const candidates = buildPropCandidateKeys(modelName);
    for (const key of candidates) {
        if (Object.prototype.hasOwnProperty.call(props, key)) {
            return props[key];
        }
    }
    return undefined;
}

function buildPropCandidateKeys(modelName: string): string[] {
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

function isDeclaredEvent(options: string[] | Record<string, unknown> | undefined, eventName: string): boolean {
    if (!options) {
        return true;
    }
    if (Array.isArray(options)) {
        return options.some(item => normalizeEventName(item) === eventName);
    }
    return Object.prototype.hasOwnProperty.call(options, eventName);
}

function resolveEmitHandlers(props: Record<string, unknown>, eventName: string): unknown[] {
    const handlers: unknown[] = [];
    const candidates = buildEmitCandidateKeys(eventName);
    for (const key of candidates) {
        const value = props[key];
        if (Array.isArray(value)) {
            for (const item of value) {
                if (!handlers.includes(item)) {
                    handlers.push(item);
                }
            }
        } else if (value !== undefined && !handlers.includes(value)) {
            handlers.push(value);
        }
    }
    return handlers;
}

function buildEmitCandidateKeys(eventName: string): string[] {
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

function normalizeEventName(eventName: string): string {
    return toKebabCase(String(eventName || ""));
}

function toCamelCase(value: string): string {
    const normalized = String(value || "")
        .replace(/^on[-:]/i, "")
        .replace(/[^a-zA-Z0-9]+([a-zA-Z0-9])/g, (_, char) => char.toUpperCase())
        .replace(/^[A-Z]/, char => char.toLowerCase());
    return normalized;
}

function toKebabCase(value: string): string {
    return String(value || "")
        .replace(/^on[-:]/i, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/[_:\s]+/g, "-")
        .replace(/--+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
}

export function onInit(hook: (model?: object) => void): void {
    registerHook("onInit", hook);
}

export function onBeforeRender(hook: (model?: object) => void): void {
    registerHook("onBeforeRender", hook);
}

export function onRender(hook: (model?: object) => void): void {
    registerHook("onRender", hook);
}

export function onBeforeMount(hook: (model?: object) => void): void {
    registerHook("onBeforeMount", hook);
}

export function onMounted(hook: (model?: object) => void): void {
    registerHook("onMount", hook);
}

export function onBeforeUpdate(hook: (model?: object) => void): void {
    registerHook("onBeforeUpdate", hook);
}

export function onUpdated(hook: (model?: object) => void): void {
    registerHook("onUpdate", hook);
}

export function onBeforeUnmount(hook: (model?: object) => void): void {
    registerHook("onBeforeUnMount", hook);
}

export function onUnmounted(hook: (model?: object) => void): void {
    registerHook("onUnMount", hook);
}

export function onActivated(hook: (model?: object) => void): void {
    registerHook("onActivated", hook);
}

export function onDeactivated(hook: (model?: object) => void): void {
    registerHook("onDeactivated", hook);
}

export function onBeforeEnter(hook: (el?: Element) => void): void {
    registerHook("onBeforeEnter", hook);
}

export function onEnter(hook: (el?: Element) => void): void {
    registerHook("onEnter", hook);
}

export function onAfterEnter(hook: (el?: Element) => void): void {
    registerHook("onAfterEnter", hook);
}

export function onEnterCancelled(hook: (el?: Element) => void): void {
    registerHook("onEnterCancelled", hook);
}

export function onBeforeLeave(hook: (el?: Element) => void): void {
    registerHook("onBeforeLeave", hook);
}

export function onLeave(hook: (el?: Element) => void): void {
    registerHook("onLeave", hook);
}

export function onAfterLeave(hook: (el?: Element) => void): void {
    registerHook("onAfterLeave", hook);
}

export function onLeaveCancelled(hook: (el?: Element) => void): void {
    registerHook("onLeaveCancelled", hook);
}

export function onBeforeMove(hook: (el?: Element) => void): void {
    registerHook("onBeforeMove", hook);
}

export function onMove(hook: (el?: Element) => void): void {
    registerHook("onMove", hook);
}

export function onAfterMove(hook: (el?: Element) => void): void {
    registerHook("onAfterMove", hook);
}

export function onMoveCancelled(hook: (el?: Element) => void): void {
    registerHook("onMoveCancelled", hook);
}

export function onSuspensePending(
    hook: (detail?: { pendingCount: number; timeout: number }) => void
): void {
    registerHook("onSuspensePending", hook);
}

export function onSuspenseFallback(
    hook: (detail?: { pendingCount: number; timeout: number }) => void
): void {
    registerHook("onSuspenseFallback", hook);
}

export function onSuspenseResolve(
    hook: (detail?: { pendingCount: number; timeout: number }) => void
): void {
    registerHook("onSuspenseResolve", hook);
}

export function onSuspenseError(
    hook: (detail?: { error?: unknown; pendingCount: number; timeout: number }) => void
): void {
    registerHook("onSuspenseError", hook);
}

export function onSuspenseRetry(
    hook: (detail?: { pendingCount: number; retryKey?: string; timeout: number }) => void
): void {
    registerHook("onSuspenseRetry", hook);
}
