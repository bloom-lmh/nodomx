import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const BLOCK_RE = /<(template|script|style)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
const BASE64_VLQ_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DEFAULT_DECLARATION_SUFFIX = ".d.nd.ts";
const DEFAULT_OUTPUT_SUFFIX = ".nd.gen.mjs";
const FALLTHROUGH_COMPONENT_ATTRIBUTES = new Set([
    "class",
    "id",
    "key",
    "ref",
    "style"
]);
const GLOBAL_TEMPLATE_IDENTIFIERS = new Set([
    "Array",
    "Boolean",
    "Date",
    "JSON",
    "Math",
    "Number",
    "Object",
    "Promise",
    "String",
    "clearTimeout",
    "console",
    "document",
    "false",
    "null",
    "setTimeout",
    "true",
    "undefined",
    "window"
]);
const DEFAULT_IGNORED_DIRS = new Set([
    ".git",
    ".vsix-stage",
    "dist",
    "node_modules"
]);
const ND_COMPONENT_SURFACE_CACHE = new Map();
const SAFE_DECLARATION_TYPE_REFERENCES = new Set([
    "Array",
    "Date",
    "Map",
    "Partial",
    "Pick",
    "Promise",
    "Readonly",
    "ReadonlyArray",
    "Record",
    "Required",
    "Set",
    "String",
    "Number",
    "Boolean",
    "NonNullable",
    "Omit",
    "Exclude",
    "Extract",
    "Uppercase",
    "Lowercase",
    "Capitalize",
    "Uncapitalize"
]);

export function parseNd(source, options = {}) {
    const descriptor = {
        filename: options.filename || "anonymous.nd",
        template: null,
        script: null,
        styles: []
    };

    for (const match of source.matchAll(BLOCK_RE)) {
        const tag = match[1];
        const attrs = match[2] || "";
        const rawContent = match[3] || "";
        const blockStartOffset = match.index || 0;
        const openTagEndOffset = blockStartOffset + (match[0] || "").indexOf(">") + 1;
        const closeTagStartOffset = blockStartOffset + (match[0] || "").lastIndexOf("</");
        const leadingTrimLength = rawContent.length - rawContent.trimStart().length;
        const trailingTrimLength = rawContent.length - rawContent.trimEnd().length;
        const content = rawContent.trim();
        const contentStartOffset = openTagEndOffset + leadingTrimLength;
        const contentEndOffset = Math.max(contentStartOffset, closeTagStartOffset - trailingTrimLength);
        if (tag === "template") {
            if (descriptor.template) {
                throw createNdError(
                    `Only one <template> block is allowed in ${descriptor.filename}.`,
                    {
                        filename: descriptor.filename,
                        offset: blockStartOffset,
                        source
                    }
                );
            }
            descriptor.template = {
                content,
                contentEndOffset,
                contentStartOffset,
                rawContent
            };
        } else if (tag === "script") {
            if (descriptor.script) {
                throw createNdError(
                    `Only one <script> block is allowed in ${descriptor.filename}.`,
                    {
                        filename: descriptor.filename,
                        offset: blockStartOffset,
                        source
                    }
                );
            }
            descriptor.script = {
                attrs,
                content,
                contentEndOffset,
                contentStartOffset,
                lang: extractBlockLanguage(attrs),
                isTypeScript: isTypeScriptLang(extractBlockLanguage(attrs)),
                rawContent,
                setup: /\bsetup\b/i.test(attrs)
            };
        } else if (tag === "style") {
            descriptor.styles.push({
                content,
                contentEndOffset,
                contentStartOffset,
                rawContent,
                scoped: /\bscoped\b/i.test(attrs)
            });
        }
    }

    if (!descriptor.template) {
        throw createNdError(`Missing <template> block in ${descriptor.filename}.`, {
            filename: descriptor.filename,
            offset: 0,
            source
        });
    }

    return descriptor;
}

export function compileNd(source, options = {}) {
    return compileNdWithMap(source, options).code;
}

export function compileNdWithMap(source, options = {}) {
    const descriptor = options.descriptor || parseNd(source, options);
    const filename = options.filename || descriptor.filename;
    const sourceMapFilename = options.sourceMapFilename || descriptor.filename || filename;
    const importSource = options.importSource || "nodomx";
    const className = options.className || createClassName(filename);
    const scopeId = options.scopeId || createScopeId(filename);
    const typeSurface = options.typeSurface || extractNdTypeSurface(source, {
        descriptor,
        filename
    });
    validateTypedScriptBlock(descriptor.script, source, filename);
    validateNdTemplateTypes(typeSurface, source, filename, options);
    const template = buildTemplate(descriptor, scopeId);
    const scriptCode = buildScript(descriptor.script, {
        filename,
        source
    });
    const code = [
        `import { Module, ModuleFactory as __nd_module_factory__ } from ${JSON.stringify(importSource)};`,
        "",
        scriptCode,
        "",
        `class ${className} extends Module {}`,
        `Object.assign(${className}.prototype, __nd_component__);`,
        `${className}.prototype.template = function template(props) {`,
        `    return ${JSON.stringify(template)};`,
        "};",
        `${className}.prototype.__ndFile = ${JSON.stringify(filename)};`,
        `__nd_module_factory__.addClass(${className});`,
        "",
        `export default ${className};`,
        `export { ${className} };`
    ].join("\n");
    const map = createNdSourceMap(code, descriptor, source, {
        filename,
        scriptCode,
        sourceMapFilename
    });

    return {
        code,
        map
    };
}

export async function compileFile(inputFile, options = {}) {
    const resolvedInput = path.resolve(inputFile);
    const source = await fsp.readFile(resolvedInput, "utf8");
    const outputFile = resolveOutFile(resolvedInput, options);
    const declarationFile = shouldEmitDeclaration(options)
        ? resolveDeclarationOutFile(resolvedInput, options)
        : null;
    const importSource = await resolveImportSource(resolvedInput, options);
    const descriptor = parseNd(source, {
        filename: resolvedInput
    });
    const typeSurface = extractNdTypeSurface(source, {
        descriptor,
        filename: resolvedInput
    });
    const { code, map } = compileNdWithMap(source, {
        descriptor,
        filename: resolvedInput,
        importSource,
        className: options.className,
        scopeId: options.scopeId,
        sourceMapFilename: resolvedInput,
        templateTypeCheck: options.templateTypeCheck,
        typeSurface
    });
    const declaration = declarationFile
        ? generateNdDeclaration(source, {
            descriptor,
            filename: resolvedInput,
            typeSurface
        })
        : "";

    if (!options.typesOnly) {
        await fsp.mkdir(path.dirname(outputFile), { recursive: true });
        await fsp.writeFile(outputFile, code, "utf8");
    }
    if (declarationFile) {
        await fsp.mkdir(path.dirname(declarationFile), { recursive: true });
        await fsp.writeFile(declarationFile, declaration, "utf8");
    }

    return {
        code,
        declaration,
        declarationFile,
        inputFile: resolvedInput,
        outputFile,
        importSource,
        map,
        typeSurface
    };
}

export async function compileFiles(inputFiles, options = {}) {
    const results = [];
    for (const inputFile of inputFiles) {
        results.push(await compileFile(inputFile, options));
    }
    return results;
}

export async function compilePath(inputPath, options = {}) {
    const resolvedPath = path.resolve(inputPath);
    const stat = await fsp.stat(resolvedPath);

    if (stat.isFile()) {
        if (!isNdFile(resolvedPath)) {
            throw new Error(`Expected a .nd file: ${resolvedPath}`);
        }
        return [await compileFile(resolvedPath, options)];
    }

    if (options.outFile) {
        throw new Error("The --out option is only available when compiling a single .nd file.");
    }

    const files = await collectNdFiles(resolvedPath, options);
    return compileFiles(files, options);
}

export async function typeCheckNdFile(inputFile, options = {}) {
    const resolvedInput = path.resolve(inputFile);
    const source = await fsp.readFile(resolvedInput, "utf8");
    const descriptor = parseNd(source, {
        filename: resolvedInput
    });
    const typeSurface = extractNdTypeSurface(source, {
        descriptor,
        filename: resolvedInput
    });
    compileNdWithMap(source, {
        descriptor,
        filename: resolvedInput,
        importSource: options.importSource || "nodomx",
        sourceMapFilename: resolvedInput,
        templateTypeCheck: options.templateTypeCheck,
        typeSurface
    });
    const declarationFile = shouldEmitDeclaration(options)
        ? resolveDeclarationOutFile(resolvedInput, options)
        : null;
    const declaration = declarationFile
        ? generateNdDeclaration(source, {
            descriptor,
            filename: resolvedInput,
            typeSurface
        })
        : "";
    if (declarationFile) {
        await fsp.mkdir(path.dirname(declarationFile), { recursive: true });
        await fsp.writeFile(declarationFile, declaration, "utf8");
    }
    return {
        declaration,
        declarationFile,
        inputFile: resolvedInput,
        typeSurface
    };
}

export async function typeCheckNdFiles(inputFiles, options = {}) {
    const results = [];
    for (const inputFile of inputFiles) {
        results.push(await typeCheckNdFile(inputFile, options));
    }
    return results;
}

export async function typeCheckNdPath(inputPath, options = {}) {
    const resolvedPath = path.resolve(inputPath);
    const stat = await fsp.stat(resolvedPath);

    if (stat.isFile()) {
        if (!isNdFile(resolvedPath)) {
            throw new Error(`Expected a .nd file: ${resolvedPath}`);
        }
        return [await typeCheckNdFile(resolvedPath, options)];
    }

    const files = await collectNdFiles(resolvedPath, options);
    return typeCheckNdFiles(files, options);
}

export async function runNdTypeCheck(inputPath, options = {}) {
    const resolvedPath = path.resolve(inputPath);
    const files = await collectNdFiles(resolvedPath, options);
    const results = [];
    const errors = [];

    for (const inputFile of files) {
        try {
            results.push(await typeCheckNdFile(inputFile, options));
        } catch (error) {
            let source = "";
            try {
                source = await fsp.readFile(inputFile, "utf8");
            } catch {
                source = "";
            }
            errors.push(describeNdError(error, source, {
                filename: inputFile
            }));
        }
    }

    return {
        errors,
        files,
        ok: errors.length === 0,
        results
    };
}

export async function collectNdFiles(inputPath, options = {}) {
    const resolvedPath = path.resolve(inputPath);
    const stat = await fsp.stat(resolvedPath);

    if (stat.isFile()) {
        return isNdFile(resolvedPath) ? [resolvedPath] : [];
    }

    const files = [];
    await walkDirectory(resolvedPath, async (entryPath) => {
        if (isNdFile(entryPath)) {
            files.push(entryPath);
        }
    }, options);
    files.sort();
    return files;
}

export async function watchNd(inputPath, options = {}) {
    const resolvedPath = path.resolve(inputPath);
    const stat = await fsp.stat(resolvedPath);
    const targetFile = stat.isFile() ? resolvedPath : null;
    const watchRoot = stat.isDirectory() ? resolvedPath : path.dirname(resolvedPath);
    const watchers = new Map();
    const timers = new Map();
    let closed = false;

    const api = {
        close() {
            closed = true;
            for (const timer of timers.values()) {
                clearTimeout(timer);
            }
            timers.clear();
            for (const watcher of watchers.values()) {
                watcher.close();
            }
            watchers.clear();
        },
        ready: null
    };

    api.ready = (async () => {
        await compilePath(resolvedPath, options);
        await registerDirectory(watchRoot);
        if (typeof options.onReady === "function") {
            options.onReady();
        }
    })();

    return api;

    async function registerDirectory(dir) {
        const normalizedDir = path.resolve(dir);
        if (closed || watchers.has(normalizedDir) || shouldIgnoreDirectory(path.basename(normalizedDir), options, normalizedDir !== watchRoot)) {
            return;
        }

        const watcher = fs.watch(normalizedDir, (eventType, filename) => {
            if (closed) {
                return;
            }
            const name = filename ? filename.toString() : "";
            const changedPath = name ? path.join(normalizedDir, name) : normalizedDir;
            scheduleHandle(changedPath, eventType);
        });

        watchers.set(normalizedDir, watcher);

        const entries = await safeReadDirectory(normalizedDir);
        for (const entry of entries) {
            if (entry.isDirectory()) {
                await registerDirectory(path.join(normalizedDir, entry.name));
            }
        }
    }

    function scheduleHandle(changedPath, eventType) {
        const normalizedPath = path.resolve(changedPath);
        if (timers.has(normalizedPath)) {
            clearTimeout(timers.get(normalizedPath));
        }

        const timer = setTimeout(async () => {
            timers.delete(normalizedPath);
            await handleFsEvent(normalizedPath, eventType);
        }, 40);

        timers.set(normalizedPath, timer);
    }

    async function handleFsEvent(changedPath, eventType) {
        if (targetFile && changedPath !== targetFile) {
            const maybeDir = await safeStat(changedPath);
            if (!maybeDir?.isDirectory()) {
                return;
            }
        }

        const statInfo = await safeStat(changedPath);
        if (statInfo?.isDirectory()) {
            await registerDirectory(changedPath);
            return;
        }

        if (targetFile && changedPath !== targetFile) {
            return;
        }

        if (!isNdFile(changedPath)) {
            return;
        }

        if (!statInfo) {
            await removeCompiledOutput(changedPath, options);
            if (typeof options.onRemoved === "function") {
                options.onRemoved(changedPath, eventType);
            }
            return;
        }

        try {
            const result = await compileFile(changedPath, options);
            if (typeof options.onCompiled === "function") {
                options.onCompiled(result, eventType);
            }
        } catch (error) {
            if (typeof options.onError === "function") {
                options.onError(error, changedPath, eventType);
            } else {
                console.error(error);
            }
        }
    }
}

export async function watchNdTypes(inputPath, options = {}) {
    const resolvedPath = path.resolve(inputPath);
    const stat = await fsp.stat(resolvedPath);
    const targetFile = stat.isFile() ? resolvedPath : null;
    const watchRoot = stat.isDirectory() ? resolvedPath : path.dirname(resolvedPath);
    const watchers = new Map();
    const timers = new Map();
    let closed = false;

    const api = {
        close() {
            closed = true;
            for (const timer of timers.values()) {
                clearTimeout(timer);
            }
            timers.clear();
            for (const watcher of watchers.values()) {
                watcher.close();
            }
            watchers.clear();
        },
        ready: null
    };

    api.ready = (async () => {
        const initial = await runNdTypeCheck(resolvedPath, options);
        if (initial.errors.length > 0) {
            for (const error of initial.errors) {
                if (typeof options.onError === "function") {
                    options.onError(error, error.filename, "initial");
                }
            }
        }
        await registerDirectory(watchRoot);
        if (typeof options.onReady === "function") {
            options.onReady(initial);
        }
    })();

    return api;

    async function registerDirectory(dir) {
        const normalizedDir = path.resolve(dir);
        if (closed || watchers.has(normalizedDir) || shouldIgnoreDirectory(path.basename(normalizedDir), options, normalizedDir !== watchRoot)) {
            return;
        }

        const watcher = fs.watch(normalizedDir, (eventType, filename) => {
            if (closed) {
                return;
            }
            const name = filename ? filename.toString() : "";
            const changedPath = name ? path.join(normalizedDir, name) : normalizedDir;
            scheduleHandle(changedPath, eventType);
        });

        watchers.set(normalizedDir, watcher);

        const entries = await safeReadDirectory(normalizedDir);
        for (const entry of entries) {
            if (entry.isDirectory()) {
                await registerDirectory(path.join(normalizedDir, entry.name));
            }
        }
    }

    function scheduleHandle(changedPath, eventType) {
        const normalizedPath = path.resolve(changedPath);
        if (timers.has(normalizedPath)) {
            clearTimeout(timers.get(normalizedPath));
        }

        const timer = setTimeout(async () => {
            timers.delete(normalizedPath);
            await handleFsEvent(normalizedPath, eventType);
        }, 40);

        timers.set(normalizedPath, timer);
    }

    async function handleFsEvent(changedPath, eventType) {
        if (targetFile && changedPath !== targetFile) {
            const maybeDir = await safeStat(changedPath);
            if (!maybeDir?.isDirectory()) {
                return;
            }
        }

        const statInfo = await safeStat(changedPath);
        if (statInfo?.isDirectory()) {
            await registerDirectory(changedPath);
            return;
        }

        if (targetFile && changedPath !== targetFile) {
            return;
        }

        if (!isNdFile(changedPath)) {
            return;
        }

        if (!statInfo) {
            await removeGeneratedTypeOutput(changedPath, options);
            if (typeof options.onRemoved === "function") {
                options.onRemoved(changedPath, eventType);
            }
            return;
        }

        try {
            const result = await typeCheckNdFile(changedPath, options);
            if (typeof options.onChecked === "function") {
                options.onChecked(result, eventType);
            }
        } catch (error) {
            if (typeof options.onError === "function") {
                options.onError(error, changedPath, eventType);
            } else {
                console.error(error);
            }
        }
    }
}

export function defaultOutFile(inputFile, outputSuffix = DEFAULT_OUTPUT_SUFFIX) {
    const ext = path.extname(inputFile);
    const base = inputFile.slice(0, -ext.length);
    return `${base}${outputSuffix}`;
}

export function defaultDeclarationOutFile(inputFile, declarationSuffix = DEFAULT_DECLARATION_SUFFIX) {
    const ext = path.extname(inputFile);
    const base = inputFile.slice(0, -ext.length);
    return `${base}${declarationSuffix}`;
}

export async function inferImportSource(inputFile) {
    let current = path.dirname(path.resolve(inputFile));
    while (true) {
        const pkgFile = path.join(current, "package.json");
        try {
            const pkg = JSON.parse(await fsp.readFile(pkgFile, "utf8"));
            if (pkg.name === "nodomx") {
                return pkg.name;
            }
            const dependencySets = [
                pkg.dependencies,
                pkg.devDependencies,
                pkg.peerDependencies,
                pkg.optionalDependencies
            ];
            for (const dependencySet of dependencySets) {
                if (dependencySet?.nodomx) {
                    return "nodomx";
                }
            }
        } catch {
            // ignore and continue
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return "nodomx";
        }
        current = parent;
    }
}

export function describeNdError(error, source, options = {}) {
    const filename = options.filename || error?.ndFilename || "anonymous.nd";
    const loc = normalizeNdErrorLocation(error, source);
    return {
        column: loc.column,
        filename,
        frame: loc.frame,
        line: loc.line,
        message: error?.message || "Unknown .nd compilation error.",
        offset: loc.offset
    };
}

export function extractNdTypeSurface(source, options = {}) {
    const descriptor = options.descriptor || parseNd(source, options);
    const filename = options.filename || descriptor.filename || "anonymous.nd";
    const surface = createEmptyNdTypeSurface(filename);
    if (descriptor.script?.content) {
        collectScriptTypeSurface(descriptor.script, surface, filename);
        if (options.componentContractCheck !== false) {
            surface.componentContracts = resolveImportedNdComponentContracts(descriptor.script, filename, options);
        }
    }
    if (descriptor.template?.content) {
        collectTemplateSlotTypeSurface(descriptor.template, surface);
        surface.templateDiagnostics = collectTemplateTypeDiagnostics(descriptor.template, surface, {
            componentContractCheck: options.componentContractCheck !== false
        });
    }
    return surface;
}

export function checkNdTemplateTypes(source, options = {}) {
    const descriptor = options.descriptor || parseNd(source, options);
    const typeSurface = options.typeSurface || extractNdTypeSurface(source, {
        descriptor,
        filename: options.filename || descriptor.filename
    });
    return Array.isArray(typeSurface.templateDiagnostics)
        ? [...typeSurface.templateDiagnostics]
        : [];
}

export function generateNdDeclaration(source, options = {}) {
    const descriptor = options.descriptor || parseNd(source, options);
    const typeSurface = options.typeSurface || extractNdTypeSurface(source, {
        descriptor,
        filename: options.filename || descriptor.filename
    });
    const props = typeSurface.props || [];
    const emits = typeSurface.emits || [];
    const slots = typeSurface.slots || [];
    const lines = [
        "import type { UnknownClass } from \"nodomx\";",
        "",
        "export interface __NdProps {"
    ];

    if (props.length === 0) {
        lines.push("  [key: string]: unknown;");
    } else {
        for (const entry of props) {
            lines.push(`  ${formatDeclarationPropertyName(entry.name)}${entry.optional === false ? "" : "?"}: ${entry.typeText || "unknown"};`);
        }
    }

    lines.push(
        "}",
        "",
        "export interface __NdEmits {"
    );
    if (emits.length === 0) {
        lines.push("  [event: string]: (...args: unknown[]) => unknown;");
    } else {
        for (const entry of emits) {
            lines.push(`  ${formatDeclarationPropertyName(entry.name)}?: ${entry.typeText || "((...args: unknown[]) => unknown)"};`);
        }
    }

    lines.push(
        "}",
        "",
        "export interface __NdSlots {"
    );
    if (slots.length === 0) {
        lines.push("  default?: unknown;");
    } else {
        for (const entry of slots) {
            lines.push(`  ${formatDeclarationPropertyName(entry.name)}?: ${entry.typeText || "unknown"};`);
        }
    }

    lines.push(
        "}",
        "",
        "declare const component: UnknownClass;",
        "export default component;",
        "export type __NdComponent = typeof component;"
    );

    return `${lines.join("\n")}\n`;
}

function validateNdTemplateTypes(typeSurface, source, filename, options = {}) {
    if (options.templateTypeCheck === false) {
        return;
    }
    const diagnostics = Array.isArray(typeSurface?.templateDiagnostics)
        ? typeSurface.templateDiagnostics
        : [];
    if (diagnostics.length === 0) {
        return;
    }
    const preview = diagnostics
        .slice(0, 3)
        .map(item => `- ${item.message}`)
        .join("\n");
    const extra = diagnostics.length > 3
        ? `\n- ...and ${diagnostics.length - 3} more template issue(s).`
        : "";
    throw createNdError(
        `Template type check failed in ${path.basename(filename)}.\n${preview}${extra}`,
        {
            filename,
            offset: diagnostics[0].offset,
            source
        }
    );
}

function createEmptyNdTypeSurface(filename) {
    return {
        bindings: [],
        bindingHints: new Map(),
        componentContracts: new Map(),
        emits: [],
        filename,
        props: [],
        slots: [],
        templateDiagnostics: []
    };
}

function collectScriptTypeSurface(scriptBlock, surface, filename) {
    if (!scriptBlock?.content) {
        return;
    }
    if (scriptBlock.setup) {
        const { body } = extractImportStatements(scriptBlock.content);
        const { optionExpressions, statements } = extractDefineOptions(body);
        const hoistedBindings = collectOptionHoistedBindings(statements, optionExpressions);
        const hoistedBindingNames = new Set(hoistedBindings.map(item => item.name));
        const setupStatements = statements.filter(item => !item.isOption && !hoistedBindingNames.has(item.name));
        for (const binding of extractTopLevelBindings(setupStatements.map(item => item.statement))) {
            pushUniqueNdSurfaceEntry(surface.bindings, binding, "setup");
        }
    }

    const sourceFile = createScriptSurfaceSourceFile(scriptBlock, filename);
    const localTypes = collectLocalTypeDeclarations(sourceFile);
    collectScriptBindingHints(sourceFile, localTypes, surface);
    if (scriptBlock.setup) {
        collectScriptSetupTypeSurfaceFromAst(sourceFile, localTypes, surface);
    } else {
        collectOptionsScriptTypeSurfaceFromAst(sourceFile, localTypes, surface);
    }
}

function collectTemplateSlotTypeSurface(templateBlock, surface) {
    const slotRe = /<slot\b([^<>]*?)\/?>/gi;
    for (const match of templateBlock.content.matchAll(slotRe)) {
        const attrsSource = match[1] || "";
        const nameMatch = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(attrsSource);
        const slotName = (nameMatch?.[1] || nameMatch?.[2] || nameMatch?.[3] || "default").trim() || "default";
        pushUniqueNdSurfaceEntry(surface.slots, slotName, "template");
    }
}

function collectScriptSetupTypeSurfaceFromAst(sourceFile, localTypes, surface) {
    visitSurfaceNodes(sourceFile, (node) => {
        if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) {
            return;
        }
        const callName = node.expression.text;
        if (callName === "defineProps") {
            collectContractNamesFromCall(node, "props", localTypes, surface.props, "defineProps", sourceFile);
        } else if (callName === "defineEmits") {
            collectContractNamesFromCall(node, "emits", localTypes, surface.emits, "defineEmits", sourceFile);
        } else if (callName === "defineSlots") {
            collectContractNamesFromCall(node, "slots", localTypes, surface.slots, "defineSlots", sourceFile);
        } else if (callName === "defineModel") {
            const modelName = resolveDefineModelName(node) || "modelValue";
            const modelType = node.typeArguments?.[0]
                ? getTypeTextForDeclaration(node.typeArguments[0], localTypes, sourceFile)
                : "unknown";
            pushUniqueNdSurfaceEntry(surface.props, modelName, "defineModel", {
                typeText: modelType
            });
            pushUniqueNdSurfaceEntry(surface.emits, `update:${modelName}`, "defineModel", {
                typeText: `(value: ${modelType}) => unknown`
            });
        }
    });
}

function collectOptionsScriptTypeSurfaceFromAst(sourceFile, localTypes, surface) {
    const exportedComponent = getDefaultExportObjectLiteral(sourceFile);
    if (!exportedComponent) {
        return;
    }

    for (const property of exportedComponent.properties) {
        const propertyName = getObjectMemberName(property);
        if (!propertyName) {
            continue;
        }
        if (propertyName === "props") {
            const initializer = getObjectMemberInitializer(property);
            collectContractNamesFromValue(initializer, "props", localTypes, surface.props, "options.props", sourceFile);
            continue;
        }
        if (propertyName === "emits") {
            const initializer = getObjectMemberInitializer(property);
            collectContractNamesFromValue(initializer, "emits", localTypes, surface.emits, "options.emits", sourceFile);
            continue;
        }
        if (propertyName === "setup") {
            collectSetupReturnBindings(property, surface.bindings);
        }
    }
}

function collectContractNamesFromCall(callExpression, kind, localTypes, target, source, sourceFile) {
    if (callExpression.arguments?.length > 0) {
        collectContractNamesFromValue(callExpression.arguments[0], kind, localTypes, target, source, sourceFile);
    }
    if (callExpression.typeArguments?.length > 0) {
        collectContractNamesFromTypeNode(callExpression.typeArguments[0], kind, localTypes, target, source, sourceFile);
    }
}

function collectContractNamesFromValue(valueNode, kind, localTypes, target, source, sourceFile) {
    if (!valueNode) {
        return;
    }
    if (ts.isParenthesizedExpression(valueNode) || ts.isAsExpression(valueNode) || ts.isSatisfiesExpression?.(valueNode)) {
        collectContractNamesFromValue(valueNode.expression, kind, localTypes, target, source, sourceFile);
        return;
    }
    if (ts.isStringLiteralLike(valueNode)) {
        pushUniqueNdSurfaceEntry(target, valueNode.text.trim(), source);
        return;
    }
    if (ts.isIdentifier(valueNode)) {
        const resolvedType = resolveLocalTypeNode(localTypes, valueNode.text);
        if (resolvedType) {
            collectContractNamesFromTypeNode(resolvedType, kind, localTypes, target, source, sourceFile);
        }
        return;
    }
    if (ts.isArrayLiteralExpression(valueNode)) {
        for (const element of valueNode.elements) {
            collectContractNamesFromValue(element, kind, localTypes, target, source, sourceFile);
        }
        return;
    }
    if (ts.isObjectLiteralExpression(valueNode)) {
        for (const property of valueNode.properties) {
            const name = getObjectMemberName(property);
            if (name) {
                pushUniqueNdSurfaceEntry(target, normalizeContractName(kind, name), source, inferRuntimeContractMetadata(property, kind, localTypes, sourceFile));
            }
        }
        return;
    }
}

function collectContractNamesFromTypeNode(typeNode, kind, localTypes, target, source, sourceFile) {
    const resolvedType = resolveTypeNode(typeNode, localTypes);
    if (!resolvedType) {
        return;
    }
    if (ts.isUnionTypeNode(resolvedType) || ts.isIntersectionTypeNode(resolvedType)) {
        for (const node of resolvedType.types) {
            collectContractNamesFromTypeNode(node, kind, localTypes, target, source, sourceFile);
        }
        return;
    }
    if (ts.isLiteralTypeNode(resolvedType) && ts.isStringLiteralLike(resolvedType.literal)) {
        pushUniqueNdSurfaceEntry(target, resolvedType.literal.text.trim(), source);
        return;
    }
    if (ts.isTypeLiteralNode(resolvedType) || ts.isInterfaceDeclaration(resolvedType)) {
        const members = ts.isTypeLiteralNode(resolvedType)
            ? resolvedType.members
            : resolvedType.members;
        for (const member of members) {
            const memberName = getTypeElementName(member);
            if (memberName) {
                pushUniqueNdSurfaceEntry(
                    target,
                    normalizeContractName(kind, memberName),
                    source,
                    inferTypeElementContractMetadata(member, kind, localTypes, sourceFile)
                );
            }
            if (kind === "emits" && ts.isCallSignatureDeclaration(member)) {
                collectEmitNamesFromCallSignature(member, localTypes, target, source, sourceFile);
            }
        }
    }
}

function collectEmitNamesFromCallSignature(node, localTypes, target, source, sourceFile) {
    const firstParameter = node.parameters?.[0];
    if (!firstParameter?.type) {
        return;
    }
    const signatureText = buildEmitSignatureTypeText(node, localTypes, sourceFile);
    collectEventNamesFromTypeNode(firstParameter.type, localTypes, target, source, sourceFile, {
        typeText: signatureText
    });
}

function collectEventNamesFromTypeNode(typeNode, localTypes, target, source, sourceFile, metadata = {}) {
    const resolvedType = resolveTypeNode(typeNode, localTypes);
    if (!resolvedType) {
        return;
    }
    if (ts.isUnionTypeNode(resolvedType) || ts.isIntersectionTypeNode(resolvedType)) {
        for (const child of resolvedType.types) {
            collectEventNamesFromTypeNode(child, localTypes, target, source, sourceFile, metadata);
        }
        return;
    }
    if (ts.isLiteralTypeNode(resolvedType) && ts.isStringLiteralLike(resolvedType.literal)) {
        pushUniqueNdSurfaceEntry(target, resolvedType.literal.text.trim(), source, metadata);
    }
}

function collectSetupReturnBindings(member, bindingsTarget) {
    const body = getFunctionLikeBody(member);
    if (!body) {
        return;
    }
    visitFunctionReturns(body, (expression) => {
        if (!ts.isObjectLiteralExpression(expression)) {
            return;
        }
        for (const property of expression.properties) {
            const name = getObjectMemberName(property);
            if (name) {
                pushUniqueNdSurfaceEntry(bindingsTarget, name, "setup-return");
            }
        }
    });
}

function collectTemplateTypeDiagnostics(templateBlock, surface, options = {}) {
    if (!templateBlock?.content) {
        return [];
    }
    const templateNodes = parseTemplateNodes(templateBlock);
    const expressions = [
        ...collectScopedSelectorExpressions(templateNodes),
        ...collectTemplateMustacheExpressions(templateBlock, templateNodes),
        ...collectTemplateEventExpressions(templateNodes)
    ];
    const globalAllowed = new Set([
        "$event",
        ...surface.bindings.map(item => item.name),
        ...GLOBAL_TEMPLATE_IDENTIFIERS
    ]);
    const diagnostics = [];
    const seen = new Set();

    for (const expression of expressions) {
        const allowed = new Set([
            ...globalAllowed,
            ...collectScopedTemplateIdentifiers(expression.offset, templateNodes, surface)
        ]);
        for (const identifier of collectExpressionFreeIdentifiers(expression.expression)) {
            if (allowed.has(identifier)) {
                continue;
            }
            const key = `${identifier}:${expression.offset}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            diagnostics.push({
                expression: expression.expression,
                identifier,
                message: `Unknown template identifier \`${identifier}\` in ${expression.kind}.`,
                offset: expression.offset
            });
        }
    }

    diagnostics.sort((left, right) => left.offset - right.offset);
    if (options.componentContractCheck !== false && surface.componentContracts?.size > 0) {
        diagnostics.push(...collectComponentContractTemplateDiagnostics(templateNodes, surface.componentContracts));
        diagnostics.sort((left, right) => left.offset - right.offset);
    }
    return diagnostics;
}

function parseTemplateNodes(templateBlock) {
    const source = templateBlock.content;
    const nodes = [];
    const stack = [];
    const tagRe = /<\/?([A-Za-z][\w:-]*)(\s[\s\S]*?)?(\/?)>/g;

    for (const match of source.matchAll(tagRe)) {
        const fullMatch = match[0];
        const start = templateBlock.contentStartOffset + (match.index || 0);
        const isClosing = fullMatch.startsWith("</");
        const name = match[1];
        const lowerName = name.toLowerCase();
        if (isClosing) {
            const stackIndex = findMatchingTemplateNode(stack, lowerName);
            if (stackIndex !== -1) {
                const node = stack[stackIndex];
                node.closeStart = start;
                node.closeEnd = start + fullMatch.length;
                stack.splice(stackIndex);
            }
            continue;
        }

        const attrsSource = match[2] || "";
        const attrsStart = start + fullMatch.indexOf(attrsSource);
        const node = {
            attrs: extractNdTemplateAttributes(attrsSource, attrsStart),
            closeEnd: null,
            closeStart: null,
            lowerName,
            name,
            openEnd: start + fullMatch.length,
            openStart: start,
            parent: stack.length > 0 ? stack[stack.length - 1] : null
        };
        nodes.push(node);
        if (match[3] !== "/" && !isVoidTemplateTag(lowerName)) {
            stack.push(node);
        }
    }

    return nodes;
}

function extractNdTemplateAttributes(source, baseOffset) {
    const attrs = [];
    const attrRe = /([:@$A-Za-z_][\w:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|{{([\s\S]*?)}}|([^\s"'=<>`]+)))?/g;
    for (const match of source.matchAll(attrRe)) {
        const name = match[1];
        const fullStart = baseOffset + (match.index || 0);
        const value = match[2] ?? match[3] ?? match[4] ?? match[5] ?? "";
        const rawValue = extractNdTemplateAttributeRawValue(match[0]);
        const valueStartOffset = rawValue ? fullStart + match[0].lastIndexOf(rawValue) : null;
        const valueKind = !rawValue
            ? "boolean"
            : rawValue.startsWith("{{") && rawValue.endsWith("}}")
                ? "mustache"
                : rawValue.startsWith("\"") || rawValue.startsWith("'")
                    ? "string"
                    : "expression";
        attrs.push({
            name,
            rawValue,
            startOffset: fullStart,
            value,
            valueKind,
            valueStartOffset: valueStartOffset == null
                ? null
                : valueKind === "mustache"
                    ? valueStartOffset + 2
                    : valueKind === "string"
                        ? valueStartOffset + 1
                        : valueStartOffset
        });
    }
    return attrs;
}

function collectScopedTemplateSkipRanges(nodes) {
    return nodes
        .filter(node => isSkippedScopedTemplateNode(node))
        .map(node => ({
            end: node.closeEnd || node.openEnd,
            start: node.openStart
        }));
}

function collectScopedSelectorExpressions(nodes) {
    const expressions = [];
    for (const node of nodes) {
        for (const attr of node.attrs) {
            const normalizedName = attr.name.toLowerCase();
            if (normalizedName === "x-repeat" || (node.lowerName === "for" && normalizedName === "cond")) {
                if (attr.valueStartOffset != null && attr.value) {
                    expressions.push({
                        expression: attr.value.trim(),
                        kind: normalizedName,
                        offset: attr.valueStartOffset
                    });
                }
            }
        }
    }
    return expressions;
}

function collectTemplateMustacheExpressions(templateBlock, nodes) {
    const expressions = [];
    const skipRanges = collectScopedTemplateSkipRanges(nodes);
    const moustacheRe = /{{([\s\S]*?)}}/g;
    for (const match of templateBlock.content.matchAll(moustacheRe)) {
        const expression = (match[1] || "").trim();
        const offset = templateBlock.contentStartOffset + (match.index || 0) + 2;
        if (!expression || isOffsetWithinRanges(offset, skipRanges)) {
            continue;
        }
        expressions.push({
            expression,
            kind: "interpolation",
            offset
        });
    }
    return expressions;
}

function collectTemplateEventExpressions(nodes) {
    const expressions = [];
    const skipRanges = collectScopedTemplateSkipRanges(nodes);
    for (const node of nodes) {
        for (const attr of node.attrs) {
            if (!attr.name.toLowerCase().startsWith("e-") || attr.valueStartOffset == null) {
                continue;
            }
            if (isOffsetWithinRanges(attr.valueStartOffset, skipRanges)) {
                continue;
            }
            const expression = normalizeTemplateEventExpression(attr.value);
            if (!expression) {
                continue;
            }
            expressions.push({
                expression,
                kind: attr.name,
                offset: attr.valueStartOffset
            });
        }
    }
    return expressions;
}

function collectScopedTemplateIdentifiers(offset, nodes, surface) {
    const identifiers = new Set();
    const ancestors = nodes
        .filter(node => isOffsetWithinNode(offset, node))
        .sort((left, right) => left.openStart - right.openStart);
    for (const node of ancestors) {
        for (const attr of node.attrs || []) {
            const normalizedName = attr.name.toLowerCase();
            if (!attr.value) {
                continue;
            }
            if (normalizedName === "x-model") {
                const hint = resolveBindingHintFromExpression(attr.value, surface?.bindingHints);
                collectObjectHintIdentifiers(hint, identifiers);
                continue;
            }
            if (normalizedName === "x-repeat" || (node.lowerName === "for" && normalizedName === "cond")) {
                const hint = resolveBindingHintFromExpression(attr.value, surface?.bindingHints);
                collectRepeatHintIdentifiers(hint, identifiers);
            }
        }
    }
    return identifiers;
}

function collectExpressionFreeIdentifiers(expression) {
    if (!expression) {
        return [];
    }
    const wrapped = `(${expression});`;
    const sourceFile = ts.createSourceFile("template-expression.ts", wrapped, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const identifiers = new Set();
    const scopeStack = [new Set()];

    visit(sourceFile);
    return Array.from(identifiers);

    function visit(node) {
        if (!node) {
            return;
        }
        if (ts.isFunctionLike(node) && node !== sourceFile) {
            const localScope = new Set();
            if (node.name && ts.isIdentifier(node.name)) {
                localScope.add(node.name.text);
            }
            for (const parameter of node.parameters) {
                collectBindingPatternNames(parameter.name, localScope);
                if (parameter.initializer) {
                    visit(parameter.initializer);
                }
            }
            scopeStack.push(localScope);
            if (node.body) {
                visit(node.body);
            }
            scopeStack.pop();
            return;
        }
        if (ts.isVariableDeclaration(node)) {
            collectBindingPatternNames(node.name, scopeStack[scopeStack.length - 1]);
            if (node.initializer) {
                visit(node.initializer);
            }
            return;
        }
        if (ts.isCatchClause(node)) {
            const localScope = new Set();
            if (node.variableDeclaration) {
                collectBindingPatternNames(node.variableDeclaration.name, localScope);
            }
            scopeStack.push(localScope);
            visit(node.block);
            scopeStack.pop();
            return;
        }
        if (ts.isPropertyAccessExpression(node)) {
            visit(node.expression);
            return;
        }
        if (ts.isPropertyAssignment(node)) {
            if (ts.isComputedPropertyName(node.name)) {
                visit(node.name.expression);
            }
            visit(node.initializer);
            return;
        }
        if (ts.isShorthandPropertyAssignment(node)) {
            if (!isDeclaredIdentifier(node.name.text)) {
                identifiers.add(node.name.text);
            }
            return;
        }
        if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
            const localScope = new Set();
            for (const parameter of node.parameters) {
                collectBindingPatternNames(parameter.name, localScope);
            }
            scopeStack.push(localScope);
            if (node.body) {
                visit(node.body);
            }
            scopeStack.pop();
            return;
        }
        if (ts.isIdentifier(node)) {
            if (!isExpressionReferenceIdentifier(node)) {
                return;
            }
            if (!isDeclaredIdentifier(node.text)) {
                identifiers.add(node.text);
            }
            return;
        }
        ts.forEachChild(node, visit);
    }

    function isDeclaredIdentifier(name) {
        for (let index = scopeStack.length - 1; index >= 0; index -= 1) {
            if (scopeStack[index].has(name)) {
                return true;
            }
        }
        return false;
    }
}

function buildScript(scriptBlock, context = {}) {
    if (!scriptBlock?.content) {
        return "const __nd_component__ = {};";
    }
    let scriptCode;
    if (scriptBlock.setup) {
        scriptCode = buildScriptSetup(scriptBlock.content);
    } else {
        if (!/\bexport\s+default\b/.test(scriptBlock.content)) {
            throw new Error("The <script> block must contain `export default { ... }`.");
        }
        scriptCode = scriptBlock.content.replace(/\bexport\s+default\b/, "const __nd_component__ =");
    }
    if (scriptBlock.isTypeScript) {
        return transpileTypeScriptScript(scriptCode, scriptBlock, context);
    }
    return scriptCode;
}

function createNdSourceMap(code, descriptor, source, options = {}) {
    const lineMappings = [];
    const scriptMappings = createScriptSourceLineMappings(descriptor.script, options.scriptCode || "");
    const templatePosition = descriptor.template
        ? offsetToPosition(source, descriptor.template.contentStartOffset)
        : null;
    const scriptPosition = descriptor.script
        ? offsetToPosition(source, descriptor.script.contentStartOffset)
        : templatePosition;
    const componentPosition = scriptPosition || templatePosition || { line: 1, column: 1 };

    lineMappings.push(toSourceMapLocation(scriptPosition || templatePosition || componentPosition));
    lineMappings.push(null);
    lineMappings.push(...scriptMappings);
    lineMappings.push(null);
    lineMappings.push(toSourceMapLocation(componentPosition));
    lineMappings.push(toSourceMapLocation(componentPosition));
    lineMappings.push(toSourceMapLocation(templatePosition || componentPosition));
    lineMappings.push(toSourceMapLocation(templatePosition || componentPosition));
    lineMappings.push(toSourceMapLocation(componentPosition));
    lineMappings.push(toSourceMapLocation(componentPosition));
    lineMappings.push(toSourceMapLocation(componentPosition));
    lineMappings.push(null);
    lineMappings.push(toSourceMapLocation(componentPosition));
    lineMappings.push(toSourceMapLocation(componentPosition));

    return {
        version: 3,
        file: normalizeSourceMapPath(options.filename || descriptor.filename || "anonymous.nd"),
        sources: [normalizeSourceMapPath(options.sourceMapFilename || descriptor.filename || "anonymous.nd")],
        sourcesContent: [source],
        names: [],
        mappings: encodeSourceMapMappings(lineMappings, countLines(code))
    };
}

function createScriptSourceLineMappings(scriptBlock, scriptCode) {
    const generatedLineCount = countLines(scriptCode);
    if (!scriptBlock?.content || generatedLineCount === 0) {
        return [];
    }

    const sourceLinePositions = createBlockSourceLinePositions(scriptBlock);
    const fallback = sourceLinePositions[0] || { line: 1, column: 1 };
    const mappings = [];

    for (let index = 0; index < generatedLineCount; index += 1) {
        const location = sourceLinePositions[index] || fallback;
        mappings.push(toSourceMapLocation(location));
    }

    return mappings;
}

function createBlockSourceLinePositions(block) {
    if (!block?.content) {
        return [];
    }

    const content = String(block.content || "");
    const rawContent = block.rawContent || content;
    const leadingTrimLength = rawContent.length - rawContent.trimStart().length;
    const trimmedStart = leadingTrimLength;
    const contentLines = content.split(/\r?\n/);
    const contentStartPosition = offsetToPosition(rawContent, trimmedStart);
    const mappedLines = [];
    for (let index = 0; index < contentLines.length; index += 1) {
        mappedLines.push({
            line: contentStartPosition.line + index,
            column: index === 0 ? contentStartPosition.column : 1
        });
    }
    return mappedLines;
}

function toSourceMapLocation(position) {
    if (!position) {
        return null;
    }
    return {
        line: Math.max(0, position.line - 1),
        column: Math.max(0, position.column - 1)
    };
}

function countLines(source) {
    return String(source || "").split(/\r?\n/).length;
}

function encodeSourceMapMappings(lineMappings, lineCount) {
    const mappings = [];
    let previousSourceIndex = 0;
    let previousSourceLine = 0;
    let previousSourceColumn = 0;

    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
        const mapping = lineMappings[lineIndex] || null;
        if (!mapping) {
            mappings.push("");
            continue;
        }

        const segment = [
            0,
            0 - previousSourceIndex,
            mapping.line - previousSourceLine,
            mapping.column - previousSourceColumn
        ];
        previousSourceIndex = 0;
        previousSourceLine = mapping.line;
        previousSourceColumn = mapping.column;
        mappings.push(segment.map(encodeVlq).join(""));
    }

    return mappings.join(";");
}

function encodeVlq(value) {
    let nextValue = toVlqSigned(value);
    let output = "";
    do {
        let digit = nextValue & 31;
        nextValue >>>= 5;
        if (nextValue > 0) {
            digit |= 32;
        }
        output += BASE64_VLQ_CHARS[digit];
    } while (nextValue > 0);
    return output;
}

function toVlqSigned(value) {
    return value < 0 ? ((-value) << 1) + 1 : (value << 1);
}

function normalizeSourceMapPath(value) {
    return String(value || "").replace(/\\/g, "/");
}

function createNdError(message, options = {}) {
    const error = new Error(message);
    error.ndFilename = options.filename || "anonymous.nd";
    error.ndOffset = Math.max(0, Number(options.offset) || 0);
    if (typeof options.source === "string") {
        const position = offsetToPosition(options.source, error.ndOffset);
        error.ndLine = position.line;
        error.ndColumn = position.column;
        error.ndFrame = createCodeFrame(options.source, error.ndOffset);
    }
    return error;
}

function validateTypedScriptBlock(scriptBlock, source, filename) {
    if (!scriptBlock?.content || !scriptBlock.isTypeScript) {
        return;
    }
    const validation = ts.transpileModule(scriptBlock.content, {
        fileName: `${filename}${scriptBlock.setup ? ".setup.ts" : ".ts"}`,
        compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022
        },
        reportDiagnostics: true
    });
    const diagnostic = pickTypeScriptError(validation.diagnostics || []);
    if (!diagnostic) {
        return;
    }

    throw createTypeScriptNdError(diagnostic, {
        filename,
        scriptBlock,
        source,
        validatingRawBlock: true
    });
}

function transpileTypeScriptScript(scriptCode, scriptBlock, context = {}) {
    const transpiled = ts.transpileModule(scriptCode, {
        fileName: `${context.filename || "anonymous.nd"}${scriptBlock.setup ? ".setup.ts" : ".ts"}`,
        compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
            importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove
        },
        reportDiagnostics: true
    });
    const diagnostic = pickTypeScriptError(transpiled.diagnostics || []);
    if (diagnostic) {
        throw createTypeScriptNdError(diagnostic, {
            filename: context.filename || "anonymous.nd",
            scriptBlock,
            source: context.source || "",
            validatingRawBlock: false
        });
    }
    return String(transpiled.outputText || "").trim();
}

function pickTypeScriptError(diagnostics) {
    return diagnostics.find(item => item.category === ts.DiagnosticCategory.Error);
}

function createTypeScriptNdError(diagnostic, options) {
    const messageText = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n").trim();
    const label = options.scriptBlock?.setup ? "<script setup lang=\"ts\">" : "<script lang=\"ts\">";
    if (options.validatingRawBlock && diagnostic.file && Number.isFinite(diagnostic.start)) {
        return createNdError(`Invalid ${label} syntax: ${messageText}`, {
            filename: options.filename,
            offset: (options.scriptBlock?.contentStartOffset || 0) + diagnostic.start,
            source: options.source
        });
    }
    return createNdError(`Unable to transpile ${label}: ${messageText}`, {
        filename: options.filename,
        offset: options.scriptBlock?.contentStartOffset || 0,
        source: options.source
    });
}

function buildScriptSetup(scriptContent) {
    const { body, imports } = extractImportStatements(scriptContent);
    const { optionExpressions, statements } = extractDefineOptions(body);
    const importBindings = extractImportBindings(imports);
    const optionIdentifiers = extractIdentifiers(optionExpressions.join("\n"));
    const hoistedBindings = collectOptionHoistedBindings(statements, optionExpressions);
    const hoistedBindingNames = hoistedBindings.map(item => item.name);
    const setupStatements = statements.filter(item => !item.isOption && !hoistedBindingNames.includes(item.name));
    const setupBody = setupStatements
        .map(item => item.statement.trim())
        .filter(Boolean)
        .join("\n\n");
    const bindings = extractTopLevelBindings(setupStatements.map(item => item.statement));
    const optionScopeNames = Array.from(new Set([
        ...importBindings.filter(name => optionIdentifiers.includes(name)),
        ...hoistedBindingNames
    ]));
    const parts = [];
    if (imports.length > 0) {
        parts.push(imports.join("\n"), "");
    }
    if (hoistedBindings.length > 0) {
        parts.push(
            hoistedBindings
                .map(item => item.statement.trim())
                .join("\n\n"),
            ""
        );
    }
    if (optionExpressions.length > 0) {
        parts.push(
            "const __nd_apply_options__ = (factory, scope) => {",
            "  const options = factory() || {};",
            "  if (Array.isArray(options.modules)) {",
            "    options.modules = options.modules.map((item) => {",
            "      if (!item) {",
            "        return item;",
            "      }",
            "      for (const key of Object.keys(scope)) {",
            "        if (scope[key] === item) {",
            "          return { name: key, module: item };",
            "        }",
            "      }",
            "      return item;",
            "    });",
            "  }",
            "  return options;",
            "};",
            ""
        );
    }
    parts.push("const __nd_component__ = {");
    for (const expression of optionExpressions) {
        parts.push(`  ...__nd_apply_options__(() => (${expression}), ${createScopeLiteral(optionScopeNames)}),`);
    }
    parts.push("  setup() {");
    if (setupBody.trim()) {
        parts.push(indentBlock(setupBody.trim(), 4), "");
    }
    if (bindings.length === 0) {
        parts.push("    return {};");
    } else {
        parts.push("    return {");
        for (let index = 0; index < bindings.length; index++) {
            const suffix = index === bindings.length - 1 ? "" : ",";
            parts.push(`      ${bindings[index]}${suffix}`);
        }
        parts.push("    };");
    }
    parts.push("  }", "};");
    return parts.join("\n");
}

function extractDefineOptions(source) {
    const optionExpressions = [];
    const statements = [];
    for (const statement of splitTopLevelStatements(source)) {
        const trimmed = statement.trim();
        if (!trimmed) {
            continue;
        }
        const match = /^defineOptions\s*\(([\s\S]*)\)\s*;?$/.exec(trimmed);
        if (match) {
            optionExpressions.push(match[1].trim());
            statements.push({
                isOption: true,
                name: "",
                statement: trimmed
            });
            continue;
        }
        statements.push({
            isOption: false,
            name: extractStatementBindingName(trimmed),
            statement: trimmed
        });
    }
    return {
        optionExpressions,
        statements
    };
}

function extractImportStatements(source) {
    const statements = splitTopLevelStatements(source);
    const imports = [];
    const bodyStatements = [];
    for (const statement of statements) {
        if (/^\s*import\b/.test(statement)) {
            imports.push(statement.trim());
        } else if (statement.trim()) {
            bodyStatements.push(statement.trim());
        }
    }
    return {
        body: bodyStatements.join("\n\n"),
        imports
    };
}

function extractTopLevelBindings(sourceOrStatements) {
    const statements = Array.isArray(sourceOrStatements)
        ? sourceOrStatements
        : splitTopLevelStatements(sourceOrStatements);
    const names = [];
    for (const statement of statements) {
        const trimmed = statement.trim();
        if (!trimmed) {
            continue;
        }
        const match = /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)\b/.exec(trimmed);
        if (match && !names.includes(match[1])) {
            names.push(match[1]);
        }
    }
    return names;
}

function extractImportBindings(imports) {
    const names = [];
    for (const statement of imports) {
        const match = /^\s*import\s+([\s\S]+?)\s+from\s+["'][^"']+["']\s*;?\s*$/.exec(statement);
        if (!match) {
            continue;
        }
        collectImportClauseBindings(match[1].trim(), names);
    }
    return names;
}

function collectImportClauseBindings(clause, names) {
    if (!clause) {
        return;
    }
    const commaIndex = findClauseComma(clause);
    if (commaIndex !== -1) {
        addImportBindingName(clause.slice(0, commaIndex).trim(), names);
        collectImportClauseBindings(clause.slice(commaIndex + 1).trim(), names);
        return;
    }
    if (clause.startsWith("{")) {
        addNamedImportBindings(clause, names);
        return;
    }
    const namespaceMatch = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(clause);
    if (namespaceMatch) {
        addImportBindingName(namespaceMatch[1], names);
        return;
    }
    addImportBindingName(clause, names);
}

function addNamedImportBindings(clause, names) {
    const content = clause.replace(/^\{\s*|\s*\}$/g, "");
    for (const part of content.split(",")) {
        const trimmed = part.trim();
        if (!trimmed) {
            continue;
        }
        const aliasMatch = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(trimmed);
        addImportBindingName(aliasMatch ? aliasMatch[1] : trimmed, names);
    }
}

function addImportBindingName(name, names) {
    if (/^[A-Za-z_$][\w$]*$/.test(name) && !names.includes(name)) {
        names.push(name);
    }
}

function collectOptionHoistedBindings(statements, optionExpressions) {
    if (optionExpressions.length === 0) {
        return [];
    }
    const availableBindings = new Map();
    for (const statement of statements) {
        if (!statement.isOption && statement.name) {
            availableBindings.set(statement.name, statement);
        }
    }

    const referencedBindings = new Set();
    for (const expression of optionExpressions) {
        for (const name of extractIdentifiers(expression)) {
            if (availableBindings.has(name)) {
                referencedBindings.add(name);
            }
        }
    }

    return statements.filter(statement => !statement.isOption && referencedBindings.has(statement.name));
}

function extractIdentifiers(source) {
    return Array.from(new Set(
        Array.from(source.matchAll(/\b[A-Za-z_$][\w$]*\b/g), match => match[0])
    ));
}

function extractStatementBindingName(statement) {
    return /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)\b/.exec(statement)?.[1] || "";
}

function findClauseComma(clause) {
    let depth = 0;
    for (let index = 0; index < clause.length; index++) {
        const char = clause[index];
        if (char === "{") {
            depth++;
        } else if (char === "}" && depth > 0) {
            depth--;
        } else if (char === "," && depth === 0) {
            return index;
        }
    }
    return -1;
}

function createScopeLiteral(names) {
    if (!names || names.length === 0) {
        return "{}";
    }
    return `{ ${names.join(", ")} }`;
}

function splitTopLevelStatements(source) {
    const statements = [];
    let start = 0;
    let depth = 0;
    let quote = null;

    for (let index = 0; index < source.length; index++) {
        const char = source[index];
        const next = source[index + 1];

        if (quote) {
            if (char === "\\" && next) {
                index += 1;
                continue;
            }
            if (char === quote) {
                quote = null;
            }
            continue;
        }

        if (char === "\"" || char === "'" || char === "`") {
            quote = char;
            continue;
        }

        if (char === "/" && next === "/") {
            index = source.indexOf("\n", index);
            if (index < 0) {
                break;
            }
            continue;
        }

        if (char === "/" && next === "*") {
            const commentEnd = source.indexOf("*/", index + 2);
            if (commentEnd < 0) {
                break;
            }
            index = commentEnd + 1;
            continue;
        }

        if (char === "{" || char === "[" || char === "(") {
            depth += 1;
            continue;
        }

        if (char === "}" || char === "]" || char === ")") {
            depth -= 1;
            continue;
        }

        if (char === ";" && depth === 0) {
            statements.push(source.slice(start, index + 1));
            start = index + 1;
        }
    }

    if (start < source.length) {
        statements.push(source.slice(start));
    }
    return statements;
}

function formatDeclarationPropertyName(name) {
    return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

function pushUniqueNdSurfaceEntry(target, name, source, metadata = {}) {
    const normalizedName = String(name || "").trim();
    if (!normalizedName) {
        return;
    }
    const existing = target.find(item => item.name === normalizedName);
    if (existing) {
        if (!existing.typeText && metadata.typeText) {
            existing.typeText = metadata.typeText;
        }
        if (existing.optional !== false && metadata.optional === false) {
            existing.optional = false;
        }
        return;
    }
    target.push({
        name: normalizedName,
        optional: metadata.optional !== false,
        source,
        typeText: metadata.typeText || ""
    });
}

function inferRuntimeContractMetadata(property, kind, localTypes, sourceFile) {
    if (kind === "props") {
        const initializer = getObjectMemberInitializer(property);
        return {
            optional: true,
            typeText: inferRuntimePropTypeText(initializer, localTypes, sourceFile)
        };
    }
    if (kind === "emits") {
        const initializer = getObjectMemberInitializer(property);
        return {
            typeText: inferRuntimeEmitTypeText(initializer, localTypes, sourceFile)
        };
    }
    if (kind === "slots") {
        const initializer = getObjectMemberInitializer(property);
        return {
            typeText: inferRuntimeSlotTypeText(initializer, localTypes, sourceFile)
        };
    }
    return {};
}

function inferTypeElementContractMetadata(member, kind, localTypes, sourceFile) {
    if (!member) {
        return {};
    }
    if (kind === "emits" && ts.isPropertySignature(member)) {
        return {
            optional: !!member.questionToken,
            typeText: getTypeTextForDeclaration(member.type, localTypes, sourceFile, {
                fallback: "(...args: unknown[]) => unknown"
            })
        };
    }
    if (kind === "props") {
        return {
            optional: !!member.questionToken,
            typeText: getTypeTextForDeclaration(member.type, localTypes, sourceFile)
        };
    }
    if (kind === "slots") {
        return {
            optional: !!member.questionToken,
            typeText: getTypeTextForDeclaration(member.type, localTypes, sourceFile)
        };
    }
    return {};
}

function inferRuntimePropTypeText(initializer, localTypes, sourceFile) {
    if (!initializer) {
        return "unknown";
    }
    if (ts.isIdentifier(initializer)) {
        return normalizeRuntimeConstructorType(initializer.text);
    }
    if (ts.isArrayLiteralExpression(initializer)) {
        const variants = initializer.elements
            .map(element => inferRuntimePropTypeText(element, localTypes, sourceFile))
            .filter(Boolean);
        return variants.length > 0 ? Array.from(new Set(variants)).join(" | ") : "unknown";
    }
    if (ts.isObjectLiteralExpression(initializer)) {
        const typeMember = initializer.properties.find(property => getObjectMemberName(property) === "type");
        if (typeMember) {
            return inferRuntimePropTypeText(getObjectMemberInitializer(typeMember), localTypes, sourceFile);
        }
    }
    return getTypeTextForDeclaration(initializer.type, localTypes, sourceFile);
}

function inferRuntimeEmitTypeText(initializer, localTypes, sourceFile) {
    if (!initializer) {
        return "(...args: unknown[]) => unknown";
    }
    if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        return buildFunctionLikeSignatureTypeText(initializer, localTypes, sourceFile);
    }
    return "(...args: unknown[]) => unknown";
}

function inferRuntimeSlotTypeText(initializer, localTypes, sourceFile) {
    if (!initializer) {
        return "unknown";
    }
    if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        return buildFunctionLikeSignatureTypeText(initializer, localTypes, sourceFile);
    }
    return getTypeTextForDeclaration(initializer.type, localTypes, sourceFile);
}

function normalizeRuntimeConstructorType(name) {
    const value = String(name || "").trim();
    if (value === "String") {
        return "string";
    }
    if (value === "Number") {
        return "number";
    }
    if (value === "Boolean") {
        return "boolean";
    }
    if (value === "Array") {
        return "unknown[]";
    }
    if (value === "Object") {
        return "Record<string, unknown>";
    }
    if (value === "Date") {
        return "Date";
    }
    return "unknown";
}

function buildFunctionLikeSignatureTypeText(node, localTypes, sourceFile) {
    if (!node) {
        return "(...args: unknown[]) => unknown";
    }
    const params = (node.parameters || [])
        .map(parameter => {
            const restPrefix = parameter.dotDotDotToken ? "..." : "";
            const name = parameter.name?.getText?.(sourceFile) || "arg";
            const optional = parameter.questionToken ? "?" : "";
            const typeText = getTypeTextForDeclaration(parameter.type, localTypes, sourceFile);
            return `${restPrefix}${name}${optional}: ${typeText}`;
        })
        .join(", ");
    const returnType = getTypeTextForDeclaration(node.type, localTypes, sourceFile, {
        fallback: "unknown"
    });
    return `(${params}) => ${returnType}`;
}

function buildEmitSignatureTypeText(node, localTypes, sourceFile) {
    if (!node) {
        return "(...args: unknown[]) => unknown";
    }
    const payloadParameters = (node.parameters || []).slice(1);
    if (payloadParameters.length === 0) {
        return "() => unknown";
    }
    const params = payloadParameters
        .map(parameter => {
            const restPrefix = parameter.dotDotDotToken ? "..." : "";
            const name = parameter.name?.getText?.(sourceFile) || "payload";
            const optional = parameter.questionToken ? "?" : "";
            const typeText = getTypeTextForDeclaration(parameter.type, localTypes, sourceFile);
            return `${restPrefix}${name}${optional}: ${typeText}`;
        })
        .join(", ");
    const returnType = getTypeTextForDeclaration(node.type, localTypes, sourceFile, {
        fallback: "unknown"
    });
    return `(${params}) => ${returnType}`;
}

function getTypeTextForDeclaration(typeNode, localTypes, sourceFile, options = {}) {
    if (!typeNode) {
        return options.fallback || "unknown";
    }
    const resolved = resolveTypeNode(typeNode, localTypes) || typeNode;
    if (!isSafeDeclarationTypeNode(resolved, localTypes)) {
        return options.fallback || "unknown";
    }
    const printer = ts.createPrinter({ removeComments: true });
    const text = printer.printNode(ts.EmitHint.Unspecified, resolved, sourceFile).trim();
    return text || options.fallback || "unknown";
}

function isSafeDeclarationTypeNode(typeNode, localTypes, seen = new Set()) {
    if (!typeNode) {
        return false;
    }
    if (ts.isParenthesizedTypeNode(typeNode) || ts.isTypeOperatorNode(typeNode) || ts.isRestTypeNode?.(typeNode) || ts.isOptionalTypeNode?.(typeNode)) {
        return isSafeDeclarationTypeNode(typeNode.type, localTypes, seen);
    }
    if (ts.isUnionTypeNode(typeNode) || ts.isIntersectionTypeNode(typeNode)) {
        return typeNode.types.every(item => isSafeDeclarationTypeNode(item, localTypes, seen));
    }
    if (ts.isLiteralTypeNode(typeNode)) {
        return true;
    }
    if (ts.isArrayTypeNode(typeNode)) {
        return isSafeDeclarationTypeNode(typeNode.elementType, localTypes, seen);
    }
    if (ts.isTupleTypeNode(typeNode)) {
        return typeNode.elements.every(item => isSafeDeclarationTypeNode(ts.isNamedTupleMember(item) ? item.type : item, localTypes, seen));
    }
    if (ts.isFunctionTypeNode(typeNode)) {
        return typeNode.parameters.every(parameter => !parameter.type || isSafeDeclarationTypeNode(parameter.type, localTypes, seen))
            && (!typeNode.type || isSafeDeclarationTypeNode(typeNode.type, localTypes, seen));
    }
    if (ts.isTypeLiteralNode(typeNode)) {
        return typeNode.members.every(member => {
            if (ts.isPropertySignature(member) || ts.isMethodSignature(member) || ts.isCallSignatureDeclaration(member) || ts.isIndexSignatureDeclaration(member)) {
                const memberType = member.type || null;
                const parameterTypes = member.parameters || [];
                return parameterTypes.every(parameter => !parameter.type || isSafeDeclarationTypeNode(parameter.type, localTypes, seen))
                    && (!memberType || isSafeDeclarationTypeNode(memberType, localTypes, seen));
            }
            return false;
        });
    }
    if (ts.isTemplateLiteralTypeNode?.(typeNode)) {
        return typeNode.templateSpans.every(span => isSafeDeclarationTypeNode(span.type, localTypes, seen));
    }
    if (ts.isIndexedAccessTypeNode(typeNode)) {
        return isSafeDeclarationTypeNode(typeNode.objectType, localTypes, seen)
            && isSafeDeclarationTypeNode(typeNode.indexType, localTypes, seen);
    }
    if (ts.isTypeReferenceNode(typeNode)) {
        if (ts.isIdentifier(typeNode.typeName)) {
            const referenceName = typeNode.typeName.text;
            if (SAFE_DECLARATION_TYPE_REFERENCES.has(referenceName)) {
                return (typeNode.typeArguments || []).every(item => isSafeDeclarationTypeNode(item, localTypes, seen));
            }
            const resolved = resolveLocalTypeNode(localTypes, referenceName);
            if (resolved && !seen.has(referenceName)) {
                seen.add(referenceName);
                return isSafeDeclarationTypeNode(resolveTypeNode(resolved, localTypes, seen) || resolved, localTypes, seen);
            }
        }
        return false;
    }
    return isKeywordTypeNode(typeNode) || ts.isThisTypeNode?.(typeNode);
}

function resolveImportedNdComponentContracts(scriptBlock, filename, options = {}) {
    const contracts = new Map();
    if (!scriptBlock?.content || !filename) {
        return contracts;
    }
    const sourceFile = createScriptSurfaceSourceFile(scriptBlock, filename);
    for (const statement of sourceFile.statements || []) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
            continue;
        }
        const specifier = statement.moduleSpecifier.text.trim();
        const resolvedFile = resolveImportedNdComponentFile(filename, specifier);
        if (!resolvedFile) {
            continue;
        }
        const surface = readImportedNdComponentSurface(resolvedFile, options.__ndSeenFiles);
        if (!surface) {
            continue;
        }
        for (const localName of collectImportedBindingNames(statement.importClause)) {
            registerImportedNdComponentContract(contracts, localName, surface);
        }
    }
    return contracts;
}

function resolveImportedNdComponentFile(filename, specifier) {
    if (!specifier || !specifier.toLowerCase().endsWith(".nd")) {
        return "";
    }
    if (!specifier.startsWith(".") && !path.isAbsolute(specifier)) {
        return "";
    }
    const baseDir = path.dirname(path.resolve(filename));
    const resolvedFile = path.resolve(baseDir, specifier);
    return fs.existsSync(resolvedFile) ? resolvedFile : "";
}

function collectImportedBindingNames(importClause) {
    const names = [];
    if (!importClause) {
        return names;
    }
    if (importClause.name) {
        names.push(importClause.name.text);
    }
    if (importClause.namedBindings) {
        if (ts.isNamespaceImport(importClause.namedBindings)) {
            names.push(importClause.namedBindings.name.text);
        } else if (ts.isNamedImports(importClause.namedBindings)) {
            for (const element of importClause.namedBindings.elements) {
                names.push((element.name || element.propertyName)?.text || "");
            }
        }
    }
    return names.filter(Boolean);
}

function registerImportedNdComponentContract(contracts, localName, surface) {
    const names = new Set([
        localName,
        toKebabCase(localName)
    ]);
    for (const name of names) {
        contracts.set(name, {
            emits: surface.emits || [],
            filename: surface.filename,
            props: surface.props || [],
            slots: surface.slots || []
        });
    }
}

function readImportedNdComponentSurface(filePath, parentSeenFiles) {
    const normalizedFile = path.resolve(filePath);
    const seenFiles = new Set(parentSeenFiles || []);
    if (seenFiles.has(normalizedFile)) {
        return null;
    }
    try {
        const stat = fs.statSync(normalizedFile);
        const cacheKey = `${stat.mtimeMs}:${stat.size}`;
        const cached = ND_COMPONENT_SURFACE_CACHE.get(normalizedFile);
        if (cached?.cacheKey === cacheKey) {
            return cached.surface;
        }
        const source = fs.readFileSync(normalizedFile, "utf8");
        const descriptor = parseNd(source, {
            filename: normalizedFile
        });
        const surface = extractNdTypeSurface(source, {
            __ndSeenFiles: new Set([...seenFiles, normalizedFile]),
            componentContractCheck: false,
            descriptor,
            filename: normalizedFile,
            templateTypeCheck: false
        });
        ND_COMPONENT_SURFACE_CACHE.set(normalizedFile, {
            cacheKey,
            surface
        });
        return surface;
    } catch {
        return null;
    }
}

function collectComponentContractTemplateDiagnostics(nodes, componentContracts) {
    const diagnostics = [];
    for (const node of nodes) {
        const contract = componentContracts.get(node.name) || componentContracts.get(node.lowerName);
        if (!contract) {
            continue;
        }
        for (const attr of node.attrs || []) {
            const eventName = normalizeComponentEventAttributeName(attr.name);
            if (eventName) {
                if (!contract.emits.some(entry => normalizeContractEventName(entry.name) === eventName)) {
                    diagnostics.push({
                        message: `Unknown emitted event handler \`${attr.name}\` on component \`${node.name}\`. Declared emits: ${formatContractEntryList(contract.emits) || "none"}.`,
                        offset: attr.valueStartOffset ?? attr.startOffset
                    });
                }
                continue;
            }
            if (shouldIgnoreComponentAttribute(attr.name)) {
                continue;
            }
            const normalizedProp = normalizeContractPropName(attr.name);
            if (!contract.props.some(entry => normalizeContractPropName(entry.name) === normalizedProp)) {
                diagnostics.push({
                    message: `Unknown prop \`${attr.name}\` on component \`${node.name}\`. Declared props: ${formatContractEntryList(contract.props) || "none"}.`,
                    offset: attr.valueStartOffset ?? attr.startOffset
                });
            }
        }
        for (const child of getDirectTemplateChildren(nodes, node)) {
            if (child.lowerName !== "slot") {
                continue;
            }
            const slotAttr = child.attrs.find(attr => attr.name.toLowerCase() === "name");
            const slotName = String(slotAttr?.value || "").trim();
            if (!slotName) {
                continue;
            }
            const normalizedSlot = normalizeContractSlotName(slotName);
            if (!contract.slots.some(entry => normalizeContractSlotName(entry.name) === normalizedSlot)) {
                diagnostics.push({
                    message: `Unknown named slot \`${slotName}\` passed to component \`${node.name}\`. Declared slots: ${formatContractEntryList(contract.slots) || "none"}.`,
                    offset: slotAttr?.valueStartOffset ?? slotAttr?.startOffset ?? child.openStart
                });
            }
        }
    }
    return diagnostics;
}

function formatContractEntryList(entries) {
    return Array.isArray(entries) && entries.length > 0
        ? entries.map(entry => `\`${entry.name}\``).join(", ")
        : "";
}

function getDirectTemplateChildren(nodes, parentNode) {
    return nodes.filter(node => node.parent === parentNode);
}

function normalizeContractPropName(name) {
    const value = String(name || "").trim();
    return value ? toKebabCase(value) : "";
}

function normalizeContractEventName(name) {
    const value = String(name || "").trim();
    if (!value) {
        return "";
    }
    return value
        .split(":")
        .map(segment => toKebabCase(segment))
        .filter(Boolean)
        .join(":");
}

function normalizeContractSlotName(name) {
    const value = String(name || "").trim();
    if (!value) {
        return "";
    }
    return value.toLowerCase() === "default" ? "default" : toKebabCase(value);
}

function normalizeComponentEventAttributeName(name) {
    const value = String(name || "").trim();
    if (!value) {
        return "";
    }
    if (/^on:/.test(value)) {
        return normalizeContractEventName(value.slice(3));
    }
    if (/^on-/.test(value)) {
        return normalizeContractEventName(value.slice(3));
    }
    if (/^on[A-Z]/.test(value)) {
        return normalizeContractEventName(`${value[2].toLowerCase()}${value.slice(3)}`);
    }
    return "";
}

function shouldIgnoreComponentAttribute(name) {
    const lowerName = String(name || "").toLowerCase();
    if (!lowerName) {
        return true;
    }
    if (FALLTHROUGH_COMPONENT_ATTRIBUTES.has(lowerName)) {
        return true;
    }
    return lowerName.startsWith("x-")
        || lowerName.startsWith("e-")
        || lowerName.startsWith("data-")
        || lowerName.startsWith("aria-");
}

function toKebabCase(value) {
    return String(value || "")
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/[_\s]+/g, "-")
        .replace(/--+/g, "-")
        .toLowerCase();
}

function isKeywordTypeNode(node) {
    return !!node && [
        ts.SyntaxKind.AnyKeyword,
        ts.SyntaxKind.BigIntKeyword,
        ts.SyntaxKind.BooleanKeyword,
        ts.SyntaxKind.NeverKeyword,
        ts.SyntaxKind.NullKeyword,
        ts.SyntaxKind.NumberKeyword,
        ts.SyntaxKind.ObjectKeyword,
        ts.SyntaxKind.StringKeyword,
        ts.SyntaxKind.SymbolKeyword,
        ts.SyntaxKind.UndefinedKeyword,
        ts.SyntaxKind.UnknownKeyword,
        ts.SyntaxKind.VoidKeyword
    ].includes(node.kind);
}

function createScriptSurfaceSourceFile(scriptBlock, filename) {
    return ts.createSourceFile(
        `${filename}${scriptBlock?.setup ? ".setup" : ""}${scriptBlock?.isTypeScript ? ".ts" : ".js"}`,
        scriptBlock?.content || "",
        ts.ScriptTarget.Latest,
        true,
        scriptBlock?.isTypeScript ? ts.ScriptKind.TS : ts.ScriptKind.JS
    );
}

function visitSurfaceNodes(sourceFile, visit) {
    const walker = (node) => {
        visit(node);
        ts.forEachChild(node, walker);
    };
    walker(sourceFile);
}

function resolveDefineModelName(node) {
    const firstArg = node.arguments?.[0];
    return firstArg && ts.isStringLiteralLike(firstArg) ? firstArg.text.trim() : "";
}

function collectScriptBindingHints(sourceFile, localTypes, surface) {
    if (!surface?.bindingHints) {
        surface.bindingHints = new Map();
    }
    visitSurfaceNodes(sourceFile, (node) => {
        if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) {
            return;
        }
        const hint = inferBindingHint(node.initializer, node.type, localTypes);
        if (!hint) {
            return;
        }
        mergeSurfaceBindingHint(surface.bindingHints, node.name.text, hint);
    });
}

function collectLocalTypeDeclarations(sourceFile) {
    const localTypes = new Map();
    for (const statement of sourceFile.statements || []) {
        if (ts.isTypeAliasDeclaration(statement)) {
            localTypes.set(statement.name.text, statement.type);
        } else if (ts.isInterfaceDeclaration(statement)) {
            localTypes.set(statement.name.text, statement);
        }
    }
    return localTypes;
}

function resolveBindingHintFromExpression(expression, bindingHints) {
    if (!expression || !(bindingHints instanceof Map) || bindingHints.size === 0) {
        return null;
    }
    try {
        const sourceFile = ts.createSourceFile("binding-hint.ts", `(${expression});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const statement = sourceFile.statements?.[0];
        if (!statement || !ts.isExpressionStatement(statement)) {
            return null;
        }
        return resolveBindingHintFromExpressionNode(statement.expression, bindingHints);
    } catch {
        return null;
    }
}

function resolveBindingHintFromExpressionNode(node, bindingHints) {
    if (!node) {
        return null;
    }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression?.(node)) {
        return resolveBindingHintFromExpressionNode(node.expression, bindingHints);
    }
    if (ts.isIdentifier(node)) {
        return bindingHints.get(node.text) || null;
    }
    if (ts.isPropertyAccessExpression(node)) {
        const targetHint = resolveBindingHintFromExpressionNode(node.expression, bindingHints);
        return targetHint?.propertyHints?.get(node.name.text) || null;
    }
    if (ts.isElementAccessExpression(node)) {
        const targetHint = resolveBindingHintFromExpressionNode(node.expression, bindingHints);
        const argument = node.argumentExpression;
        if (targetHint?.propertyHints && argument && ts.isStringLiteralLike(argument)) {
            return targetHint.propertyHints.get(argument.text) || null;
        }
    }
    return null;
}

function collectObjectHintIdentifiers(hint, identifiers) {
    if (!hint) {
        return;
    }
    for (const key of hint.objectKeys || []) {
        identifiers.add(key);
    }
}

function collectRepeatHintIdentifiers(hint, identifiers) {
    const elementHint = hint?.arrayElementHint;
    if (!elementHint) {
        return;
    }
    collectObjectHintIdentifiers(elementHint, identifiers);
}

function mergeSurfaceBindingHint(bindingHints, name, hint) {
    const existing = bindingHints.get(name);
    bindingHints.set(name, mergeBindingHints(existing, hint));
}

function createBindingHint() {
    return {
        arrayElementHint: null,
        objectKeys: new Set(),
        propertyHints: new Map()
    };
}

function hasBindingHint(hint) {
    return !!(
        hint
        && (hint.objectKeys?.size > 0
            || hint.propertyHints?.size > 0
            || hasBindingHint(hint.arrayElementHint))
    );
}

function mergeBindingHints(targetHint, sourceHint) {
    if (!targetHint && !sourceHint) {
        return null;
    }
    const target = targetHint || createBindingHint();
    if (!sourceHint) {
        return target;
    }
    for (const key of sourceHint.objectKeys || []) {
        target.objectKeys.add(key);
    }
    for (const [key, nestedHint] of sourceHint.propertyHints || []) {
        target.propertyHints.set(key, mergeBindingHints(target.propertyHints.get(key) || null, nestedHint));
    }
    if (sourceHint.arrayElementHint) {
        target.arrayElementHint = mergeBindingHints(target.arrayElementHint, sourceHint.arrayElementHint);
    }
    return target;
}

function inferBindingHint(initializer, typeNode, localTypes) {
    let hint = null;
    if (typeNode) {
        hint = mergeBindingHints(hint, inferBindingHintFromTypeNode(typeNode, localTypes));
    }
    if (initializer) {
        hint = mergeBindingHints(hint, inferBindingHintFromInitializer(initializer, localTypes));
    }
    return hasBindingHint(hint) ? hint : null;
}

function inferBindingHintFromInitializer(initializer, localTypes) {
    if (!initializer) {
        return null;
    }
    if (ts.isParenthesizedExpression(initializer) || ts.isAsExpression(initializer) || ts.isTypeAssertionExpression(initializer) || ts.isNonNullExpression(initializer) || ts.isSatisfiesExpression?.(initializer)) {
        return inferBindingHintFromInitializer(initializer.expression, localTypes);
    }
    if (ts.isObjectLiteralExpression(initializer)) {
        const hint = createBindingHint();
        for (const property of initializer.properties) {
            const name = getObjectMemberName(property);
            if (!name) {
                continue;
            }
            hint.objectKeys.add(name);
            const nestedHint = inferBindingHintFromRuntimeMember(property, localTypes);
            if (nestedHint) {
                hint.propertyHints.set(name, nestedHint);
            }
        }
        return hasBindingHint(hint) ? hint : null;
    }
    if (ts.isArrayLiteralExpression(initializer)) {
        const hint = createBindingHint();
        for (const element of initializer.elements) {
            hint.arrayElementHint = mergeBindingHints(
                hint.arrayElementHint,
                inferBindingHintFromInitializer(element, localTypes)
            );
        }
        return hasBindingHint(hint) ? hint : null;
    }
    if (ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression)) {
        if (["reactive", "useReactive", "ref", "useRef", "useState"].includes(initializer.expression.text)) {
            return inferBindingHintFromInitializer(initializer.arguments?.[0], localTypes);
        }
    }
    return null;
}

function inferBindingHintFromRuntimeMember(member, localTypes) {
    if (ts.isPropertyAssignment(member)) {
        return inferBindingHint(member.initializer, null, localTypes);
    }
    if (ts.isShorthandPropertyAssignment(member)) {
        return null;
    }
    if (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
        return null;
    }
    return null;
}

function inferBindingHintFromTypeNode(typeNode, localTypes, seen = new Set()) {
    const resolved = resolveTypeNode(typeNode, localTypes, seen);
    if (!resolved) {
        return null;
    }
    if (ts.isParenthesizedTypeNode(resolved) || ts.isTypeOperatorNode(resolved) || ts.isRestTypeNode?.(resolved) || ts.isOptionalTypeNode?.(resolved)) {
        return inferBindingHintFromTypeNode(resolved.type, localTypes, seen);
    }
    if (ts.isUnionTypeNode(resolved) || ts.isIntersectionTypeNode(resolved)) {
        let hint = null;
        for (const child of resolved.types) {
            hint = mergeBindingHints(hint, inferBindingHintFromTypeNode(child, localTypes, seen));
        }
        return hasBindingHint(hint) ? hint : null;
    }
    if (ts.isArrayTypeNode(resolved)) {
        const hint = createBindingHint();
        hint.arrayElementHint = inferBindingHintFromTypeNode(resolved.elementType, localTypes, seen);
        return hasBindingHint(hint) ? hint : null;
    }
    if (ts.isTupleTypeNode(resolved)) {
        const hint = createBindingHint();
        for (const element of resolved.elements) {
            const nextType = ts.isNamedTupleMember(element) ? element.type : element;
            hint.arrayElementHint = mergeBindingHints(hint.arrayElementHint, inferBindingHintFromTypeNode(nextType, localTypes, seen));
        }
        return hasBindingHint(hint) ? hint : null;
    }
    if (ts.isTypeReferenceNode(resolved) && ts.isIdentifier(resolved.typeName)) {
        if (["Array", "ReadonlyArray"].includes(resolved.typeName.text)) {
            const hint = createBindingHint();
            hint.arrayElementHint = inferBindingHintFromTypeNode(resolved.typeArguments?.[0], localTypes, seen);
            return hasBindingHint(hint) ? hint : null;
        }
    }
    if (ts.isTypeLiteralNode(resolved) || ts.isInterfaceDeclaration(resolved)) {
        const members = ts.isTypeLiteralNode(resolved) ? resolved.members : resolved.members;
        const hint = createBindingHint();
        for (const member of members) {
            const name = getTypeElementName(member);
            if (!name) {
                continue;
            }
            hint.objectKeys.add(name);
            const nestedHint = inferBindingHintFromTypeElement(member, localTypes, seen);
            if (nestedHint) {
                hint.propertyHints.set(name, nestedHint);
            }
        }
        return hasBindingHint(hint) ? hint : null;
    }
    return null;
}

function inferBindingHintFromTypeElement(member, localTypes, seen) {
    if (!member) {
        return null;
    }
    if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) {
        return inferBindingHintFromTypeNode(member.type, localTypes, seen);
    }
    return null;
}

function resolveLocalTypeNode(localTypes, name) {
    return localTypes?.get(name) || null;
}

function resolveTypeNode(typeNode, localTypes, seen = new Set()) {
    if (!typeNode) {
        return null;
    }
    if (ts.isParenthesizedTypeNode(typeNode)) {
        return resolveTypeNode(typeNode.type, localTypes, seen);
    }
    if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
        const referenceName = typeNode.typeName.text;
        if (seen.has(referenceName)) {
            return null;
        }
        const resolved = resolveLocalTypeNode(localTypes, referenceName);
        if (!resolved) {
            return typeNode;
        }
        seen.add(referenceName);
        return resolveTypeNode(resolved, localTypes, seen) || resolved;
    }
    return typeNode;
}

function getTypeElementName(member) {
    if ("name" in member && member.name) {
        return getPropertyNameText(member.name);
    }
    return "";
}

function getDefaultExportObjectLiteral(sourceFile) {
    for (const statement of sourceFile.statements || []) {
        if (ts.isExportAssignment(statement) && ts.isObjectLiteralExpression(statement.expression)) {
            return statement.expression;
        }
    }
    return null;
}

function getObjectMemberName(member) {
    if (!member) {
        return "";
    }
    if (ts.isPropertyAssignment(member) || ts.isShorthandPropertyAssignment(member) || ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
        return getPropertyNameText(member.name);
    }
    return "";
}

function getObjectMemberInitializer(member) {
    if (!member) {
        return null;
    }
    if (ts.isPropertyAssignment(member)) {
        return member.initializer;
    }
    if (ts.isShorthandPropertyAssignment(member)) {
        return member.name;
    }
    return null;
}

function getFunctionLikeBody(member) {
    if (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
        return member.body || null;
    }
    if (ts.isPropertyAssignment(member)) {
        const initializer = member.initializer;
        if (ts.isFunctionExpression(initializer) || ts.isArrowFunction(initializer)) {
            return initializer.body || null;
        }
    }
    return null;
}

function visitFunctionReturns(body, visitReturn) {
    const walker = (node) => {
        if (!node) {
            return;
        }
        if (ts.isFunctionLike(node) && node !== body) {
            return;
        }
        if (ts.isReturnStatement(node) && node.expression) {
            visitReturn(node.expression);
        }
        ts.forEachChild(node, walker);
    };
    walker(body);
}

function normalizeContractName(kind, name) {
    return kind === "emits" || kind === "slots" ? name : name;
}

function getPropertyNameText(nameNode) {
    if (!nameNode) {
        return "";
    }
    if (ts.isIdentifier(nameNode) || ts.isPrivateIdentifier(nameNode)) {
        return nameNode.text;
    }
    if (ts.isStringLiteralLike(nameNode) || ts.isNumericLiteral(nameNode)) {
        return nameNode.text;
    }
    if (ts.isComputedPropertyName(nameNode) && ts.isStringLiteralLike(nameNode.expression)) {
        return nameNode.expression.text;
    }
    return "";
}

function findMatchingTemplateNode(stack, lowerName) {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].lowerName === lowerName) {
            return index;
        }
    }
    return -1;
}

function isVoidTemplateTag(lowerName) {
    return lowerName === "br"
        || lowerName === "hr"
        || lowerName === "img"
        || lowerName === "input"
        || lowerName === "link"
        || lowerName === "meta";
}

function extractNdTemplateAttributeRawValue(matchText) {
    const equalIndex = matchText.indexOf("=");
    return equalIndex < 0 ? "" : matchText.slice(equalIndex + 1).trimStart();
}

function isScopedTemplateNode(node) {
    if (!node) {
        return false;
    }
    if (node.lowerName === "for" || node.lowerName === "recur") {
        return true;
    }
    return node.attrs.some(attr => {
        const name = attr.name.toLowerCase();
        return name === "x-repeat" || name === "x-model" || name === "x-recur";
    });
}

function isSkippedScopedTemplateNode(node) {
    if (!isScopedTemplateNode(node)) {
        return false;
    }
    if (node.lowerName === "recur") {
        return true;
    }
    return node.attrs.some(attr => attr.name.toLowerCase() === "x-recur");
}

function isOffsetWithinRanges(offset, ranges) {
    return ranges.some(range => offset >= range.start && offset < range.end);
}

function isOffsetWithinNode(offset, node) {
    const end = node.closeEnd || node.openEnd;
    return offset >= node.openStart && offset < end;
}

function normalizeTemplateEventExpression(expression) {
    const text = String(expression || "").trim();
    if (!text) {
        return "";
    }
    if (!/[()[\]{}]/.test(text) && text.includes(":")) {
        return text.split(":")[0].trim();
    }
    return text;
}

function collectBindingPatternNames(bindingName, target) {
    if (!bindingName) {
        return;
    }
    if (ts.isIdentifier(bindingName)) {
        target.add(bindingName.text);
        return;
    }
    if (ts.isObjectBindingPattern(bindingName)) {
        for (const element of bindingName.elements) {
            collectBindingPatternNames(element.name, target);
        }
        return;
    }
    if (ts.isArrayBindingPattern(bindingName)) {
        for (const element of bindingName.elements) {
            if (ts.isBindingElement(element)) {
                collectBindingPatternNames(element.name, target);
            }
        }
    }
}

function isExpressionReferenceIdentifier(node) {
    const parent = node.parent;
    if (!parent) {
        return true;
    }
    if ((ts.isPropertyAccessExpression(parent) || ts.isQualifiedName(parent)) && parent.name === node) {
        return false;
    }
    if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodSignature(parent)) && parent.name === node) {
        return false;
    }
    if ((ts.isImportClause(parent) || ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent) || ts.isImportEqualsDeclaration(parent)) && parent.name === node) {
        return false;
    }
    if ((ts.isBindingElement(parent) || ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent)) && parent.name === node) {
        return false;
    }
    if ((ts.isPropertySignature(parent) || ts.isEnumMember(parent)) && parent.name === node) {
        return false;
    }
    if (ts.isLabeledStatement(parent) && parent.label === node) {
        return false;
    }
    if (ts.isBreakOrContinueStatement(parent) && parent.label === node) {
        return false;
    }
    if (ts.isExportSpecifier(parent) && parent.propertyName === node) {
        return false;
    }
    if (ts.isMetaProperty(parent)) {
        return false;
    }
    return true;
}

function indentBlock(source, spaces) {
    const prefix = " ".repeat(spaces);
    return source
        .split(/\r?\n/)
        .map(line => line ? prefix + line : line)
        .join("\n");
}

function buildTemplate(descriptor, scopeId) {
    let template = descriptor.template.content;
    const styleContent = buildStyleContent(descriptor.styles, scopeId);
    if (descriptor.styles.some(style => style.scoped)) {
        template = injectScopedAttribute(template, scopeId);
    }
    if (styleContent) {
        template = injectStyleTag(template, styleContent);
    }
    return template;
}

function buildStyleContent(styles, scopeId) {
    if (!styles || styles.length === 0) {
        return "";
    }
    return styles
        .map(style => style.scoped ? scopeCss(style.content, scopeId) : style.content)
        .filter(Boolean)
        .join("\n\n")
        .trim();
}

function injectScopedAttribute(template, scopeId) {
    const match = /^\s*<([a-zA-Z][\w:-]*)([^>]*)>/m.exec(template);
    if (!match) {
        return template;
    }
    const attr = ` data-nd-scope="${scopeId}"`;
    const tag = match[0];
    const injected = tag.endsWith("/>")
        ? tag.slice(0, -2) + attr + " />"
        : tag.slice(0, -1) + attr + ">";
    return template.replace(tag, injected);
}

function injectStyleTag(template, css) {
    const match = /^\s*<([a-zA-Z][\w:-]*)([^>]*)>/m.exec(template);
    if (!match) {
        return template;
    }
    const tag = match[0];
    const styleTag = `\n<style>\n${css}\n</style>\n`;
    return template.replace(tag, `${tag}${styleTag}`);
}

function scopeCss(css, scopeId) {
    const selectorPrefix = `[data-nd-scope="${scopeId}"]`;
    return scopeCssBlock(css, selectorPrefix).trim();
}

function scopeCssBlock(css, selectorPrefix) {
    let cursor = 0;
    let result = "";

    while (cursor < css.length) {
        const openBrace = css.indexOf("{", cursor);
        if (openBrace === -1) {
            result += css.slice(cursor);
            break;
        }

        const closeBrace = findMatchingBrace(css, openBrace);
        if (closeBrace === -1) {
            result += css.slice(cursor);
            break;
        }

        const preamble = css.slice(cursor, openBrace);
        const splitIndex = preamble.lastIndexOf(";");
        const leading = splitIndex === -1 ? "" : preamble.slice(0, splitIndex + 1);
        const selector = (splitIndex === -1 ? preamble : preamble.slice(splitIndex + 1)).trim();
        const body = css.slice(openBrace + 1, closeBrace);

        result += leading;
        if (!selector) {
            result += `{${body}}`;
            cursor = closeBrace + 1;
            continue;
        }

        if (selector.startsWith("@")) {
            const atRuleName = selector.slice(1).split(/[\s(]/)[0].toLowerCase();
            if (isKeyframesRule(atRuleName)) {
                result += `${selector}{${body}}`;
            } else {
                result += `${selector}{${scopeCssBlock(body, selectorPrefix)}}`;
            }
        } else {
            result += `${scopeSelectorList(selector, selectorPrefix)}{${body}}`;
        }

        cursor = closeBrace + 1;
    }

    return result;
}

function findMatchingBrace(css, openBrace) {
    let depth = 0;
    for (let i = openBrace; i < css.length; i++) {
        const char = css[i];
        if (char === "{") {
            depth++;
        } else if (char === "}") {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}

function isKeyframesRule(atRuleName) {
    return atRuleName === "keyframes" || atRuleName.endsWith("keyframes");
}

function scopeSelectorList(selector, selectorPrefix) {
    return splitSelectorList(selector)
        .map(item => `${selectorPrefix} ${item.trim()}`)
        .join(", ");
}

function splitSelectorList(selector) {
    const selectors = [];
    let buffer = "";
    let roundDepth = 0;
    let squareDepth = 0;

    for (let i = 0; i < selector.length; i++) {
        const char = selector[i];
        if (char === "(") {
            roundDepth++;
        } else if (char === ")" && roundDepth > 0) {
            roundDepth--;
        } else if (char === "[") {
            squareDepth++;
        } else if (char === "]" && squareDepth > 0) {
            squareDepth--;
        }

        if (char === "," && roundDepth === 0 && squareDepth === 0) {
            if (buffer.trim()) {
                selectors.push(buffer.trim());
            }
            buffer = "";
            continue;
        }

        buffer += char;
    }

    if (buffer.trim()) {
        selectors.push(buffer.trim());
    }

    return selectors;
}

function createClassName(filename) {
    const base = path.basename(filename, path.extname(filename)).replace(/\.nd$/i, "");
    const normalized = base
        .replace(/[^a-zA-Z0-9]+/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(part => part[0].toUpperCase() + part.slice(1))
        .join("");
    return `${normalized || "Nd"}Component`;
}

function normalizeNdErrorLocation(error, source) {
    const offset = Number.isFinite(error?.ndOffset)
        ? Math.max(0, error.ndOffset)
        : 0;
    const line = Number.isFinite(error?.ndLine)
        ? error.ndLine
        : offsetToPosition(source || "", offset).line;
    const column = Number.isFinite(error?.ndColumn)
        ? error.ndColumn
        : offsetToPosition(source || "", offset).column;
    const frame = typeof error?.ndFrame === "string"
        ? error.ndFrame
        : createCodeFrame(source || "", offset);

    return {
        column,
        frame,
        line,
        offset
    };
}

function offsetToPosition(source, offset) {
    const safeOffset = Math.max(0, Math.min(offset, source.length));
    let line = 1;
    let column = 1;
    for (let index = 0; index < safeOffset; index++) {
        if (source[index] === "\n") {
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

function createCodeFrame(source, offset, options = {}) {
    const lines = String(source || "").split(/\r?\n/);
    const context = options.context ?? 2;
    const position = offsetToPosition(String(source || ""), offset);
    const targetIndex = Math.max(0, position.line - 1);
    const start = Math.max(0, targetIndex - context);
    const end = Math.min(lines.length - 1, targetIndex + context);
    const frameLines = [];

    for (let index = start; index <= end; index++) {
        const lineNumber = String(index + 1).padStart(3, " ");
        frameLines.push(`${lineNumber} | ${lines[index] || ""}`);
        if (index === targetIndex) {
            frameLines.push(`    | ${" ".repeat(Math.max(0, position.column - 1))}^`);
        }
    }

    return frameLines.join("\n");
}

function createScopeId(filename) {
    const seed = path.basename(filename).toLowerCase();
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = ((hash << 5) - hash + seed.charCodeAt(i)) >>> 0;
    }
    return `nd-${hash.toString(16)}`;
}

function extractBlockLanguage(attrs) {
    const match = /\blang\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(attrs || "");
    return (match?.[1] || match?.[2] || match?.[3] || "").trim().toLowerCase();
}

function isTypeScriptLang(lang) {
    return lang === "ts" || lang === "typescript";
}

function isNdFile(filePath) {
    return path.extname(filePath).toLowerCase() === ".nd";
}

async function resolveImportSource(inputFile, options) {
    if (typeof options.importSource === "function") {
        return options.importSource(inputFile);
    }
    if (typeof options.importSource === "string" && options.importSource.trim() !== "") {
        return options.importSource;
    }
    return inferImportSource(inputFile);
}

function resolveOutFile(inputFile, options) {
    if (typeof options.outFileResolver === "function") {
        return path.resolve(options.outFileResolver(inputFile, options));
    }
    if (options.outFile) {
        return path.resolve(options.outFile);
    }
    return defaultOutFile(inputFile, options.outputSuffix || DEFAULT_OUTPUT_SUFFIX);
}

function resolveDeclarationOutFile(inputFile, options) {
    if (typeof options.declarationOutFileResolver === "function") {
        return path.resolve(options.declarationOutFileResolver(inputFile, options));
    }
    if (options.declarationOutFile) {
        return path.resolve(options.declarationOutFile);
    }
    return defaultDeclarationOutFile(inputFile, options.declarationSuffix || DEFAULT_DECLARATION_SUFFIX);
}

function shouldEmitDeclaration(options = {}) {
    return !!(options.declaration || options.emitDeclaration || options.typesOnly);
}

async function removeCompiledOutput(inputFile, options) {
    const outFile = resolveOutFile(inputFile, options);
    await fsp.rm(outFile, { force: true });
    await removeGeneratedTypeOutput(inputFile, options);
}

async function removeGeneratedTypeOutput(inputFile, options) {
    if (!shouldEmitDeclaration(options)) {
        return;
    }
    await fsp.rm(resolveDeclarationOutFile(inputFile, options), { force: true });
}

async function walkDirectory(dir, onFile, options) {
    const entries = await safeReadDirectory(dir);
    for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!shouldIgnoreDirectory(entry.name, options, true)) {
                await walkDirectory(entryPath, onFile, options);
            }
            continue;
        }
        if (entry.isFile()) {
            await onFile(entryPath);
        }
    }
}

function shouldIgnoreDirectory(name, options, isNested) {
    if (!isNested) {
        return false;
    }
    if (Array.isArray(options.ignoreDirectories) && options.ignoreDirectories.includes(name)) {
        return true;
    }
    return DEFAULT_IGNORED_DIRS.has(name);
}

async function safeReadDirectory(dir) {
    try {
        return await fsp.readdir(dir, { withFileTypes: true });
    } catch {
        return [];
    }
}

async function safeStat(filePath) {
    try {
        return await fsp.stat(filePath);
    } catch {
        return null;
    }
}
