import type { Module } from "./module";
type TrackKey = string | number | symbol;
type CleanupRegistrar = (cleanup: () => void) => void;
export type WatchStopHandle = () => void;
export type WatchSource<T = unknown> = Ref<T> | ComputedRef<T> | (() => T) | object;
export type WatchOptions = {
    immediate?: boolean;
    deep?: boolean;
};
export type WatchCallback<T = unknown> = (value: T, oldValue: T | undefined, onCleanup: CleanupRegistrar) => void;
export interface Ref<T = unknown> {
    value: T;
}
export interface ComputedRef<T = unknown> {
    readonly value: T;
}
export interface BindingOwner {
    notifyBindingChange(oldValue: unknown, newValue: unknown): void;
}
export declare function track(target: object, key: TrackKey): void;
export declare function trigger(target: object, key: TrackKey): void;
export declare function reactive<T extends object>(target: T): T;
export declare function useReactive<T extends object>(target: T): T;
export declare function useState<T>(value: T): Ref<T>;
export declare function useRef<T>(value: T): Ref<T>;
export declare function useComputed<T>(getter: (() => T) | {
    get: () => T;
    set?: (value: T) => void;
}): ComputedRef<T>;
export declare function useWatch<T>(source: WatchSource<T> | Array<WatchSource<T>>, callback: WatchCallback<T>, options?: WatchOptions): WatchStopHandle;
export declare function useWatchEffect(effect: (onCleanup: CleanupRegistrar) => void): WatchStopHandle;
export declare function toValue<T>(value: T | Ref<T> | ComputedRef<T>): T;
export declare function isRef(value: unknown): value is Ref<unknown>;
export declare function isComputed(value: unknown): value is ComputedRef<unknown>;
export declare function isReactive(value: unknown): value is object;
export declare function unwrapState(value: unknown): unknown;
export declare function shouldSkipModelProxy(value: unknown): boolean;
export declare function bindStateHost(value: unknown, model: object, key: TrackKey): void;
export declare function unbindStateHost(value: unknown, model: object, key: TrackKey): void;
export declare function removeReactiveOwner(value: unknown, owner: BindingOwner): void;
export declare function withCurrentModule<T>(module: Module, handler: () => T): T;
export declare function useModule(): Module;
export declare function useModel(): object;
export declare function toRaw<T>(value: T): T;
export declare function cloneStateValue<T>(value: T): T;
export declare const ref: typeof useRef;
export declare const computed: typeof useComputed;
export declare const watch: typeof useWatch;
export declare const watchEffect: typeof useWatchEffect;
export declare const unref: typeof toValue;
export {};
