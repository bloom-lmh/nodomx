import fsp from "node:fs/promises";
import path from "node:path";
import { compileNd, inferImportSource } from "@nodomx/nd-compiler";

export function nodomNd(options = {}) {
    return {
        name: "nodom-nd",
        async resolveId(source, importer) {
            if (!isNdRequest(source)) {
                return null;
            }
            if (path.isAbsolute(source)) {
                return source;
            }
            if (!importer) {
                return path.resolve(source);
            }
            return path.resolve(path.dirname(importer), source);
        },
        async load(id) {
            if (!isNdRequest(id)) {
                return null;
            }

            this.addWatchFile(id);

            const source = await fsp.readFile(id, "utf8");
            const importSource = options.importSource || await inferImportSource(id);
            const code = compileNd(source, {
                filename: id,
                importSource,
                className: typeof options.className === "function" ? options.className(id) : options.className,
                scopeId: typeof options.scopeId === "function" ? options.scopeId(id) : options.scopeId
            });

            return {
                code,
                map: { mappings: "" }
            };
        }
    };
}

export default nodomNd;

function isNdRequest(request) {
    return typeof request === "string" && request.toLowerCase().endsWith(".nd");
}
