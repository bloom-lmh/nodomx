import fsp from "node:fs/promises";
import path from "node:path";
import { compileNdWithMap, describeNdError, inferImportSource, parseNd } from "@nodomx/nd-compiler";

export function nodomx(options = {}) {
    let resolvedConfig;
    let devServer = null;
    const lastSuccessfulSnapshots = new Map();
    const lastSuccessfulResults = new Map();
    const serveStatusByFile = new Map();

    return {
        name: "vite-plugin-nodomx",
        enforce: "pre",
        configResolved(config) {
            resolvedConfig = config;
        },
        configureServer(server) {
            devServer = server;
        },
        async resolveId(source, importer) {
            if (!isNdRequest(source)) {
                return null;
            }

            const query = getQuery(source);
            const request = cleanUrl(source);
            if (path.isAbsolute(request)) {
                return `${request}${query}`;
            }
            if (!importer) {
                return `${path.resolve(request)}${query}`;
            }
            return `${path.resolve(path.dirname(cleanUrl(importer)), request)}${query}`;
        },
        async load(id) {
            const file = cleanUrl(id);
            if (!isNdRequest(file)) {
                return null;
            }

            this.addWatchFile(file);

            const source = await fsp.readFile(file, "utf8");
            let descriptor;
            try {
                descriptor = parseNd(source, {
                    filename: file
                });
                validateNdScriptSyntax(this, descriptor, source, file);
                const result = compileNdWithMap(source, {
                    descriptor,
                    filename: file,
                    importSource: await resolveImportSource(file, options),
                    className: resolveOptionValue(options.className, file),
                    scopeId: resolveOptionValue(options.scopeId, file),
                    sourceMapFilename: file
                });
                const successfulAt = new Date().toISOString();
                lastSuccessfulSnapshots.set(file, createNdBlockSnapshot(source));
                lastSuccessfulResults.set(file, {
                    code: result.code,
                    map: result.map,
                    meta: {
                        successfulAt
                    }
                });
                const previousServeStatus = serveStatusByFile.get(file);
                const serveState = previousServeStatus && previousServeStatus.state !== "healthy"
                    ? "recovered"
                    : "healthy";
                const serveStatus = {
                    activeOutput: "latest",
                    changedBlocks: [],
                    file,
                    hasLastSuccessfulSnapshot: true,
                    lastSuccessfulAt: successfulAt,
                    preservedBlocks: [],
                    recoveryHint: serveState === "recovered"
                        ? "The .nd file compiled successfully again. Vite is now serving the latest module output."
                        : "The .nd file compiled successfully. Vite is serving the latest module output.",
                    state: serveState
                };
                serveStatusByFile.set(file, {
                    ...serveStatus
                });
                if (resolvedConfig?.command === "serve" && devServer?.ws?.send) {
                    emitNdServeStatus(devServer, file, serveStatus);
                }

                return {
                    code: result.code,
                    map: result.map
                };
            } catch (error) {
                const lastSuccessfulSnapshot = lastSuccessfulSnapshots.get(file) || null;
                const lastSuccessfulResult = lastSuccessfulResults.get(file) || null;
                const currentSnapshot = createNdBlockSnapshot(source);
                const changedBlocks = summarizeChangedBlocks(lastSuccessfulSnapshot, currentSnapshot);
                const preservedBlocks = summarizePreservedBlocks(lastSuccessfulSnapshot, changedBlocks);
                const diagnostic = describeNdError(error, source, {
                    filename: file
                });
                const recoveryHint = buildNdRecoveryHint(diagnostic.message, {
                    changedBlocks,
                    hasLastSuccessfulSnapshot: !!lastSuccessfulSnapshot
                });
                const serveStatus = {
                    activeOutput: lastSuccessfulSnapshot ? "preserved-last-good-output" : "none",
                    changedBlocks,
                    hasLastSuccessfulSnapshot: !!lastSuccessfulSnapshot,
                    lastSuccessfulAt: lastSuccessfulResult?.meta?.successfulAt || null,
                    preservedBlocks,
                    recoveryHint,
                    state: lastSuccessfulSnapshot ? "preserved-last-good-output" : "compile-error"
                };
                serveStatusByFile.set(file, {
                    ...serveStatus,
                    file
                });
                if (shouldPreserveLastSuccessfulServeResult(resolvedConfig, devServer, file, lastSuccessfulResults)) {
                    emitNdServeError(devServer, file, diagnostic, {
                        ...serveStatus,
                        hasLastSuccessfulSnapshot: true
                    });
                    emitNdServeStatus(devServer, file, {
                        ...serveStatus,
                        hasLastSuccessfulSnapshot: true
                    });
                    return {
                        code: lastSuccessfulResult.code,
                        map: lastSuccessfulResult.map
                    };
                }
                if (resolvedConfig?.command === "serve" && devServer?.ws?.send) {
                    emitNdServeStatus(devServer, file, serveStatus);
                }
                reportNdPluginError(this, diagnostic, file, {
                    ...serveStatus,
                    hasLastSuccessfulSnapshot: !!lastSuccessfulSnapshot
                });
            }
        },
        async handleHotUpdate(ctx) {
            if (!isNdRequest(ctx.file)) {
                return;
            }
            await emitNdHotUpdateMeta(ctx, lastSuccessfulSnapshots.get(ctx.file) || null);
            const modules = Array.from(ctx.server.moduleGraph.getModulesByFile(ctx.file) || []);
            for (const mod of modules) {
                ctx.server.moduleGraph.invalidateModule(mod);
            }
            return modules;
        }
    };
}

export default nodomx;

function isNdRequest(request) {
    return typeof request === "string" && cleanUrl(request).toLowerCase().endsWith(".nd");
}

function cleanUrl(id) {
    return typeof id === "string" ? id.replace(/[?#].*$/, "") : id;
}

function getQuery(id) {
    if (typeof id !== "string") {
        return "";
    }
    const index = id.search(/[?#]/);
    return index === -1 ? "" : id.slice(index);
}

function resolveOptionValue(option, file) {
    return typeof option === "function" ? option(file) : option;
}

async function resolveImportSource(file, options) {
    if (typeof options.importSource === "function") {
        return options.importSource(file);
    }
    if (typeof options.importSource === "string" && options.importSource.trim() !== "") {
        return options.importSource;
    }
    return inferImportSource(file);
}

function toHotId(file, rootDir) {
    const normalizedFile = normalizePath(file);
    if (!rootDir) {
        return normalizedFile;
    }

    const relativePath = normalizePath(path.relative(rootDir, file));
    if (!relativePath || relativePath.startsWith("..")) {
        return normalizedFile;
    }
    return `/${relativePath}`;
}

function normalizePath(file) {
    return String(file || "").replace(/\\/g, "/");
}

function validateNdScriptSyntax(pluginContext, descriptor, source, file) {
    const script = descriptor?.script;
    if (!script?.content) {
        return;
    }
    if (script.isTypeScript) {
        return;
    }

    try {
        pluginContext.parse(script.content, {
            sourceType: "module"
        });
    } catch (error) {
        const ndError = new Error(buildScriptSyntaxErrorMessage(error, script));
        const scriptLoc = resolveScriptSyntaxLocation(script, error, source);
        ndError.ndColumn = scriptLoc.column;
        ndError.ndFilename = file;
        ndError.ndFrame = scriptLoc.frame;
        ndError.ndLine = scriptLoc.line;
        ndError.ndOffset = scriptLoc.offset;
        throw ndError;
    }
}

function reportNdPluginError(pluginContext, diagnostic, file, context = {}) {
    pluginContext.error({
        frame: diagnostic.frame,
        id: file,
        loc: {
            column: Math.max(0, diagnostic.column - 1),
            file,
            line: diagnostic.line
        },
        message: buildNdOverlayMessage(diagnostic.message, {
            activeOutput: context.activeOutput,
            changedBlocks: context.changedBlocks,
            hasLastSuccessfulSnapshot: !!context.hasLastSuccessfulSnapshot,
            lastSuccessfulAt: context.lastSuccessfulAt,
            preservedBlocks: context.preservedBlocks,
            recoveryHint: context.recoveryHint,
            state: context.state
        })
    });
}

function emitNdServeError(server, file, diagnostic, context = {}) {
    if (!server?.ws?.send) {
        return;
    }
    server.ws.send({
        err: {
            frame: diagnostic.frame,
            id: file,
            loc: {
                column: Math.max(0, diagnostic.column - 1),
                file,
                line: diagnostic.line
            },
            message: buildNdOverlayMessage(diagnostic.message, {
                activeOutput: context.activeOutput,
                changedBlocks: context.changedBlocks,
                hasLastSuccessfulSnapshot: !!context.hasLastSuccessfulSnapshot,
                lastSuccessfulAt: context.lastSuccessfulAt,
                preservedBlocks: context.preservedBlocks,
                recoveryHint: context.recoveryHint,
                state: context.state
            }),
            plugin: "vite-plugin-nodomx"
        },
        type: "error"
    });
}

function emitNdServeStatus(server, file, context = {}) {
    if (!server?.ws?.send) {
        return;
    }
    server.ws.send({
        data: {
            changedBlocks: Array.isArray(context.changedBlocks) ? context.changedBlocks.slice() : [],
            file: normalizePath(file),
            activeOutput: context.activeOutput || "latest",
            hasLastSuccessfulSnapshot: !!context.hasLastSuccessfulSnapshot,
            lastSuccessfulAt: context.lastSuccessfulAt || null,
            preservedBlocks: Array.isArray(context.preservedBlocks) ? context.preservedBlocks.slice() : [],
            recoveryHint: context.recoveryHint || "",
            state: context.state || "healthy"
        },
        event: "nodomx:nd-serve-status",
        type: "custom"
    });
}

function shouldPreserveLastSuccessfulServeResult(resolvedConfig, server, file, lastSuccessfulResults) {
    return resolvedConfig?.command === "serve"
        && !!server?.ws?.send
        && lastSuccessfulResults.has(file);
}

function buildScriptSyntaxErrorMessage(error, script) {
    const prefix = script?.setup ? "Invalid <script setup> syntax" : "Invalid <script> syntax";
    const reason = String(error?.message || "Unexpected syntax error.")
        .replace(/\s*\(\d+:\d+\)\s*$/, "")
        .trim();
    return `${prefix}: ${reason}`;
}

function resolveScriptSyntaxLocation(script, error, source) {
    const relativeOffset = resolveScriptSyntaxOffset(error, script.content || "");
    const basePosition = offsetToPosition(source, script.contentStartOffset || 0);
    const relativePosition = offsetToPosition(script.content || "", relativeOffset);
    const line = basePosition.line + relativePosition.line - 1;
    const column = relativePosition.line === 1
        ? basePosition.column + relativePosition.column - 1
        : relativePosition.column;
    const offset = positionToOffset(source, line, column);
    return {
        column,
        frame: createCodeFrame(source, offset),
        line,
        offset
    };
}

function resolveScriptSyntaxOffset(error, source) {
    if (Number.isFinite(error?.pos)) {
        return Math.max(0, error.pos);
    }
    if (Number.isFinite(error?.raisedAt)) {
        return Math.max(0, error.raisedAt);
    }
    if (Number.isFinite(error?.loc?.line) && Number.isFinite(error?.loc?.column)) {
        return positionToOffset(source, error.loc.line, error.loc.column + 1);
    }
    return 0;
}

function offsetToPosition(source, offset) {
    const safeSource = String(source || "");
    const safeOffset = Math.max(0, Math.min(Number(offset) || 0, safeSource.length));
    let line = 1;
    let column = 1;
    for (let index = 0; index < safeOffset; index++) {
        if (safeSource[index] === "\n") {
            line += 1;
            column = 1;
        } else {
            column += 1;
        }
    }
    return {
        column,
        line
    };
}

function positionToOffset(source, line, column) {
    const safeSource = String(source || "");
    if (line <= 1) {
        return Math.max(0, column - 1);
    }
    let currentLine = 1;
    let index = 0;
    while (index < safeSource.length && currentLine < line) {
        if (safeSource[index] === "\n") {
            currentLine += 1;
        }
        index += 1;
    }
    return Math.max(0, Math.min(safeSource.length, index + Math.max(0, column - 1)));
}


function createCodeFrame(source, offset, context = 2) {
    const safeSource = String(source || "");
    const lines = safeSource.split(/\r?\n/);
    const position = offsetToPosition(safeSource, offset);
    const targetIndex = Math.max(0, position.line - 1);
    const start = Math.max(0, targetIndex - context);
    const end = Math.min(lines.length - 1, targetIndex + context);
    const frame = [];

    for (let index = start; index <= end; index++) {
        frame.push(`${String(index + 1).padStart(3, " ")} | ${lines[index] || ""}`);
        if (index === targetIndex) {
            frame.push(`    | ${" ".repeat(Math.max(0, position.column - 1))}^`);
        }
    }
    return frame.join("\n");
}

function buildNdOverlayMessage(message, context = {}) {
    const parts = [String(message || "").trim()];
    if (context.changedBlocks?.length) {
        parts.push(`Changed block(s): ${context.changedBlocks.join(", ")}`);
    }
    if (context.state) {
        parts.push(`Recovery state: ${formatNdRecoveryState(context.state)}`);
    }
    if (context.activeOutput) {
        parts.push(`Serving output: ${formatNdActiveOutput(context.activeOutput)}`);
    }
    if (context.preservedBlocks?.length) {
        parts.push(`Preserved block(s): ${context.preservedBlocks.join(", ")}`);
    }
    parts.push(`Last successful compile: ${context.hasLastSuccessfulSnapshot ? "available" : "none"}`);
    if (context.lastSuccessfulAt) {
        parts.push(`Last successful compile at: ${context.lastSuccessfulAt}`);
    }
    if (context.hasLastSuccessfulSnapshot) {
        parts.push("Vite will keep the last successful .nd module output until this file compiles again.");
    }
    if (context.recoveryHint) {
        parts.push(`Recovery: ${context.recoveryHint}`);
    }
    return parts.filter(Boolean).join("\n\n");
}

function formatNdRecoveryState(state) {
    if (state === "preserved-last-good-output") {
        return "serving preserved last successful output";
    }
    if (state === "recovered") {
        return "recovered and serving the latest .nd module";
    }
    if (state === "compile-error") {
        return "compile error";
    }
    return "healthy";
}

function formatNdActiveOutput(activeOutput) {
    if (activeOutput === "preserved-last-good-output") {
        return "preserved last successful output";
    }
    if (activeOutput === "none") {
        return "none";
    }
    return "latest module output";
}

function buildNdRecoveryHint(message, context = {}) {
    const text = String(message || "");
    if (/Unknown prop `/.test(text)) {
        return "Declare the prop on the child component, remove it from the parent template, or rename it to a declared prop, then save the file again.";
    }
    if (/Unknown named slot `/.test(text)) {
        return "Declare the named slot on the child component, rename the slot block in the parent template, or remove the stale slot usage, then save the file again.";
    }
    if (/Unknown emitted event handler `/.test(text)) {
        return "Declare the emitted event on the child component, rename the parent event handler binding, or remove the stale event listener, then save the file again.";
    }
    if (/Template type check failed/.test(text)) {
        return "Add the missing template binding or event handler, or remove the stale template usage, then save the file again.";
    }
    if (/Only one <template> block is allowed/.test(text)) {
        return "Keep a single <template> block and move extra markup into that block, then save the file again.";
    }
    if (/Only one <script> block is allowed/.test(text)) {
        return "Keep a single <script> or <script setup> block in the component, then save again so Vite can recover.";
    }
    if (/Missing <template> block/.test(text)) {
        return "Add a root <template>...</template> block so the .nd component has render output, then save the file again.";
    }
    if (/Invalid <script/.test(text)) {
        return "Fix the highlighted script syntax and save the file again. Vite will rebuild from the corrected .nd source.";
    }
    if (/export default/.test(text)) {
        return "Add `export default { ... }` to the <script> block, or switch to <script setup>, then save again.";
    }
    if (context.changedBlocks?.length) {
        return `Fix the ${context.changedBlocks.join(", ")} block and save again so Vite can rebuild the module.`;
    }
    return "Fix the highlighted .nd block and save the file again so Vite can rebuild the module.";
}

function createNdBlockSnapshot(source) {
    const snapshot = {
        script: null,
        scriptCount: 0,
        styles: [],
        styleCount: 0,
        template: null,
        templateCount: 0
    };
    const blockRe = /<(template|script|style)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
    for (const match of source.matchAll(blockRe)) {
        const tag = String(match[1] || "").toLowerCase();
        const content = String(match[3] || "").trim();
        if (tag === "template") {
            snapshot.templateCount += 1;
            if (snapshot.template === null) {
                snapshot.template = content;
            }
            continue;
        }
        if (tag === "script") {
            snapshot.scriptCount += 1;
            if (snapshot.script === null) {
                snapshot.script = content;
            }
            continue;
        }
        if (tag === "style") {
            snapshot.styleCount += 1;
            snapshot.styles.push(content);
        }
    }
    return snapshot;
}

function summarizeChangedBlocks(previousSnapshot, nextSnapshot) {
    const changes = [];
    if (!previousSnapshot) {
        if (nextSnapshot.templateCount > 0) {
            changes.push("template");
        }
        if (nextSnapshot.scriptCount > 0) {
            changes.push("script");
        }
        if (nextSnapshot.styleCount > 0) {
            changes.push("style");
        }
        return changes;
    }

    if (previousSnapshot.template !== nextSnapshot.template || previousSnapshot.templateCount !== nextSnapshot.templateCount) {
        changes.push("template");
    }
    if (previousSnapshot.script !== nextSnapshot.script || previousSnapshot.scriptCount !== nextSnapshot.scriptCount) {
        changes.push("script");
    }
    if (previousSnapshot.styleCount !== nextSnapshot.styleCount || previousSnapshot.styles.join("\n---\n") !== nextSnapshot.styles.join("\n---\n")) {
        changes.push("style");
    }
    return changes;
}

function summarizePreservedBlocks(previousSnapshot, changedBlocks) {
    if (!previousSnapshot) {
        return [];
    }
    const changed = new Set(Array.isArray(changedBlocks) ? changedBlocks : []);
    const preserved = [];
    if (previousSnapshot.templateCount > 0 && !changed.has("template")) {
        preserved.push("template");
    }
    if (previousSnapshot.scriptCount > 0 && !changed.has("script")) {
        preserved.push("script");
    }
    if (previousSnapshot.styleCount > 0 && !changed.has("style")) {
        preserved.push("style");
    }
    return preserved;
}

async function emitNdHotUpdateMeta(ctx, lastSuccessfulSnapshot) {
    const normalizedFile = normalizePath(ctx.file);
    const payload = {
        blocks: [],
        file: normalizedFile,
        styleOnly: false
    };

    try {
        const source = ctx.read ? await ctx.read() : null;
        const nextSnapshot = createNdBlockSnapshot(source || "");
        payload.blocks = summarizeChangedBlocks(lastSuccessfulSnapshot, nextSnapshot);
        payload.styleOnly = payload.blocks.length > 0 && payload.blocks.every(item => item === "style");
    } catch {
        payload.blocks = [];
        payload.styleOnly = false;
    }

    ctx.server.ws.send({
        type: "custom",
        event: "nodomx:nd-update-meta",
        data: payload
    });
}
