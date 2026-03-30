import {
    buttonStyle,
    escapeHtml,
    formatTime,
    sectionStyle,
    sectionTitleStyle
} from "./shared.js";
import { findModuleById } from "./snapshot.js";

export function renderPanel(entries, current, state, pickerState = {}) {
    const selectedModule = current
        ? findModuleById(current.snapshot.rootModule, current.selectedModuleId) || current.snapshot.rootModule
        : null;
    const filteredTimeline = current
        ? filterTimeline(current.timeline, state.eventFilter, state.searchQuery)
        : [];
    const selectedEvent = current
        ? current.timeline.find(item => item.id === state.selectedEventId) || filteredTimeline[filteredTimeline.length - 1] || null
        : null;
    state.selectedEventId = selectedEvent?.id || null;
    const treeHtml = current
        ? renderModuleTree(current.snapshot.rootModule, current.selectedModuleId, state.searchQuery)
        : '<div style="opacity:.7;padding:10px 0;">No mounted NodomX app.</div>';
    const pickerActive = !!pickerState.active;

    return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(148,163,184,0.18);gap:16px;">
            <div style="display:grid;gap:6px;">
                <strong style="font-size:14px;letter-spacing:0.04em;">NodomX Devtools</strong>
                <span style="font-size:11px;opacity:.72;">Inspect apps, modules, stores, route state, and lifecycle timeline. Toggle with Ctrl+Shift+D.</span>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                ${renderAppTabs(entries, current?.id)}
                <button data-action="refresh" style="${buttonStyle("#1d4ed8", "#eff6ff")}">Refresh</button>
                <button data-action="highlight" style="${buttonStyle("rgba(20,184,166,0.22)", "#ccfbf1")}">Highlight</button>
                <button data-action="pick" style="${buttonStyle(pickerActive ? "#14b8a6" : "rgba(20,184,166,0.22)", pickerActive ? "#042f2e" : "#ccfbf1")}">${pickerActive ? "Stop pick" : "Pick element"}</button>
                <button data-action="export" style="${buttonStyle("rgba(148,163,184,0.18)", "#e5eef7")}">Export</button>
                <button data-action="inspect" style="${buttonStyle("rgba(148,163,184,0.18)", "#e5eef7")}">Inspect</button>
                <button data-action="clear-timeline" style="${buttonStyle("rgba(249,115,22,0.18)", "#ffedd5")}">Clear timeline</button>
                <button data-action="close" style="${buttonStyle("rgba(148,163,184,0.18)", "#e5eef7")}">Close</button>
            </div>
        </div>
        ${pickerActive ? `
            <div style="padding:10px 16px;border-bottom:1px solid rgba(148,163,184,0.12);background:rgba(20,184,166,0.14);font-size:12px;">
                Element picker is active. Hover the page to preview a module and click to select it. Press Esc to cancel.
            </div>
        ` : ""}
        ${state.notice ? `
            <div style="padding:10px 16px;border-bottom:1px solid rgba(148,163,184,0.12);background:${state.notice.type === "error" ? "rgba(127,29,29,0.35)" : "rgba(6,95,70,0.35)"};font-size:12px;">
                ${escapeHtml(state.notice.text)}
            </div>
        ` : ""}
        <div style="padding:12px 16px;display:grid;gap:12px;border-bottom:1px solid rgba(148,163,184,0.12);">
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                <input data-devtools-search value="${escapeHtml(state.searchQuery)}" placeholder="Search module, event, hot id..." style="flex:1;min-width:240px;background:rgba(15,23,42,0.85);color:#e5eef7;border:1px solid rgba(148,163,184,0.22);border-radius:12px;padding:10px 12px;outline:none;" />
                <select data-devtools-filter style="background:rgba(15,23,42,0.85);color:#e5eef7;border:1px solid rgba(148,163,184,0.22);border-radius:12px;padding:10px 12px;outline:none;">
                    ${renderFilterOptions(state.eventFilter)}
                </select>
                <div style="font-size:11px;opacity:.75;">Apps: ${entries.length} / Timeline: ${current?.timeline.length || 0} / Modules: ${current?.snapshot.summary.moduleCount || 0}</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">${renderInspectorTabs(state.activeTab)}</div>
        </div>
        <div style="display:grid;grid-template-columns:minmax(280px, 34%) minmax(0, 1fr);height:calc(72vh - 132px);max-height:calc(780px - 132px);">
            <section data-nodomx-devtools-tree style="border-right:1px solid rgba(148,163,184,0.12);display:grid;grid-template-rows:minmax(0,1fr) 220px;min-height:0;">
                <div style="padding:12px 14px;overflow:auto;min-height:0;">
                    <div style="font-size:11px;opacity:.68;margin-bottom:10px;">Module tree</div>
                    ${treeHtml}
                </div>
                <div data-nodomx-devtools-timeline style="padding:12px 14px;border-top:1px solid rgba(148,163,184,0.12);overflow:auto;min-height:0;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                        <span style="font-size:11px;opacity:.68;">Timeline</span>
                        <span style="font-size:11px;opacity:.68;">${filteredTimeline.length} item(s)</span>
                    </div>
                    ${renderTimeline(filteredTimeline, selectedEvent?.id)}
                </div>
            </section>
            <section data-nodomx-devtools-inspector style="padding:12px 16px;overflow:auto;min-height:0;">
                ${renderInspector(current, selectedModule, filteredTimeline, state.activeTab, selectedEvent)}
            </section>
        </div>
    `;
}

function renderInspector(current, selectedModule, filteredTimeline, activeTab, selectedEvent) {
    if (!current) {
        return '<div style="opacity:.7;">No app selected.</div>';
    }
    if (activeTab === "app") {
        return renderAppInspector(current);
    }
    if (activeTab === "events") {
        return renderEventInspector(selectedEvent);
    }
    if (activeTab === "stores") {
        return renderStoresInspector(current.snapshot.store);
    }
    if (activeTab === "raw") {
        return renderCodeBlock(current.snapshot);
    }
    return renderModuleInspector(current, selectedModule, filteredTimeline);
}

function renderModuleInspector(current, selectedModule, filteredTimeline) {
    const moduleInfo = selectedModule || current.snapshot.rootModule;
    if (!moduleInfo) {
        return '<div style="opacity:.7;">No module available.</div>';
    }
    const latestEvents = filteredTimeline.filter(item => {
        return item.moduleId === moduleInfo.id || item.reason === "mount" || item.reason === "manual-refresh";
    }).slice(-8).reverse();
    return `
        <div style="display:grid;gap:14px;">
            <section style="${sectionStyle()}">
                <div style="${sectionTitleStyle()}">Selected module</div>
                <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;font-size:12px;">
                    ${renderKeyValue("Name", moduleInfo.name)}
                    ${renderKeyValue("Module ID", moduleInfo.id)}
                    ${renderKeyValue("Hot ID", moduleInfo.hotId)}
                    ${renderKeyValue("State", moduleInfo.stateName)}
                    ${renderKeyValue("Children", moduleInfo.childCount)}
                    ${renderKeyValue("Slots", moduleInfo.slotNames.length ? moduleInfo.slotNames.join(", ") : "-")}
                </div>
            </section>
            <section style="${sectionStyle()}">
                <div style="${sectionTitleStyle()}">Module editors</div>
                ${renderEditableBlock("Setup", "setup", moduleInfo.setup)}
                ${renderEditableBlock("State", "state", moduleInfo.state)}
            </section>
            <section style="${sectionStyle()}">
                <div style="${sectionTitleStyle()}">Module summary</div>
                <div style="display:grid;gap:10px;">
                    ${renderPreviewBlock("Hooks", moduleInfo.hookNames)}
                    ${renderPreviewBlock("Props", moduleInfo.props)}
                    ${renderPreviewBlock("Exposed", moduleInfo.exposed)}
                    ${renderPreviewBlock("Route", moduleInfo.route)}
                    ${renderPreviewBlock("KeepAlive", moduleInfo.keepAlive)}
                </div>
            </section>
            <section style="${sectionStyle()}">
                <div style="${sectionTitleStyle()}">Recent module events</div>
                ${latestEvents.length ? latestEvents.map(event => renderTimelineItem(event, false)).join("") : '<div style="opacity:.7;font-size:12px;">No recent events for this module.</div>'}
            </section>
        </div>
    `;
}

function renderAppInspector(current) {
    return `
        <div style="display:grid;gap:14px;">
            <section style="${sectionStyle()}">
                <div style="${sectionTitleStyle()}">App overview</div>
                <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;font-size:12px;">
                    ${renderKeyValue("Name", current.snapshot.name)}
                    ${renderKeyValue("Selector", current.snapshot.selector || "-")}
                    ${renderKeyValue("Modules", current.snapshot.summary.moduleCount)}
                    ${renderKeyValue("Stores", current.snapshot.summary.storeCount)}
                    ${renderKeyValue("Last event", current.lastEvent)}
                    ${renderKeyValue("Updated", current.lastUpdatedAt)}
                </div>
            </section>
            <section style="${sectionStyle()}">
                <div style="${sectionTitleStyle()}">App summary</div>
                ${renderPreviewBlock("Summary", current.snapshot.summary)}
                ${renderPreviewBlock("Root route", current.snapshot.summary.route)}
                ${renderPreviewBlock("Store ids", current.snapshot.summary.storeIds)}
            </section>
        </div>
    `;
}

function renderStoresInspector(stores) {
    if (!stores?.length) {
        return `<section style="${sectionStyle()}"><div style="${sectionTitleStyle()}">Stores</div><div style="opacity:.7;font-size:12px;">No official store registered.</div></section>`;
    }
    return `<div style="display:grid;gap:14px;">${stores.map(store => `
        <section style="${sectionStyle()}">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <div style="${sectionTitleStyle()}">${escapeHtml(store.id)}</div>
                <button data-apply-store="${escapeHtml(store.id)}" style="${buttonStyle("rgba(20,184,166,0.22)", "#ccfbf1")}">Apply store state</button>
            </div>
            <textarea data-store-editor="${escapeHtml(store.id)}" spellcheck="false" style="${editorStyle()}">${escapeHtml(JSON.stringify(store.state ?? {}, null, 2))}</textarea>
            ${renderPreviewBlock("Current state", store.state)}
        </section>
    `).join("")}</div>`;
}

function renderModuleTree(rootModule, selectedModuleId, searchQuery) {
    if (!rootModule) {
        return '<div style="opacity:.7;font-size:12px;">No root module snapshot available.</div>';
    }
    const normalizedQuery = String(searchQuery || "").trim().toLowerCase();
    const rendered = renderModuleNode(rootModule, selectedModuleId, normalizedQuery, 0);
    return rendered.visible ? rendered.html : '<div style="opacity:.7;font-size:12px;">No module matches the current search.</div>';
}

function renderModuleNode(moduleInfo, selectedModuleId, searchQuery, depth) {
    const children = (moduleInfo.children || []).map(child => renderModuleNode(child, selectedModuleId, searchQuery, depth + 1));
    const selfText = `${moduleInfo.name} ${moduleInfo.hotId} ${moduleInfo.id}`.toLowerCase();
    const selfMatches = !searchQuery || selfText.includes(searchQuery);
    const childVisible = children.some(child => child.visible);
    if (!(selfMatches || childVisible)) {
        return { html: "", visible: false };
    }
    const active = moduleInfo.id === selectedModuleId;
    const badges = [
        moduleInfo.keepAlive?.managed ? "keep-alive" : "",
        moduleInfo.route ? "route" : "",
        moduleInfo.slotNames.length ? "slot" : ""
    ].filter(Boolean).map(label => `<span style="font-size:10px;padding:2px 6px;border-radius:999px;background:rgba(148,163,184,0.18);">${label}</span>`).join(" ");
    return {
        visible: true,
        html: `
            <div style="display:grid;gap:8px;margin-left:${depth * 14}px;">
                <button data-module-id="${moduleInfo.id}" style="cursor:pointer;border:none;border-radius:12px;padding:10px 12px;background:${active ? "rgba(20,184,166,0.22)" : "rgba(15,23,42,0.85)"};color:${active ? "#ccfbf1" : "#e5eef7"};text-align:left;">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                        <strong style="font-size:12px;">${escapeHtml(moduleInfo.name)}</strong>
                        <span style="font-size:10px;opacity:.72;">#${moduleInfo.id}</span>
                    </div>
                    <div style="margin-top:4px;font-size:11px;opacity:.74;">${escapeHtml(moduleInfo.hotId || "-")}</div>
                    <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">${badges || `<span style="font-size:10px;opacity:.6;">${escapeHtml(moduleInfo.stateName)}</span>`}</div>
                </button>
                ${children.filter(child => child.visible).map(child => child.html).join("")}
            </div>
        `
    };
}

function renderTimeline(events, selectedEventId) {
    if (!events.length) {
        return '<div style="opacity:.7;font-size:12px;">No timeline events yet.</div>';
    }
    return events.slice().reverse().map(event => renderTimelineItem(event, event.id === selectedEventId)).join("");
}

function renderTimelineItem(event, selected = false) {
    return `
        <button data-event-id="${escapeHtml(event.id)}" data-event-module-id="${escapeHtml(event.moduleId ?? "")}" style="display:grid;gap:4px;width:100%;cursor:pointer;border:none;text-align:left;padding:10px 12px;border-radius:12px;background:${selected ? "rgba(20,184,166,0.22)" : "rgba(15,23,42,0.85)"};color:${selected ? "#ccfbf1" : "#e5eef7"};margin-bottom:8px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <strong style="font-size:11px;">${escapeHtml(event.summary)}</strong>
                <span style="font-size:10px;opacity:.68;">${escapeHtml(formatTime(event.at))}</span>
            </div>
            <div style="font-size:10px;opacity:.72;">${escapeHtml(event.category)} / ${escapeHtml(event.reason)}${event.moduleName ? ` / ${escapeHtml(event.moduleName)}` : ""}</div>
            ${event.hookName ? `<div style="font-size:10px;opacity:.72;">Hook: ${escapeHtml(event.hookName)}</div>` : ""}
        </button>
    `;
}

function renderAppTabs(entries, selectedId) {
    if (!entries.length) {
        return '<span style="font-size:11px;opacity:.68;">No app</span>';
    }
    return entries.map(entry => {
        const active = entry.id === selectedId;
        return `<button data-app-id="${entry.id}" style="cursor:pointer;border:none;border-radius:999px;padding:6px 10px;background:${active ? "#14b8a6" : "rgba(148,163,184,0.18)"};color:${active ? "#042f2e" : "#e5eef7"};">${escapeHtml(entry.snapshot?.name || entry.id)}</button>`;
    }).join(" ");
}

function renderFilterOptions(selected) {
    return [
        ["all", "All events"],
        ["lifecycle", "Lifecycle"],
        ["render", "Render"],
        ["hook", "Hooks"],
        ["manual", "Manual"],
        ["update", "Update"],
        ["error", "Error"]
    ].map(([value, label]) => `<option value="${value}"${selected === value ? " selected" : ""}>${label}</option>`).join("");
}

function renderInspectorTabs(activeTab) {
    return [
        ["module", "Module"],
        ["app", "App"],
        ["events", "Events"],
        ["stores", "Stores"],
        ["raw", "Raw JSON"]
    ].map(([value, label]) => {
        const active = value === activeTab;
        return `<button data-inspector-tab="${value}" style="${buttonStyle(active ? "#14b8a6" : "rgba(148,163,184,0.18)", active ? "#042f2e" : "#e5eef7")}">${label}</button>`;
    }).join(" ");
}

function renderPreviewBlock(label, value) {
    return `<div style="display:grid;gap:6px;"><div style="font-size:11px;opacity:.68;">${escapeHtml(label)}</div>${renderCodeBlock(value)}</div>`;
}

function renderEditableBlock(label, target, value) {
    return `
        <div style="display:grid;gap:8px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <div style="font-size:11px;opacity:.68;">${escapeHtml(label)}</div>
                <button data-apply-module="${target}" style="${buttonStyle("rgba(20,184,166,0.22)", "#ccfbf1")}">Apply ${escapeHtml(label.toLowerCase())}</button>
            </div>
            <textarea data-module-editor="${target}" spellcheck="false" style="${editorStyle()}">${escapeHtml(JSON.stringify(value ?? {}, null, 2))}</textarea>
        </div>
    `;
}

function renderCodeBlock(value) {
    return `<pre style="margin:0;padding:12px;background:rgba(15,23,42,0.85);border-radius:12px;overflow:auto;font-size:11px;line-height:1.5;max-height:220px;">${escapeHtml(JSON.stringify(value ?? null, null, 2))}</pre>`;
}

function renderEventInspector(event) {
    if (!event) {
        return `<section style="${sectionStyle()}"><div style="${sectionTitleStyle()}">Event details</div><div style="opacity:.7;font-size:12px;">Select a timeline event to inspect its details.</div></section>`;
    }
    return `
        <div style="display:grid;gap:14px;">
            <section style="${sectionStyle()}">
                <div style="${sectionTitleStyle()}">Event details</div>
                <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;font-size:12px;">
                    ${renderKeyValue("Summary", event.summary)}
                    ${renderKeyValue("When", formatTime(event.at))}
                    ${renderKeyValue("Category", event.category)}
                    ${renderKeyValue("Reason", event.reason)}
                    ${renderKeyValue("Module", event.moduleName || "-")}
                    ${renderKeyValue("Module ID", event.moduleId ?? "-")}
                    ${renderKeyValue("Hot ID", event.hotId || "-")}
                    ${renderKeyValue("Hook", event.hookName || "-")}
                </div>
            </section>
            <section style="${sectionStyle()}">
                <div style="${sectionTitleStyle()}">Payload</div>
                ${renderCodeBlock(event.details || {})}
            </section>
        </div>
    `;
}

function renderKeyValue(key, value) {
    return `<div style="display:grid;gap:4px;"><span style="opacity:.68;">${escapeHtml(key)}</span><strong>${escapeHtml(value ?? "-")}</strong></div>`;
}

function filterTimeline(events, filterValue, searchQuery) {
    const query = String(searchQuery || "").trim().toLowerCase();
    return events.filter(event => {
        if (filterValue !== "all" && event.category !== filterValue) {
            return false;
        }
        if (!query) {
            return true;
        }
        return [
            event.summary,
            event.reason,
            event.category,
            event.moduleName,
            event.hotId,
            event.hookName
        ].filter(Boolean).some(item => String(item).toLowerCase().includes(query));
    });
}

function editorStyle() {
    return "min-height:140px;resize:vertical;background:rgba(15,23,42,0.85);color:#e5eef7;border:1px solid rgba(148,163,184,0.18);border-radius:12px;padding:12px;font-size:11px;line-height:1.5;font-family:inherit;outline:none;";
}
