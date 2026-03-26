import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const BLOCK_RE = /<(template|script|style)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
const DEFAULT_OUTPUT_SUFFIX = ".nd.gen.mjs";
const DEFAULT_IGNORED_DIRS = new Set([
    ".git",
    ".vsix-stage",
    "dist",
    "node_modules"
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
        const content = match[3] || "";
        if (tag === "template") {
            if (descriptor.template) {
                throw new Error(`Only one <template> block is allowed in ${descriptor.filename}.`);
            }
            descriptor.template = {
                content: content.trim()
            };
        } else if (tag === "script") {
            if (descriptor.script) {
                throw new Error(`Only one <script> block is allowed in ${descriptor.filename}.`);
            }
            descriptor.script = {
                attrs,
                content: content.trim(),
                setup: /\bsetup\b/i.test(attrs)
            };
        } else if (tag === "style") {
            descriptor.styles.push({
                content: content.trim(),
                scoped: /\bscoped\b/i.test(attrs)
            });
        }
    }

    if (!descriptor.template) {
        throw new Error(`Missing <template> block in ${descriptor.filename}.`);
    }

    return descriptor;
}

export function compileNd(source, options = {}) {
    const descriptor = parseNd(source, options);
    const filename = descriptor.filename;
    const importSource = options.importSource || "nodomx";
    const className = options.className || createClassName(filename);
    const scopeId = options.scopeId || createScopeId(filename);
    const template = buildTemplate(descriptor, scopeId);
    const scriptCode = buildScript(descriptor.script);

    return [
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
}

export async function compileFile(inputFile, options = {}) {
    const resolvedInput = path.resolve(inputFile);
    const source = await fsp.readFile(resolvedInput, "utf8");
    const outputFile = resolveOutFile(resolvedInput, options);
    const importSource = await resolveImportSource(resolvedInput, options);
    const code = compileNd(source, {
        filename: resolvedInput,
        importSource,
        className: options.className,
        scopeId: options.scopeId
    });

    await fsp.mkdir(path.dirname(outputFile), { recursive: true });
    await fsp.writeFile(outputFile, code, "utf8");

    return {
        code,
        inputFile: resolvedInput,
        outputFile,
        importSource
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

export function defaultOutFile(inputFile, outputSuffix = DEFAULT_OUTPUT_SUFFIX) {
    const ext = path.extname(inputFile);
    const base = inputFile.slice(0, -ext.length);
    return `${base}${outputSuffix}`;
}

export async function inferImportSource(inputFile) {
    let current = path.dirname(path.resolve(inputFile));
    while (true) {
        const pkgFile = path.join(current, "package.json");
        try {
            const pkg = JSON.parse(await fsp.readFile(pkgFile, "utf8"));
            if (pkg.name === "nodomx" || pkg.name === "nodom3") {
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
                if (dependencySet?.nodom3) {
                    return "nodom3";
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

function buildScript(scriptBlock) {
    if (!scriptBlock?.content) {
        return "const __nd_component__ = {};";
    }
    if (scriptBlock.setup) {
        return buildScriptSetup(scriptBlock.content);
    }
    if (!/\bexport\s+default\b/.test(scriptBlock.content)) {
        throw new Error("The <script> block must contain `export default { ... }`.");
    }
    return scriptBlock.content.replace(/\bexport\s+default\b/, "const __nd_component__ =");
}

function buildScriptSetup(scriptContent) {
    const { body, imports } = extractImportStatements(scriptContent);
    const { body: setupBody, optionExpressions } = extractDefineOptions(body);
    const bindings = extractTopLevelBindings(setupBody);
    const parts = [];
    if (imports.length > 0) {
        parts.push(imports.join("\n"), "");
    }
    parts.push("const __nd_component__ = {");
    for (const expression of optionExpressions) {
        parts.push(`  ...(${expression}),`);
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
    const bodyStatements = [];
    for (const statement of splitTopLevelStatements(source)) {
        const trimmed = statement.trim();
        if (!trimmed) {
            continue;
        }
        const match = /^defineOptions\s*\(([\s\S]*)\)\s*;?$/.exec(trimmed);
        if (match) {
            optionExpressions.push(match[1].trim());
            continue;
        }
        bodyStatements.push(trimmed);
    }
    return {
        body: bodyStatements.join("\n\n"),
        optionExpressions
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

function extractTopLevelBindings(source) {
    const names = [];
    for (const statement of splitTopLevelStatements(source)) {
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
    return css.replace(/(^|})\s*([^@}{][^{]+)\{/g, (full, brace, selector) => {
        const scopedSelector = selector
            .split(",")
            .map(item => `${selectorPrefix} ${item.trim()}`)
            .join(", ");
        return `${brace}\n${scopedSelector}{`;
    }).trim();
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

function createScopeId(filename) {
    const seed = path.basename(filename).toLowerCase();
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = ((hash << 5) - hash + seed.charCodeAt(i)) >>> 0;
    }
    return `nd-${hash.toString(16)}`;
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

async function removeCompiledOutput(inputFile, options) {
    const outFile = resolveOutFile(inputFile, options);
    await fsp.rm(outFile, { force: true });
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
