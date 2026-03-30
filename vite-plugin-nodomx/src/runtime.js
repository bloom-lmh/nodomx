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
        hot.on("nodomx:nd-update-meta", (payload) => {
            hot.data ||= {};
            hot.data.__nodomxChangedBlockMap ||= {};
            const file = normalizePath(payload?.file || "");
            if (!file) {
                return;
            }
            hot.data.__nodomxChangedBlockMap[file] = {
                blocks: Array.isArray(payload?.blocks) ? payload.blocks.slice() : [],
                styleOnly: !!payload?.styleOnly
            };
        });
        hot.on("nodomx:nd-serve-status", (payload) => {
            hot.data ||= {};
            hot.data.__nodomxServeStatusMap ||= {};
            const file = normalizePath(payload?.file || "");
            if (!file) {
                return;
            }
            hot.data.__nodomxServeStatusMap[file] = {
                activeOutput: payload?.activeOutput || "latest",
                changedBlocks: Array.isArray(payload?.changedBlocks) ? payload.changedBlocks.slice() : [],
                file,
                hasLastSuccessfulSnapshot: !!payload?.hasLastSuccessfulSnapshot,
                lastSuccessfulAt: payload?.lastSuccessfulAt || null,
                preservedBlocks: Array.isArray(payload?.preservedBlocks) ? payload.preservedBlocks.slice() : [],
                recoveryHint: payload?.recoveryHint || "",
                state: payload?.state || "healthy"
            };
        });
    }

    const initialModule = await load();
    const initialApp = resolveModuleClass(initialModule);
    mountResolvedModule(initialApp, nodom, selector, [], null, null);

    if (hot?.accept) {
        const acceptUpdate = async (acceptedModule) => {
            try {
                const nextModule = resolveAcceptedModule(acceptedModule) || await load();
                const nextApp = resolveModuleClass(nextModule);
                const changedFiles = readChangedFiles(hot);
                const changedMeta = readChangedMeta(hot, changedFiles);
                const serveStatus = readRelevantServeStatus(hot, changedFiles);
                mountResolvedModule(nextApp, nodom, selector, changedFiles, changedMeta, serveStatus);
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

function mountResolvedModule(App, nodom, selector, changedFiles, changedMeta = null, serveStatus = null) {
    const hotUpdate = summarizeHotUpdate(changedFiles, changedMeta);
    nodom.__ndViteHotMeta = {
        changedBlocks: hotUpdate.changedBlocks,
        changedFiles: hotUpdate.changedFiles,
        ndFiles: hotUpdate.ndFiles,
        otherFiles: hotUpdate.otherFiles,
        serveStatus,
        strategy: hotUpdate.strategy,
        styleOnlyFiles: hotUpdate.styleOnlyFiles
    };
    if (hotUpdate.strategy === "style-only-skip-reload") {
        return;
    }
    const hotState = typeof nodom.captureHotState === "function"
        ? nodom.captureHotState()
        : undefined;
    const reloadTargets = hotUpdate.ndFiles.length > 0 ? hotUpdate.ndFiles : hotUpdate.changedFiles;
    if (typeof nodom.hotReload === "function") {
        nodom.hotReload(App, selector, hotState, reloadTargets);
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

function readChangedMeta(hot, changedFiles) {
    if (!hot?.data) {
        return {
            changedBlocks: {},
            styleOnlyFiles: []
        };
    }
    const metaMap = hot.data.__nodomxChangedBlockMap || {};
    const changedBlocks = {};
    const styleOnlyFiles = [];
    for (const file of Array.isArray(changedFiles) ? changedFiles : []) {
        const normalized = normalizePath(file);
        const meta = metaMap[normalized];
        if (!meta) {
            continue;
        }
        changedBlocks[normalized] = Array.isArray(meta.blocks) ? meta.blocks.slice() : [];
        if (meta.styleOnly) {
            styleOnlyFiles.push(normalized);
        }
        delete metaMap[normalized];
    }
    hot.data.__nodomxChangedBlockMap = metaMap;
    return {
        changedBlocks,
        styleOnlyFiles
    };
}

function readRelevantServeStatus(hot, changedFiles) {
    const statusMap = hot?.data?.__nodomxServeStatusMap || {};
    const normalizedFiles = Array.isArray(changedFiles)
        ? changedFiles.map(file => normalizePath(file).replace(/\?.*$/, "")).filter(Boolean)
        : [];
    for (let index = normalizedFiles.length - 1; index >= 0; index -= 1) {
        const file = normalizedFiles[index];
        if (statusMap[file]) {
            const matched = statusMap[file];
            delete statusMap[file];
            return {
                ...matched,
                changedBlocks: Array.isArray(matched.changedBlocks) ? matched.changedBlocks.slice() : [],
                preservedBlocks: Array.isArray(matched.preservedBlocks) ? matched.preservedBlocks.slice() : []
            };
        }
    }
    return null;
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

function summarizeHotUpdate(changedFiles, changedMeta) {
    const changedBlocks = changedMeta?.changedBlocks || {};
    const styleOnlyFiles = Array.isArray(changedMeta?.styleOnlyFiles)
        ? changedMeta.styleOnlyFiles.map(normalizePath)
        : [];
    const styleOnlySet = new Set(styleOnlyFiles);
    const normalizedChangedFiles = Array.isArray(changedFiles)
        ? changedFiles.map(normalizePath).filter(Boolean)
        : [];
    const ndFiles = [];
    const otherFiles = [];

    for (const file of normalizedChangedFiles) {
        const cleanFile = file.replace(/\?.*$/, "");
        if (/\.nd$/i.test(cleanFile)) {
            if (!ndFiles.includes(cleanFile)) {
                ndFiles.push(cleanFile);
            }
        } else if (!otherFiles.includes(file)) {
            otherFiles.push(file);
        }
    }

    const strategy = ndFiles.length > 0
        ? (otherFiles.length === 0 && ndFiles.every(file => styleOnlySet.has(file))
            ? "style-only-skip-reload"
            : "nd-block-hmr")
        : "full-reload";

    return {
        changedBlocks,
        changedFiles: normalizedChangedFiles,
        ndFiles,
        otherFiles,
        strategy,
        styleOnlyFiles
    };
}
