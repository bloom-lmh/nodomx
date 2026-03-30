import { renderPanel } from "./panel-render.js";
import { SHORTCUT_KEY } from "./shared.js";

export function createOverlay(documentRef, hook, getSelectedAppId) {
    const root = documentRef.createElement("aside");
    root.setAttribute("data-nodomx-devtools", "");
    Object.assign(root.style, {
        position: "fixed",
        right: "18px",
        bottom: "18px",
        width: "980px",
        maxWidth: "calc(100vw - 36px)",
        height: "72vh",
        maxHeight: "780px",
        overflow: "hidden",
        zIndex: "2147483647",
        background: "rgba(8, 15, 27, 0.98)",
        color: "#e5eef7",
        borderRadius: "18px",
        boxShadow: "0 24px 64px rgba(0,0,0,0.38)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        border: "1px solid rgba(148, 163, 184, 0.22)",
        backdropFilter: "blur(12px)"
    });
    documentRef.body.appendChild(root);

    const state = {
        activeTab: "module",
        eventFilter: "all",
        notice: null,
        searchQuery: "",
        selectedEventId: null,
        selectedModuleOnly: false,
        timelineGroupBy: "none",
        timelineGroupKey: ""
    };

    return {
        root,
        render(entries) {
            const selectedId = getSelectedAppId();
            const current = entries.find(entry => entry.id === selectedId) || entries[0];
            root.innerHTML = renderPanel(entries, current, state, hook.__pickerState);
            bindOverlayEvents(root, hook, state, entries);
        }
    };
}

export function installShortcut(globalTarget, hook) {
    if (!globalTarget?.document || globalTarget[SHORTCUT_KEY]) {
        return;
    }
    globalTarget[SHORTCUT_KEY] = true;
    globalTarget.document.addEventListener("keydown", event => {
        if (!(event.ctrlKey && event.shiftKey && String(event.key || "").toLowerCase() === "d")) {
            return;
        }
        event.preventDefault();
        if (globalTarget.document.querySelector("[data-nodomx-devtools]")) {
            hook.closeOverlay();
        } else {
            hook.openOverlay();
        }
    });
}

function bindOverlayEvents(root, hook, state, entries) {
    const current = entries.find(entry => entry.id === getSelectedAppId(entries, hook)) || entries[0];
    root.querySelector('[data-action="refresh"]')?.addEventListener("click", () => {
        if (!current) {
            return;
        }
        hook.notifyUpdate(current.app, "manual-refresh", {
            category: "manual",
            summary: "Manual refresh"
        });
        setNotice("success", "Snapshot refreshed.");
    });
    root.querySelector('[data-action="highlight"]')?.addEventListener("click", () => {
        if (!current) {
            return;
        }
        const result = hook.highlightSelection(current.id, current.selectedModuleId);
        setNotice(result ? "success" : "error", result ? `Highlighted <${result.targetTag}> for module #${result.moduleId}.` : "Unable to resolve a DOM element for the current module.");
    });
    root.querySelector('[data-action="pick"]')?.addEventListener("click", () => {
        if (!current) {
            return;
        }
        try {
            if (hook.__pickerState?.active) {
                hook.stopElementPicker();
                setNotice("success", "Element picker stopped.");
                return;
            }
            hook.startElementPicker(current.id);
            setNotice("success", "Element picker started. Hover the page and click a NodomX element to inspect it.");
        } catch (error) {
            setNotice("error", error.message || "Unable to start element picker.");
        }
    });
    root.querySelector('[data-action="export"]')?.addEventListener("click", () => {
        if (!current) {
            return;
        }
        hook.exportSnapshot(current.id);
        setNotice("success", "Snapshot exported to console and clipboard when available.");
    });
    root.querySelector('[data-action="inspect"]')?.addEventListener("click", () => {
        if (!current) {
            return;
        }
        hook.inspectSelection(current.id, current.selectedModuleId);
        setNotice("success", "Selected app/module snapshot sent to console.");
    });
    root.querySelector('[data-action="clear-timeline"]')?.addEventListener("click", () => {
        if (!current) {
            return;
        }
        hook.clearTimeline(current.id);
        setNotice("success", "Timeline cleared.");
    });
    root.querySelector('[data-action="close"]')?.addEventListener("click", () => {
        hook.closeOverlay();
    });
    for (const button of root.querySelectorAll("[data-app-id]")) {
        button.addEventListener("click", () => {
            hook.selectApp(button.getAttribute("data-app-id"));
        });
    }
    for (const button of root.querySelectorAll("[data-module-id]")) {
        button.addEventListener("click", () => {
            if (current) {
                hook.selectModule(current.id, Number(button.getAttribute("data-module-id")));
            }
        });
    }
    for (const button of root.querySelectorAll("[data-event-id]")) {
        button.addEventListener("click", () => {
            state.selectedEventId = button.getAttribute("data-event-id");
            state.activeTab = "events";
            const moduleId = Number(button.getAttribute("data-event-module-id"));
            if (current && Number.isFinite(moduleId) && moduleId > 0) {
                hook.selectModule(current.id, moduleId);
                return;
            }
            rerender();
        });
    }
    root.querySelector("[data-devtools-search]")?.addEventListener("input", event => {
        state.searchQuery = event.target.value || "";
        rerender();
    });
    root.querySelector("[data-devtools-filter]")?.addEventListener("change", event => {
        state.eventFilter = event.target.value || "all";
        rerender();
    });
    root.querySelector('[data-action="toggle-module-events"]')?.addEventListener("click", () => {
        state.selectedModuleOnly = !state.selectedModuleOnly;
        rerender();
    });
    for (const button of root.querySelectorAll("[data-filter-category]")) {
        button.addEventListener("click", () => {
            state.eventFilter = button.getAttribute("data-filter-category") || "all";
            rerender();
        });
    }
    for (const button of root.querySelectorAll("[data-group-by]")) {
        button.addEventListener("click", () => {
            const nextGroupBy = button.getAttribute("data-group-by") || "none";
            state.timelineGroupBy = nextGroupBy;
            if (nextGroupBy === "none") {
                state.timelineGroupKey = "";
            }
            rerender();
        });
    }
    for (const button of root.querySelectorAll("[data-group-value]")) {
        button.addEventListener("click", () => {
            const nextGroupBy = button.getAttribute("data-group-field") || "none";
            const nextKey = button.getAttribute("data-group-value") || "";
            if (state.timelineGroupBy === nextGroupBy && state.timelineGroupKey === nextKey) {
                state.timelineGroupKey = "";
            } else {
                state.timelineGroupBy = nextGroupBy;
                state.timelineGroupKey = nextKey;
            }
            rerender();
        });
    }
    for (const button of root.querySelectorAll("[data-inspector-tab]")) {
        button.addEventListener("click", () => {
            state.activeTab = button.getAttribute("data-inspector-tab") || "module";
            rerender();
        });
    }
    for (const button of root.querySelectorAll("[data-apply-module]")) {
        button.addEventListener("click", () => {
            if (!current) {
                return;
            }
            const target = button.getAttribute("data-apply-module");
            const editor = root.querySelector(`[data-module-editor="${target}"]`);
            try {
                hook.applyModulePatch(current.id, current.selectedModuleId, target, editor?.value || "{}");
                setNotice("success", `Applied ${target} patch.`);
            } catch (error) {
                setNotice("error", error.message || `Failed to apply ${target} patch.`);
            }
        });
    }
    for (const button of root.querySelectorAll("[data-apply-store]")) {
        button.addEventListener("click", () => {
            if (!current) {
                return;
            }
            const storeId = button.getAttribute("data-apply-store");
            const editor = root.querySelector(`[data-store-editor="${cssEscape(storeId)}"]`);
            try {
                hook.applyStorePatch(current.id, storeId, editor?.value || "{}");
                setNotice("success", `Applied store patch to ${storeId}.`);
            } catch (error) {
                setNotice("error", error.message || `Failed to patch store ${storeId}.`);
            }
        });
    }
    for (const button of root.querySelectorAll("[data-route-action]")) {
        button.addEventListener("click", () => {
            if (!current) {
                return;
            }
            const target = button.getAttribute("data-route-action");
            const editorKey = button.getAttribute("data-route-editor-target");
            try {
                const routePayload = readRouteEditorPayload(root, editorKey);
                hook.navigateRoute(routePayload, {
                    appId: current.id,
                    replace: target === "replace"
                });
                setNotice("success", `${target === "replace" ? "Replaced" : "Pushed"} route ${routePayload.path}.`);
            } catch (error) {
                setNotice("error", error.message || "Failed to navigate route.");
            }
        });
    }

    scrollSelections(root);

    function rerender() {
        const nextEntries = Array.from(hook.apps.values());
        const selectedId = getSelectedAppId(nextEntries, hook);
        const selected = nextEntries.find(entry => entry.id === selectedId) || nextEntries[0];
        root.innerHTML = renderPanel(nextEntries, selected, state, hook.__pickerState);
        bindOverlayEvents(root, hook, state, nextEntries);
    }

    function setNotice(type, text) {
        state.notice = {
            text,
            type
        };
        rerender();
    }
}

function scrollSelections(root) {
    root.querySelector('[data-selected-module="true"]')?.scrollIntoView?.({
        block: "nearest"
    });
    root.querySelector('[data-selected-event="true"]')?.scrollIntoView?.({
        block: "nearest"
    });
}

function getSelectedAppId(entries, hook) {
    if (!hook || !entries?.length) {
        return null;
    }
    return hook.__selectedAppId || entries[0]?.id || null;
}

function cssEscape(value) {
    return String(value).replace(/(["\\])/g, "\\$1");
}

function readRouteEditorPayload(root, editorKey) {
    const pathEditor = root.querySelector(`[data-route-editor="${cssEscape(editorKey)}"]`);
    const queryEditor = root.querySelector(`[data-route-query-editor="${cssEscape(editorKey)}"]`);
    const hashEditor = root.querySelector(`[data-route-hash-editor="${cssEscape(editorKey)}"]`);
    const path = String(pathEditor?.value || "").trim();
    if (!path) {
        throw new Error("Route path cannot be empty.");
    }
    const queryText = String(queryEditor?.value || "").trim();
    let query = {};
    if (queryText) {
        try {
            const parsed = JSON.parse(queryText);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw new Error("Route query must be a JSON object.");
            }
            query = parsed;
        } catch (error) {
            throw new Error(`Unable to parse route query JSON: ${error.message}`);
        }
    }
    return {
        hash: String(hashEditor?.value || "").trim(),
        path,
        query
    };
}
