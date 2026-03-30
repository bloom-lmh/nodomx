import { ModuleFactory } from "@nodomx/runtime-registry";
import { Renderer } from "@nodomx/runtime-view";
import { Module } from "@nodomx/runtime-module";
export function defineAsyncComponent(loaderOrOptions) {
    const options = normalizeAsyncComponentOptions(loaderOrOptions);
    const meta = {
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
        template() {
            return resolveAsyncTemplate(meta, this);
        }
        onInit() {
            const self = this;
            meta.instances.add(self);
            self.__asyncShowLoading = !meta.resolved && !meta.error && meta.delay === 0;
            scheduleAsyncVisibility(meta, self, options.onError);
            void ensureAsyncResolved(meta, options.onError).catch(() => undefined);
        }
        onBeforeUnMount() {
            cleanupAsyncInstance(this, meta);
        }
        onUnMount() {
            cleanupAsyncInstance(this, meta);
        }
    }
    const ctor = AsyncComponentWrapper;
    ctor.__asyncComponentMeta__ = meta;
    return ctor;
}
export function resolveAsyncComponentClass(component) {
    const meta = getAsyncComponentMeta(component);
    return meta === null || meta === void 0 ? void 0 : meta.resolved;
}
export function getAsyncComponentStatus(component) {
    const meta = getAsyncComponentMeta(component);
    return meta ? snapshotAsyncStatus(meta) : undefined;
}
export function subscribeAsyncComponent(component, listener) {
    const meta = getAsyncComponentMeta(component);
    if (!meta || typeof listener !== "function") {
        return () => { };
    }
    meta.listeners.add(listener);
    return () => {
        meta.listeners.delete(listener);
    };
}
export function retryAsyncComponent(component) {
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
function ensureAsyncResolved(meta, onError) {
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
            onError === null || onError === void 0 ? void 0 : onError(error);
        }
        catch {
            // ignore user callback errors and keep async failure visible
        }
        notifyAsyncInstances(meta);
        throw error;
    });
    notifyAsyncInstances(meta);
    return meta.pending;
}
function scheduleAsyncVisibility(meta, instance, onError) {
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
                onError === null || onError === void 0 ? void 0 : onError(timeoutError);
            }
            catch {
                // ignore user callback errors and keep async failure visible
            }
            notifyAsyncInstances(meta);
        }, meta.timeout);
    }
}
function resolveAsyncTemplate(meta, instance) {
    if (meta.resolved) {
        return `<${meta.resolved.name}></${meta.resolved.name}>`;
    }
    if (meta.error) {
        if (meta.errorComponent) {
            return `<${meta.errorComponent.name}></${meta.errorComponent.name}>`;
        }
        return `<div class="nd-async-error" role="alert">${escapeHtml(meta.error instanceof Error ? meta.error.message : "Async component failed to load.")}</div>`;
    }
    if (instance.__asyncShowLoading) {
        if (meta.loadingComponent) {
            return `<${meta.loadingComponent.name}></${meta.loadingComponent.name}>`;
        }
        return `<div class="nd-async-loading" role="status">Loading...</div>`;
    }
    return `<div class="nd-async-placeholder" style="display:none" aria-hidden="true"></div>`;
}
function notifyAsyncInstances(meta) {
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
function requestAsyncRender(instance) {
    var _a;
    (_a = instance.markDirty) === null || _a === void 0 ? void 0 : _a.call(instance);
    Renderer.add(instance);
}
function cleanupAsyncInstance(instance, meta) {
    clearAsyncTimers(instance);
    meta.instances.delete(instance);
}
function clearAsyncTimers(instance) {
    if (instance.__asyncDelayTimer) {
        clearTimeout(instance.__asyncDelayTimer);
        delete instance.__asyncDelayTimer;
    }
    if (instance.__asyncTimeoutTimer) {
        clearTimeout(instance.__asyncTimeoutTimer);
        delete instance.__asyncTimeoutTimer;
    }
}
function normalizeAsyncComponentOptions(loaderOrOptions) {
    var _a;
    if (typeof loaderOrOptions === "function") {
        return {
            delay: 0,
            loader: loaderOrOptions
        };
    }
    return {
        delay: (_a = loaderOrOptions.delay) !== null && _a !== void 0 ? _a : 0,
        ...loaderOrOptions
    };
}
function normalizeAsyncResult(result) {
    const value = (result && typeof result === "object" && "default" in result
        ? result.default
        : result);
    if (!value) {
        return undefined;
    }
    if (typeof value === "string") {
        return ModuleFactory.getClass(value);
    }
    return value;
}
function getAsyncComponentMeta(component) {
    if (!component || typeof component !== "function") {
        return undefined;
    }
    return component.__asyncComponentMeta__;
}
function snapshotAsyncStatus(meta) {
    return {
        attempts: meta.attempts,
        delay: meta.delay,
        error: meta.error,
        loading: meta.loading,
        resolved: !!meta.resolved,
        timeout: meta.timeout
    };
}
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
//# sourceMappingURL=async-component.js.map