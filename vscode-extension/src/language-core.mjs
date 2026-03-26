const BLOCK_RE = /<(template|script|style)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
const IDENTIFIER_RE = /[A-Za-z_$][\w$]*/g;
const BUILTIN_IDENTIFIERS = new Set([
    "Date",
    "JSON",
    "Math",
    "Number",
    "Object",
    "String",
    "false",
    "null",
    "true",
    "undefined"
]);

export const ND_BLOCK_COMPLETIONS = [
    {
        label: "template",
        kind: "block",
        insertText: "<template>\n  $0\n</template>",
        insertTextFormat: "snippet",
        detail: "Root template block"
    },
    {
        label: "script",
        kind: "block",
        insertText: "<script>\nimport { useState } from \"nodomx\";\n\nexport default {\n  setup() {\n    const count = useState(0);\n\n    return {\n      count\n    };\n  }\n}\n</script>",
        insertTextFormat: "snippet",
        detail: "Component logic block"
    },
    {
        label: "script setup",
        kind: "block",
        insertText: "<script setup>\nimport { useState } from \"nodomx\";\n\nconst count = useState(0);\n</script>",
        insertTextFormat: "snippet",
        detail: "Composition sugar block"
    },
    {
        label: "style",
        kind: "block",
        insertText: "<style>\n$0\n</style>",
        insertTextFormat: "snippet",
        detail: "Style block"
    },
    {
        label: "style scoped",
        kind: "block",
        insertText: "<style scoped>\n$0\n</style>",
        insertTextFormat: "snippet",
        detail: "Scoped style block"
    }
];

export const ND_TEMPLATE_COMPLETIONS = [
    { label: "x-module", kind: "directive", detail: "Mount child module" },
    { label: "x-model", kind: "directive", detail: "Switch model scope" },
    { label: "x-repeat", kind: "directive", detail: "Repeat a list" },
    { label: "x-recur", kind: "directive", detail: "Recursive template" },
    { label: "x-if", kind: "directive", detail: "Conditional render" },
    { label: "x-elseif", kind: "directive", detail: "Conditional branch" },
    { label: "x-else", kind: "directive", detail: "Fallback branch" },
    { label: "x-endif", kind: "directive", detail: "Close conditional chain" },
    { label: "x-show", kind: "directive", detail: "Toggle display" },
    { label: "x-field", kind: "directive", detail: "Two-way field binding" },
    { label: "x-route", kind: "directive", detail: "Route trigger" },
    { label: "x-router", kind: "directive", detail: "Router outlet" },
    { label: "x-slot", kind: "directive", detail: "Named slot" },
    { label: "e-click", kind: "event", detail: "Click event binding" },
    { label: "e-change", kind: "event", detail: "Change event binding" },
    { label: "e-input", kind: "event", detail: "Input event binding" },
    { label: "e-blur", kind: "event", detail: "Blur event binding" },
    { label: "e-focus", kind: "event", detail: "Focus event binding" },
    { label: "e-keyup", kind: "event", detail: "Keyboard event binding" }
];

export const ND_SCRIPT_COMPLETIONS = [
    { label: "useState", kind: "api", detail: "Create a ref-like state value" },
    { label: "useReactive", kind: "api", detail: "Create a reactive object" },
    { label: "useComputed", kind: "api", detail: "Create a computed state" },
    { label: "useWatch", kind: "api", detail: "Watch a source and react to changes" },
    { label: "useWatchEffect", kind: "api", detail: "Run an effect with auto dependency tracking" },
    { label: "defineProps", kind: "api", detail: "Read current component props inside script setup" },
    { label: "defineOptions", kind: "api", detail: "Declare component options inside script setup" },
    { label: "withDefaults", kind: "api", detail: "Apply defaults to props returned by defineProps" },
    { label: "provide", kind: "api", detail: "Provide a dependency for descendant modules" },
    { label: "inject", kind: "api", detail: "Inject a dependency from an ancestor or app context" },
    { label: "useApp", kind: "api", detail: "Access the current app instance inside setup" },
    { label: "useRoute", kind: "api", detail: "Read the current route payload from the module model" },
    { label: "useRouter", kind: "api", detail: "Access the active router plugin instance" },
    { label: "onInit", kind: "api", detail: "Register a setup initialization hook" },
    { label: "onBeforeMount", kind: "api", detail: "Register a before-mount hook" },
    { label: "onMounted", kind: "api", detail: "Register a composition lifecycle hook" },
    { label: "onBeforeUpdate", kind: "api", detail: "Register a before-update hook" },
    { label: "onUpdated", kind: "api", detail: "Register an update lifecycle hook" },
    { label: "onBeforeUnmount", kind: "api", detail: "Register a before-unmount hook" },
    { label: "onUnmounted", kind: "api", detail: "Register an unmount lifecycle hook" },
    { label: "nextTick", kind: "api", detail: "Flush pending renders in the next microtask" }
];

export function analyzeNdDocument(document) {
    const text = document.getText();
    const descriptor = parseNdDocument(text, document.uri);
    const scriptAnalysis = descriptor.script ? analyzeScriptBlock(document, descriptor.script) : createEmptyScriptAnalysis();
    const diagnostics = [
        ...descriptor.errors,
        ...collectReferenceDiagnostics(document, descriptor, scriptAnalysis)
    ];

    return {
        descriptor,
        diagnostics,
        scriptAnalysis
    };
}

export function getNdCompletions(document, position) {
    const analysis = analyzeNdDocument(document);
    const offset = document.offsetAt(position);
    const block = getBlockAtOffset(analysis.descriptor, offset);

    if (!block) {
        return ND_BLOCK_COMPLETIONS;
    }
    if (block.type === "script") {
        return ND_SCRIPT_COMPLETIONS;
    }
    if (block.type === "template") {
        return [
            ...Array.from(analysis.scriptAnalysis.exposedSymbols.values()).map(symbol => ({
                label: symbol.name,
                kind: symbol.kind,
                detail: symbol.detail
            })),
            ...ND_TEMPLATE_COMPLETIONS
        ];
    }
    return [];
}

export function getNdDefinition(document, position) {
    const analysis = analyzeNdDocument(document);
    const offset = document.offsetAt(position);
    const block = getBlockAtOffset(analysis.descriptor, offset);
    if (!block) {
        return null;
    }

    const token = readIdentifierAt(document.getText(), offset);
    if (!token) {
        return null;
    }

    const symbol = analysis.scriptAnalysis.exposedSymbols.get(token.text);
    if (!symbol?.range) {
        return null;
    }

    return {
        uri: document.uri,
        range: symbol.range
    };
}

export function parseNdDocument(text, uri = "anonymous.nd") {
    const descriptor = {
        uri,
        blocks: [],
        errors: [],
        script: null,
        styles: [],
        template: null
    };

    for (const match of text.matchAll(BLOCK_RE)) {
        const [fullMatch, type, attrs = "", content = ""] = match;
        const start = match.index || 0;
        const openTagLength = fullMatch.indexOf(">") + 1;
        const contentStart = start + openTagLength;
        const contentEnd = contentStart + content.length;
        const end = start + fullMatch.length;
        const block = {
            attrs,
            content,
            contentEnd,
            contentStart,
            end,
            scoped: type === "style" && /\bscoped\b/i.test(attrs),
            setup: type === "script" && /\bsetup\b/i.test(attrs),
            start,
            type
        };

        descriptor.blocks.push(block);

        if (type === "template") {
            if (descriptor.template) {
                descriptor.errors.push(errorForRange(text, start, end, "Only one <template> block is allowed.", "error"));
            } else {
                descriptor.template = block;
            }
        } else if (type === "script") {
            if (descriptor.script) {
                descriptor.errors.push(errorForRange(text, start, end, "Only one <script> block is allowed.", "error"));
            } else {
                descriptor.script = block;
            }
        } else if (type === "style") {
            descriptor.styles.push(block);
        }
    }

    if (!descriptor.template) {
        descriptor.errors.push(errorForRange(text, 0, 0, "Missing <template> block.", "error"));
    }

    if (descriptor.script && !descriptor.script.setup && !/\bexport\s+default\b/.test(descriptor.script.content)) {
        descriptor.errors.push(errorForRange(text, descriptor.script.start, descriptor.script.end, "The <script> block must contain `export default { ... }`.", "error"));
    }

    return descriptor;
}

function analyzeScriptBlock(document, scriptBlock) {
    if (scriptBlock.setup) {
        return analyzeScriptSetupBlock(document, scriptBlock);
    }
    const content = scriptBlock.content;
    const contentStart = scriptBlock.contentStart;
    const setupBodyRange = findFunctionBody(content, /\bsetup\s*\([^)]*\)\s*\{/g);
    if (!setupBodyRange) {
        return createEmptyScriptAnalysis();
    }

    const setupBody = content.slice(setupBodyRange.bodyStart, setupBodyRange.bodyEnd);
    const setupBodyOffset = contentStart + setupBodyRange.bodyStart;
    const declarations = extractDeclarations(document, setupBody, setupBodyOffset);
    const exposedSymbols = extractReturnedSymbols(document, setupBody, setupBodyOffset, declarations);

    return {
        declarations,
        exposedSymbols
    };
}

function analyzeScriptSetupBlock(document, scriptBlock) {
    const declarations = new Map();
    const statements = splitTopLevelStatements(scriptBlock.content);
    let offset = scriptBlock.contentStart;
    for (const statement of statements) {
        const localDeclarations = extractDeclarations(document, statement, offset);
        for (const [name, declaration] of localDeclarations.entries()) {
            declarations.set(name, declaration);
        }
        offset += statement.length;
    }
    return {
        declarations,
        exposedSymbols: declarations
    };
}

function extractDeclarations(document, source, baseOffset) {
    const declarations = new Map();
    const declarationRe = /\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g;

    for (const match of source.matchAll(declarationRe)) {
        const name = match[1];
        const offset = baseOffset + (match.index || 0) + match[0].lastIndexOf(name);
        declarations.set(name, {
            detail: "setup() local binding",
            kind: /\bfunction\b/.test(match[0]) ? "function" : "variable",
            name,
            range: rangeFromOffsets(document, offset, offset + name.length)
        });
    }

    return declarations;
}

function extractReturnedSymbols(document, source, baseOffset, declarations) {
    const symbols = new Map();
    const returnObject = findReturnObject(source);
    if (!returnObject) {
        return symbols;
    }

    const entries = splitTopLevelEntries(returnObject.body);
    for (const entry of entries) {
        const raw = entry.text.trim();
        if (!raw) {
            continue;
        }

        const methodMatch = /^([A-Za-z_$][\w$]*)\s*\(/.exec(raw);
        const aliasMatch = /^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/.exec(raw);
        const propMatch = /^([A-Za-z_$][\w$]*)\s*:/.exec(raw);
        const shortHandMatch = /^([A-Za-z_$][\w$]*)$/.exec(raw);
        let exposedName;
        let targetName;

        if (methodMatch) {
            exposedName = methodMatch[1];
            targetName = exposedName;
        } else if (aliasMatch) {
            exposedName = aliasMatch[1];
            targetName = aliasMatch[2];
        } else if (propMatch) {
            exposedName = propMatch[1];
            targetName = exposedName;
        } else if (shortHandMatch) {
            exposedName = shortHandMatch[1];
            targetName = exposedName;
        } else {
            continue;
        }

        const entryOffset = baseOffset + returnObject.bodyStart + entry.start + raw.indexOf(exposedName);
        const declaration = declarations.get(targetName);
        const range = declaration?.range || rangeFromOffsets(document, entryOffset, entryOffset + exposedName.length);

        symbols.set(exposedName, {
            detail: declaration?.detail || "Exposed from setup()",
            kind: declaration?.kind || (methodMatch ? "function" : "variable"),
            name: exposedName,
            range
        });
    }

    return symbols;
}

function collectReferenceDiagnostics(document, descriptor, scriptAnalysis) {
    if (!descriptor.template) {
        return [];
    }

    const diagnostics = [];
    const references = collectSimpleTemplateReferences(descriptor.template);
    for (const reference of references) {
        if (BUILTIN_IDENTIFIERS.has(reference.name) || scriptAnalysis.exposedSymbols.has(reference.name)) {
            continue;
        }
        diagnostics.push({
            message: `Unknown template symbol \`${reference.name}\`. Return it from setup() to make it available in the template.`,
            range: rangeFromOffsets(document, reference.offset, reference.offset + reference.name.length),
            severity: "warning"
        });
    }

    return diagnostics;
}

function collectSimpleTemplateReferences(templateBlock) {
    const references = [];
    const content = templateBlock.content;

    for (const match of content.matchAll(/\{\{\s*([A-Za-z_$][\w$]*)(?:\.[A-Za-z_$][\w$]*)*\s*\}\}/g)) {
        const identifier = match[1];
        const full = match[0];
        const referenceOffset = templateBlock.contentStart + (match.index || 0) + full.indexOf(identifier);
        references.push({
            name: identifier,
            offset: referenceOffset
        });
    }

    for (const match of content.matchAll(/\b(?:e|x)-[\w-]+\s*=\s*(["'])(.*?)\1/g)) {
        const expression = match[2].trim();
        const nameMatch = /^([A-Za-z_$][\w$]*)(?:\s*\(|(?:\.[A-Za-z_$][\w$]*)*$)/.exec(expression);
        if (!nameMatch) {
            continue;
        }
        const identifier = nameMatch[1];
        const referenceOffset = templateBlock.contentStart + (match.index || 0) + match[0].indexOf(identifier);
        references.push({
            name: identifier,
            offset: referenceOffset
        });
    }

    return references;
}

function getBlockAtOffset(descriptor, offset) {
    return descriptor.blocks.find(block => offset >= block.start && offset <= block.end) || null;
}

function readIdentifierAt(text, offset) {
    const start = readIdentifierStart(text, offset);
    const end = readIdentifierEnd(text, offset);
    if (start === end) {
        return null;
    }
    return {
        end,
        start,
        text: text.slice(start, end)
    };
}

function readIdentifierStart(text, offset) {
    let cursor = Math.max(0, Math.min(offset, text.length));
    if (!isIdentifierChar(text[cursor]) && isIdentifierChar(text[cursor - 1])) {
        cursor -= 1;
    }
    while (cursor > 0 && isIdentifierChar(text[cursor - 1])) {
        cursor -= 1;
    }
    return cursor;
}

function readIdentifierEnd(text, offset) {
    let cursor = Math.max(0, Math.min(offset, text.length));
    if (!isIdentifierChar(text[cursor]) && isIdentifierChar(text[cursor - 1])) {
        cursor -= 1;
    }
    while (cursor < text.length && isIdentifierChar(text[cursor])) {
        cursor += 1;
    }
    return cursor;
}

function isIdentifierChar(char) {
    return typeof char === "string" && /[A-Za-z0-9_$]/.test(char);
}

function createEmptyScriptAnalysis() {
    return {
        declarations: new Map(),
        exposedSymbols: new Map()
    };
}

function findFunctionBody(source, pattern) {
    const match = pattern.exec(source);
    if (!match) {
        return null;
    }

    const openBrace = source.indexOf("{", (match.index || 0) + match[0].length - 1);
    if (openBrace < 0) {
        return null;
    }

    const closeBrace = findMatchingBrace(source, openBrace);
    if (closeBrace < 0) {
        return null;
    }

    return {
        bodyEnd: closeBrace,
        bodyStart: openBrace + 1,
        closeBrace,
        openBrace
    };
}

function findReturnObject(source) {
    for (const match of source.matchAll(/\breturn\s*\{/g)) {
        const start = source.indexOf("{", match.index || 0);
        if (start < 0) {
            continue;
        }
        const end = findMatchingBrace(source, start);
        if (end < 0) {
            continue;
        }
        return {
            body: source.slice(start + 1, end),
            bodyEnd: end,
            bodyStart: start + 1
        };
    }
    return null;
}

function splitTopLevelEntries(source) {
    const entries = [];
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

        if (char === "," && depth === 0) {
            entries.push({
                start,
                text: source.slice(start, index)
            });
            start = index + 1;
        }
    }

    if (start <= source.length) {
        entries.push({
            start,
            text: source.slice(start)
        });
    }

    return entries;
}

function findMatchingBrace(source, openIndex) {
    let depth = 0;
    let quote = null;

    for (let index = openIndex; index < source.length; index++) {
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
                return -1;
            }
            continue;
        }

        if (char === "/" && next === "*") {
            const commentEnd = source.indexOf("*/", index + 2);
            if (commentEnd < 0) {
                return -1;
            }
            index = commentEnd + 1;
            continue;
        }

        if (char === "{") {
            depth += 1;
        } else if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }

    return -1;
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

function errorForRange(text, start, end, message, severity) {
    return {
        message,
        range: rangeFromOffsets({
            getText() {
                return text;
            },
            positionAt(offset) {
                return positionAt(text, offset);
            }
        }, start, end),
        severity
    };
}

function rangeFromOffsets(document, start, end) {
    return {
        end: document.positionAt(end),
        start: document.positionAt(start)
    };
}

function positionAt(text, offset) {
    const safeOffset = Math.max(0, Math.min(offset, text.length));
    const before = text.slice(0, safeOffset);
    const lines = before.split(/\r?\n/);
    return {
        character: lines[lines.length - 1].length,
        line: lines.length - 1
    };
}
