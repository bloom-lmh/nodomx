import { cloneValue, INTERESTING_HOOKS } from "./shared.js";

export function snapshotApp(app, details = {}) {
    const instance = app?.instance;
    const rootModule = instance ? snapshotModule(instance) : null;
    const stores = snapshotStore(app?.config?.globalProperties?.$store);
    return {
        details: cloneValue(details),
        name: app?.rootComponent?.name || instance?.constructor?.name || "AnonymousApp",
        rootModule,
        selector: app?.selector || null,
        store: stores,
        summary: {
            moduleCount: countModules(rootModule),
            route: rootModule?.route || null,
            storeCount: stores.length,
            storeIds: stores.map(store => store.id)
        }
    };
}

export function snapshotModule(module) {
    if (!module) {
        return null;
    }
    const hookNames = module.compositionHooks instanceof Map
        ? Array.from(module.compositionHooks.keys())
        : [];
    return {
        children: Array.isArray(module.children) ? module.children.map(snapshotModule) : [],
        childCount: Array.isArray(module.children) ? module.children.length : 0,
        exposed: cloneValue(module.exposed || {}),
        hookNames,
        hotId: typeof module.getHotId === "function" ? module.getHotId() : module.constructor?.name || "AnonymousModule",
        id: module.id ?? null,
        keepAlive: {
            deactivated: !!module.keepAliveDeactivated,
            managed: !!module.keepAliveManaged
        },
        name: module.constructor?.name || "AnonymousModule",
        props: cloneValue(module.props || {}),
        route: cloneRoute(module),
        setup: typeof module.captureSetupState === "function" ? cloneValue(module.captureSetupState()) : {},
        slotNames: module.slots instanceof Map ? Array.from(module.slots.keys()) : [],
        state: cloneValue(module.model || {}),
        stateName: resolveModuleStateName(module.state)
    };
}

export function snapshotStore(storeContainer) {
    const stores = storeContainer?._stores;
    if (!(stores instanceof Map)) {
        return [];
    }
    return Array.from(stores.values()).map(store => ({
        id: store?.$id || "store",
        state: cloneValue(store?.$state || {})
    }));
}

export function findModuleById(rootModule, moduleId) {
    if (!rootModule || moduleId === null || moduleId === undefined) {
        return null;
    }
    if (rootModule.id === moduleId) {
        return rootModule;
    }
    for (const child of rootModule.children || []) {
        const found = findModuleById(child, moduleId);
        if (found) {
            return found;
        }
    }
    return null;
}

export function findModuleByHotId(rootModule, hotId) {
    if (!rootModule || !hotId) {
        return null;
    }
    if (rootModule.hotId === hotId) {
        return rootModule;
    }
    for (const child of rootModule.children || []) {
        const found = findModuleByHotId(child, hotId);
        if (found) {
            return found;
        }
    }
    return null;
}

export function resolveModuleSnapshot(rootModule, details) {
    if (!rootModule) {
        return null;
    }
    if (details?.moduleId !== undefined && details?.moduleId !== null) {
        return findModuleById(rootModule, Number(details.moduleId));
    }
    if (details?.hotId) {
        return findModuleByHotId(rootModule, details.hotId);
    }
    return rootModule;
}

export function classifyEventCategory(reason, hookName) {
    if (hookName && INTERESTING_HOOKS.has(hookName)) {
        return "hook";
    }
    if (/error/i.test(reason)) {
        return "error";
    }
    if (/mount|unmount|activated|deactivated/i.test(reason)) {
        return "lifecycle";
    }
    if (/render|refresh/i.test(reason)) {
        return "render";
    }
    if (/manual|timeline/i.test(reason)) {
        return "manual";
    }
    return "update";
}

export function summarizeEvent(reason, hookName, moduleSnapshot, details) {
    if (hookName) {
        const args = Array.isArray(details?.hookArgs) && details.hookArgs.length
            ? ` (${details.hookArgs.join(", ")})`
            : "";
        return `${moduleSnapshot?.name || details?.moduleName || "Module"} ${hookName}${args}`;
    }
    if (reason === "first-render") {
        return `${moduleSnapshot?.name || "Module"} first render`;
    }
    if (reason === "render") {
        return `${moduleSnapshot?.name || "Module"} render`;
    }
    if (reason === "mount") {
        return "App mounted";
    }
    if (reason === "unmount") {
        return "App unmounted";
    }
    return details?.summary || reason;
}

function cloneRoute(module) {
    const route = module?.model?.$route || module?.$route;
    if (!route || typeof route !== "object") {
        return null;
    }
    return cloneValue({
        data: route.data,
        fullPath: route.fullPath,
        hash: route.hash,
        matched: route.matched,
        meta: route.meta,
        name: route.name,
        params: route.params,
        path: route.path,
        query: route.query
    });
}

function countModules(rootModule) {
    if (!rootModule) {
        return 0;
    }
    return 1 + (rootModule.children || []).reduce((total, child) => total + countModules(child), 0);
}

function resolveModuleStateName(state) {
    const stateMap = {
        1: "INIT",
        2: "UNMOUNTED",
        3: "MOUNTED"
    };
    return stateMap[state] || String(state ?? "unknown");
}
