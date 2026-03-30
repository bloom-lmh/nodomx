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

export function createHook(globalTarget, options = {}) {
    const apps = new Map();
    const listeners = new Set();
    const timelineLimit = Math.max(40, Number(options.timelineLimit) || DEFAULT_TIMELINE_LIMIT);
    let panel = null;
    let selectedAppId = null;

    const hook = {
        __selectedAppId: null,
        apps,
        version: 2,
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
            globalTarget && (globalTarget.__NODOMX_DEVTOOLS_LAST_EXPORT__ = payload);
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
            globalTarget && (globalTarget.__NODOMX_DEVTOOLS_LAST_INSPECT__ = payload);
            globalTarget?.console?.info?.("[NodomX Devtools] Inspect selection", payload);
            return payload;
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
            panel.root.remove();
            panel = null;
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
        const moduleSnapshot = resolveModuleSnapshot(snapshot.rootModule, details);
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
}
