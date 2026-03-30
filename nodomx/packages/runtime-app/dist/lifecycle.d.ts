import type { InjectionKey } from "@nodomx/shared";
import type { Module } from "@nodomx/runtime-module";
type ModelOptions<T = unknown, TValue = T> = {
    default?: TValue;
    event?: string;
    get?: (value: TValue) => T;
    set?: (value: T) => TValue;
};
export declare function useModule(): Module;
export declare function useModel(): object;
export declare function useApp(): import("@nodomx/shared").NodomApp;
export declare function useAttrs<T = Record<string, unknown>>(): T;
export declare const useProps: typeof useAttrs;
export declare function useSlots(): Map<string, import("@nodomx/shared").RenderedDom>;
export declare function defineSlots<T = ReturnType<typeof useSlots>>(): T;
export declare function defineProps<T = Record<string, unknown>>(): T;
export declare function withDefaults<T extends Record<string, unknown>>(props: T, defaults: Partial<T>): T;
export declare function defineModel<T = unknown>(options?: ModelOptions<T>): {
    value: T;
};
export declare function defineModel<T = unknown>(name: string, options?: ModelOptions<T>): {
    value: T;
};
export declare function provide<T>(key: InjectionKey<T>, value: T): void;
export declare function inject<T>(key: InjectionKey<T>, defaultValue?: T): T | undefined;
export declare const useInject: typeof inject;
export declare function defineEmits<T extends (...args: any[]) => any = (event: string, ...args: unknown[]) => boolean>(options?: string[] | Record<string, unknown>): T;
export declare function defineExpose<T extends Record<string, unknown>>(exposed?: T): T | undefined;
export declare function useRouter<T = unknown>(): T;
export declare function useRoute<T = Record<string, unknown>>(): T;
export declare function onInit(hook: (model?: object) => void): void;
export declare function onBeforeRender(hook: (model?: object) => void): void;
export declare function onRender(hook: (model?: object) => void): void;
export declare function onBeforeMount(hook: (model?: object) => void): void;
export declare function onMounted(hook: (model?: object) => void): void;
export declare function onBeforeUpdate(hook: (model?: object) => void): void;
export declare function onUpdated(hook: (model?: object) => void): void;
export declare function onBeforeUnmount(hook: (model?: object) => void): void;
export declare function onUnmounted(hook: (model?: object) => void): void;
export declare function onActivated(hook: (model?: object) => void): void;
export declare function onDeactivated(hook: (model?: object) => void): void;
export declare function onBeforeEnter(hook: (el?: Element) => void): void;
export declare function onEnter(hook: (el?: Element) => void): void;
export declare function onAfterEnter(hook: (el?: Element) => void): void;
export declare function onEnterCancelled(hook: (el?: Element) => void): void;
export declare function onBeforeLeave(hook: (el?: Element) => void): void;
export declare function onLeave(hook: (el?: Element) => void): void;
export declare function onAfterLeave(hook: (el?: Element) => void): void;
export declare function onLeaveCancelled(hook: (el?: Element) => void): void;
export declare function onBeforeMove(hook: (el?: Element) => void): void;
export declare function onMove(hook: (el?: Element) => void): void;
export declare function onAfterMove(hook: (el?: Element) => void): void;
export declare function onMoveCancelled(hook: (el?: Element) => void): void;
export declare function onSuspensePending(hook: (detail?: {
    pendingCount: number;
    timeout: number;
}) => void): void;
export declare function onSuspenseFallback(hook: (detail?: {
    pendingCount: number;
    timeout: number;
}) => void): void;
export declare function onSuspenseResolve(hook: (detail?: {
    pendingCount: number;
    timeout: number;
}) => void): void;
export declare function onSuspenseError(hook: (detail?: {
    error?: unknown;
    pendingCount: number;
    timeout: number;
}) => void): void;
export declare function onSuspenseRetry(hook: (detail?: {
    pendingCount: number;
    retryKey?: string;
    timeout: number;
}) => void): void;
export {};
