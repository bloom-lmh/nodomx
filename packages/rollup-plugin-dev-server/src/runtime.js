export async function bootstrapNodomApp(options) {
    const nodom = options?.nodom;
    const selector = options?.selector || "#app";
    const entryUrl = options?.entryUrl || "";
    const load = options?.load;

    if (typeof load !== "function") {
        throw new Error("bootstrapNodomApp requires a `load` function.");
    }
    if (!nodom || typeof nodom.remount !== "function") {
        throw new Error("bootstrapNodomApp requires a `nodom` object with a remount method.");
    }

    registerEntry(entryUrl);

    const module = await load();
    const App = resolveModuleClass(module);
    nodom.remount(App, selector);
    return App;
}

function registerEntry(entryUrl) {
    if (typeof window === "undefined" || !entryUrl) {
        return;
    }
    const state = window.__NODOMX_HMR__ = window.__NODOMX_HMR__ || {};
    state.entryUrl = entryUrl;
}

function resolveModuleClass(module) {
    if (!module || typeof module !== "object") {
        throw new Error("Failed to load the NodomX app module.");
    }
    if (module.default) {
        return module.default;
    }
    const firstExport = Object.values(module).find(value => typeof value === "function");
    if (firstExport) {
        return firstExport;
    }
    throw new Error("The loaded module does not export a NodomX module class.");
}
