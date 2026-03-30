import { renderPanel } from "./panel-render.js";
import { SHORTCUT_KEY } from "./shared.js";

const PANEL_STATE_KEY = "__NODOMX_DEVTOOLS_PANEL_STATE__";

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
    hydrateState(documentRef.defaultView || globalThis, state);

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
    for (const button of root.querySelectorAll("[data-group-event-id]")) {
        button.addEventListener("click", () => {
            state.selectedEventId = button.getAttribute("data-group-event-id");
            state.activeTab = "events";
            const moduleId = Number(button.getAttribute("data-group-event-module-id"));
            if (current && Number.isFinite(moduleId) && moduleId > 0) {
                hook.selectModule(current.id, moduleId);
                return;
            }
            rerender();
        });
    }
    for (const button of root.querySelectorAll("[data-event-jump-action]")) {
        button.addEventListener("click", () => {
            if (!current) {
                return;
            }
            const eventId = button.getAttribute("data-event-jump-event-id");
            const moduleId = Number(button.getAttribute("data-event-jump-module-id"));
            if (!Number.isFinite(moduleId) || moduleId <= 0) {
                setNotice("error", "This event does not point to a concrete module node.");
                return;
            }
            state.selectedEventId = eventId;
            state.activeTab = "events";
            if (button.getAttribute("data-event-jump-action") === "node") {
                const result = hook.highlightSelection(current.id, moduleId);
                if (!result) {
                    setNotice("error", "Unable to resolve a DOM node for the selected event.");
                    return;
                }
                hook.selectModule(current.id, moduleId);
                setNotice("success", `Highlighted <${result.targetTag}> for module #${moduleId}.`);
                return;
            }
            hook.selectModule(current.id, moduleId);
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
    bindRouteQueryEditors(root, rerender);

    scrollSelections(root);

    function rerender() {
        persistState(root.ownerDocument?.defaultView || globalThis, state);
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

function bindRouteQueryEditors(root, rerender) {
    for (const button of root.querySelectorAll("[data-route-query-action]")) {
        button.addEventListener("click", () => {
            const target = button.getAttribute("data-route-query-target");
            if (!target) {
                return;
            }
            if (button.getAttribute("data-route-query-action") === "add") {
                appendRouteQueryRow(root, target);
                syncRouteQueryEditor(root, target);
                return;
            }
            if (button.getAttribute("data-route-query-action") === "remove") {
                const row = button.closest(`[data-route-query-row="${cssEscape(target)}"]`);
                row?.remove();
                if (!root.querySelector(`[data-route-query-row="${cssEscape(target)}"]`)) {
                    appendRouteQueryRow(root, target);
                }
                syncRouteQueryEditor(root, target);
                return;
            }
            if (button.getAttribute("data-route-query-action") === "sync") {
                syncRouteQueryEditor(root, target);
                return;
            }
            rerender();
        });
    }
    for (const input of root.querySelectorAll("[data-route-query-key],[data-route-query-value]")) {
        input.addEventListener("input", () => {
            const target = input.getAttribute("data-route-query-key") || input.getAttribute("data-route-query-value");
            if (!target) {
                return;
            }
            syncRouteQueryEditor(root, target, false);
        });
    }
}

function appendRouteQueryRow(root, target) {
    const list = root.querySelector(`[data-route-query-list="${cssEscape(target)}"]`);
    if (!list) {
        return;
    }
    const row = root.ownerDocument.createElement("div");
    row.setAttribute("data-route-query-row", target);
    Object.assign(row.style, {
        alignItems: "center",
        display: "grid",
        gap: "8px",
        gridTemplateColumns: "minmax(120px,0.4fr) minmax(0,1fr) auto"
    });
    row.innerHTML = `
        <input data-route-query-key="${target}" data-route-query-index="${list.children.length}" value="" placeholder="query key" style="background:rgba(15,23,42,0.85);color:#e5eef7;border:1px solid rgba(148,163,184,0.18);border-radius:10px;padding:8px 10px;font-size:11px;line-height:1.5;font-family:inherit;outline:none;" />
        <input data-route-query-value="${target}" data-route-query-index="${list.children.length}" value="" placeholder="query value" style="background:rgba(15,23,42,0.85);color:#e5eef7;border:1px solid rgba(148,163,184,0.18);border-radius:10px;padding:8px 10px;font-size:11px;line-height:1.5;font-family:inherit;outline:none;" />
        <button data-route-query-action="remove" data-route-query-target="${target}" data-route-query-index="${list.children.length}" style="cursor:pointer;border:none;border-radius:999px;padding:6px 10px;background:rgba(248,113,113,0.18);color:#fee2e2;">Remove</button>
    `;
    list.appendChild(row);
    for (const input of row.querySelectorAll("[data-route-query-key],[data-route-query-value]")) {
        input.addEventListener("input", () => syncRouteQueryEditor(root, target, false));
    }
    row.querySelector("[data-route-query-action=\"remove\"]")?.addEventListener("click", () => {
        row.remove();
        if (!root.querySelector(`[data-route-query-row="${cssEscape(target)}"]`)) {
            appendRouteQueryRow(root, target);
        }
        syncRouteQueryEditor(root, target);
    });
}

function syncRouteQueryEditor(root, target, pretty = true) {
    const editor = root.querySelector(`[data-route-query-editor="${cssEscape(target)}"]`);
    if (!editor) {
        return;
    }
    const nextQuery = readRouteQueryRows(root, target);
    editor.value = JSON.stringify(nextQuery, null, pretty ? 2 : 0);
}

function readRouteQueryRows(root, target) {
    const rows = root.querySelectorAll(`[data-route-query-row="${cssEscape(target)}"]`);
    const query = {};
    for (const row of rows) {
        const key = String(row.querySelector(`[data-route-query-key="${cssEscape(target)}"]`)?.value || "").trim();
        const rawValue = String(row.querySelector(`[data-route-query-value="${cssEscape(target)}"]`)?.value || "").trim();
        if (!key) {
            continue;
        }
        const value = parseRouteQueryValue(rawValue);
        if (Object.prototype.hasOwnProperty.call(query, key)) {
            const current = query[key];
            query[key] = Array.isArray(current)
                ? current.concat([value])
                : [current, value];
            continue;
        }
        query[key] = value;
    }
    return query;
}

function parseRouteQueryValue(value) {
    if (!value) {
        return "";
    }
    if (/^(true|false|null)$/i.test(value)) {
        return JSON.parse(value.toLowerCase());
    }
    if (/^-?\d+(\.\d+)?$/.test(value)) {
        return Number(value);
    }
    if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }
    return value;
}

function hydrateState(globalTarget, state) {
    const raw = globalTarget?.localStorage?.getItem?.(PANEL_STATE_KEY);
    if (!raw) {
        return;
    }
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") {
            return;
        }
        state.activeTab = parsed.activeTab || state.activeTab;
        state.eventFilter = parsed.eventFilter || state.eventFilter;
        state.searchQuery = parsed.searchQuery || "";
        state.selectedModuleOnly = !!parsed.selectedModuleOnly;
        state.timelineGroupBy = parsed.timelineGroupBy || "none";
        state.timelineGroupKey = parsed.timelineGroupKey || "";
    } catch {
        // ignore invalid persisted panel state
    }
}

function persistState(globalTarget, state) {
    globalTarget?.localStorage?.setItem?.(PANEL_STATE_KEY, JSON.stringify({
        activeTab: state.activeTab,
        eventFilter: state.eventFilter,
        searchQuery: state.searchQuery,
        selectedModuleOnly: state.selectedModuleOnly,
        timelineGroupBy: state.timelineGroupBy,
        timelineGroupKey: state.timelineGroupKey
    }));
}
