import { ModuleFactory } from "@nodomx/runtime-registry";
import { Renderer } from "@nodomx/runtime-view";
import type { ModuleLike, UnknownClass } from "@nodomx/shared";
import { Module } from "@nodomx/runtime-module";

export type AsyncComponentLoaderResult =
    | UnknownClass
    | ModuleLike
    | string
    | { default?: UnknownClass | ModuleLike | string };

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

type AsyncComponentMeta = {
    attempts: number;
    delay: number;
    error?: unknown;
    errorComponent?: UnknownClass;
    instances: Set<AsyncComponentModule>;
    listeners: Set<(status: AsyncComponentStatus) => void>;
    loader: AsyncComponentLoader;
    loading: boolean;
    onError?: (error: unknown) => void;
    loadingComponent?: UnknownClass;
    pending?: Promise<UnknownClass>;
    resolved?: UnknownClass;
    timeout?: number;
};

type AsyncComponentClass = UnknownClass & {
    __asyncComponentMeta__?: AsyncComponentMeta;
};

type AsyncComponentModule = Module & {
    __asyncDelayTimer?: ReturnType<typeof setTimeout>;
    __asyncShowLoading?: boolean;
    __asyncTimeoutTimer?: ReturnType<typeof setTimeout>;
};

export function defineAsyncComponent(loader: AsyncComponentLoader): UnknownClass;
export function defineAsyncComponent(options: AsyncComponentOptions): UnknownClass;
export function defineAsyncComponent(loaderOrOptions: AsyncComponentLoader | AsyncComponentOptions): UnknownClass {
    const options = normalizeAsyncComponentOptions(loaderOrOptions);
    const meta: AsyncComponentMeta = {
        attempts: 0,
        delay: options.delay,
        errorComponent: options.errorComponent,
        instances: new Set(),
        listeners: new Set(),
        loader: options.loader,
        loading: false,
        onError: options.onError,
        loadingComponent: options.loadingComponent,
        timeout: options.timeout
    };

    if (meta.loadingComponent) {
        ModuleFactory.addClass(meta.loadingComponent);
    }
    if (meta.errorComponent) {
        ModuleFactory.addClass(meta.errorComponent);
    }

    class AsyncComponentWrapper extends Module {
        public template(): string {
            return resolveAsyncTemplate(meta, this as AsyncComponentModule);
        }

        public onInit(): void {
            const self = this as AsyncComponentModule;
            meta.instances.add(self);
            self.__asyncShowLoading = !meta.resolved && !meta.error && meta.delay === 0;
            scheduleAsyncVisibility(meta, self, options.onError);
            void ensureAsyncResolved(meta, options.onError).catch(() => undefined);
        }

        public onBeforeUnMount(): void {
            cleanupAsyncInstance(this as AsyncComponentModule, meta);
        }

        public onUnMount(): void {
            cleanupAsyncInstance(this as AsyncComponentModule, meta);
        }
    }

    const ctor = AsyncComponentWrapper as unknown as AsyncComponentClass;
    ctor.__asyncComponentMeta__ = meta;
    return ctor;
}

export function resolveAsyncComponentClass(component: unknown): UnknownClass | undefined {
    const meta = getAsyncComponentMeta(component);
    return meta?.resolved;
}

export function getAsyncComponentStatus(component: unknown): AsyncComponentStatus | undefined {
    const meta = getAsyncComponentMeta(component);
    return meta ? snapshotAsyncStatus(meta) : undefined;
}

export function subscribeAsyncComponent(
    component: unknown,
    listener: (status: AsyncComponentStatus) => void
): () => void {
    const meta = getAsyncComponentMeta(component);
    if (!meta || typeof listener !== "function") {
        return () => {};
    }
    meta.listeners.add(listener);
    return () => {
        meta.listeners.delete(listener);
    };
}

export function retryAsyncComponent(component: unknown): Promise<UnknownClass | undefined> {
    const meta = getAsyncComponentMeta(component);
    if (!meta) {
        return Promise.resolve(undefined);
    }
    meta.error = undefined;
    meta.loading = false;
    meta.pending = undefined;
    meta.resolved = undefined;
    notifyAsyncInstances(meta);
    return ensureAsyncResolved(meta, meta.onError).catch(() => undefined);
}

function ensureAsyncResolved(meta: AsyncComponentMeta, onError?: (error: unknown) => void): Promise<UnknownClass> {
    if (meta.resolved) {
        return Promise.resolve(meta.resolved);
    }
    if (meta.pending) {
        return meta.pending;
    }
    meta.loading = true;
    meta.attempts += 1;
    meta.error = undefined;
    meta.resolved = undefined;
    meta.pending = Promise.resolve()
        .then(() => meta.loader())
        .then(result => {
            const resolved = normalizeAsyncResult(result);
            if (!resolved) {
                throw new Error("Async component loader resolved without a component.");
            }
            meta.loading = false;
            meta.error = undefined;
            meta.resolved = resolved;
            meta.pending = undefined;
            ModuleFactory.addClass(resolved);
            notifyAsyncInstances(meta);
            return resolved;
        })
        .catch(error => {
            meta.loading = false;
            meta.pending = undefined;
            meta.error = error;
            try {
                onError?.(error);
            } catch {
                // ignore user callback errors and keep async failure visible
            }
            notifyAsyncInstances(meta);
            throw error;
        });
    notifyAsyncInstances(meta);
    return meta.pending;
}

function scheduleAsyncVisibility(
    meta: AsyncComponentMeta,
    instance: AsyncComponentModule,
    onError?: (error: unknown) => void
): void {
    clearAsyncTimers(instance);
    if (!meta.resolved && !meta.error && meta.delay > 0) {
        instance.__asyncDelayTimer = setTimeout(() => {
            instance.__asyncShowLoading = true;
            requestAsyncRender(instance);
        }, meta.delay);
    }
    if (!meta.resolved && !meta.error && typeof meta.timeout === "number" && meta.timeout > 0) {
        instance.__asyncTimeoutTimer = setTimeout(() => {
            if (meta.resolved || meta.error) {
                return;
            }
            const timeoutError = new Error(`Async component timed out after ${meta.timeout}ms.`);
            meta.loading = false;
            meta.pending = undefined;
            meta.error = timeoutError;
            try {
                onError?.(timeoutError);
            } catch {
                // ignore user callback errors and keep async failure visible
            }
            notifyAsyncInstances(meta);
        }, meta.timeout);
    }
}

function resolveAsyncTemplate(meta: AsyncComponentMeta, instance: AsyncComponentModule): string {
    if (meta.resolved) {
        return `<${meta.resolved.name}></${meta.resolved.name}>`;
    }
    if (meta.error) {
        if (meta.errorComponent) {
            return `<${meta.errorComponent.name}></${meta.errorComponent.name}>`;
        }
        return `<div class="nd-async-error" role="alert">${escapeHtml(
            meta.error instanceof Error ? meta.error.message : "Async component failed to load."
        )}</div>`;
    }
    if (instance.__asyncShowLoading) {
        if (meta.loadingComponent) {
            return `<${meta.loadingComponent.name}></${meta.loadingComponent.name}>`;
        }
        return `<div class="nd-async-loading" role="status">Loading...</div>`;
    }
    return `<div class="nd-async-placeholder" style="display:none" aria-hidden="true"></div>`;
}

function notifyAsyncInstances(meta: AsyncComponentMeta): void {
    for (const instance of meta.instances) {
        instance.__asyncShowLoading = !meta.resolved && !meta.error && meta.delay === 0;
        clearAsyncTimers(instance);
        if (!meta.resolved && !meta.error) {
            scheduleAsyncVisibility(meta, instance, meta.onError);
        }
        requestAsyncRender(instance);
    }
    const status = snapshotAsyncStatus(meta);
    for (const listener of meta.listeners) {
        listener(status);
    }
}

function requestAsyncRender(instance: AsyncComponentModule): void {
    instance.markDirty?.();
    Renderer.add(instance);
}

function cleanupAsyncInstance(instance: AsyncComponentModule, meta: AsyncComponentMeta): void {
    clearAsyncTimers(instance);
    meta.instances.delete(instance);
}

function clearAsyncTimers(instance: AsyncComponentModule): void {
    if (instance.__asyncDelayTimer) {
        clearTimeout(instance.__asyncDelayTimer);
        delete instance.__asyncDelayTimer;
    }
    if (instance.__asyncTimeoutTimer) {
        clearTimeout(instance.__asyncTimeoutTimer);
        delete instance.__asyncTimeoutTimer;
    }
}

function normalizeAsyncComponentOptions(
    loaderOrOptions: AsyncComponentLoader | AsyncComponentOptions
): AsyncComponentOptions & { delay: number } {
    if (typeof loaderOrOptions === "function") {
        return {
            delay: 0,
            loader: loaderOrOptions
        };
    }
    return {
        delay: loaderOrOptions.delay ?? 0,
        ...loaderOrOptions
    };
}

function normalizeAsyncResult(result: AsyncComponentLoaderResult): UnknownClass | undefined {
    const value = (result && typeof result === "object" && "default" in result
        ? result.default
        : result) as UnknownClass | ModuleLike | string | undefined;
    if (!value) {
        return undefined;
    }
    if (typeof value === "string") {
        return ModuleFactory.getClass(value);
    }
    return value as UnknownClass;
}

function getAsyncComponentMeta(component: unknown): AsyncComponentMeta | undefined {
    if (!component || typeof component !== "function") {
        return undefined;
    }
    return (component as AsyncComponentClass).__asyncComponentMeta__;
}

function snapshotAsyncStatus(meta: AsyncComponentMeta): AsyncComponentStatus {
    return {
        attempts: meta.attempts,
        delay: meta.delay,
        error: meta.error,
        loading: meta.loading,
        resolved: !!meta.resolved,
        timeout: meta.timeout
    };
}

function escapeHtml(value: string): string {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
