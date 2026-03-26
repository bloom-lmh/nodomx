import { getCurrentScope } from "@nodomx/reactivity";
import type { InjectionKey } from "./app";
import type { Module } from "./module";
import { Nodom } from "./nodom";

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

export function defineProps<T = Record<string, unknown>>(): T {
    return useAttrs<T>();
}

export function withDefaults<T extends Record<string, unknown>>(props: T, defaults: Partial<T>): T {
    return {
        ...(defaults || {}),
        ...(props || {})
    } as T;
}

export function provide<T>(key: InjectionKey<T>, value: T): void {
    useRuntimeModule().provide(key, value);
}

export function inject<T>(key: InjectionKey<T>, defaultValue?: T): T | undefined {
    return useRuntimeModule().inject(key, defaultValue);
}

export const useInject = inject;

export function useRouter<T = unknown>(): T {
    return (Nodom as unknown as Record<string, unknown>)["$Router"] as T;
}

export function useRoute<T = Record<string, unknown>>(): T {
    return (useRuntimeModule().model?.["$route"] || {}) as T;
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