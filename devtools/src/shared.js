export const DEVTOOLS_HOOK_KEY = "__NODOMX_DEVTOOLS_HOOK__";
export const DEVTOOLS_APP_ID = "__nodomxDevtoolsAppId";
export const DEFAULT_TIMELINE_LIMIT = 180;
export const SHORTCUT_KEY = "__nodomxDevtoolsShortcutInstalled__";

export const INTERESTING_HOOKS = new Set([
    "onMount",
    "onUnMount",
    "onActivated",
    "onDeactivated",
    "onBeforeEnter",
    "onEnter",
    "onAfterEnter",
    "onEnterCancelled",
    "onBeforeLeave",
    "onLeave",
    "onAfterLeave",
    "onLeaveCancelled",
    "onBeforeMove",
    "onMove",
    "onAfterMove",
    "onMoveCancelled",
    "onSuspensePending",
    "onSuspenseFallback",
    "onSuspenseResolve",
    "onSuspenseError",
    "onSuspenseRetry"
]);

export function getGlobalTarget() {
    if (typeof window !== "undefined") {
        return window;
    }
    if (typeof globalThis !== "undefined") {
        return globalThis;
    }
    return null;
}

export function ensureAppId(app) {
    if (!app[DEVTOOLS_APP_ID]) {
        app[DEVTOOLS_APP_ID] = `app-${Math.random().toString(36).slice(2, 10)}`;
    }
    return app[DEVTOOLS_APP_ID];
}

export function cloneValue(value, seen = new WeakMap()) {
    if (value === null || value === undefined) {
        return value;
    }
    if (typeof value === "function") {
        return `[Function ${value.name || "anonymous"}]`;
    }
    if (typeof value !== "object") {
        return value;
    }
    if (seen.has(value)) {
        return "[Circular]";
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (Array.isArray(value)) {
        seen.set(value, true);
        return value.map(item => cloneValue(item, seen));
    }
    seen.set(value, true);
    const output = {};
    for (const key of Object.keys(value)) {
        output[key] = cloneValue(value[key], seen);
    }
    return output;
}

export function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export function formatTime(value) {
    if (!value) {
        return "-";
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleTimeString();
}

export function buttonStyle(background, color) {
    return `cursor:pointer;border:none;border-radius:10px;padding:6px 10px;background:${background};color:${color};`;
}

export function sectionStyle() {
    return "display:grid;gap:10px;padding:12px;background:rgba(15,23,42,0.72);border-radius:14px;border:1px solid rgba(148,163,184,0.16);";
}

export function sectionTitleStyle() {
    return "font-size:11px;opacity:.68;letter-spacing:0.04em;text-transform:uppercase;";
}
