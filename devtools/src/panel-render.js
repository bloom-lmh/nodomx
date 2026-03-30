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
    const baseTimeline = current
        ? filterTimeline(current.timeline, state.eventFilter, state.searchQuery, selectedModule?.id, state.selectedModuleOnly)
        : [];
    const timelineGroups = current
        ? groupTimeline(baseTimeline, state.timelineGroupBy)
        : [];
    const filteredTimeline = current
        ? filterTimelineByGroup(baseTimeline, state.timelineGroupBy, state.timelineGroupKey)
        : [];
    const activeTimelineGroup = current
        ? resolveActiveTimelineGroup(timelineGroups, state.timelineGroupBy, state.timelineGroupKey, filteredTimeline)
        : null;
    const selectedEvent = current
        ? filteredTimeline.find(item => item.id === state.selectedEventId) || filteredTimeline[filteredTimeline.length - 1] || null
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
                <button data-action="toggle-module-events" style="${buttonStyle(state.selectedModuleOnly ? "#14b8a6" : "rgba(148,163,184,0.18)", state.selectedModuleOnly ? "#042f2e" : "#e5eef7")}">Only selected module</button>
                <div style="font-size:11px;opacity:.75;">Apps: ${entries.length} / Timeline: ${current?.timeline.length || 0} / Visible: ${filteredTimeline.length} / Modules: ${current?.snapshot.summary.moduleCount || 0}</div>
            </div>
            ${current ? renderTimelineSummary(current.timeline, baseTimeline, timelineGroups, state.eventFilter, selectedModule?.id, state.selectedModuleOnly, state.timelineGroupBy, state.timelineGroupKey) : ""}
            <div style="display:flex;gap:8px;flex-wrap:wrap;">${renderInspectorTabs(state.activeTab)}</div>
        </div>
        <div style="display:grid;grid-template-columns:minmax(280px, 34%) minmax(0, 1fr);height:calc(72vh - 160px);max-height:calc(780px - 160px);">
            <section data-nodomx-devtools-tree style="border-right:1px solid rgba(148,163,184,0.12);display:grid;grid-template-rows:minmax(0,1fr) 260px;min-height:0;">
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
                ${renderInspector(current, selectedModule, filteredTimeline, state.activeTab, selectedEvent, activeTimelineGroup)}
            </section>
        </div>
    `;
}

function renderInspector(current, selectedModule, filteredTimeline, activeTab, selectedEvent, activeTimelineGroup) {
    if (!current) {
        return '<div style="opacity:.7;">No app selected.</div>';
    }
    if (activeTab === "app") {
        return renderAppInspector(current);
    }
    if (activeTab === "events") {
        return renderEventInspector(selectedEvent, activeTimelineGroup);
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
            ${moduleInfo.route ? renderRouteEditor("Module route", "module", moduleInfo.route) : ""}
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
            ${current.snapshot.summary.route ? renderRouteEditor("App route", "app", current.snapshot.summary.route) : ""}
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

function renderRouteEditor(label, target, route) {
    return `
        <section style="${sectionStyle()}">
            <div style="${sectionTitleStyle()}">${escapeHtml(label)}</div>
            <div style="font-size:12px;opacity:.82;">Current: ${escapeHtml(route.fullPath || route.path || "/")}</div>
            ${renderRouteSnapshot(route)}
            <div style="display:grid;gap:8px;">
                <div style="font-size:11px;opacity:.68;">Path</div>
                <textarea data-route-editor="${target}" spellcheck="false" style="${editorStyle(80)}">${escapeHtml(route.path || route.fullPath || "/")}</textarea>
            </div>
            <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(180px, 30%);gap:10px;">
                <div style="display:grid;gap:8px;">
                    <div style="font-size:11px;opacity:.68;">Query JSON</div>
                    ${renderRouteQueryPairs(route.query, target)}
                    <textarea data-route-query-editor="${target}" spellcheck="false" style="${editorStyle(120)}">${escapeHtml(JSON.stringify(route.query ?? {}, null, 2))}</textarea>
                </div>
                <div style="display:grid;gap:8px;">
                    <div style="font-size:11px;opacity:.68;">Hash</div>
                    <textarea data-route-hash-editor="${target}" spellcheck="false" style="${editorStyle(120)}">${escapeHtml(route.hash || "")}</textarea>
                </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button data-route-action="push" data-route-editor-target="${target}" style="${buttonStyle("rgba(20,184,166,0.22)", "#ccfbf1")}">Push route</button>
                <button data-route-action="replace" data-route-editor-target="${target}" style="${buttonStyle("rgba(59,130,246,0.22)", "#dbeafe")}">Replace route</button>
            </div>
        </section>
    `;
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
                <button data-module-id="${moduleInfo.id}" data-selected-module="${active ? "true" : "false"}" style="cursor:pointer;border:none;border-radius:12px;padding:10px 12px;background:${active ? "rgba(20,184,166,0.22)" : "rgba(15,23,42,0.85)"};color:${active ? "#ccfbf1" : "#e5eef7"};text-align:left;">
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
        <button data-event-id="${escapeHtml(event.id)}" data-event-module-id="${escapeHtml(event.moduleId ?? "")}" data-selected-event="${selected ? "true" : "false"}" style="display:grid;gap:4px;width:100%;cursor:pointer;border:none;text-align:left;padding:10px 12px;border-radius:12px;background:${selected ? "rgba(20,184,166,0.22)" : "rgba(15,23,42,0.85)"};color:${selected ? "#ccfbf1" : "#e5eef7"};margin-bottom:8px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <strong style="font-size:11px;">${escapeHtml(event.summary)}</strong>
                <span style="font-size:10px;opacity:.68;">${escapeHtml(formatTime(event.at))}</span>
            </div>
            <div style="font-size:10px;opacity:.72;">${escapeHtml(event.category)} / ${escapeHtml(event.reason)}${event.moduleName ? ` / ${escapeHtml(event.moduleName)}` : ""}</div>
            ${event.hookName ? `<div style="font-size:10px;opacity:.72;">Hook: ${escapeHtml(event.hookName)}</div>` : ""}
        </button>
    `;
}

function renderTimelineSummary(events, baseTimeline, groups, activeFilter, selectedModuleId, selectedModuleOnly, timelineGroupBy, timelineGroupKey) {
    const counts = countTimelineEvents(events, selectedModuleId);
    const activeGroupLabel = timelineGroupBy !== "none" && timelineGroupKey
        ? `Grouped by ${timelineGroupBy}: ${timelineGroupKey}`
        : "No timeline grouping";
    const filters = [
        ["all", `All (${counts.all})`],
        ["lifecycle", `Lifecycle (${counts.lifecycle})`],
        ["render", `Render (${counts.render})`],
        ["hook", `Hooks (${counts.hook})`],
        ["manual", `Manual (${counts.manual})`],
        ["update", `Update (${counts.update})`],
        ["error", `Error (${counts.error})`]
    ];
    return `
        <div style="display:grid;gap:10px;">
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                ${filters.map(([value, label]) => `<button data-filter-category="${value}" style="${buttonStyle(activeFilter === value ? "#14b8a6" : "rgba(148,163,184,0.18)", activeFilter === value ? "#042f2e" : "#e5eef7")}">${label}</button>`).join(" ")}
                <span style="font-size:11px;opacity:.72;">Selected module events: ${counts.selectedModule}</span>
                ${selectedModuleOnly ? '<span style="font-size:11px;opacity:.72;">Module-only filter is active</span>' : ""}
                <span style="font-size:11px;opacity:.72;">Visible after filter: ${baseTimeline.length}</span>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                ${renderTimelineGroupingButtons(timelineGroupBy)}
                <span style="font-size:11px;opacity:.72;">${escapeHtml(activeGroupLabel)}</span>
            </div>
            ${groups.length ? `
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                    ${groups.map(group => `<button data-group-field="${timelineGroupBy}" data-group-value="${escapeHtml(group.key)}" style="${buttonStyle(timelineGroupBy !== "none" && timelineGroupKey === group.key ? "#14b8a6" : "rgba(148,163,184,0.18)", timelineGroupBy !== "none" && timelineGroupKey === group.key ? "#042f2e" : "#e5eef7")}">${escapeHtml(group.label)} (${group.count})</button>`).join(" ")}
                </div>
            ` : ""}
        </div>
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

function renderEventInspector(event, activeTimelineGroup) {
    if (!event && !activeTimelineGroup) {
        return `<section style="${sectionStyle()}"><div style="${sectionTitleStyle()}">Event details</div><div style="opacity:.7;font-size:12px;">Select a timeline event to inspect its details.</div></section>`;
    }
    return `
        <div style="display:grid;gap:14px;">
            ${activeTimelineGroup ? renderTimelineGroupDetails(activeTimelineGroup) : ""}
            ${event ? `
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
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
                        ${event.moduleId ? `<button data-event-jump-action="module" data-event-jump-module-id="${escapeHtml(event.moduleId)}" data-event-jump-event-id="${escapeHtml(event.id)}" style="${buttonStyle("rgba(20,184,166,0.22)", "#ccfbf1")}">Jump to module</button>` : ""}
                        ${event.moduleId ? `<button data-event-jump-action="node" data-event-jump-module-id="${escapeHtml(event.moduleId)}" data-event-jump-event-id="${escapeHtml(event.id)}" style="${buttonStyle("rgba(59,130,246,0.22)", "#dbeafe")}">Highlight node</button>` : ""}
                    </div>
                </section>
                <section style="${sectionStyle()}">
                    <div style="${sectionTitleStyle()}">Payload</div>
                    ${renderCodeBlock(event.details || {})}
                </section>
            ` : `
                <section style="${sectionStyle()}">
                    <div style="${sectionTitleStyle()}">Event details</div>
                    <div style="opacity:.7;font-size:12px;">Select a timeline event inside the active group to inspect its payload.</div>
                </section>
            `}
        </div>
    `;
}

function renderKeyValue(key, value) {
    return `<div style="display:grid;gap:4px;"><span style="opacity:.68;">${escapeHtml(key)}</span><strong>${escapeHtml(value ?? "-")}</strong></div>`;
}

function filterTimeline(events, filterValue, searchQuery, selectedModuleId, selectedModuleOnly) {
    const query = String(searchQuery || "").trim().toLowerCase();
    return events.filter(event => {
        if (filterValue !== "all" && event.category !== filterValue) {
            return false;
        }
        if (selectedModuleOnly && selectedModuleId != null && event.moduleId !== selectedModuleId) {
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

function filterTimelineByGroup(events, timelineGroupBy, timelineGroupKey) {
    if (timelineGroupBy === "none" || !timelineGroupKey) {
        return events;
    }
    return events.filter(event => resolveTimelineGroupKey(event, timelineGroupBy) === timelineGroupKey);
}

function groupTimeline(events, timelineGroupBy) {
    if (timelineGroupBy === "none") {
        return [];
    }
    const groups = new Map();
    for (const event of events) {
        const key = resolveTimelineGroupKey(event, timelineGroupBy);
        if (!groups.has(key)) {
            groups.set(key, {
                count: 0,
                key,
                label: key,
                lastAt: event.at
            });
        }
        const group = groups.get(key);
        group.count += 1;
        group.lastAt = event.at;
    }
    return Array.from(groups.values())
        .sort((left, right) => right.count - left.count || String(right.lastAt).localeCompare(String(left.lastAt)))
        .slice(0, 8);
}

function resolveTimelineGroupKey(event, timelineGroupBy) {
    if (timelineGroupBy === "module") {
        return event.moduleName || event.hotId || "App / global";
    }
    return event.reason || "unknown";
}

function resolveActiveTimelineGroup(groups, timelineGroupBy, timelineGroupKey, filteredTimeline) {
    if (timelineGroupBy === "none" || !timelineGroupKey) {
        return null;
    }
    const current = groups.find(group => group.key === timelineGroupKey);
    if (!current) {
        return null;
    }
    return {
        ...current,
        events: filteredTimeline.slice().reverse().slice(0, 6),
        groupBy: timelineGroupBy
    };
}

function renderTimelineGroupingButtons(activeGroupBy) {
    const groups = [
        ["none", "No grouping"],
        ["reason", "By reason"],
        ["module", "By module"]
    ];
    return groups.map(([value, label]) => `<button data-group-by="${value}" style="${buttonStyle(activeGroupBy === value ? "#14b8a6" : "rgba(148,163,184,0.18)", activeGroupBy === value ? "#042f2e" : "#e5eef7")}">${label}</button>`).join(" ");
}

function countTimelineEvents(events, selectedModuleId) {
    const counts = {
        all: events.length,
        error: 0,
        hook: 0,
        lifecycle: 0,
        manual: 0,
        render: 0,
        selectedModule: 0,
        update: 0
    };
    for (const event of events) {
        if (event.category in counts) {
            counts[event.category] += 1;
        }
        if (selectedModuleId != null && event.moduleId === selectedModuleId) {
            counts.selectedModule += 1;
        }
    }
    return counts;
}

function editorStyle(minHeight = 140) {
    return `min-height:${minHeight}px;resize:vertical;background:rgba(15,23,42,0.85);color:#e5eef7;border:1px solid rgba(148,163,184,0.18);border-radius:12px;padding:12px;font-size:11px;line-height:1.5;font-family:inherit;outline:none;`;
}

function renderTimelineGroupDetails(group) {
    return `
        <section style="${sectionStyle()}">
            <div style="${sectionTitleStyle()}">Active timeline group</div>
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;font-size:12px;">
                ${renderKeyValue("Group by", group.groupBy)}
                ${renderKeyValue("Group key", group.key)}
                ${renderKeyValue("Visible events", group.count)}
            </div>
            <div style="display:grid;gap:8px;">
                <div style="font-size:11px;opacity:.68;">Recent events in this group</div>
                ${group.events.length
                    ? group.events.map(item => `<div style="padding:8px 10px;border-radius:10px;background:rgba(15,23,42,0.85);font-size:11px;display:grid;gap:8px;">
                        <button data-group-event-id="${escapeHtml(item.id)}" data-group-event-module-id="${escapeHtml(item.moduleId ?? "")}" style="cursor:pointer;border:none;background:transparent;color:inherit;padding:0;text-align:left;">
                            <div style="display:flex;justify-content:space-between;gap:8px;">
                                <strong>${escapeHtml(item.summary)}</strong>
                                <span style="opacity:.68;">${escapeHtml(formatTime(item.at))}</span>
                            </div>
                            <div style="margin-top:4px;opacity:.72;">${escapeHtml(item.moduleName || "App / global")} / ${escapeHtml(item.reason)}</div>
                        </button>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;">
                            ${item.moduleId ? `<button data-event-jump-action="module" data-event-jump-module-id="${escapeHtml(item.moduleId)}" data-event-jump-event-id="${escapeHtml(item.id)}" style="${buttonStyle("rgba(20,184,166,0.22)", "#ccfbf1")}">Jump to module</button>` : ""}
                            ${item.moduleId ? `<button data-event-jump-action="node" data-event-jump-module-id="${escapeHtml(item.moduleId)}" data-event-jump-event-id="${escapeHtml(item.id)}" style="${buttonStyle("rgba(59,130,246,0.22)", "#dbeafe")}">Highlight node</button>` : ""}
                        </div>
                    </div>`).join("")
                    : '<div style="opacity:.7;font-size:12px;">No events available for the current group.</div>'}
            </div>
        </section>
    `;
}

function renderRouteQueryPairs(query, target) {
    const entries = Object.entries(query || {});
    const rows = entries.length ? entries : [["", ""]];
    return `
        <div data-route-query-list="${target}" style="display:grid;gap:8px;">
            ${rows.map(([key, value], index) => renderRouteQueryRow(target, index, key, value)).join("")}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button data-route-query-action="add" data-route-query-target="${target}" style="${buttonStyle("rgba(20,184,166,0.22)", "#ccfbf1")}">Add query pair</button>
            <button data-route-query-action="sync" data-route-query-target="${target}" style="${buttonStyle("rgba(148,163,184,0.18)", "#e5eef7")}">Sync from rows</button>
        </div>
    `;
}

function renderRouteQueryRow(target, index, key, value) {
    return `
        <div data-route-query-row="${target}" style="display:grid;grid-template-columns:minmax(120px,0.4fr) minmax(0,1fr) auto;gap:8px;align-items:center;">
            <input data-route-query-key="${target}" data-route-query-index="${index}" value="${escapeHtml(String(key ?? ""))}" placeholder="query key" style="${inlineInputStyle()}" />
            <input data-route-query-value="${target}" data-route-query-index="${index}" value="${escapeHtml(stringifyRouteQueryValue(value))}" placeholder="query value" style="${inlineInputStyle()}" />
            <button data-route-query-action="remove" data-route-query-target="${target}" data-route-query-index="${index}" style="${buttonStyle("rgba(248,113,113,0.18)", "#fee2e2")}">Remove</button>
        </div>
    `;
}

function stringifyRouteQueryValue(value) {
    if (Array.isArray(value)) {
        return JSON.stringify(value);
    }
    if (value && typeof value === "object") {
        return JSON.stringify(value);
    }
    return value == null ? "" : String(value);
}

function inlineInputStyle() {
    return "background:rgba(15,23,42,0.85);color:#e5eef7;border:1px solid rgba(148,163,184,0.18);border-radius:10px;padding:8px 10px;font-size:11px;line-height:1.5;font-family:inherit;outline:none;";
}

function renderRouteSnapshot(route) {
    const queryEntries = Object.entries(route.query || {});
    const paramEntries = Object.entries(route.params || {});
    return `
        <div style="display:grid;gap:8px;">
            <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:11px;">
                <span style="padding:2px 8px;border-radius:999px;background:rgba(20,184,166,0.18);">path: ${escapeHtml(route.path || "/")}</span>
                <span style="padding:2px 8px;border-radius:999px;background:rgba(59,130,246,0.18);">query keys: ${queryEntries.length}</span>
                <span style="padding:2px 8px;border-radius:999px;background:rgba(249,115,22,0.18);">params: ${paramEntries.length}</span>
            </div>
            ${queryEntries.length ? `<div style="font-size:11px;opacity:.78;">Query: ${escapeHtml(queryEntries.map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(",") : value}`).join(" �� "))}</div>` : ""}
            ${paramEntries.length ? `<div style="font-size:11px;opacity:.78;">Params: ${escapeHtml(paramEntries.map(([key, value]) => `${key}=${value}`).join(" �� "))}</div>` : ""}
        </div>
    `;
}
