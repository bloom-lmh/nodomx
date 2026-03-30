import type { ModuleLike, UnknownClass } from "@nodomx/shared";
export type AsyncComponentLoaderResult = UnknownClass | ModuleLike | string | {
    default?: UnknownClass | ModuleLike | string;
};
export type AsyncComponentLoader = () => Promise<AsyncComponentLoaderResult>;
export type AsyncComponentOptions = {
    delay?: number;
    errorComponent?: UnknownClass;
    loadingComponent?: UnknownClass;
    loader: AsyncComponentLoader;
    onError?: (error: unknown) => void;
    timeout?: number;
};
export type AsyncComponentStatus = {
    attempts: number;
    delay: number;
    error?: unknown;
    loading: boolean;
    resolved: boolean;
    timeout?: number;
};
export declare function defineAsyncComponent(loader: AsyncComponentLoader): UnknownClass;
export declare function defineAsyncComponent(options: AsyncComponentOptions): UnknownClass;
export declare function resolveAsyncComponentClass(component: unknown): UnknownClass | undefined;
export declare function getAsyncComponentStatus(component: unknown): AsyncComponentStatus | undefined;
export declare function subscribeAsyncComponent(component: unknown, listener: (status: AsyncComponentStatus) => void): () => void;
export declare function retryAsyncComponent(component: unknown): Promise<UnknownClass | undefined>;
