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
        searchQuery: ""
    };

    return {
        root,
        render(entries) {
            const selectedId = getSelectedAppId();
            const current = entries.find(entry => entry.id === selectedId) || entries[0];
            root.innerHTML = renderPanel(entries, current, state);
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
        if (current) {
            hook.notifyUpdate(current.app, "manual-refresh", {
                category: "manual",
                summary: "Manual refresh"
            });
        }
    });
    root.querySelector('[data-action="export"]')?.addEventListener("click", () => {
        if (current) {
            hook.exportSnapshot(current.id);
        }
    });
    root.querySelector('[data-action="inspect"]')?.addEventListener("click", () => {
        if (current) {
            hook.inspectSelection(current.id, current.selectedModuleId);
        }
    });
    root.querySelector('[data-action="clear-timeline"]')?.addEventListener("click", () => {
        if (current) {
            hook.clearTimeline(current.id);
        }
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
    root.querySelector("[data-devtools-search]")?.addEventListener("input", event => {
        state.searchQuery = event.target.value || "";
        rerender();
    });
    root.querySelector("[data-devtools-filter]")?.addEventListener("change", event => {
        state.eventFilter = event.target.value || "all";
        rerender();
    });
    for (const button of root.querySelectorAll("[data-inspector-tab]")) {
        button.addEventListener("click", () => {
            state.activeTab = button.getAttribute("data-inspector-tab") || "module";
            rerender();
        });
    }

    function rerender() {
        const nextEntries = Array.from(hook.apps.values());
        const selectedId = getSelectedAppId(nextEntries, hook);
        const selected = nextEntries.find(entry => entry.id === selectedId) || nextEntries[0];
        root.innerHTML = renderPanel(nextEntries, selected, state);
        bindOverlayEvents(root, hook, state, nextEntries);
    }
}

function getSelectedAppId(entries, hook) {
    if (!hook || !entries?.length) {
        return null;
    }
    return hook.__selectedAppId || entries[0]?.id || null;
}
