import { createOverlay, installShortcut } from "./overlay.js";
import {
    cloneValue,
    DEFAULT_TIMELINE_LIMIT,
    ensureAppId
} from "./shared.js";
import {
    classifyEventCategory,
    findModuleById,
    resolveModuleSnapshot,
    snapshotApp,
    summarizeEvent
} from "./snapshot.js";

const HIGHLIGHT_ATTR = "data-nodomx-devtools-highlight";

export function createHook(globalTarget, options = {}) {
    const apps = new Map();
    const listeners = new Set();
    const timelineLimit = Math.max(40, Number(options.timelineLimit) || DEFAULT_TIMELINE_LIMIT);
    let highlightElement = null;
    let panel = null;
    let pickerCleanup = null;
    let selectedAppId = null;
    const pickerState = {
        active: false,
        hoveredAppId: null,
        hoveredModuleId: null
    };

    const hook = {
        __selectedAppId: null,
        __pickerState: pickerState,
        apps,
        version: 3,
        registerApp(app) {
            return ensureAppEntry(app, "mount", { source: "register-app" }).id;
        },
        unregisterApp(app) {
            const id = app?.__nodomxDevtoolsAppId;
            if (!id || !apps.has(id)) {
                return;
            }
            const entry = apps.get(id);
            if (entry) {
                recordTimelineEvent(entry, "unmount", {
                    appId: id,
                    category: "lifecycle",
                    summary: "App unmounted"
                });
            }
            apps.delete(id);
            if (selectedAppId === id) {
                selectedAppId = apps.keys().next().value || null;
                hook.__selectedAppId = selectedAppId;
            }
            clearHighlight();
            emit("unmount", id, null);
        },
        notifyUpdate(app, reason = "update", details = {}) {
            return ensureAppEntry(app, reason, details).snapshot;
        },
        getSnapshot() {
            return Array.from(apps.values()).map(entry => ({
                id: entry.id,
                lastEvent: entry.lastEvent,
                lastUpdatedAt: entry.lastUpdatedAt,
                selectedModuleId: entry.selectedModuleId,
                snapshot: cloneValue(entry.snapshot),
                timelineCount: entry.timeline.length
            }));
        },
        getAppSnapshot(appId) {
            const entry = resolveEntry(appId);
            return entry ? cloneValue(entry.snapshot) : null;
        },
        getTimeline(appId) {
            const entry = resolveEntry(appId);
            return entry ? cloneValue(entry.timeline) : [];
        },
        clearTimeline(appId) {
            const entry = resolveEntry(appId);
            if (!entry) {
                return;
            }
            entry.timeline.length = 0;
            recordTimelineEvent(entry, "timeline-cleared", {
                appId: entry.id,
                category: "manual",
                summary: "Timeline cleared"
            });
            renderOverlay();
        },
        exportSnapshot(appId) {
            const entry = resolveEntry(appId);
            if (!entry) {
                return "";
            }
            const payload = JSON.stringify(entry.snapshot, null, 2);
            if (globalTarget) {
                globalTarget.__NODOMX_DEVTOOLS_LAST_EXPORT__ = payload;
            }
            globalTarget?.navigator?.clipboard?.writeText?.(payload).catch?.(() => {});
            globalTarget?.console?.info?.("[NodomX Devtools] Snapshot exported", payload);
            return payload;
        },
        inspectSelection(appId, moduleId) {
            const entry = resolveEntry(appId);
            if (!entry) {
                return null;
            }
            const payload = {
                app: cloneValue(entry.snapshot),
                module: cloneValue(findModuleById(entry.snapshot.rootModule, moduleId ?? entry.selectedModuleId))
            };
            if (globalTarget) {
                globalTarget.__NODOMX_DEVTOOLS_LAST_INSPECT__ = payload;
            }
            globalTarget?.console?.info?.("[NodomX Devtools] Inspect selection", payload);
            return payload;
        },
        highlightSelection(appId, moduleId) {
            const entry = resolveEntry(appId);
            if (!entry) {
                return null;
            }
            const targetModuleId = moduleId ?? entry.selectedModuleId ?? entry.snapshot.rootModule?.id;
            const moduleInstance = findModuleInstance(entry.app?.instance, targetModuleId);
            const targetNode = resolveModuleElement(moduleInstance);
            if (!(targetNode instanceof Element)) {
                clearHighlight();
                return null;
            }
            const overlay = ensureHighlightElement();
            positionHighlightElement(overlay, targetNode);
            return {
                appId: entry.id,
                moduleId: moduleInstance?.id ?? null,
                targetTag: targetNode.tagName.toLowerCase()
            };
        },
        clearHighlight() {
            clearHighlight();
        },
        navigateRoute(path, options = {}) {
            const entry = resolveEntry(options.appId);
            const router = resolveRouter(globalTarget, entry);
            if (!router) {
                throw new Error("No Router instance is available for devtools navigation.");
            }
            const targetPath = normalizeRouteTarget(path);
            if (!targetPath) {
                throw new Error("Route path cannot be empty.");
            }
            if (options.replace) {
                router.replace(targetPath);
            } else {
                router.push(targetPath);
            }
            if (entry?.app) {
                this.notifyUpdate(entry.app, "devtools-route-nav", {
                    category: "manual",
                    replace: !!options.replace,
                    routePath: targetPath,
                    summary: `${options.replace ? "Replaced" : "Pushed"} route ${targetPath}`
                });
            }
            return targetPath;
        },
        pickElement(targetNode, appId) {
            const match = resolveModuleMatchForNode(targetNode, appId);
            if (!match) {
                return null;
            }
            this.selectApp(match.appId);
            this.selectModule(match.appId, match.module.id);
            if (pickerState.active) {
                this.stopElementPicker();
            }
            return {
                appId: match.appId,
                moduleId: match.module.id,
                targetTag: match.element?.tagName?.toLowerCase?.() || null
            };
        },
        startElementPicker(appId) {
            if (!globalTarget?.document) {
                return false;
            }
            if (pickerCleanup) {
                pickerCleanup();
                pickerCleanup = null;
            }
            const entry = resolveEntry(appId);
            if (!entry) {
                throw new Error("No NodomX app available to inspect.");
            }
            selectedAppId = entry.id;
            hook.__selectedAppId = entry.id;
            pickerState.active = true;
            pickerState.hoveredAppId = null;
            pickerState.hoveredModuleId = null;
            const onMouseMove = event => {
                const targetNode = event.target;
                if (isIgnoredPickerTarget(targetNode)) {
                    return;
                }
                const match = resolveModuleMatchForNode(targetNode, entry.id);
                if (!match) {
                    pickerState.hoveredAppId = null;
                    pickerState.hoveredModuleId = null;
                    clearHighlight();
                    renderOverlay();
                    return;
                }
                pickerState.hoveredAppId = match.appId;
                pickerState.hoveredModuleId = match.module.id;
                const overlay = ensureHighlightElement();
                positionHighlightElement(overlay, match.element);
                renderOverlay();
            };
            const onClick = event => {
                if (isIgnoredPickerTarget(event.target)) {
                    return;
                }
                const result = hook.pickElement(event.target, entry.id);
                if (!result) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
            };
            const onKeyDown = event => {
                if (event.key !== "Escape") {
                    return;
                }
                event.preventDefault();
                hook.stopElementPicker();
            };
            globalTarget.document.addEventListener("mousemove", onMouseMove, true);
            globalTarget.document.addEventListener("click", onClick, true);
            globalTarget.document.addEventListener("keydown", onKeyDown, true);
            globalTarget.document.body?.setAttribute("data-nodomx-devtools-picking", "true");
            pickerCleanup = () => {
                globalTarget.document.removeEventListener("mousemove", onMouseMove, true);
                globalTarget.document.removeEventListener("click", onClick, true);
                globalTarget.document.removeEventListener("keydown", onKeyDown, true);
                globalTarget.document.body?.removeAttribute("data-nodomx-devtools-picking");
            };
            renderOverlay();
            return true;
        },
        stopElementPicker() {
            if (pickerCleanup) {
                pickerCleanup();
                pickerCleanup = null;
            }
            pickerState.active = false;
            pickerState.hoveredAppId = null;
            pickerState.hoveredModuleId = null;
            clearHighlight();
            renderOverlay();
        },
        applyModulePatch(appId, moduleId, target, payload) {
            const entry = resolveEntry(appId);
            if (!entry) {
                throw new Error("No NodomX app available to patch.");
            }
            const targetModuleId = moduleId ?? entry.selectedModuleId ?? entry.snapshot.rootModule?.id;
            const moduleInstance = findModuleInstance(entry.app?.instance, targetModuleId);
            if (!moduleInstance) {
                throw new Error(`Unable to resolve module ${targetModuleId ?? "unknown"}.`);
            }
            const nextPayload = normalizePatchPayload(payload, `${target} patch`);
            if (target === "setup") {
                patchModuleSetup(moduleInstance, nextPayload);
            } else if (target === "state") {
                patchModuleState(moduleInstance, nextPayload);
            } else {
                throw new Error(`Unsupported module patch target: ${target}`);
            }
            refreshModule(moduleInstance);
            this.notifyUpdate(entry.app, "devtools-patch", {
                category: "manual",
                moduleId: moduleInstance.id,
                moduleName: moduleInstance.constructor?.name || "AnonymousModule",
                summary: `Patched ${target} on ${moduleInstance.constructor?.name || "module"}`
            });
            return this.getAppSnapshot(entry.id);
        },
        applyStorePatch(appId, storeId, payload) {
            const entry = resolveEntry(appId);
            if (!entry) {
                throw new Error("No NodomX app available to patch.");
            }
            const container = entry.app?.config?.globalProperties?.$store;
            const store = resolveStore(container, storeId);
            if (!store) {
                throw new Error(`Unable to resolve store "${storeId}".`);
            }
            const nextPayload = normalizePatchPayload(payload, `store patch for ${storeId}`);
            if (typeof store.$patch === "function") {
                store.$patch(nextPayload);
            } else {
                applyObjectPatch(store, nextPayload);
            }
            this.notifyUpdate(entry.app, "devtools-store-patch", {
                category: "manual",
                storeId,
                summary: `Patched store ${storeId}`
            });
            return this.getAppSnapshot(entry.id);
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        selectApp(appId) {
            if (!apps.has(appId)) {
                return;
            }
            selectedAppId = appId;
            hook.__selectedAppId = appId;
            const entry = apps.get(appId);
            if (entry && !findModuleById(entry.snapshot.rootModule, entry.selectedModuleId)) {
                entry.selectedModuleId = entry.snapshot.rootModule?.id ?? null;
            }
            renderOverlay();
            if (entry?.selectedModuleId != null) {
                this.highlightSelection(entry.id, entry.selectedModuleId);
            }
        },
        selectModule(appId, moduleId) {
            const entry = resolveEntry(appId);
            if (!entry) {
                return;
            }
            entry.selectedModuleId = moduleId;
            selectedAppId = entry.id;
            hook.__selectedAppId = entry.id;
            renderOverlay();
            this.highlightSelection(entry.id, moduleId);
        },
        openOverlay() {
            if (!globalTarget?.document) {
                return null;
            }
            installShortcut(globalTarget, hook);
            panel ||= createOverlay(globalTarget.document, hook, () => selectedAppId);
            renderOverlay();
            return panel;
        },
        closeOverlay() {
            if (!panel) {
                return;
            }
            hook.stopElementPicker();
            panel.root.remove();
            panel = null;
            clearHighlight();
        }
    };

    return hook;

    function resolveEntry(appId) {
        if (appId && apps.has(appId)) {
            return apps.get(appId);
        }
        if (selectedAppId && apps.has(selectedAppId)) {
            return apps.get(selectedAppId);
        }
        const firstEntry = apps.values().next();
        return firstEntry.done ? null : firstEntry.value;
    }

    function ensureAppEntry(app, reason, details) {
        const id = ensureAppId(app);
        const snapshot = snapshotApp(app, details);
        const entry = apps.get(id) || {
            app,
            id,
            selectedModuleId: snapshot.rootModule?.id ?? null,
            timeline: []
        };
        entry.app = app;
        entry.id = id;
        entry.lastEvent = reason;
        entry.lastUpdatedAt = new Date().toISOString();
        entry.snapshot = snapshot;
        entry.selectedModuleId = findModuleById(snapshot.rootModule, entry.selectedModuleId)
            ? entry.selectedModuleId
            : (snapshot.rootModule?.id ?? null);
        apps.set(id, entry);
        if (!selectedAppId) {
            selectedAppId = id;
            hook.__selectedAppId = id;
        }
        const moduleSnapshot = shouldResolveModuleSnapshot(details)
            ? resolveModuleSnapshot(snapshot.rootModule, details)
            : null;
        recordTimelineEvent(entry, reason, {
            appId: id,
            category: classifyEventCategory(reason, details?.hookName),
            details,
            hookName: details?.hookName || null,
            hotId: details?.hotId || moduleSnapshot?.hotId || null,
            moduleId: details?.moduleId || moduleSnapshot?.id || null,
            moduleName: details?.moduleName || moduleSnapshot?.name || null,
            summary: summarizeEvent(reason, details?.hookName, moduleSnapshot, details)
        });
        emit(reason, id, snapshot);
        return entry;
    }

    function recordTimelineEvent(entry, reason, payload) {
        entry.timeline.push({
            at: new Date().toISOString(),
            category: payload.category,
            details: cloneValue(payload.details || {}),
            hookName: payload.hookName || null,
            hotId: payload.hotId || null,
            id: `evt-${Math.random().toString(36).slice(2, 10)}`,
            moduleId: payload.moduleId || null,
            moduleName: payload.moduleName || null,
            reason,
            summary: payload.summary || reason
        });
        if (entry.timeline.length > timelineLimit) {
            entry.timeline.splice(0, entry.timeline.length - timelineLimit);
        }
    }

    function emit(type, id, snapshot) {
        const payload = {
            id,
            snapshot: snapshot ? cloneValue(snapshot) : null,
            type
        };
        for (const listener of listeners) {
            listener(payload);
        }
        renderOverlay();
    }

    function renderOverlay() {
        if (!panel) {
            return;
        }
        panel.render(Array.from(apps.values()));
    }

    function ensureHighlightElement() {
        if (highlightElement) {
            return highlightElement;
        }
        const overlay = globalTarget.document.createElement("div");
        overlay.setAttribute(HIGHLIGHT_ATTR, "");
        Object.assign(overlay.style, {
            border: "2px solid #14b8a6",
            borderRadius: "10px",
            boxShadow: "0 0 0 9999px rgba(15,23,42,0.12), 0 0 0 3px rgba(20,184,166,0.22)",
            pointerEvents: "none",
            position: "fixed",
            transition: "all 120ms ease",
            zIndex: "2147483646"
        });
        globalTarget.document.body.appendChild(overlay);
        highlightElement = overlay;
        return overlay;
    }

    function clearHighlight() {
        if (highlightElement) {
            highlightElement.remove();
            highlightElement = null;
        }
    }

    function isIgnoredPickerTarget(targetNode) {
        return targetNode instanceof Element
            && !!targetNode.closest(`[data-nodomx-devtools], [${HIGHLIGHT_ATTR}]`);
    }

    function resolveModuleMatchForNode(targetNode, appId) {
        const entry = resolveEntry(appId);
        if (!entry?.app?.instance || !(targetNode instanceof Node)) {
            return null;
        }
        const match = findModuleInstanceForNode(entry.app.instance, targetNode);
        if (!match) {
            return null;
        }
        return {
            appId: entry.id,
            element: resolveModuleElement(match),
            module: match
        };
    }
}

function findModuleInstance(rootModule, moduleId) {
    if (!rootModule || moduleId === null || moduleId === undefined) {
        return null;
    }
    if (rootModule.id === moduleId) {
        return rootModule;
    }
    for (const child of rootModule.children || []) {
        const found = findModuleInstance(child, moduleId);
        if (found) {
            return found;
        }
    }
    return null;
}

function resolveModuleElement(moduleInstance) {
    if (!moduleInstance) {
        return null;
    }
    if (!moduleInstance.domManager?.renderedTree && typeof moduleInstance.render === "function") {
        moduleInstance.render();
    }
    if (!moduleInstance.domManager?.renderedTree) {
        return null;
    }
    return findFirstElementNode(moduleInstance.domManager.renderedTree);
}

function findModuleInstanceForNode(rootModule, targetNode) {
    if (!rootModule || !(targetNode instanceof Node)) {
        return null;
    }
    const rootElement = resolveModuleElement(rootModule);
    if (!(rootElement instanceof Element) || !rootElement.contains(targetNode)) {
        return null;
    }
    for (const child of rootModule.children || []) {
        const found = findModuleInstanceForNode(child, targetNode);
        if (found) {
            return found;
        }
    }
    return rootModule;
}

function findFirstElementNode(renderedDom) {
    if (!renderedDom) {
        return null;
    }
    if (renderedDom.node instanceof Element) {
        return renderedDom.node;
    }
    for (const child of renderedDom.children || []) {
        const found = findFirstElementNode(child);
        if (found) {
            return found;
        }
    }
    return renderedDom.node instanceof Comment
        ? renderedDom.node.nextSibling instanceof Element
            ? renderedDom.node.nextSibling
            : null
        : null;
}

function positionHighlightElement(overlay, targetNode) {
    const rect = targetNode.getBoundingClientRect();
    Object.assign(overlay.style, {
        display: "block",
        height: `${Math.max(0, rect.height)}px`,
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${Math.max(0, rect.width)}px`
    });
}

function normalizePatchPayload(payload, label) {
    if (typeof payload === "string") {
        try {
            return JSON.parse(payload);
        } catch (error) {
            throw new Error(`Unable to parse ${label}: ${error.message}`);
        }
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error(`${label} must be a JSON object.`);
    }
    return payload;
}

function patchModuleSetup(moduleInstance, nextPayload) {
    const setupState = moduleInstance.setupState;
    if (!setupState || typeof setupState !== "object") {
        throw new Error("Selected module has no setup state to patch.");
    }
    for (const [key, value] of Object.entries(nextPayload)) {
        const binding = setupState[key];
        if (binding && typeof binding === "object" && "value" in binding) {
            binding.value = clonePatchValue(value);
            continue;
        }
        if (binding && typeof binding === "object" && value && typeof value === "object") {
            applyObjectPatch(binding, value);
            continue;
        }
        moduleInstance.model[key] = clonePatchValue(value);
    }
}

function patchModuleState(moduleInstance, nextPayload) {
    if (!moduleInstance?.model || typeof moduleInstance.model !== "object") {
        throw new Error("Selected module has no reactive model to patch.");
    }
    applyObjectPatch(moduleInstance.model, nextPayload);
}

function resolveStore(container, storeId) {
    const stores = container?._stores;
    if (!(stores instanceof Map)) {
        return null;
    }
    return stores.get(storeId) || null;
}

function refreshModule(moduleInstance) {
    if (!moduleInstance) {
        return;
    }
    if (typeof moduleInstance.markDirty === "function") {
        moduleInstance.markDirty();
    }
    if (typeof moduleInstance.render === "function") {
        moduleInstance.render();
        return;
    }
    if (typeof moduleInstance.active === "function") {
        moduleInstance.active();
    }
}

function applyObjectPatch(target, patch) {
    if (!target || typeof target !== "object") {
        return;
    }
    for (const [key, value] of Object.entries(patch)) {
        const current = target[key];
        if (current && typeof current === "object" && value && typeof value === "object" && !Array.isArray(value)) {
            applyObjectPatch(current, value);
            continue;
        }
        target[key] = clonePatchValue(value);
    }
}

function clonePatchValue(value) {
    if (value === null || value === undefined) {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(item => clonePatchValue(item));
    }
    if (typeof value === "object") {
        const output = {};
        for (const key of Object.keys(value)) {
            output[key] = clonePatchValue(value[key]);
        }
        return output;
    }
    return value;
}

function resolveRouter(globalTarget, entry) {
    const explicitRouter = globalTarget?.__NODOMX_ROUTER__;
    if (explicitRouter && typeof explicitRouter.push === "function" && typeof explicitRouter.replace === "function") {
        return explicitRouter;
    }
    const nodomRouter = globalTarget?.Nodom?.$Router || globalThis?.Nodom?.$Router;
    if (nodomRouter && typeof nodomRouter.push === "function" && typeof nodomRouter.replace === "function") {
        return nodomRouter;
    }
    const routeModel = entry?.app?.instance?.model?.$route;
    if (routeModel?.router && typeof routeModel.router.push === "function" && typeof routeModel.router.replace === "function") {
        return routeModel.router;
    }
    return null;
}

function shouldResolveModuleSnapshot(details) {
    if (!details || typeof details !== "object") {
        return true;
    }
    if (details.moduleId !== undefined && details.moduleId !== null) {
        return true;
    }
    if (details.hotId) {
        return true;
    }
    if (details.storeId) {
        return false;
    }
    return true;
}

function normalizeRouteTarget(target) {
    if (typeof target === "string") {
        return target.trim();
    }
    if (!target || typeof target !== "object") {
        return "";
    }
    const path = String(target.path || "").trim();
    if (!path) {
        return "";
    }
    const query = normalizeRouteQuery(target.query);
    const queryText = serializeRouteQuery(query);
    const hashText = normalizeRouteHash(target.hash);
    return `${path}${queryText}${hashText}`;
}

function normalizeRouteQuery(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return value;
}

function serializeRouteQuery(query) {
    const parts = [];
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === "") {
            continue;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                if (item === undefined || item === null || item === "") {
                    continue;
                }
                parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
            }
            continue;
        }
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
    return parts.length ? `?${parts.join("&")}` : "";
}

function normalizeRouteHash(hash) {
    const value = String(hash || "").trim();
    if (!value) {
        return "";
    }
    return value.startsWith("#") ? value : `#${value}`;
}
