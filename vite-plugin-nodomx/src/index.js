import fsp from "node:fs/promises";
import path from "node:path";
import { compileNd, inferImportSource } from "@nodomx/nd-compiler";

export function nodomx(options = {}) {
    let resolvedConfig;

    return {
        name: "vite-plugin-nodomx",
        enforce: "pre",
        configResolved(config) {
            resolvedConfig = config;
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
            const code = compileNd(source, {
                filename: toHotId(file, resolvedConfig?.root),
                importSource: await resolveImportSource(file, options),
                className: resolveOptionValue(options.className, file),
                scopeId: resolveOptionValue(options.scopeId, file)
            });

            return {
                code,
                map: { mappings: "" }
            };
        },
        handleHotUpdate(ctx) {
            if (!isNdRequest(ctx.file)) {
                return;
            }
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
