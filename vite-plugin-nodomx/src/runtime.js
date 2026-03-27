export async function bootstrapNodomxViteApp(options) {
    const nodom = options?.nodom;
    const selector = options?.selector || "#app";
    const load = options?.load;
    const hot = options?.hot;
    const deps = Array.isArray(options?.deps) ? options.deps : [];

    if (typeof load !== "function") {
        throw new Error("bootstrapNodomxViteApp requires a `load` function.");
    }
    if (!nodom || (typeof nodom.hotReload !== "function" && typeof nodom.remount !== "function")) {
        throw new Error("bootstrapNodomxViteApp requires a `nodom` object with hotReload or remount.");
    }

    if (hot?.on) {
        hot.on("vite:beforeUpdate", (payload) => {
            hot.data ||= {};
            hot.data.__nodomxChangedFiles = extractChangedFiles(payload);
        });
    }

    const initialModule = await load();
    const initialApp = resolveModuleClass(initialModule);
    mountResolvedModule(initialApp, nodom, selector, []);

    if (hot?.accept) {
        const acceptUpdate = async (acceptedModule) => {
            try {
                const nextModule = resolveAcceptedModule(acceptedModule) || await load();
                const nextApp = resolveModuleClass(nextModule);
                const changedFiles = readChangedFiles(hot);
                mountResolvedModule(nextApp, nodom, selector, changedFiles);
            } catch (error) {
                console.error("[nodomx-vite] hot update failed.", error);
                if (typeof hot.invalidate === "function") {
                    hot.invalidate();
                }
            }
        };

        if (deps.length > 0) {
            hot.accept(deps, acceptUpdate);
        } else {
            hot.accept(acceptUpdate);
        }
    }

    return initialApp;
}

function mountResolvedModule(App, nodom, selector, changedFiles) {
    const hotState = typeof nodom.captureHotState === "function"
        ? nodom.captureHotState()
        : undefined;
    if (typeof nodom.hotReload === "function") {
        nodom.hotReload(App, selector, hotState, changedFiles);
    } else {
        nodom.remount(App, selector);
    }
}

function resolveModuleClass(module) {
    if (!module || typeof module !== "object") {
        throw new Error("Failed to load the NodomX app module.");
    }
    if (module.default) {
        return module.default;
    }
    const firstExport = Object.values(module).find((value) => typeof value === "function");
    if (firstExport) {
        return firstExport;
    }
    throw new Error("The loaded module does not export a NodomX module class.");
}

function resolveAcceptedModule(acceptedModule) {
    if (Array.isArray(acceptedModule)) {
        return acceptedModule[0];
    }
    return acceptedModule;
}

function readChangedFiles(hot) {
    if (!hot?.data) {
        return [];
    }
    const changedFiles = Array.isArray(hot.data.__nodomxChangedFiles)
        ? hot.data.__nodomxChangedFiles.slice()
        : [];
    hot.data.__nodomxChangedFiles = [];
    return changedFiles;
}

function extractChangedFiles(payload) {
    if (!payload || !Array.isArray(payload.updates)) {
        return [];
    }

    const files = [];
    for (const update of payload.updates) {
        const file = normalizePath(update?.path || update?.acceptedPath || "");
        if (file && !files.includes(file)) {
            files.push(file);
        }
    }
    return files;
}

function normalizePath(file) {
    return String(file || "").replace(/\\/g, "/");
}
