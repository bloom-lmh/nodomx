import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractNdTypeSurface } from "@nodomx/nd-compiler";

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

const BUILTIN_TEMPLATE_ELEMENTS = new Set([
    "else",
    "elseif",
    "endif",
    "for",
    "if",
    "keepalive",
    "module",
    "recur",
    "route",
    "router",
    "show",
    "slot",
    "suspense",
    "transition",
    "transitiongroup",
    "teleport"
]);

const COMPONENT_CONTRACT_CACHE = new Map();
const FALLTHROUGH_COMPONENT_ATTRIBUTES = new Set([
    "class",
    "id",
    "key",
    "ref",
    "style"
]);

const HTML_TAGS = [
    "a",
    "article",
    "aside",
    "button",
    "div",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "img",
    "input",
    "label",
    "li",
    "main",
    "nav",
    "ol",
    "option",
    "p",
    "section",
    "select",
    "span",
    "strong",
    "table",
    "tbody",
    "td",
    "textarea",
    "th",
    "thead",
    "tr",
    "ul"
];

const HTML_VOID_TAGS = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr"
]);

const HTML_ATTRIBUTES = [
    { label: "class", detail: "HTML class attribute" },
    { label: "id", detail: "HTML id attribute" },
    { label: "style", detail: "Inline style attribute" },
    { label: "title", detail: "Tooltip text attribute" },
    { label: "href", detail: "Link target attribute" },
    { label: "src", detail: "Asset source attribute" },
    { label: "alt", detail: "Alternative text attribute" },
    { label: "type", detail: "Input/button type attribute" },
    { label: "name", detail: "Form field name attribute" },
    { label: "value", detail: "Form field value attribute" },
    { label: "placeholder", detail: "Placeholder attribute" },
    { label: "disabled", detail: "Disable an element" },
    { label: "checked", detail: "Checked state attribute" },
    { label: "selected", detail: "Selected option attribute" },
    { label: "for", detail: "Label target attribute" },
    { label: "target", detail: "Link target window attribute" },
    { label: "rel", detail: "Relationship attribute" }
];

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
    { label: "KeepAlive", kind: "component", detail: "Cache a child module instance across conditional unmounts" },
    { label: "Suspense", kind: "component", detail: "Coordinate async descendants with fallback content and delayed reveal" },
    { label: "Transition", kind: "component", detail: "Apply enter and leave transition classes to a conditional subtree" },
    { label: "TransitionGroup", kind: "component", detail: "Apply enter and leave transitions to keyed list children" },
    { label: "Teleport", kind: "component", detail: "Render slot content into another DOM target" },
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
    { label: "defineAsyncComponent", kind: "api", detail: "Load a component lazily with loading and error fallbacks" },
    { label: "useState", kind: "api", detail: "Create a ref-like state value" },
    { label: "useReactive", kind: "api", detail: "Create a reactive object" },
    { label: "useComputed", kind: "api", detail: "Create a computed state" },
    { label: "useWatch", kind: "api", detail: "Watch a source and react to changes" },
    { label: "useWatchEffect", kind: "api", detail: "Run an effect with auto dependency tracking" },
    { label: "defineModel", kind: "api", detail: "Create a two-way binding model inside script setup" },
    { label: "defineProps", kind: "api", detail: "Read current component props inside script setup" },
    { label: "defineEmits", kind: "api", detail: "Declare component events and return an emit function" },
    { label: "defineExpose", kind: "api", detail: "Declare an exposed component surface" },
    { label: "defineSlots", kind: "api", detail: "Access slot bindings inside script setup" },
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
    { label: "onActivated", kind: "api", detail: "Register a hook fired when a KeepAlive-managed component becomes active" },
    { label: "onDeactivated", kind: "api", detail: "Register a hook fired when a KeepAlive-managed component is cached and removed from the DOM" },
    { label: "onBeforeEnter", kind: "api", detail: "Register a transition before-enter hook" },
    { label: "onEnter", kind: "api", detail: "Register a transition enter hook after enter classes switch" },
    { label: "onAfterEnter", kind: "api", detail: "Register a transition after-enter hook" },
    { label: "onEnterCancelled", kind: "api", detail: "Register a transition enter-cancelled hook" },
    { label: "onBeforeLeave", kind: "api", detail: "Register a transition before-leave hook" },
    { label: "onLeave", kind: "api", detail: "Register a transition leave hook after leave classes switch" },
    { label: "onAfterLeave", kind: "api", detail: "Register a transition after-leave hook" },
    { label: "onLeaveCancelled", kind: "api", detail: "Register a transition leave-cancelled hook" },
    { label: "onBeforeMove", kind: "api", detail: "Register a transition-group before-move hook" },
    { label: "onMove", kind: "api", detail: "Register a transition-group move hook while move classes are active" },
    { label: "onAfterMove", kind: "api", detail: "Register a transition-group after-move hook" },
    { label: "onMoveCancelled", kind: "api", detail: "Register a transition-group move-cancelled hook" },
    { label: "onSuspensePending", kind: "api", detail: "Register a hook fired when Suspense starts tracking pending async descendants" },
    { label: "onSuspenseFallback", kind: "api", detail: "Register a hook fired when Suspense reveals fallback content" },
    { label: "onSuspenseResolve", kind: "api", detail: "Register a hook fired when Suspense resolves after a pending or error state" },
    { label: "onSuspenseError", kind: "api", detail: "Register a hook fired when a tracked async descendant fails inside Suspense" },
    { label: "onSuspenseRetry", kind: "api", detail: "Register a hook fired when Suspense retries failed async descendants after `retry-key` changes" },
    { label: "nextTick", kind: "api", detail: "Flush pending renders in the next microtask" }
];

const ND_SCRIPT_DOCS = new Map(ND_SCRIPT_COMPLETIONS.map(item => [
    item.label,
    `**${item.label}**\n\n${item.detail}`
]));

const ND_TEMPLATE_DOCS = new Map([
    [
        "KeepAlive",
        "**KeepAlive**\n\nCache a child module instance when it is removed from the render tree, so local state survives hide/show toggles. Supports `include`, `exclude`, and `max` cache policies."
    ],
    [
        "Suspense",
        "**Suspense**\n\nTrack async descendants rendered through the default slot and reveal fallback or error content while they are pending or failed. Supports delayed fallback display with `timeout`, plus `fallback` / `error` attributes or named slots. Bind `retry-key` to a changing value when you want to retry failed async descendants. Use `branch-transition` together with `transition-*` attributes when fallback and error branches should enter and leave through the built-in transition pipeline. `fallback` / `error` slot blocks can read boundary fields such as `phase`, `pendingCount`, `retryKey`, and `errorMessage`."
    ],
    [
        "Teleport",
        "**Teleport**\n\nRender slot content into another DOM target. Use `to` to point at a selector like `#modal-root`, and set `disabled` to render in place."
    ],
    [
        "Transition",
        "**Transition**\n\nWrap a conditional subtree and let NodomX apply enter/leave classes such as `fade-enter-from` and `fade-leave-to`."
    ],
    [
        "TransitionGroup",
        "**TransitionGroup**\n\nApply enter, leave, and move transition classes to each keyed direct child in a list or multi-child group."
    ],
    [
        "slot",
        "**slot**\n\nDeclare a named slot outlet. Use `name` to target a non-default slot, or `innerRender` to render slot content with the child model scope."
    ],
    [
        "route",
        "**route**\n\nCreate a route link element. Use `path` to point at a router location and `active` to bind the active-state field."
    ],
    [
        "router",
        "**router**\n\nRender the active route outlet inside the current module."
    ],
    [
        "module",
        "**module**\n\nMount a child module or registered component inside the current template scope."
    ]
]);

const SUSPENSE_SLOT_SCOPE_SYMBOLS = new Map([
    [
        "phase",
        {
            defaultLibrary: true,
            detail: "Suspense slot scope field describing the current boundary phase: `idle`, `pending`, `fallback`, `resolved`, or `error`.",
            kind: "variable",
            name: "phase"
        }
    ],
    [
        "pendingCount",
        {
            defaultLibrary: true,
            detail: "Suspense slot scope field describing how many async descendants are still pending inside the current boundary.",
            kind: "variable",
            name: "pendingCount"
        }
    ],
    [
        "retryKey",
        {
            defaultLibrary: true,
            detail: "Suspense slot scope field with the last normalized `retry-key` value observed by the boundary.",
            kind: "variable",
            name: "retryKey"
        }
    ],
    [
        "errorMessage",
        {
            defaultLibrary: true,
            detail: "Suspense slot scope field with the latest error message captured from a failed async descendant.",
            kind: "variable",
            name: "errorMessage"
        }
    ],
    [
        "fallbackText",
        {
            defaultLibrary: true,
            detail: "Suspense slot scope field with the fallback text that would be rendered when no `fallback` slot is provided.",
            kind: "variable",
            name: "fallbackText"
        }
    ],
    [
        "errorText",
        {
            defaultLibrary: true,
            detail: "Suspense slot scope field with the error text that would be rendered when no `error` slot is provided.",
            kind: "variable",
            name: "errorText"
        }
    ],
    [
        "showFallback",
        {
            defaultLibrary: true,
            detail: "Suspense slot scope flag indicating whether the fallback branch is currently visible.",
            kind: "variable",
            name: "showFallback"
        }
    ],
    [
        "showError",
        {
            defaultLibrary: true,
            detail: "Suspense slot scope flag indicating whether the error branch is currently visible.",
            kind: "variable",
            name: "showError"
        }
    ]
]);

const SUSPENSE_SLOT_SCOPE_COMPLETIONS = Array.from(SUSPENSE_SLOT_SCOPE_SYMBOLS.values()).map(symbol => ({
    detail: symbol.detail,
    kind: symbol.kind,
    label: symbol.name
}));

const KEEPALIVE_ATTRIBUTE_COMPLETIONS = [
    {
        label: "disabled",
        detail: "Disable caching and let the child unmount normally",
        kind: "html-attr",
        insertText: 'disabled="$1"',
        insertTextFormat: "snippet"
    },
    {
        label: "include",
        detail: "Only cache component names that match this string, csv list, or binding",
        kind: "html-attr",
        insertText: 'include="$1"',
        insertTextFormat: "snippet"
    },
    {
        label: "exclude",
        detail: "Exclude matching component names from caching",
        kind: "html-attr",
        insertText: 'exclude="$1"',
        insertTextFormat: "snippet"
    },
    {
        label: "max",
        detail: "Limit the number of cached child module instances",
        kind: "html-attr",
        insertText: 'max="$1"',
        insertTextFormat: "snippet"
    }
];

const SUSPENSE_ATTRIBUTE_COMPLETIONS = [
    {
        label: "fallback",
        detail: "Fallback text shown when no `fallback` named slot is provided",
        kind: "html-attr",
        insertText: 'fallback="$1"',
        insertTextFormat: "snippet"
    },
    {
        label: "error",
        detail: "Error text shown when no `error` named slot is provided",
        kind: "html-attr",
        insertText: 'error="$1"',
        insertTextFormat: "snippet"
    },
    {
        label: "timeout",
        detail: "Delay fallback visibility by this many milliseconds",
        kind: "html-attr",
        insertText: 'timeout="$1"',
        insertTextFormat: "snippet"
    },
    {
        label: "retry-key",
        detail: "Retry failed async descendants when this bound value changes",
        kind: "html-attr",
        insertText: 'retry-key={{$1:retryToken}}',
        insertTextFormat: "snippet"
    }
];

const TELEPORT_ATTRIBUTE_COMPLETIONS = [
    {
        label: "to",
        detail: "Teleport target selector or element binding",
        kind: "html-attr",
        insertText: 'to="$1"',
        insertTextFormat: "snippet"
    },
    {
        label: "target",
        detail: "Alias for the teleport target selector",
        kind: "html-attr",
        insertText: 'target="$1"',
        insertTextFormat: "snippet"
    },
    {
        label: "disabled",
        detail: "Render in place instead of moving into the target",
        kind: "html-attr",
        insertText: 'disabled="$1"',
        insertTextFormat: "snippet"
    }
];

const TRANSITION_ATTRIBUTE_COMPLETIONS = [
    {
        label: "name",
        detail: "Transition class prefix like `fade` or `slide`",
        kind: "html-attr",
        insertText: 'name="$1"',
        insertTextFormat: "snippet"
    },
    {
        label: "duration",
        detail: "Shared enter/leave duration in milliseconds",
        kind: "html-attr",
        insertText: 'duration="$1"',
        insertTextFormat: "snippet"
    },
    {
        label: "enter-duration",
        detail: "Enter duration in milliseconds",
        kind: "html-attr",
        insertText: 'enter-duration="$1"',
        insertTextFormat: "snippet"
    },
    {
        label: "leave-duration",
        detail: "Leave duration in milliseconds",
        kind: "html-attr",
        insertText: 'leave-duration="$1"',
        insertTextFormat: "snippet"
    },
    {
        label: "enter-from-class",
        detail: "Custom class applied before enter starts",
        kind: "html-attr",
        insertText: 'enter-from-class="$1"',
        insertTextFormat: "snippet"
    },
    {
        label: "enter-active-class",
        detail: "Custom active enter class",
        kind: "html-attr",
        insertText: 'enter-active-class="$1"',
        insertTextFormat: "snippet"
    },
    {
        label: "enter-to-class",
        detail: "Custom class applied after the enter frame",
        kind: "html-attr",
        insertText: 'enter-to-class="$1"',
        insertTextFormat: "snippet"
    },
    {
        label: "leave-from-class",
        detail: "Custom class applied before leave starts",
        kind: "html-attr",
        insertText: 'leave-from-class="$1"',
        insertTextFormat: "snippet"
    },
    {
        label: "leave-active-class",
        detail: "Custom active leave class",
        kind: "html-attr",
        insertText: 'leave-active-class="$1"',
        insertTextFormat: "snippet"
    },
    {
        label: "leave-to-class",
        detail: "Custom class applied before the node is removed",
        kind: "html-attr",
        insertText: 'leave-to-class="$1"',
        insertTextFormat: "snippet"
    },
    {
        label: "move-class",
        detail: "Custom class applied while a TransitionGroup child is moving",
        kind: "html-attr",
        insertText: 'move-class="$1"',
        insertTextFormat: "snippet"
    },
    {
        label: "move-duration",
        detail: "Move duration in milliseconds for TransitionGroup children",
        kind: "html-attr",
        insertText: 'move-duration="$1"',
        insertTextFormat: "snippet"
    }
];

const SUSPENSE_BRANCH_TRANSITION_ATTRIBUTE_COMPLETIONS = [
    {
        label: "branch-transition",
        detail: "Enable built-in transition handling for fallback and error branches",
        kind: "html-attr",
        insertText: "branch-transition",
        insertTextFormat: "plain"
    },
    ...TRANSITION_ATTRIBUTE_COMPLETIONS
        .filter(item => item.label !== "move-class" && item.label !== "move-duration")
        .map(item => ({
            ...item,
            detail: item.detail.replace(/^Transition/, "Suspense branch transition"),
            insertText: item.insertText.replace(/^([a-z-]+)/, "transition-$1"),
            label: `transition-${item.label}`
        }))
];

const HTML_TAG_COMPLETIONS = HTML_TAGS.map(tag => ({
    label: tag,
    kind: "html-tag",
    detail: "HTML element",
    insertText: tag
}));

const HTML_ATTRIBUTE_COMPLETIONS = HTML_ATTRIBUTES.map(attribute => ({
    ...attribute,
    kind: "html-attr",
    insertText: `${attribute.label}="$1"`,
    insertTextFormat: "snippet"
}));

const BUILTIN_TEMPLATE_COMPONENTS = new Map([
    [
        "keepalive",
        {
            detail: "Built-in NodomX keep-alive component",
            kind: "component",
            label: "KeepAlive",
            name: "KeepAlive",
            insertText: "KeepAlive"
        }
    ],
    [
        "suspense",
        {
            detail: "Built-in NodomX suspense component",
            kind: "component",
            label: "Suspense",
            name: "Suspense",
            insertText: "Suspense"
        }
    ],
    [
        "transition",
        {
            detail: "Built-in NodomX transition component",
            kind: "component",
            label: "Transition",
            name: "Transition",
            insertText: "Transition"
        }
    ],
    [
        "transitiongroup",
        {
            detail: "Built-in NodomX transition-group component",
            kind: "component",
            label: "TransitionGroup",
            name: "TransitionGroup",
            insertText: "TransitionGroup"
        }
    ],
    [
        "teleport",
        {
            detail: "Built-in NodomX teleport component",
            kind: "component",
            label: "Teleport",
            name: "Teleport",
            insertText: "Teleport"
        }
    ]
]);

export function analyzeNdDocument(document) {
    const text = document.getText();
    const descriptor = parseNdDocument(text, document.uri);
    const scriptAnalysis = descriptor.script ? analyzeScriptBlock(document, descriptor.script) : createEmptyScriptAnalysis();
    scriptAnalysis.componentContract = buildComponentContractFromDescriptor(descriptor, document);
    const templateAnalysis = descriptor.template
        ? analyzeTemplateBlock(document, descriptor.template, scriptAnalysis)
        : createEmptyTemplateAnalysis();
    const diagnostics = [
        ...descriptor.errors,
        ...collectReferenceDiagnostics(document, descriptor, scriptAnalysis, templateAnalysis),
        ...templateAnalysis.diagnostics,
        ...collectCompilerTemplateDiagnostics(document, text)
    ];

    return {
        descriptor,
        diagnostics: dedupeDiagnostics(diagnostics),
        scriptAnalysis,
        templateAnalysis
    };
}

function createEmptyComponentContract() {
    return {
        emits: new Map(),
        props: new Map(),
        slots: new Map()
    };
}

function buildComponentContractFromDescriptor(descriptor, document = createTextBufferDocumentLike(descriptor?.uri || "anonymous.nd", "")) {
    const contract = createEmptyComponentContract();
    if (descriptor?.script) {
        collectScriptComponentContract(document, descriptor.script, contract);
    }
    if (descriptor?.template) {
        collectTemplateSlotContract(document, descriptor.template, contract);
    }
    const source = typeof document?.getText === "function" ? document.getText() : "";
    mergeComponentContractTypeSurface(contract, readCompilerTypeSurface(source, {
        componentContractCheck: false,
        uri: descriptor?.uri || document?.uri || "anonymous.nd"
    }));
    hydrateMissingComponentContractRanges(contract, descriptor, document);
    return contract;
}

function collectScriptComponentContract(document, scriptBlock, contract) {
    if (!scriptBlock?.content) {
        return;
    }
    if (scriptBlock.setup) {
        collectScriptSetupPropsContract(document, scriptBlock, contract);
        collectScriptSetupModelContract(document, scriptBlock, contract);
        collectScriptSetupEmitsContract(document, scriptBlock, contract);
        collectScriptSetupSlotsContract(document, scriptBlock, contract);
        return;
    }
    collectOptionsPropsContract(document, scriptBlock, contract);
}

function collectScriptSetupPropsContract(document, scriptBlock, contract) {
    const source = scriptBlock.content;
    for (const call of findMacroCalls(source, "defineProps")) {
        const firstArg = getFirstCallEntry(call.argumentsText);
        if (firstArg.text && firstArg.text.trim().startsWith("{")) {
            for (const key of collectContractObjectEntries(firstArg.text)) {
                recordPropContractName(contract, key.name, "defineProps", {
                    range: rangeFromOffsets(
                        document,
                        scriptBlock.contentStart + call.openParen + 1 + firstArg.start + key.start,
                        scriptBlock.contentStart + call.openParen + 1 + firstArg.start + key.end
                    ),
                    uri: document.uri
                });
            }
        }
    }

    for (const statement of splitTopLevelStatements(source)) {
        const trimmed = statement.trim();
        if (!trimmed) {
            continue;
        }
        const bindingName = extractStatementBindingName(trimmed);
        if (!bindingName) {
            continue;
        }
        if (!/\bdefineProps\s*\(/.test(trimmed) && !/\bwithDefaults\s*\(\s*defineProps\s*\(/.test(trimmed)) {
            continue;
        }
        const memberPattern = new RegExp(`\\b${escapeRegExp(bindingName)}\\s*\\.\\s*([A-Za-z_$][\\w$]*)`, "g");
        for (const match of source.matchAll(memberPattern)) {
            recordPropContractName(contract, match[1], "defineProps", {
                range: rangeFromOffsets(
                    document,
                    scriptBlock.contentStart + (match.index || 0) + match[0].lastIndexOf(match[1]),
                    scriptBlock.contentStart + (match.index || 0) + match[0].lastIndexOf(match[1]) + match[1].length
                ),
                uri: document.uri
            });
        }
    }
}

function collectScriptSetupModelContract(document, scriptBlock, contract) {
    const source = scriptBlock.content;
    for (const call of findMacroCalls(source, "defineModel")) {
        const firstArg = getFirstCallEntry(call.argumentsText);
        const explicitName = parseQuotedStringLiteral(firstArg.text);
        const propName = explicitName || "modelValue";
        const explicitRange = explicitName
            ? rangeFromOffsets(
                document,
                scriptBlock.contentStart + call.openParen + 1 + firstArg.start,
                scriptBlock.contentStart + call.openParen + 1 + firstArg.start + firstArg.text.length
            )
            : rangeFromOffsets(
                document,
                scriptBlock.contentStart + call.start,
                scriptBlock.contentStart + call.start + "defineModel".length
            );
        recordPropContractName(contract, propName, "defineModel", {
            range: explicitRange,
            uri: document.uri
        });
        recordEmitContractName(contract, `update:${propName}`, "defineModel", {
            range: explicitRange,
            uri: document.uri
        });
    }
}

function collectScriptSetupEmitsContract(document, scriptBlock, contract) {
    const source = scriptBlock.content;
    for (const call of findMacroCalls(source, "defineEmits")) {
        const firstArg = getFirstCallEntry(call.argumentsText);
        if (!firstArg.text) {
            continue;
        }
        const trimmed = firstArg.text.trim();
        const stringLiteral = parseQuotedStringLiteral(trimmed);
        if (stringLiteral) {
            recordEmitContractName(contract, stringLiteral, "defineEmits", {
                range: rangeFromOffsets(
                    document,
                    scriptBlock.contentStart + call.openParen + 1 + firstArg.start,
                    scriptBlock.contentStart + call.openParen + 1 + firstArg.start + firstArg.text.length
                ),
                uri: document.uri
            });
            continue;
        }
        if (trimmed.startsWith("[")) {
            for (const eventName of collectContractArrayEntries(trimmed)) {
                recordEmitContractName(contract, eventName.name, "defineEmits", {
                    range: rangeFromOffsets(
                        document,
                        scriptBlock.contentStart + call.openParen + 1 + firstArg.start + eventName.start,
                        scriptBlock.contentStart + call.openParen + 1 + firstArg.start + eventName.end
                    ),
                    uri: document.uri
                });
            }
            continue;
        }
        if (trimmed.startsWith("{")) {
            for (const eventName of collectContractObjectEntries(trimmed)) {
                recordEmitContractName(contract, eventName.name, "defineEmits", {
                    range: rangeFromOffsets(
                        document,
                        scriptBlock.contentStart + call.openParen + 1 + firstArg.start + eventName.start,
                        scriptBlock.contentStart + call.openParen + 1 + firstArg.start + eventName.end
                    ),
                    uri: document.uri
                });
            }
        }
    }
}

function collectScriptSetupSlotsContract(document, scriptBlock, contract) {
    const source = scriptBlock.content;
    for (const call of findMacroCalls(source, "defineSlots")) {
        const firstArg = getFirstCallEntry(call.argumentsText);
        if (!firstArg.text) {
            continue;
        }
        const trimmed = firstArg.text.trim();
        const stringLiteral = parseQuotedStringLiteral(trimmed);
        if (stringLiteral) {
            recordSlotContractName(contract, stringLiteral, "defineSlots", {
                range: rangeFromOffsets(
                    document,
                    scriptBlock.contentStart + call.openParen + 1 + firstArg.start,
                    scriptBlock.contentStart + call.openParen + 1 + firstArg.start + firstArg.text.length
                ),
                uri: document.uri
            });
            continue;
        }
        if (trimmed.startsWith("[")) {
            for (const slotName of collectContractArrayEntries(trimmed)) {
                recordSlotContractName(contract, slotName.name, "defineSlots", {
                    range: rangeFromOffsets(
                        document,
                        scriptBlock.contentStart + call.openParen + 1 + firstArg.start + slotName.start,
                        scriptBlock.contentStart + call.openParen + 1 + firstArg.start + slotName.end
                    ),
                    uri: document.uri
                });
            }
            continue;
        }
        if (trimmed.startsWith("{")) {
            for (const slotName of collectContractObjectEntries(trimmed)) {
                recordSlotContractName(contract, slotName.name, "defineSlots", {
                    range: rangeFromOffsets(
                        document,
                        scriptBlock.contentStart + call.openParen + 1 + firstArg.start + slotName.start,
                        scriptBlock.contentStart + call.openParen + 1 + firstArg.start + slotName.end
                    ),
                    uri: document.uri
                });
            }
        }
    }
}

function collectOptionsPropsContract(document, scriptBlock, contract) {
    const source = scriptBlock.content;
    const setupSignature = /\bsetup\s*\(\s*([A-Za-z_$][\w$]*)/.exec(source);
    if (!setupSignature) {
        return;
    }
    const propsBinding = setupSignature[1];
    const setupBodyRange = findFunctionBody(source, /\bsetup\s*\([^)]*\)\s*\{/g);
    if (!setupBodyRange) {
        return;
    }
    const setupBody = source.slice(setupBodyRange.bodyStart, setupBodyRange.bodyEnd);
    const memberPattern = new RegExp(`\\b${escapeRegExp(propsBinding)}\\s*\\.\\s*([A-Za-z_$][\\w$]*)`, "g");
    for (const match of setupBody.matchAll(memberPattern)) {
        recordPropContractName(contract, match[1], "setup(props)", {
            range: rangeFromOffsets(
                document,
                scriptBlock.contentStart + setupBodyRange.bodyStart + (match.index || 0) + match[0].lastIndexOf(match[1]),
                scriptBlock.contentStart + setupBodyRange.bodyStart + (match.index || 0) + match[0].lastIndexOf(match[1]) + match[1].length
            ),
            uri: document.uri
        });
    }
}

function collectTemplateSlotContract(document, templateBlock, contract) {
    if (!templateBlock?.content) {
        return;
    }
    const slotRe = /<slot\b([^<>]*?)(\/?)>/gi;
    for (const match of templateBlock.content.matchAll(slotRe)) {
        const attrsSource = match[1] || "";
        const blockOffset = templateBlock.contentStart + (match.index || 0);
        const nameMatch = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|{{([\s\S]*?)}}|([^\s"'=<>`]+))/i.exec(attrsSource);
        const slotName = (nameMatch?.[1] ?? nameMatch?.[2] ?? nameMatch?.[4] ?? "").trim() || "default";
        if (!slotName || nameMatch?.[3]) {
            continue;
        }
        const nameRange = nameMatch
            ? rangeFromOffsets(
                document,
                blockOffset + match[0].indexOf(nameMatch[0]),
                blockOffset + match[0].indexOf(nameMatch[0]) + nameMatch[0].length
            )
            : rangeFromOffsets(
                document,
                blockOffset,
                blockOffset + match[0].length
            );
        recordSlotContractName(contract, slotName, "template", {
            range: nameRange,
            uri: document.uri
        });
    }
}

function recordPropContractName(contract, name, source, metadata = {}) {
    recordContractEntry(contract.props, name, normalizeContractPropName, source, metadata);
}

function recordEmitContractName(contract, name, source, metadata = {}) {
    recordContractEntry(contract.emits, name, normalizeContractEventName, source, metadata);
}

function recordSlotContractName(contract, name, source, metadata = {}) {
    recordContractEntry(contract.slots, name, normalizeContractSlotName, source, metadata);
}

function recordContractEntry(targetMap, name, normalizer, source, metadata = {}) {
    const normalized = normalizer(name);
    if (!normalized) {
        return;
    }
    const label = String(name || "").trim();
    if (targetMap.has(normalized)) {
        const existing = targetMap.get(normalized);
        if (!existing.range && metadata.range) {
            existing.range = metadata.range;
        }
        if (!existing.uri && metadata.uri) {
            existing.uri = metadata.uri;
        }
        if (!existing.typeText && metadata.typeText) {
            existing.typeText = metadata.typeText;
        }
        if (existing.optional !== false && metadata.optional === false) {
            existing.optional = false;
        }
        if (!existing.source && source) {
            existing.source = source;
        }
        return;
    }
    targetMap.set(normalized, {
        label,
        normalized,
        optional: metadata.optional !== false,
        range: metadata.range || null,
        source,
        typeText: metadata.typeText || "",
        uri: metadata.uri || null
    });
}

function findMacroCalls(source, calleeName) {
    const calls = [];
    const pattern = new RegExp(`\\b${calleeName}\\b`, "g");
    for (const match of source.matchAll(pattern)) {
        const callStart = match.index || 0;
        let cursor = callStart + match[0].length;
        while (/\s/.test(source[cursor] || "")) {
            cursor += 1;
        }
        let typeArgumentsStart = -1;
        let typeArgumentsEnd = -1;
        let typeArgumentsText = "";
        if (source[cursor] === "<") {
            typeArgumentsStart = cursor + 1;
            typeArgumentsEnd = findMatchingAngleBracket(source, cursor);
            if (typeArgumentsEnd < 0) {
                continue;
            }
            typeArgumentsText = source.slice(typeArgumentsStart, typeArgumentsEnd);
            cursor = typeArgumentsEnd + 1;
            while (/\s/.test(source[cursor] || "")) {
                cursor += 1;
            }
        }
        const openParen = source[cursor] === "(" ? cursor : -1;
        if (openParen < 0) {
            continue;
        }
        const closeParen = findMatchingParenthesis(source, openParen);
        if (closeParen < 0) {
            continue;
        }
        calls.push({
            argumentsText: source.slice(openParen + 1, closeParen),
            end: closeParen + 1,
            openParen,
            start: callStart,
            typeArgumentsEnd,
            typeArgumentsStart,
            typeArgumentsText
        });
    }
    return calls;
}

function getFirstCallEntry(argumentsText) {
    const entry = splitTopLevelEntries(argumentsText)
        .map(item => ({
            start: item.start,
            text: item.text.trim()
        }))
        .find(item => item.text);
    return entry || {
        start: 0,
        text: ""
    };
}

function collectContractArrayEntries(source) {
    return Array.from(source.matchAll(/["']([^"']+)["']/g), match => ({
        end: (match.index || 0) + match[0].length,
        name: match[1].trim(),
        start: match.index || 0
    })).filter(item => item.name);
}

function collectContractObjectEntries(source) {
    const trimmed = String(source || "").trim();
    const openBrace = trimmed.indexOf("{");
    const closeBrace = openBrace >= 0 ? findMatchingBrace(trimmed, openBrace) : -1;
    const body = openBrace >= 0 && closeBrace > openBrace
        ? trimmed.slice(openBrace + 1, closeBrace)
        : trimmed;
    const keys = [];
    for (const entry of splitTopLevelEntries(body)) {
        const raw = entry.text.trim();
        if (!raw || raw.startsWith("...")) {
            continue;
        }
        const quotedMatch = /^(["'])([^"']+)\1\s*:/.exec(raw);
        if (quotedMatch) {
            const rawOffset = entry.start + raw.indexOf(quotedMatch[0]);
            const keyOffset = rawOffset + quotedMatch[0].indexOf(quotedMatch[2]);
            keys.push({
                end: keyOffset + quotedMatch[2].length,
                name: quotedMatch[2],
                start: keyOffset
            });
            continue;
        }
        const methodMatch = /^([A-Za-z_$][\w$]*)\s*(?::|\()/.exec(raw);
        if (methodMatch) {
            const rawOffset = entry.start + raw.indexOf(methodMatch[0]);
            const keyOffset = rawOffset + methodMatch[0].indexOf(methodMatch[1]);
            keys.push({
                end: keyOffset + methodMatch[1].length,
                name: methodMatch[1],
                start: keyOffset
            });
        }
    }
    return keys;
}

function parseQuotedStringLiteral(source) {
    const match = /^\s*(["'])([\s\S]*?)\1\s*$/.exec(String(source || ""));
    return match ? match[2] : "";
}

function getComponentContractForNode(node, contractCache) {
    const targetUri = node?.componentSymbol?.targetUri || node?.importedComponentSymbol?.targetUri || null;
    if (!targetUri) {
        return null;
    }
    if (contractCache.has(targetUri)) {
        return contractCache.get(targetUri);
    }
    const contract = readNdComponentContract(targetUri);
    contractCache.set(targetUri, contract);
    return contract;
}

function readNdComponentContract(targetUri) {
    if (!targetUri || !/^file:\/\//.test(targetUri)) {
        return null;
    }
    try {
        const filePath = fileURLToPath(targetUri);
        const stat = fs.statSync(filePath);
        const cacheKey = `${stat.mtimeMs}:${stat.size}`;
        const cached = COMPONENT_CONTRACT_CACHE.get(targetUri);
        if (cached?.cacheKey === cacheKey) {
            return cached.contract;
        }
        const source = fs.readFileSync(filePath, "utf8");
        const descriptor = parseNdDocument(source, targetUri);
        const contract = buildComponentContractFromDescriptor(descriptor, createTextBufferDocumentLike(targetUri, source));
        COMPONENT_CONTRACT_CACHE.set(targetUri, {
            cacheKey,
            contract
        });
        return contract;
    } catch {
        return null;
    }
}

function collectCompilerTemplateDiagnostics(document, text) {
    const typeSurface = readCompilerTypeSurface(text, {
        componentContractCheck: true,
        uri: document.uri
    });
    const diagnostics = Array.isArray(typeSurface?.templateDiagnostics)
        ? typeSurface.templateDiagnostics
        : [];
    return diagnostics
        .filter(item => !shouldSkipCompilerTemplateDiagnostic(item))
        .map(item => {
            const offset = Number.isFinite(item.offset) ? item.offset : 0;
            return {
                message: item.message,
                range: rangeFromOffsets(document, offset, Math.max(offset, offset + 1)),
                severity: "error",
                source: "nd-compiler"
            };
        });
}

function shouldSkipCompilerTemplateDiagnostic(diagnostic) {
    const message = String(diagnostic?.message || "");
    return /^Unknown prop `/.test(message)
        || /^Unknown emitted event handler `/.test(message)
        || /^Unknown named slot `/.test(message);
}

function readCompilerTypeSurface(source, options = {}) {
    if (!String(source || "").trim()) {
        return null;
    }
    try {
        return extractNdTypeSurface(source, {
            componentContractCheck: options.componentContractCheck !== false,
            filename: resolveCompilerSurfaceFilename(options.uri),
            templateTypeCheck: false
        });
    } catch {
        return null;
    }
}

function resolveCompilerSurfaceFilename(uri) {
    if (typeof uri === "string" && /^file:\/\//.test(uri)) {
        try {
            return fileURLToPath(uri);
        } catch {
            return uri;
        }
    }
    return String(uri || "anonymous.nd");
}

function mergeComponentContractTypeSurface(contract, typeSurface) {
    if (!contract || !typeSurface) {
        return contract;
    }
    for (const entry of typeSurface.props || []) {
        recordPropContractName(contract, entry.name, entry.source || "nd-compiler", {
            optional: entry.optional,
            typeText: entry.typeText || ""
        });
    }
    for (const entry of typeSurface.emits || []) {
        recordEmitContractName(contract, entry.name, entry.source || "nd-compiler", {
            optional: entry.optional,
            typeText: entry.typeText || ""
        });
    }
    for (const entry of typeSurface.slots || []) {
        recordSlotContractName(contract, entry.name, entry.source || "nd-compiler", {
            optional: entry.optional,
            typeText: entry.typeText || ""
        });
    }
    return contract;
}

function hydrateMissingComponentContractRanges(contract, descriptor, document) {
    if (!contract || !descriptor || typeof document?.getText !== "function") {
        return contract;
    }
    for (const entry of contract.props.values()) {
        hydrateComponentContractEntryRange(entry, "prop", descriptor, document);
    }
    for (const entry of contract.emits.values()) {
        hydrateComponentContractEntryRange(entry, "event", descriptor, document);
    }
    for (const entry of contract.slots.values()) {
        hydrateComponentContractEntryRange(entry, "slot", descriptor, document);
    }
    return contract;
}

function hydrateComponentContractEntryRange(entry, kind, descriptor, document) {
    if (!entry || entry.range) {
        return;
    }
    const fallbackRange = findFallbackComponentContractEntryRange(entry, kind, descriptor, document);
    if (!fallbackRange) {
        return;
    }
    entry.range = fallbackRange;
    if (!entry.uri) {
        entry.uri = document.uri;
    }
}

function findFallbackComponentContractEntryRange(entry, kind, descriptor, document) {
    const scriptRange = findFallbackComponentContractEntryRangeInBlock(
        descriptor?.script,
        document,
        entry,
        kind
    );
    if (scriptRange) {
        return scriptRange;
    }
    if (kind === "slot") {
        return findFallbackComponentContractEntryRangeInSlotTemplate(descriptor?.template, document, entry);
    }
    return null;
}

function findFallbackComponentContractEntryRangeInBlock(block, document, entry, kind) {
    if (!block?.content) {
        return null;
    }
    const source = block.content;
    const label = String(entry?.label || "").trim();
    if (!label) {
        return null;
    }
    const patterns = kind === "event"
        ? [
            new RegExp(`(["'])${escapeRegExp(label)}\\1`, "g")
        ]
        : [
            new RegExp(`\\b${escapeRegExp(label)}\\b\\s*\\??:`, "g"),
            new RegExp(`(["'])${escapeRegExp(label)}\\1\\s*:`, "g")
        ];

    for (const pattern of patterns) {
        const match = pattern.exec(source);
        if (!match) {
            continue;
        }
        const tokenIndex = match[0].indexOf(label);
        if (tokenIndex < 0) {
            continue;
        }
        const start = block.contentStart + (match.index || 0) + tokenIndex;
        return rangeFromOffsets(document, start, start + label.length);
    }
    return null;
}

function findFallbackComponentContractEntryRangeInSlotTemplate(templateBlock, document, entry) {
    if (!templateBlock?.content) {
        return null;
    }
    const label = String(entry?.label || "").trim();
    if (!label) {
        return null;
    }
    const pattern = new RegExp(`name\\s*=\\s*([\"'])${escapeRegExp(label)}\\1`, "g");
    const match = pattern.exec(templateBlock.content);
    if (!match) {
        return null;
    }
    const tokenIndex = match[0].indexOf(label);
    if (tokenIndex < 0) {
        return null;
    }
    const start = templateBlock.contentStart + (match.index || 0) + tokenIndex;
    return rangeFromOffsets(document, start, start + label.length);
}

function collectComponentContractDiagnostics(document, node, contract, nodes) {
    const diagnostics = [];

    for (const attr of node.attrs || []) {
        const eventName = normalizeComponentEventAttributeName(attr.name);
        if (eventName) {
            if (!contract.emits.has(eventName)) {
                diagnostics.push({
                    message: `Unknown emitted event handler \`${attr.name}\` on component \`${node.name}\`. Declared emits: ${formatContractEntryList(contract.emits) || "none"}.`,
                    range: attr.range,
                    severity: "warning"
                });
            }
            continue;
        }

        if (shouldIgnoreComponentAttribute(attr.name)) {
            continue;
        }

        const normalizedProp = normalizeContractPropName(attr.name);
        if (!contract.props.has(normalizedProp)) {
            diagnostics.push({
                message: `Unknown prop \`${attr.name}\` on component \`${node.name}\`. Declared props: ${formatContractEntryList(contract.props) || "none"}.`,
                range: attr.range,
                severity: "warning"
            });
        }
    }

    for (const child of getDirectTemplateChildren(nodes, node)) {
        if (String(child.name || "").toLowerCase() !== "slot") {
            continue;
        }
        const slotName = String(getTemplateAttribute(child, "name")?.value || "").trim();
        const slotNameAttribute = getTemplateAttribute(child, "name");
        if (!slotName) {
            continue;
        }
        const normalizedSlot = normalizeContractSlotName(slotName);
        if (!contract.slots.has(normalizedSlot)) {
            diagnostics.push({
                message: `Unknown named slot \`${slotName}\` passed to component \`${node.name}\`. Declared slots: ${formatContractEntryList(contract.slots) || "none"}.`,
                range: slotNameAttribute?.valueRange || slotNameAttribute?.range || child.nameRange,
                severity: "warning"
            });
        }
    }

    return diagnostics;
}

function getComponentContractAttributeCompletions(node) {
    const contract = node?.componentContract;
    if (!contract) {
        return [];
    }
    const completions = [];
    for (const prop of contract.props.values()) {
        const label = normalizeContractPropName(prop.label);
        completions.push({
            detail: formatComponentContractCompletionDetail(node.name, "prop", prop),
            insertText: `${label}={{$1}}`,
            insertTextFormat: "snippet",
            kind: "html-attr",
            label
        });
    }
    for (const emit of contract.emits.values()) {
        const eventName = normalizeContractEventName(emit.label);
        const label = eventName.includes(":") ? `on:${eventName}` : `on-${eventName}`;
        completions.push({
            detail: formatComponentContractCompletionDetail(node.name, "event", emit),
            insertText: `${label}={{$1}}`,
            insertTextFormat: "snippet",
            kind: "html-attr",
            label
        });
    }
    return dedupeCompletionItems(completions);
}

function resolveComponentContractHover(analysis, document, node, offset) {
    if (!node?.componentContract || !node.nameRange) {
        return null;
    }
    const start = document.offsetAt(node.nameRange.start);
    const end = document.offsetAt(node.nameRange.end);
    if (offset < start || offset > end) {
        return null;
    }
    return node.componentContract;
}

function appendContractMarkdown(baseMarkdown, contract) {
    const contractMarkdown = formatComponentContractMarkdown(contract);
    if (!contractMarkdown) {
        return baseMarkdown;
    }
    return `${baseMarkdown}\n\n---\n\n${contractMarkdown}`;
}

function formatComponentContractMarkdown(contract) {
    if (!contract) {
        return "";
    }
    const sections = [];
    if (contract.props.size > 0) {
        sections.push(`**Props**\n\n${formatContractEntryMarkdown(contract.props)}`);
    }
    if (contract.emits.size > 0) {
        sections.push(`**Emits**\n\n${formatContractEntryMarkdown(contract.emits)}`);
    }
    if (contract.slots.size > 0) {
        sections.push(`**Slots**\n\n${formatContractEntryMarkdown(contract.slots)}`);
    }
    return sections.join("\n\n");
}

function formatContractEntryMarkdown(targetMap) {
    return Array.from(targetMap.values())
        .map(entry => formatComponentContractEntryMarkdown(entry))
        .join("\n");
}

function formatContractEntryList(targetMap) {
    return Array.from(targetMap.values())
        .map(entry => `\`${entry.label}\``)
        .join(", ");
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

function dedupeCompletionItems(items) {
    const seen = new Set();
    return items.filter(item => {
        const key = `${item.label}:${item.kind}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function dedupeDiagnostics(items) {
    const seen = new Set();
    return (items || []).filter(item => {
        const key = [
            item.message,
            item.severity || "",
            item.range?.start?.line ?? "",
            item.range?.start?.character ?? "",
            item.range?.end?.line ?? "",
            item.range?.end?.character ?? ""
        ].join(":");
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function compactTypeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function formatComponentContractEntryMarkdown(entry) {
    const parts = [];
    if (entry?.optional === false) {
        parts.push("required");
    } else if (entry?.optional === true) {
        parts.push("optional");
    }
    if (entry?.typeText) {
        parts.push(`type: \`${compactTypeText(entry.typeText)}\``);
    }
    return parts.length > 0
        ? `- \`${entry.label}\` (${parts.join(", ")})`
        : `- \`${entry.label}\``;
}

function formatComponentContractCompletionDetail(componentName, kind, entry) {
    const label = kind === "event" ? "Event emitted" : "Prop declared";
    const parts = [`${label} by ${componentName}`];
    if (entry?.optional === false) {
        parts.push("required");
    } else if (entry?.optional === true && kind !== "event") {
        parts.push("optional");
    }
    if (entry?.typeText) {
        parts.push(compactTypeText(entry.typeText));
    }
    return parts.join(" - ");
}

function formatComponentContractItemHoverMarkdown(kind, componentName, entry) {
    const title = kind === "event"
        ? `**Event \`${entry.label}\`**`
        : (kind === "slot" ? `**Slot \`${entry.label}\`**` : `**Prop \`${entry.label}\`**`);
    const lines = [
        title,
        "",
        `Declared by \`${componentName}\`.`
    ];
    if (entry?.optional === false && kind !== "event") {
        lines.push("", "**Required**");
    } else if (entry?.optional === true && kind !== "event") {
        lines.push("", "**Optional**");
    }
    if (entry?.typeText) {
        lines.push("", `Type: \`${compactTypeText(entry.typeText)}\``);
    }
    return lines.join("\n");
}

function resolveComponentContractNavigation(analysis, offset) {
    const nodes = analysis.templateAnalysis.nodes || [];
    const currentNode = getContainingTemplateNodes(analysis.templateAnalysis, offset)[0] || null;
    const currentAttribute = getTemplateAttributeAtOffset(analysis.templateAnalysis, offset);
    const currentAttributeOwner = currentAttribute
        ? nodes.find(node => (node.attrs || []).includes(currentAttribute)) || currentNode
        : currentNode;

    if (currentAttributeOwner?.kind === "component" && currentAttribute) {
        const attributeNavigation = resolveComponentContractAttributeNavigation(currentAttributeOwner, currentAttribute);
        if (attributeNavigation) {
            return attributeNavigation;
        }
    }

    if (String(currentAttributeOwner?.name || "").toLowerCase() === "slot") {
        const parentNode = getParentTemplateNode(nodes, currentAttributeOwner);
        if (parentNode?.componentContract) {
            const slotNavigation = resolveComponentSlotNavigation(parentNode, currentAttributeOwner, currentAttribute);
            if (slotNavigation) {
                return slotNavigation;
            }
        }
    }

    return null;
}

function resolveComponentContractAttributeNavigation(node, attribute) {
    const contract = node?.componentContract;
    if (!contract || !attribute) {
        return null;
    }

    const eventName = normalizeComponentEventAttributeName(attribute.name);
    if (eventName) {
        const emitEntry = contract.emits.get(eventName);
        return buildContractNavigation({
            definitionEntry: emitEntry,
            kind: "event",
            localLabel: attribute.name,
            localRange: attribute.range
        });
    }

    if (shouldIgnoreComponentAttribute(attribute.name)) {
        return null;
    }

    const propEntry = contract.props.get(normalizeContractPropName(attribute.name));
    return buildContractNavigation({
        definitionEntry: propEntry,
        kind: "prop",
        localLabel: attribute.name,
        localRange: attribute.range
    });
}

function resolveComponentSlotNavigation(parentNode, slotNode, currentAttribute) {
    const slotNameAttribute = getTemplateAttribute(slotNode, "name");
    if (!slotNameAttribute) {
        return null;
    }
    if (currentAttribute && currentAttribute !== slotNameAttribute) {
        return null;
    }
    const slotEntry = parentNode.componentContract?.slots.get(
        normalizeContractSlotName(String(slotNameAttribute.value || "").trim())
    );
    return buildContractNavigation({
        definitionEntry: slotEntry,
        kind: "slot",
        localLabel: String(slotNameAttribute.value || "").trim(),
        localRange: slotNameAttribute.valueRange || slotNameAttribute.range
    });
}

function buildContractNavigation(target) {
    if (!target?.localRange || !target?.definitionEntry?.range) {
        return null;
    }
    return {
        definitionEntry: target.definitionEntry,
        definitionRange: target.definitionEntry.range,
        definitionUri: target.definitionEntry.uri,
        kind: target.kind,
        localLabel: target.localLabel,
        localRange: target.localRange,
        referenceLocations: dedupeLocations([
            {
                uri: target.definitionEntry.uri,
                range: target.definitionEntry.range
            },
            {
                uri: null,
                range: target.localRange
            }
        ])
    };
}

function resolveLocalContractDefinitionNavigation(document, analysis, offset) {
    const localTarget = findLocalContractDefinitionTarget(document, analysis.scriptAnalysis.componentContract, offset, document.uri);
    if (!localTarget) {
        return null;
    }
    return {
        definitionEntry: localTarget.entry,
        definitionRange: localTarget.entry.range,
        definitionUri: localTarget.entry.uri || document.uri,
        kind: localTarget.kind,
        localLabel: localTarget.entry.label,
        localRange: localTarget.entry.range,
        referenceLocations: dedupeLocations([
            {
                uri: localTarget.entry.uri || document.uri,
                range: localTarget.entry.range
            },
            ...collectCrossComponentContractReferences(document.uri, localTarget.kind, localTarget.entry)
        ])
    };
}

function findLocalContractDefinitionTarget(document, contract, offset, localUri) {
    if (!contract) {
        return null;
    }
    for (const entry of contract.props.values()) {
        const resolvedRange = entry?.uri === localUri ? resolveLocalContractEntryRange(document, entry, offset, "prop") : null;
        if (resolvedRange) {
            return {
                entry: {
                    ...entry,
                    range: resolvedRange
                },
                kind: "prop"
            };
        }
    }
    for (const entry of contract.emits.values()) {
        const resolvedRange = entry?.uri === localUri ? resolveLocalContractEntryRange(document, entry, offset, "event") : null;
        if (resolvedRange) {
            return {
                entry: {
                    ...entry,
                    range: resolvedRange
                },
                kind: "event"
            };
        }
    }
    for (const entry of contract.slots.values()) {
        const resolvedRange = entry?.uri === localUri ? resolveLocalContractEntryRange(document, entry, offset, "slot") : null;
        if (resolvedRange) {
            return {
                entry: {
                    ...entry,
                    range: resolvedRange
                },
                kind: "slot"
            };
        }
    }
    return null;
}

function resolveLocalContractEntryRange(document, entry, offset, kind) {
    if (!entry?.range) {
        return null;
    }
    const start = document.offsetAt(entry.range.start);
    const end = document.offsetAt(entry.range.end);
    const token = readIdentifierAt(document.getText(), offset);
    if (token && doesContractTokenMatchEntry(token.text, entry.label, kind)) {
        const inExpandedRange = token.start >= Math.max(0, start - 2) && token.end <= end + token.text.length + 8;
        const malformedRange = entry.range.start.line !== entry.range.end.line || end <= token.start;
        if (inExpandedRange || malformedRange) {
            return rangeFromOffsets(document, token.start, token.end);
        }
    }
    if (offset >= start && offset <= end) {
        return entry.range;
    }
    return null;
}

function doesContractTokenMatchEntry(tokenText, entryLabel, kind) {
    if (kind === "prop") {
        return normalizeContractPropName(tokenText) === normalizeContractPropName(entryLabel);
    }
    if (kind === "event") {
        return normalizeContractEventName(tokenText) === normalizeContractEventName(entryLabel);
    }
    if (kind === "slot") {
        return normalizeContractSlotName(tokenText) === normalizeContractSlotName(entryLabel);
    }
    return false;
}

function collectCrossComponentContractReferences(targetUri, kind, entry) {
    if (!targetUri || !entry?.label) {
        return [];
    }
    let filePath;
    try {
        filePath = fileURLToPath(targetUri);
    } catch {
        return [];
    }
    const workspaceRoot = findWorkspaceRoot(filePath);
    const ndFiles = collectWorkspaceNdFiles(workspaceRoot);
    const locations = [];

    for (const candidateFile of ndFiles) {
        const candidateUri = pathToFileURL(candidateFile).href;
        if (candidateUri === targetUri) {
            continue;
        }
        const candidate = readAnalyzedNdDocument(candidateUri);
        if (!candidate?.analysis) {
            continue;
        }
        locations.push(...collectContractUsageLocationsForAnalysis(candidateUri, candidate.analysis, targetUri, kind, entry.label));
    }

    return dedupeLocations(locations);
}

function collectContractUsageLocationsForAnalysis(candidateUri, analysis, targetUri, kind, label) {
    const locations = [];
    const normalizedProp = kind === "prop" ? normalizeContractPropName(label) : "";
    const normalizedEvent = kind === "event" ? normalizeContractEventName(label) : "";
    const normalizedSlot = kind === "slot" ? normalizeContractSlotName(label) : "";

    for (const node of analysis.templateAnalysis.nodes || []) {
        const symbolUri = node.componentSymbol?.targetUri || node.importedComponentSymbol?.targetUri || null;
        if (symbolUri !== targetUri) {
            continue;
        }

        if (kind === "prop") {
            for (const attr of node.attrs || []) {
                if (shouldIgnoreComponentAttribute(attr.name)) {
                    continue;
                }
                if (normalizeContractPropName(attr.name) === normalizedProp) {
                    locations.push({
                        uri: candidateUri,
                        range: attr.range
                    });
                }
            }
            continue;
        }

        if (kind === "event") {
            for (const attr of node.attrs || []) {
                if (normalizeComponentEventAttributeName(attr.name) === normalizedEvent) {
                    locations.push({
                        uri: candidateUri,
                        range: attr.range
                    });
                }
            }
            continue;
        }

        if (kind === "slot") {
            for (const child of getDirectTemplateChildren(analysis.templateAnalysis.nodes || [], node)) {
                if (String(child.name || "").toLowerCase() !== "slot") {
                    continue;
                }
                const slotNameAttribute = getTemplateAttribute(child, "name");
                if (!slotNameAttribute) {
                    continue;
                }
                if (normalizeContractSlotName(String(slotNameAttribute.value || "").trim()) === normalizedSlot) {
                    locations.push({
                        uri: candidateUri,
                        range: slotNameAttribute.valueRange || slotNameAttribute.range
                    });
                }
            }
        }
    }

    return locations;
}

function readAnalyzedNdDocument(targetUri) {
    if (!targetUri || !/^file:\/\//.test(targetUri)) {
        return null;
    }
    try {
        const filePath = fileURLToPath(targetUri);
        const source = fs.readFileSync(filePath, "utf8");
        const document = createTextBufferDocumentLike(targetUri, source);
        return {
            analysis: analyzeNdDocument(document),
            document
        };
    } catch {
        return null;
    }
}

function findWorkspaceRoot(filePath) {
    let current = path.dirname(filePath);
    while (true) {
        if (fs.existsSync(path.join(current, "package.json")) || fs.existsSync(path.join(current, ".git"))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return path.dirname(filePath);
        }
        current = parent;
    }
}

function collectWorkspaceNdFiles(rootDir) {
    const files = [];
    const queue = [rootDir];
    while (queue.length > 0) {
        const current = queue.pop();
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (shouldSkipWorkspaceDirectory(entry.name)) {
                    continue;
                }
                queue.push(path.join(current, entry.name));
                continue;
            }
            if (entry.isFile() && entry.name.toLowerCase().endsWith(".nd")) {
                files.push(path.join(current, entry.name));
            }
        }
    }
    return files;
}

function shouldSkipWorkspaceDirectory(name) {
    return [
        ".git",
        ".vitepress",
        "coverage",
        "dist",
        "node_modules"
    ].includes(String(name || "").toLowerCase());
}

function resolveComponentContractItemHover(analysis, document, offset) {
    const nodes = analysis.templateAnalysis.nodes || [];
    const currentNode = getContainingTemplateNodes(analysis.templateAnalysis, offset)[0] || null;
    const currentAttribute = getTemplateAttributeAtOffset(analysis.templateAnalysis, offset);
    const currentAttributeOwner = currentAttribute
        ? nodes.find(node => (node.attrs || []).includes(currentAttribute)) || currentNode
        : currentNode;

    if (currentAttributeOwner?.kind === "component" && currentAttribute) {
        const eventName = normalizeComponentEventAttributeName(currentAttribute.name);
        const entry = eventName
            ? currentAttributeOwner.componentContract?.emits.get(eventName)
            : (!shouldIgnoreComponentAttribute(currentAttribute.name)
                ? currentAttributeOwner.componentContract?.props.get(normalizeContractPropName(currentAttribute.name))
                : null);
        const entryType = eventName ? "event" : "prop";
        if (entry) {
            return {
                contents: {
                    kind: "markdown",
                    value: formatComponentContractItemHoverMarkdown(entryType, currentAttributeOwner.name, entry)
                },
                range: currentAttribute.range
            };
        }
    }

    if (String(currentAttributeOwner?.name || "").toLowerCase() === "slot") {
        const slotNameAttribute = getTemplateAttribute(currentAttributeOwner, "name");
        const parentNode = getParentTemplateNode(nodes, currentAttributeOwner);
        if (slotNameAttribute && parentNode?.componentContract && (!currentAttribute || currentAttribute === slotNameAttribute)) {
            const slotEntry = parentNode.componentContract.slots.get(
                normalizeContractSlotName(String(slotNameAttribute.value || "").trim())
            );
            if (slotEntry) {
                return {
                    contents: {
                        kind: "markdown",
                        value: formatComponentContractItemHoverMarkdown("slot", parentNode.name, slotEntry)
                    },
                    range: slotNameAttribute.valueRange || slotNameAttribute.range
                };
            }
        }
    }

    return null;
}

function dedupeLocations(locations) {
    const seen = new Set();
    return locations
        .filter(Boolean)
        .map(item => ({
            uri: item.uri,
            range: item.range
        }))
        .filter(item => {
            const key = `${item.uri || ""}:${item.range.start.line}:${item.range.start.character}:${item.range.end.line}:${item.range.end.character}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
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
        const context = getTemplateCompletionContext(document.getText(), block, offset);
        const templateNode = getTemplateNodeAtOffset(analysis.templateAnalysis, offset);
        const slotScopeCompletions = getTemplateScopedCompletions(analysis.templateAnalysis, offset);
        const componentCompletions = Array.from(analysis.scriptAnalysis.templateComponents.values()).map(symbol => ({
            label: symbol.name,
            kind: "component",
            detail: symbol.detail,
            insertText: symbol.name
        })).concat(Array.from(BUILTIN_TEMPLATE_COMPONENTS.values()));
        if (context.kind === "tag") {
            return [
                ...componentCompletions,
                ...HTML_TAG_COMPLETIONS
            ];
        }
        if (context.kind === "attribute") {
            return [
                ...getTemplateAttributeCompletions(templateNode, analysis),
                ...HTML_ATTRIBUTE_COMPLETIONS,
                ...ND_TEMPLATE_COMPLETIONS
            ];
        }
        return [
            ...slotScopeCompletions,
            ...Array.from(analysis.scriptAnalysis.exposedSymbols.values()).map(symbol => ({
                label: symbol.name,
                kind: symbol.kind,
                detail: symbol.detail
            })),
            ...componentCompletions,
            ...HTML_TAG_COMPLETIONS,
            ...HTML_ATTRIBUTE_COMPLETIONS,
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

    const componentContractNavigation = resolveComponentContractNavigation(analysis, offset);
    if (componentContractNavigation?.definitionRange) {
        return {
            uri: componentContractNavigation.definitionUri || document.uri,
            range: componentContractNavigation.definitionRange
        };
    }
    const templateBlockNavigation = resolveTemplateBlockNavigation(analysis, offset);
    if (templateBlockNavigation?.definitionRange) {
        return {
            uri: document.uri,
            range: templateBlockNavigation.definitionRange
        };
    }
    const localContractDefinitionNavigation = resolveLocalContractDefinitionNavigation(document, analysis, offset);
    if (localContractDefinitionNavigation?.definitionRange) {
        return {
            uri: localContractDefinitionNavigation.definitionUri || document.uri,
            range: localContractDefinitionNavigation.definitionRange
        };
    }

    const token = readIdentifierAt(document.getText(), offset);
    if (!token) {
        return null;
    }

    const symbol = analysis.scriptAnalysis.exposedSymbols.get(token.text) || analysis.scriptAnalysis.templateComponents.get(token.text);
    if (!symbol?.range) {
        return null;
    }

    return {
        uri: document.uri,
        range: symbol.range
    };
}

export function getNdHover(document, position) {
    const analysis = analyzeNdDocument(document);
    const offset = document.offsetAt(position);
    const componentContractItemHover = resolveComponentContractItemHover(analysis, document, offset);
    if (componentContractItemHover) {
        return componentContractItemHover;
    }
    const token = readIdentifierAt(document.getText(), offset);
    if (!token) {
        return null;
    }

    const templateNode = getTemplateNodeContainingOffset(analysis.templateAnalysis, offset);
    const templateContract = resolveComponentContractHover(analysis, document, templateNode, offset);

    const symbol = resolveKnownSymbolAtOffset(analysis, token.text, token.start);
    if (symbol) {
        return {
            contents: {
                kind: "markdown",
                value: appendContractMarkdown(
                    `**${symbol.name}**\n\n${symbol.detail}`,
                    templateContract
                )
            },
            range: rangeFromOffsets(document, token.start, token.end)
        };
    }

    const builtinDoc = ND_SCRIPT_DOCS.get(token.text);
    if (builtinDoc) {
        return {
            contents: {
                kind: "markdown",
                value: builtinDoc
            },
            range: rangeFromOffsets(document, token.start, token.end)
        };
    }

    const templateDoc = ND_TEMPLATE_DOCS.get(token.text);
    if (templateDoc) {
        return {
            contents: {
                kind: "markdown",
                value: appendContractMarkdown(templateDoc, templateContract)
            },
            range: rangeFromOffsets(document, token.start, token.end)
        };
    }

    return null;
}

export function getNdDocumentLinks(document) {
    const analysis = analyzeNdDocument(document);
    const links = [];

    for (const symbol of analysis.scriptAnalysis.importedTemplateComponents.values()) {
        if (!symbol?.specifierRange || !symbol.targetUri) {
            continue;
        }
        links.push({
            range: symbol.specifierRange,
            target: symbol.targetUri
        });
    }

    for (const node of analysis.templateAnalysis.nodes || []) {
        const symbol = node.componentSymbol || node.importedComponentSymbol;
        if (!symbol?.targetUri) {
            continue;
        }
        links.push({
            range: node.nameRange,
            target: symbol.targetUri
        });
    }

    return dedupeDocumentLinks(links);
}

export function getNdReferences(document, position) {
    const analysis = analyzeNdDocument(document);
    const offset = document.offsetAt(position);
    const componentContractNavigation = resolveComponentContractNavigation(analysis, offset);
    if (componentContractNavigation) {
        return componentContractNavigation.referenceLocations.map(item => ({
            uri: item.uri || document.uri,
            range: item.range
        }));
    }
    const templateBlockNavigation = resolveTemplateBlockNavigation(analysis, offset);
    if (templateBlockNavigation) {
        return templateBlockNavigation.referenceRanges.map(range => ({
            uri: document.uri,
            range
        }));
    }
    const localContractDefinitionNavigation = resolveLocalContractDefinitionNavigation(document, analysis, offset);
    if (localContractDefinitionNavigation) {
        return localContractDefinitionNavigation.referenceLocations.map(item => ({
            uri: item.uri || document.uri,
            range: item.range
        }));
    }

    const token = readIdentifierAt(document.getText(), offset);
    if (!token || !isRenameableToken(analysis.scriptAnalysis, token.text)) {
        return [];
    }

    return collectSymbolReferences(document, analysis, token.text).map(range => ({
        uri: document.uri,
        range
    }));
}

export function getNdRenameEdit(document, position, newName) {
    const analysis = analyzeNdDocument(document);
    const offset = document.offsetAt(position);
    const componentContractNavigation = resolveComponentContractNavigation(analysis, offset);
    if (componentContractNavigation) {
        return buildComponentContractRenameEdit(componentContractNavigation, newName, document.uri);
    }
    const localContractDefinitionNavigation = resolveLocalContractDefinitionNavigation(document, analysis, offset);
    if (localContractDefinitionNavigation) {
        return buildComponentContractRenameEdit(localContractDefinitionNavigation, newName, document.uri);
    }

    const normalizedName = String(newName || "").trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(normalizedName)) {
        return null;
    }

    const token = readIdentifierAt(document.getText(), offset);
    if (!token || !isRenameableToken(analysis.scriptAnalysis, token.text)) {
        return null;
    }

    const references = getNdReferences(document, position);
    if (references.length === 0) {
        return null;
    }

    return {
        changes: {
            [document.uri]: references.map(reference => ({
                newText: normalizedName,
                range: reference.range
            }))
        }
    };
}

export function getNdDocumentSymbols(document) {
    const analysis = analyzeNdDocument(document);
    const symbols = [];

    if (analysis.descriptor.template) {
        symbols.push({
            children: buildTemplateDocumentSymbols(document, analysis.templateAnalysis.nodes),
            kind: "block",
            name: "template",
            range: rangeFromOffsets(document, analysis.descriptor.template.start, analysis.descriptor.template.end),
            selectionRange: rangeFromOffsets(
                document,
                analysis.descriptor.template.start,
                analysis.descriptor.template.start + "<template>".length
            )
        });
    }

    if (analysis.descriptor.script) {
        const scriptChildren = Array.from(analysis.scriptAnalysis.declarations.values())
            .sort((left, right) => compareRanges(left.range, right.range))
            .map(symbol => ({
                kind: symbol.kind === "function" ? "function" : "variable",
                name: symbol.name,
                range: symbol.range,
                selectionRange: symbol.range
            }));

        symbols.push({
            children: scriptChildren,
            kind: "block",
            name: analysis.descriptor.script.setup ? "script setup" : "script",
            range: rangeFromOffsets(document, analysis.descriptor.script.start, analysis.descriptor.script.end),
            selectionRange: rangeFromOffsets(
                document,
                analysis.descriptor.script.start,
                analysis.descriptor.script.start + (analysis.descriptor.script.setup ? "<script setup>".length : "<script>".length)
            )
        });
    }

    for (const styleBlock of analysis.descriptor.styles) {
        symbols.push({
            kind: "block",
            name: styleBlock.scoped ? "style scoped" : "style",
            range: rangeFromOffsets(document, styleBlock.start, styleBlock.end),
            selectionRange: rangeFromOffsets(
                document,
                styleBlock.start,
                styleBlock.start + (styleBlock.scoped ? "<style scoped>".length : "<style>".length)
            )
        });
    }

    return symbols;
}

export function getNdFoldingRanges(document) {
    const analysis = analyzeNdDocument(document);
    const ranges = [];
    const seen = new Set();

    for (const block of analysis.descriptor.blocks || []) {
        pushFoldingRange(ranges, seen, document, block.start, block.end, block.type);
    }
    for (const node of analysis.templateAnalysis.nodes || []) {
        if (node.closeEnd === null || node.closeEnd === undefined) {
            continue;
        }
        pushFoldingRange(ranges, seen, document, node.openStart, node.closeEnd, "region");
    }

    return ranges;
}

export function getNdSelectionRanges(document, positions) {
    const analysis = analyzeNdDocument(document);
    return positions.map(position => buildSelectionRangeChain(document, analysis, document.offsetAt(position)));
}

export function getNdCodeActions(document, context = {}, range = null) {
    const analysis = analyzeNdDocument(document);
    const diagnostics = context.diagnostics || analysis.diagnostics;
    const actions = [];

    for (const diagnostic of diagnostics) {
        const duplicateAttributeAction = createDuplicateAttributeAction(document, analysis, diagnostic);
        if (duplicateAttributeAction) {
            actions.push(duplicateAttributeAction);
        }

        const exposeSetupSymbolAction = createExposeSetupSymbolAction(document, analysis, diagnostic);
        if (exposeSetupSymbolAction) {
            actions.push(exposeSetupSymbolAction);
        }

        const createHandlerAction = createComponentEventHandlerScaffoldAction(document, analysis, diagnostic);
        if (createHandlerAction) {
            actions.push(createHandlerAction);
        }

        const registerModuleAction = createRegisterImportedComponentAction(document, analysis, diagnostic);
        if (registerModuleAction) {
            actions.push(registerModuleAction);
        }

        const teleportAction = createTeleportDisabledAction(document, analysis, diagnostic);
        if (teleportAction) {
            actions.push(teleportAction);
        }

        const teleportTargetAction = createTeleportTargetAction(document, analysis, diagnostic);
        if (teleportTargetAction) {
            actions.push(teleportTargetAction);
        }

        const closingTagAction = createClosingTagFixAction(document, diagnostic);
        if (closingTagAction) {
            actions.push(closingTagAction);
        }

        const unclosedTagAction = createUnclosedTagFixAction(document, analysis, diagnostic);
        if (unclosedTagAction) {
            actions.push(unclosedTagAction);
        }

        const unexpectedClosingTagAction = createRemoveUnexpectedClosingTagAction(document, diagnostic);
        if (unexpectedClosingTagAction) {
            actions.push(unexpectedClosingTagAction);
        }

        const repeatKeyAction = createRepeatKeyAction(document, analysis, diagnostic);
        if (repeatKeyAction) {
            actions.push(repeatKeyAction);
        }

        const wrapSingleRootAction = createWrapSingleRootAction(document, analysis, diagnostic);
        if (wrapSingleRootAction) {
            actions.push(wrapSingleRootAction);
        }

        const keepAliveMaxAction = createKeepAliveMaxAction(document, analysis, diagnostic);
        if (keepAliveMaxAction) {
            actions.push(keepAliveMaxAction);
        }

        const suspenseTimeoutAction = createSuspenseTimeoutAction(document, analysis, diagnostic);
        if (suspenseTimeoutAction) {
            actions.push(suspenseTimeoutAction);
        }

        const suspenseTransitionDurationAction = createSuspenseTransitionDurationAction(document, analysis, diagnostic);
        if (suspenseTransitionDurationAction) {
            actions.push(suspenseTransitionDurationAction);
        }

        const suspenseFallbackAction = createSuspenseFallbackAction(document, analysis, diagnostic);
        if (suspenseFallbackAction) {
            actions.push(suspenseFallbackAction);
        }

        const suspenseFallbackSlotAction = createSuspenseFallbackSlotAction(document, analysis, diagnostic);
        if (suspenseFallbackSlotAction) {
            actions.push(suspenseFallbackSlotAction);
        }

        const suspenseErrorAction = createSuspenseErrorAction(document, analysis, diagnostic);
        if (suspenseErrorAction) {
            actions.push(suspenseErrorAction);
        }

        const suspenseErrorSlotAction = createSuspenseErrorSlotAction(document, analysis, diagnostic);
        if (suspenseErrorSlotAction) {
            actions.push(suspenseErrorSlotAction);
        }

        const suspenseRetryKeyAction = createSuspenseRetryKeyAction(document, analysis, diagnostic);
        if (suspenseRetryKeyAction) {
            actions.push(suspenseRetryKeyAction);
        }

        const convertTransitionGroupAction = createConvertTransitionGroupAction(document, analysis, diagnostic);
        if (convertTransitionGroupAction) {
            actions.push(convertTransitionGroupAction);
        }

        const transitionGroupKeyAction = createTransitionGroupChildKeyAction(document, analysis, diagnostic);
        if (transitionGroupKeyAction) {
            actions.push(transitionGroupKeyAction);
        }

        const routePathAction = createRoutePathAction(document, analysis, diagnostic);
        if (routePathAction) {
            actions.push(routePathAction);
        }

        const moduleNameAction = createModuleNameAction(document, analysis, diagnostic);
        if (moduleNameAction) {
            actions.push(moduleNameAction);
        }

        actions.push(...createComponentContractRenameActions(document, analysis, diagnostic));

        const removeUnknownComponentUsageAction = createRemoveUnknownComponentContractUsageAction(document, analysis, diagnostic);
        if (removeUnknownComponentUsageAction) {
            actions.push(removeUnknownComponentUsageAction);
        }
    }

    actions.push(...createBatchComponentContractActions(document, analysis, diagnostics));
    actions.push(...createContextualTemplateRefactorActions(document, analysis, range));
    return dedupeCodeActions(actions);
}

export function formatNdDocument(document) {
    const text = document.getText();
    const descriptor = parseNdDocument(text, document.uri);
    if (descriptor.blocks.length === 0) {
        return [];
    }

    const sortedBlocks = [...descriptor.blocks].sort((left, right) => left.start - right.start);
    const formatted = sortedBlocks.map(block => formatBlock(block)).join("\n\n").trimEnd() + "\n";

    if (formatted === text) {
        return [];
    }

    return [
        {
            newText: formatted,
            range: {
                start: document.positionAt(0),
                end: document.positionAt(text.length)
            }
        }
    ];
}

export const ND_SEMANTIC_TOKEN_TYPES = [
    "keyword",
    "class",
    "function",
    "property",
    "variable",
    "string",
    "number"
];

export const ND_SEMANTIC_TOKEN_MODIFIERS = [
    "defaultLibrary"
];

export function getNdSemanticTokens(document) {
    const analysis = analyzeNdDocument(document);
    const tokens = [];

    for (const block of analysis.descriptor.blocks) {
        pushSemanticToken(tokens, document, block.start + 1, block.type.length, "keyword");
        if (block.type === "script" && /\bsetup\b/i.test(block.attrs || "")) {
            const setupOffset = (block.attrs || "").toLowerCase().indexOf("setup");
            if (setupOffset >= 0) {
                pushSemanticToken(tokens, document, block.start + 1 + "script".length + 1 + setupOffset, "setup".length, "keyword");
            }
        }
        if (block.type === "style" && /\bscoped\b/i.test(block.attrs || "")) {
            const scopedOffset = (block.attrs || "").toLowerCase().indexOf("scoped");
            if (scopedOffset >= 0) {
                pushSemanticToken(tokens, document, block.start + 1 + "style".length + 1 + scopedOffset, "scoped".length, "keyword");
            }
        }
    }

    for (const node of analysis.templateAnalysis.nodes || []) {
        const isBuiltinComponent = isBuiltInTemplateComponentName(node.name);
        pushSemanticTokenRange(
            tokens,
            document,
            node.nameRange,
            node.kind === "component" ? "class" : "keyword",
            isBuiltinComponent ? ["defaultLibrary"] : []
        );
        for (const attr of node.attrs || []) {
            pushSemanticTokenRange(
                tokens,
                document,
                attr.range,
                attr.name.startsWith("e-") ? "function" : "property",
                isBuiltInTemplateAttribute(attr.name, node.name) ? ["defaultLibrary"] : []
            );
            if (attr.valueRange && attr.valueKind === "string") {
                pushSemanticTokenRange(tokens, document, attr.valueRange, "string");
            } else if (attr.valueRange && attr.valueKind === "number") {
                pushSemanticTokenRange(tokens, document, attr.valueRange, "number");
            }
        }
    }

    for (const reference of collectSimpleTemplateReferences(
        analysis.descriptor.template || { content: "", contentStart: 0, contentEnd: 0 },
        analysis.templateAnalysis
    )) {
        const knownSymbol = resolveKnownSymbolAtOffset(analysis, reference.name, reference.offset);
        pushSemanticToken(
            tokens,
            document,
            reference.offset,
            reference.name.length,
            knownSymbol?.kind === "function" ? "function" : "variable",
            knownSymbol?.defaultLibrary ? ["defaultLibrary"] : []
        );
    }

    for (const symbol of analysis.scriptAnalysis.declarations.values()) {
        pushSemanticTokenRange(tokens, document, symbol.range, mapSemanticType(symbol.kind));
    }

    if (analysis.descriptor.script) {
        for (const token of scanIdentifiers(analysis.descriptor.script.content, analysis.descriptor.script.contentStart)) {
            if (ND_SCRIPT_DOCS.has(token.name)) {
                pushSemanticToken(tokens, document, token.start, token.name.length, "function", ["defaultLibrary"]);
            }
        }
        for (const literal of scanLiteralTokens(analysis.descriptor.script.content, analysis.descriptor.script.contentStart)) {
            pushSemanticToken(tokens, document, literal.start, literal.length, literal.kind);
        }
    }

    tokens.sort((left, right) => left.start - right.start || left.length - right.length);
    return tokens;
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

function analyzeTemplateBlock(document, templateBlock, scriptAnalysis) {
    const knownComponents = new Map();
    for (const symbol of scriptAnalysis.templateComponents.values()) {
        knownComponents.set(symbol.name.toLowerCase(), symbol);
    }
    for (const [key, symbol] of BUILTIN_TEMPLATE_COMPONENTS.entries()) {
        knownComponents.set(key, symbol);
    }

    const importedComponents = new Map();
    for (const symbol of scriptAnalysis.importedTemplateComponents.values()) {
        importedComponents.set(symbol.name.toLowerCase(), symbol);
    }

    const { diagnostics, nodes } = extractTemplateNodes(document, templateBlock, knownComponents, importedComponents);
    const componentContracts = new Map();

    for (const node of nodes) {
        const componentContract = getComponentContractForNode(node, componentContracts);
        if (componentContract) {
            node.componentContract = componentContract;
            diagnostics.push(...collectComponentContractDiagnostics(document, node, componentContract, nodes));
        }

        if (node.kind === "component" && node.componentSymbol?.detail === "Imported .nd component") {
            diagnostics.push({
                message: `Imported component \`${node.name}\` is used in the template but not registered in defineOptions({ modules: [...] }).`,
                range: node.nameRange,
                severity: "warning"
            });
        } else if (node.kind === "component" && !node.componentSymbol && looksLikeComponentTag(node.name)) {
            diagnostics.push({
                message: `Unknown component \`${node.name}\`. Import it or register it in defineOptions({ modules: [...] }).`,
                range: node.nameRange,
                severity: "warning"
            });
        }

        if (node.name.toLowerCase() === "teleport" && !hasTeleportTargetAttribute(node)) {
            diagnostics.push({
                message: "`<Teleport>` should declare a `to`/`target` attribute, or set `disabled` to render in place.",
                range: node.nameRange,
                severity: "warning"
            });
        }

        if (node.name.toLowerCase() === "route" && !getTemplateAttribute(node, "path")) {
            diagnostics.push({
                message: "`<route>` should declare a `path` attribute.",
                range: node.nameRange,
                severity: "warning"
            });
        }

        if (node.name.toLowerCase() === "module" && !getTemplateAttribute(node, "name")) {
            diagnostics.push({
                message: "`<module>` should declare a `name` attribute.",
                range: node.nameRange,
                severity: "warning"
            });
        }

        const repeatAttribute = getTemplateAttribute(node, "x-repeat");
        if (repeatAttribute && !getTemplateAttribute(node, "key")) {
            diagnostics.push({
                message: "`x-repeat` should declare a stable `key={{...}}` attribute so repeated nodes keep identity.",
                range: repeatAttribute.range,
                severity: "warning"
            });
        }

        if (isSingleRootWrapper(node.name)) {
            const directChildren = getDirectTemplateChildren(nodes, node);
            if (directChildren.length !== 1) {
                diagnostics.push({
                    message: `\`<${node.name}>\` should wrap exactly one direct child element or component.`,
                    range: node.nameRange,
                    severity: "warning"
                });
            }
        }

        if (isKeepAliveWrapper(node.name)) {
            const directChildren = getDirectTemplateChildren(nodes, node);
            if (directChildren.length === 0) {
                diagnostics.push({
                    message: "`<KeepAlive>` should wrap at least one direct child element or component.",
                    range: node.nameRange,
                    severity: "warning"
                });
            }
            const maxAttribute = getTemplateAttribute(node, "max");
            if (maxAttribute && !isValidKeepAliveMaxAttribute(maxAttribute)) {
                diagnostics.push({
                    message: "`<KeepAlive>` `max` should be a non-negative number or a `{{binding}}` / expression value.",
                    range: maxAttribute.range,
                    severity: "warning"
                });
            }
        }

        if (isSuspenseWrapper(node.name)) {
            const directChildren = getDirectTemplateChildren(nodes, node);
            const defaultChildren = directChildren.filter(child => !isSuspenseNamedSlotNode(child, "fallback") && !isSuspenseNamedSlotNode(child, "error"));
            if (defaultChildren.length === 0) {
                diagnostics.push({
                    message: "`<Suspense>` should wrap at least one default child element or component.",
                    range: node.nameRange,
                    severity: "warning"
                });
            }
            const timeoutAttribute = getTemplateAttribute(node, "timeout");
            if (timeoutAttribute && !isValidSuspenseTimeoutAttribute(timeoutAttribute)) {
                diagnostics.push({
                    message: "`<Suspense>` `timeout` should be a non-negative number or a `{{binding}}` / expression value.",
                    range: timeoutAttribute.range,
                    severity: "warning"
                });
            }
            for (const transitionAttribute of getSuspenseTransitionDurationAttributes(node)) {
                if (isValidSuspenseTimeoutAttribute(transitionAttribute)) {
                    continue;
                }
                diagnostics.push({
                    message: `\`<Suspense>\` \`${transitionAttribute.name}\` should be a non-negative number or a \`{{binding}}\` / expression value.`,
                    range: transitionAttribute.range,
                    severity: "warning"
                });
            }
            if (!hasSuspenseFallback(node, nodes)) {
                diagnostics.push({
                    message: "`<Suspense>` should provide a `fallback` attribute or a `<slot name=\"fallback\">` block so async states have visible feedback.",
                    range: node.nameRange,
                    severity: "information"
                });
            }
            if (!hasSuspenseErrorBoundary(node, nodes)) {
                diagnostics.push({
                    message: "`<Suspense>` should provide an `error` attribute or a `<slot name=\"error\">` block so async failures have visible feedback.",
                    range: node.nameRange,
                    severity: "information"
                });
            }
            if (hasSuspenseErrorBoundary(node, nodes) && !hasSuspenseRetryKey(node)) {
                diagnostics.push({
                    message: "`<Suspense>` error states can recover more explicitly when `retry-key` is bound to a changing value.",
                    range: node.nameRange,
                    severity: "information"
                });
            }
        }

        if (isTransitionGroupWrapper(node.name)) {
            const directChildren = getDirectTemplateChildren(nodes, node);
            if (directChildren.length === 0) {
                diagnostics.push({
                    message: "`<TransitionGroup>` should wrap at least one direct child element or component.",
                    range: node.nameRange,
                    severity: "warning"
                });
                continue;
            }
            for (const child of directChildren) {
                if (hasStableKeyAttribute(child)) {
                    continue;
                }
                diagnostics.push({
                    message: "`<TransitionGroup>` direct children should declare a stable `key` attribute so list transitions keep identity.",
                    range: child.nameRange,
                    severity: "warning"
                });
            }
        }
    }

    return {
        diagnostics,
        nodes
    };
}

function extractTemplateNodes(document, templateBlock, knownComponents, importedComponents) {
    const nodes = [];
    const diagnostics = [];
    const source = templateBlock.content;
    const stack = [];
    const tagRe = /<!--[\s\S]*?-->|<\/?([A-Za-z][\w:-]*)([^<>]*?)(\/?)>/g;

    for (const match of source.matchAll(tagRe)) {
        const fullMatch = match[0];
        if (fullMatch.startsWith("<!--")) {
            continue;
        }

        const name = match[1];
        const attrsSource = match[2] || "";
        const isClosing = fullMatch.startsWith("</");
        const start = templateBlock.contentStart + (match.index || 0);
        const nameStart = start + fullMatch.indexOf(name);
        const nameEnd = nameStart + name.length;
        const lowerName = name.toLowerCase();

        if (isClosing) {
            const stackIndex = findMatchingOpenTagIndex(stack, lowerName);
            if (stackIndex === -1) {
                diagnostics.push({
                    message: `Unexpected closing tag \`</${name}>\`.`,
                    range: rangeFromOffsets(document, nameStart, nameEnd),
                    severity: "warning"
                });
                continue;
            }

            if (stackIndex !== stack.length - 1) {
                const expectedNode = stack[stack.length - 1];
                diagnostics.push({
                    message: `Closing tag \`</${name}>\` does not match the currently open tag \`<${expectedNode.name}>\`.`,
                    range: rangeFromOffsets(document, nameStart, nameEnd),
                    severity: "warning"
                });
                for (let index = stack.length - 1; index > stackIndex; index -= 1) {
                    diagnostics.push({
                        message: `Tag \`<${stack[index].name}>\` is not closed.`,
                        range: stack[index].nameRange,
                        severity: "warning"
                    });
                }
            }
            const matchedNode = stack[stackIndex];
            matchedNode.closeStart = start;
            matchedNode.closeEnd = start + fullMatch.length;
            stack.splice(stackIndex);
            continue;
        }

        const attrsStart = nameEnd;
        const componentSymbol = knownComponents.get(lowerName) || null;
        const importedComponentSymbol = getKnownTemplateComponent(importedComponents, name);
        const attrAnalysis = extractTemplateAttributes(document, attrsSource, attrsStart);
        diagnostics.push(...attrAnalysis.diagnostics);
        const parentNode = stack[stack.length - 1] || null;

        const node = {
            attrs: attrAnalysis.attrs,
            children: [],
            closeEnd: null,
            closeStart: null,
            componentSymbol,
            importedComponentSymbol,
            kind: classifyTemplateTag(name, lowerName, componentSymbol || importedComponentSymbol),
            name,
            nameRange: rangeFromOffsets(document, nameStart, nameEnd),
            nodeIndex: nodes.length,
            openEnd: start + fullMatch.length,
            openStart: start,
            parentIndex: parentNode?.nodeIndex ?? null
        };
        parentNode?.children.push(node.nodeIndex);
        nodes.push(node);

        const selfClosing = match[3] === "/" || HTML_VOID_TAGS.has(lowerName);
        if (!selfClosing) {
            stack.push(node);
        }
    }

    for (const node of stack) {
        diagnostics.push({
            message: `Tag \`<${node.name}>\` is not closed.`,
            range: node.nameRange,
            severity: "warning"
        });
    }

    return {
        diagnostics,
        nodes
    };
}

function extractTemplateAttributes(document, source, baseOffset) {
    const attrs = [];
    const diagnostics = [];
    const seen = new Map();
    const attrRe = /([:@$A-Za-z_][\w:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|{{([\s\S]*?)}}|([^\s"'=<>`]+)))?/g;
    for (const match of source.matchAll(attrRe)) {
        const name = match[1];
        const fullStart = baseOffset + (match.index || 0);
        const fullEnd = fullStart + match[0].length;
        const start = fullStart + match[0].indexOf(name);
        const value = match[2] ?? match[3] ?? match[4] ?? match[5] ?? "";
        const rawValue = extractAttributeRawValue(match[0]);
        const rawValueStart = rawValue ? fullStart + match[0].lastIndexOf(rawValue) : null;
        const valueInfo = resolveAttributeValueInfo(document, rawValueStart, rawValue, value);
        const normalized = name.toLowerCase();
        if (seen.has(normalized)) {
            diagnostics.push({
                message: `Duplicate attribute \`${name}\` on the same element.`,
                range: rangeFromOffsets(document, start, start + name.length),
                severity: "warning"
            });
        } else {
            seen.set(normalized, true);
        }
        attrs.push({
            endOffset: fullEnd,
            fullRange: rangeFromOffsets(document, fullStart, fullEnd),
            name,
            range: rangeFromOffsets(document, start, start + name.length),
            startOffset: fullStart,
            value,
            valueKind: valueInfo.kind,
            valueRange: valueInfo.range,
            valueStartOffset: valueInfo.startOffset
        });
    }
    return {
        attrs,
        diagnostics
    };
}

function extractAttributeRawValue(matchText) {
    const equalIndex = matchText.indexOf("=");
    if (equalIndex < 0) {
        return "";
    }
    return matchText.slice(equalIndex + 1).trimStart();
}

function resolveAttributeValueInfo(document, rawValueStart, rawValue, value) {
    if (!rawValue) {
        return {
            kind: "boolean",
            range: null,
            startOffset: null
        };
    }

    const rawStart = rawValueStart ?? 0;

    if ((rawValue.startsWith("\"") && rawValue.endsWith("\"")) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
        const innerStart = rawStart + 1;
        const innerEnd = innerStart + Math.max(0, rawValue.length - 2);
        return {
            kind: isNumericLiteral(value) ? "number" : "string",
            range: rangeFromOffsets(document, innerStart, innerEnd),
            startOffset: innerStart
        };
    }

    if (rawValue.startsWith("{{") && rawValue.endsWith("}}")) {
        const innerStart = rawStart + 2;
        const innerEnd = rawStart + rawValue.length - 2;
        return {
            kind: "mustache",
            range: rangeFromOffsets(document, innerStart, innerEnd),
            startOffset: innerStart
        };
    }

    return {
        kind: isNumericLiteral(value) ? "number" : "expression",
        range: rangeFromOffsets(document, rawStart, rawStart + rawValue.length),
        startOffset: rawStart
    };
}

function classifyTemplateTag(name, lowerName, componentSymbol) {
    if (HTML_TAGS.includes(lowerName)) {
        return "html";
    }
    if (componentSymbol) {
        return "component";
    }
    if (looksLikeComponentTag(name)) {
        return "component";
    }
    if (BUILTIN_TEMPLATE_ELEMENTS.has(lowerName)) {
        return "builtin";
    }
    return "unknown";
}

function looksLikeComponentTag(name) {
    return /^[A-Z]/.test(name);
}

function findMatchingOpenTagIndex(stack, lowerName) {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].name.toLowerCase() === lowerName) {
            return index;
        }
    }
    return -1;
}

function getKnownTemplateComponent(componentMap, name) {
    if (!componentMap) {
        return null;
    }
    if (componentMap.has(name)) {
        return componentMap.get(name);
    }
    const lowerName = String(name || "").toLowerCase();
    for (const symbol of componentMap.values()) {
        if (symbol.name.toLowerCase() === lowerName) {
            return symbol;
        }
    }
    return null;
}

function getTemplateAttribute(node, name) {
    const lowerName = String(name || "").toLowerCase();
    return node?.attrs?.find(attr => attr.name.toLowerCase() === lowerName) || null;
}

function buildTemplateDocumentSymbols(document, nodes, parentIndex = null) {
    const symbols = [];
    for (const node of nodes.filter(item => item.parentIndex === parentIndex)) {
        const children = buildTemplateDocumentSymbols(document, nodes, node.nodeIndex);
        if (!shouldExposeTemplateSymbol(node)) {
            symbols.push(...children);
            continue;
        }
        symbols.push({
            children,
            kind: node.kind === "component" ? "component" : "tag",
            name: getTemplateSymbolName(node),
            range: rangeFromOffsets(document, node.openStart, node.closeEnd || node.openEnd),
            selectionRange: node.nameRange
        });
    }
    return symbols;
}

function buildSelectionRangeChain(document, analysis, offset) {
    const ranges = [];
    const seen = new Set();
    const token = readIdentifierAt(document.getText(), offset);
    if (token) {
        pushSelectionCandidate(ranges, seen, rangeFromOffsets(document, token.start, token.end));
    }

    const block = getBlockAtOffset(analysis.descriptor, offset);
    if (block?.type === "template") {
        const attribute = getTemplateAttributeAtOffset(analysis.templateAnalysis, offset);
        if (attribute) {
            pushSelectionCandidate(ranges, seen, attribute.range);
        }
        const containingNodes = getContainingTemplateNodes(analysis.templateAnalysis, offset);
        for (const node of containingNodes) {
            pushSelectionCandidate(ranges, seen, rangeFromOffsets(document, node.openStart, node.closeEnd || node.openEnd));
        }
    }

    if (block) {
        pushSelectionCandidate(ranges, seen, rangeFromOffsets(document, block.start, block.end));
    }
    pushSelectionCandidate(ranges, seen, {
        start: document.positionAt(0),
        end: document.positionAt(document.getText().length)
    });

    const sortedRanges = ranges.sort(compareRangesBySize);
    let parent = null;
    for (let index = sortedRanges.length - 1; index >= 0; index -= 1) {
        parent = {
            parent,
            range: sortedRanges[index]
        };
    }
    return parent;
}

function getDirectTemplateChildren(nodes, parentNode) {
    return nodes.filter(node => node.parentIndex === parentNode.nodeIndex);
}

function isSingleRootWrapper(name) {
    return String(name || "").toLowerCase() === "transition";
}

function isKeepAliveWrapper(name) {
    return String(name || "").toLowerCase() === "keepalive";
}

function isSuspenseWrapper(name) {
    return String(name || "").toLowerCase() === "suspense";
}

function isTransitionGroupWrapper(name) {
    return String(name || "").toLowerCase() === "transitiongroup";
}

function hasStableKeyAttribute(node) {
    return !!getTemplateAttribute(node, "key");
}

function isValidKeepAliveMaxAttribute(attribute) {
    if (!attribute) {
        return true;
    }
    if (attribute.valueKind === "mustache" || attribute.valueKind === "expression") {
        return true;
    }
    if (attribute.valueKind === "number") {
        const parsed = Number(attribute.value);
        return Number.isFinite(parsed) && parsed >= 0;
    }
    return false;
}

function isValidSuspenseTimeoutAttribute(attribute) {
    if (!attribute) {
        return true;
    }
    if (attribute.valueKind === "mustache" || attribute.valueKind === "expression") {
        return true;
    }
    if (attribute.valueKind === "number") {
        const parsed = Number(attribute.value);
        return Number.isFinite(parsed) && parsed >= 0;
    }
    if (attribute.valueKind === "string") {
        return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(String(attribute.value || "").trim())
            && Number(attribute.value) >= 0;
    }
    return false;
}

function getSuspenseTransitionDurationAttributes(node) {
    return [
        getTemplateAttribute(node, "transition-duration"),
        getTemplateAttribute(node, "transition-enter-duration"),
        getTemplateAttribute(node, "transition-leave-duration")
    ].filter(Boolean);
}

function isSuspenseNamedSlotNode(node, slotName) {
    if (!node || String(node.name || "").toLowerCase() !== "slot") {
        return false;
    }
    const nameAttribute = getTemplateAttribute(node, "name");
    return String(nameAttribute?.value || "").trim().toLowerCase() === String(slotName || "").toLowerCase();
}

function hasSuspenseFallback(node, nodes) {
    if (getTemplateAttribute(node, "fallback")) {
        return true;
    }
    return getDirectTemplateChildren(nodes, node).some(child => isSuspenseNamedSlotNode(child, "fallback"));
}

function hasSuspenseErrorBoundary(node, nodes) {
    if (getTemplateAttribute(node, "error")) {
        return true;
    }
    return getDirectTemplateChildren(nodes, node).some(child => isSuspenseNamedSlotNode(child, "error"));
}

function hasSuspenseRetryKey(node) {
    return !!(getTemplateAttribute(node, "retry-key") || getTemplateAttribute(node, "retryKey"));
}

function shouldExposeTemplateSymbol(node) {
    return node.kind === "component"
        || node.kind === "builtin"
        || hasStructuralTemplateAttribute(node)
        || ["route", "module", "slot"].includes(String(node.name || "").toLowerCase());
}

function hasStructuralTemplateAttribute(node) {
    return !!node?.attrs?.some(attr => /^x-(if|elseif|else|repeat|slot|route|router|module|show|field)$/i.test(attr.name));
}

function getTemplateSymbolName(node) {
    const lowerName = String(node.name || "").toLowerCase();
    if (lowerName === "slot") {
        const namePreview = getTemplateAttributePreview(getTemplateAttribute(node, "name"));
        if (namePreview) {
            return `${node.name} (${namePreview})`;
        }
        return `${node.name} (default)`;
    }
    if (lowerName === "suspense") {
        const previews = [];
        const timeoutPreview = getTemplateAttributePreview(getTemplateAttribute(node, "timeout"));
        const fallbackPreview = getTemplateAttributePreview(getTemplateAttribute(node, "fallback"));
        const errorPreview = getTemplateAttributePreview(getTemplateAttribute(node, "error"));
        const retryPreview = getTemplateAttributePreview(getTemplateAttribute(node, "retry-key") || getTemplateAttribute(node, "retryKey"));
        const transitionPreview = getTemplateAttributePreview(getTemplateAttribute(node, "transition-name"))
            || (getTemplateAttribute(node, "branch-transition") ? "enabled" : null);
        if (timeoutPreview) {
            previews.push(`timeout=${timeoutPreview}`);
        }
        if (fallbackPreview) {
            previews.push(`fallback=${fallbackPreview}`);
        }
        if (errorPreview) {
            previews.push(`error=${errorPreview}`);
        }
        if (retryPreview) {
            previews.push(`retry-key=${retryPreview}`);
        }
        if (transitionPreview) {
            previews.push(`transition=${transitionPreview}`);
        }
        if (previews.length > 0) {
            return `${node.name} (${previews.join(", ")})`;
        }
    }
    if (lowerName === "keepalive") {
        const previews = ["include", "exclude", "max"]
            .map(name => {
                const preview = getTemplateAttributePreview(getTemplateAttribute(node, name));
                return preview ? `${name}=${preview}` : null;
            })
            .filter(Boolean);
        if (previews.length > 0) {
            return `${node.name} (${previews.join(", ")})`;
        }
    }
    if (lowerName === "teleport") {
        const targetPreview = getTemplateAttributePreview(getTemplateAttribute(node, "to"))
            || getTemplateAttributePreview(getTemplateAttribute(node, "target"));
        if (targetPreview) {
            return `${node.name} (${targetPreview})`;
        }
    }
    if (lowerName === "transition" || lowerName === "transitiongroup") {
        const previews = ["name", "duration", "move-duration"]
            .map(name => {
                const preview = getTemplateAttributePreview(getTemplateAttribute(node, name));
                return preview ? `${name}=${preview}` : null;
            })
            .filter(Boolean);
        if (previews.length > 0) {
            return `${node.name} (${previews.join(", ")})`;
        }
    }
    if (lowerName === "route") {
        const pathAttribute = getTemplateAttribute(node, "path");
        const pathPreview = getTemplateAttributePreview(pathAttribute);
        if (pathPreview) {
            return `${node.name} (${pathPreview})`;
        }
    }
    if (lowerName === "module") {
        const moduleAttribute = getTemplateAttribute(node, "name");
        const modulePreview = getTemplateAttributePreview(moduleAttribute);
        if (modulePreview) {
            return `${node.name} (${modulePreview})`;
        }
    }
    const structuralAttributes = (node.attrs || [])
        .filter(attr => /^x-(if|elseif|else|repeat|slot|route|router|module|show|field)$/i.test(attr.name))
        .map(attr => {
            const preview = getTemplateAttributePreview(attr);
            return preview && /^x-(if|elseif|repeat|show)$/i.test(attr.name)
                ? `${attr.name}=${preview}`
                : attr.name;
        });
    if (structuralAttributes.length === 0) {
        return node.name;
    }
    return `${node.name} (${structuralAttributes.join(", ")})`;
}

function getTemplateAttributePreview(attribute) {
    if (!attribute?.value) {
        return null;
    }
    const preview = String(attribute.value).trim().replace(/\s+/g, " ");
    if (!preview) {
        return null;
    }
    return preview.length > 24 ? `${preview.slice(0, 21)}...` : preview;
}

function getTemplateAttributeAtOffset(templateAnalysis, offset) {
    for (const node of templateAnalysis.nodes || []) {
        for (const attr of node.attrs || []) {
            if (offset >= attr.startOffset && offset <= attr.endOffset) {
                return attr;
            }
        }
    }
    return null;
}

function getContainingTemplateNodes(templateAnalysis, offset) {
    return (templateAnalysis.nodes || [])
        .filter(node => offset >= node.openStart && offset <= (node.closeEnd || node.openEnd))
        .sort((left, right) => ((left.closeEnd || left.openEnd) - left.openStart) - ((right.closeEnd || right.openEnd) - right.openStart));
}

function resolveTemplateBlockNavigation(analysis, offset) {
    const nodes = analysis.templateAnalysis.nodes || [];
    const currentNode = getContainingTemplateNodes(analysis.templateAnalysis, offset)[0] || null;
    const currentAttribute = getTemplateAttributeAtOffset(analysis.templateAnalysis, offset);
    const currentAttributeOwner = currentAttribute
        ? nodes.find(node => (node.attrs || []).includes(currentAttribute)) || currentNode
        : null;

    const attributeRelation = resolveSuspenseSlotNavigationFromAttribute(nodes, currentAttributeOwner, currentAttribute);
    if (attributeRelation) {
        return attributeRelation;
    }

    return resolveSuspenseSlotNavigationFromNode(nodes, currentNode);
}

function resolveSuspenseSlotNavigationFromAttribute(nodes, ownerNode, attribute) {
    if (!ownerNode || !attribute) {
        return null;
    }

    const lowerNodeName = String(ownerNode.name || "").toLowerCase();
    const lowerAttributeName = String(attribute.name || "").toLowerCase();
    if (lowerNodeName === "suspense" && (lowerAttributeName === "fallback" || lowerAttributeName === "error")) {
        return buildSuspenseSlotNavigation(nodes, ownerNode, lowerAttributeName, "suspense");
    }

    if (lowerNodeName === "slot" && lowerAttributeName === "name") {
        const slotName = String(attribute.value || "").trim().toLowerCase();
        if (slotName !== "fallback" && slotName !== "error") {
            return null;
        }
        const parentNode = getParentTemplateNode(nodes, ownerNode);
        if (!parentNode || !isSuspenseWrapper(parentNode.name)) {
            return null;
        }
        return buildSuspenseSlotNavigation(nodes, parentNode, slotName, "slot", ownerNode);
    }

    return null;
}

function resolveSuspenseSlotNavigationFromNode(nodes, node) {
    if (!node) {
        return null;
    }
    if (String(node.name || "").toLowerCase() !== "slot") {
        return null;
    }

    const slotName = String(getTemplateAttribute(node, "name")?.value || "").trim().toLowerCase();
    if (slotName !== "fallback" && slotName !== "error") {
        return null;
    }
    const parentNode = getParentTemplateNode(nodes, node);
    if (!parentNode || !isSuspenseWrapper(parentNode.name)) {
        return null;
    }
    return buildSuspenseSlotNavigation(nodes, parentNode, slotName, "slot", node);
}

function buildSuspenseSlotNavigation(nodes, suspenseNode, slotName, sourceKind, slotNode = null) {
    const matchedSlotNode = slotNode
        || getDirectTemplateChildren(nodes, suspenseNode).find(child => isSuspenseNamedSlotNode(child, slotName))
        || null;
    const suspenseAttribute = getTemplateAttribute(suspenseNode, slotName);
    const slotNameAttribute = matchedSlotNode ? getTemplateAttribute(matchedSlotNode, "name") : null;
    const referenceRanges = dedupeRanges([
        suspenseNode.nameRange,
        suspenseAttribute?.range,
        matchedSlotNode?.nameRange,
        slotNameAttribute?.range
    ]);

    if (referenceRanges.length === 0) {
        return null;
    }

    const definitionRange = sourceKind === "suspense"
        ? (slotNameAttribute?.range || matchedSlotNode?.nameRange || suspenseNode.nameRange)
        : (suspenseAttribute?.range || suspenseNode.nameRange);

    return definitionRange
        ? {
            definitionRange,
            referenceRanges
        }
        : null;
}

function dedupeRanges(ranges) {
    const seen = new Set();
    const deduped = [];
    for (const range of ranges) {
        if (!range) {
            continue;
        }
        const key = `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        deduped.push(range);
    }
    return deduped.sort(compareRanges);
}

function pushSelectionCandidate(ranges, seen, range) {
    if (!range) {
        return;
    }
    const key = `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
    if (seen.has(key)) {
        return;
    }
    seen.add(key);
    ranges.push(range);
}

function compareRangesBySize(left, right) {
    const leftSize = rangeSize(left);
    const rightSize = rangeSize(right);
    if (leftSize !== rightSize) {
        return leftSize - rightSize;
    }
    if (left.start.line !== right.start.line) {
        return left.start.line - right.start.line;
    }
    return left.start.character - right.start.character;
}

function rangeSize(range) {
    return ((range.end.line - range.start.line) * 10000) + (range.end.character - range.start.character);
}

function isBuiltInTemplateComponentName(name) {
    return BUILTIN_TEMPLATE_COMPONENTS.has(String(name || "").toLowerCase());
}

function isBuiltInTemplateAttribute(attributeName, nodeName) {
    const lowerAttributeName = String(attributeName || "").toLowerCase();
    const lowerNodeName = String(nodeName || "").toLowerCase();
    if (/^(x|e)-/.test(lowerAttributeName)) {
        return true;
    }
    if (lowerNodeName === "teleport") {
        return ["to", "target", "disabled"].includes(lowerAttributeName);
    }
    if (lowerNodeName === "transition" || lowerNodeName === "transitiongroup") {
        return [
            "name",
            "duration",
            "enter-duration",
            "leave-duration",
            "move-duration",
            "enter-from-class",
            "enter-active-class",
            "enter-to-class",
            "leave-from-class",
            "leave-active-class",
            "leave-to-class",
            "move-class"
        ].includes(lowerAttributeName);
    }
    if (lowerNodeName === "keepalive") {
        return ["disabled", "include", "exclude", "max"].includes(lowerAttributeName);
    }
    if (lowerNodeName === "suspense") {
        return [
            "error",
            "fallback",
            "timeout",
            "retry-key",
            "retrykey",
            "branch-transition",
            "transition-name",
            "transition-duration",
            "transition-enter-duration",
            "transition-leave-duration",
            "transition-enter-from-class",
            "transition-enter-active-class",
            "transition-enter-to-class",
            "transition-leave-from-class",
            "transition-leave-active-class",
            "transition-leave-to-class"
        ].includes(lowerAttributeName);
    }
    return false;
}

function hasTeleportTargetAttribute(node) {
    const attrs = new Map(node.attrs.map(item => [item.name.toLowerCase(), item.value]));
    if (attrs.has("to") || attrs.has("target")) {
        return true;
    }
    if (!attrs.has("disabled")) {
        return false;
    }
    const value = String(attrs.get("disabled") || "").trim().toLowerCase();
    return value === "" || value === "true" || value === "1";
}

function getTemplateNodeAtOffset(templateAnalysis, offset) {
    return templateAnalysis.nodes.find(node => offset >= node.openStart && offset <= node.openEnd) || null;
}

function getTemplateNodeContainingOffset(templateAnalysis, offset) {
    return (templateAnalysis.nodes || [])
        .filter(node => offset >= node.openStart && offset <= (node.closeEnd || node.openEnd))
        .sort((left, right) => {
            const leftSpan = (left.closeEnd || left.openEnd) - left.openStart;
            const rightSpan = (right.closeEnd || right.openEnd) - right.openStart;
            return leftSpan - rightSpan;
        })[0] || null;
}

function getParentTemplateNode(nodes, node) {
    if (!node || node.parentIndex === null || node.parentIndex === undefined) {
        return null;
    }
    return nodes.find(item => item.nodeIndex === node.parentIndex) || null;
}

function getTemplateScopedCompletions(templateAnalysis, offset) {
    const scopedSymbols = getTemplateScopedSymbols(templateAnalysis, offset);
    if (scopedSymbols.length === 0) {
        return [];
    }
    return SUSPENSE_SLOT_SCOPE_COMPLETIONS;
}

function getTemplateScopedSymbols(templateAnalysis, offset) {
    const nodes = templateAnalysis.nodes || [];
    const containingNodes = nodes
        .filter(node => offset >= node.openStart && offset <= (node.closeEnd || node.openEnd))
        .sort((left, right) => {
            const leftSpan = (left.closeEnd || left.openEnd) - left.openStart;
            const rightSpan = (right.closeEnd || right.openEnd) - right.openStart;
            return leftSpan - rightSpan;
        });
    const slotNode = containingNodes.find(node => String(node.name || "").toLowerCase() === "slot");
    if (!slotNode) {
        return [];
    }
    const parentNode = getParentTemplateNode(nodes, slotNode);
    if (!parentNode || !isSuspenseWrapper(parentNode.name)) {
        return [];
    }
    if (!isSuspenseNamedSlotNode(slotNode, "fallback") && !isSuspenseNamedSlotNode(slotNode, "error")) {
        return [];
    }
    return Array.from(SUSPENSE_SLOT_SCOPE_SYMBOLS.values());
}

function resolveTemplateScopedSymbol(templateAnalysis, offset, name) {
    if (!name) {
        return null;
    }
    return getTemplateScopedSymbols(templateAnalysis, offset).find(symbol => symbol.name === name) || null;
}

function getTemplateAttributeCompletions(node) {
    if (!node) {
        return [];
    }
    const contractCompletions = getComponentContractAttributeCompletions(node);
    if (node.name.toLowerCase() === "keepalive") {
        return [...contractCompletions, ...KEEPALIVE_ATTRIBUTE_COMPLETIONS];
    }
    if (node.name.toLowerCase() === "suspense") {
        return [...contractCompletions, ...SUSPENSE_ATTRIBUTE_COMPLETIONS, ...SUSPENSE_BRANCH_TRANSITION_ATTRIBUTE_COMPLETIONS];
    }
    if (["transition", "transitiongroup"].includes(node.name.toLowerCase())) {
        return [...contractCompletions, ...TRANSITION_ATTRIBUTE_COMPLETIONS];
    }
    if (node.name.toLowerCase() === "teleport") {
        return [...contractCompletions, ...TELEPORT_ATTRIBUTE_COMPLETIONS];
    }
    switch (node.name.toLowerCase()) {
        case "slot":
            return [
                ...contractCompletions,
                {
                    label: "name",
                    detail: "Named slot key",
                    kind: "html-attr",
                    insertText: 'name="$1"',
                    insertTextFormat: "snippet"
                },
                {
                    label: "innerRender",
                    detail: "Render slot content with the child module model",
                    kind: "html-attr",
                    insertText: 'innerRender="$1"',
                    insertTextFormat: "snippet"
                }
            ];
        case "route":
            return [
                ...contractCompletions,
                {
                    label: "path",
                    detail: "Route path to navigate to",
                    kind: "html-attr",
                    insertText: 'path="$1"',
                    insertTextFormat: "snippet"
                },
                {
                    label: "active",
                    detail: "Active-state model field",
                    kind: "html-attr",
                    insertText: 'active="$1"',
                    insertTextFormat: "snippet"
                }
            ];
        case "module":
            return [
                ...contractCompletions,
                {
                    label: "name",
                    detail: "Module class name",
                    kind: "html-attr",
                    insertText: 'name="$1"',
                    insertTextFormat: "snippet"
                }
            ];
        case "for":
        case "if":
        case "elseif":
        case "show":
        case "recur":
            return [
                ...contractCompletions,
                {
                    label: "cond",
                    detail: "Directive condition expression",
                    kind: "html-attr",
                    insertText: 'cond={{$1}}',
                    insertTextFormat: "snippet"
                }
            ];
        default:
            return contractCompletions;
    }
}

function createDuplicateAttributeAction(document, analysis, diagnostic) {
    if (!/Duplicate attribute/.test(diagnostic.message || "")) {
        return null;
    }
    const attribute = findTemplateAttributeByRange(analysis.templateAnalysis, diagnostic.range);
    if (!attribute?.fullRange) {
        return null;
    }
    return createChangesAction(
        `Remove duplicate attribute \`${attribute.name}\``,
        "quickfix",
        document.uri,
        [{
            newText: "",
            range: attribute.fullRange
        }],
        diagnostic
    );
}

function createExposeSetupSymbolAction(document, analysis, diagnostic) {
    if (!/Unknown template symbol/.test(diagnostic.message || "")) {
        return null;
    }
    if (!analysis.descriptor.script || analysis.descriptor.script.setup) {
        return null;
    }
    const name = extractIdentifierFromRange(document, diagnostic.range);
    if (!name || !analysis.scriptAnalysis.declarations.has(name)) {
        return null;
    }

    const script = analysis.descriptor.script;
    const setupBodyRange = findFunctionBody(script.content, /\bsetup\s*\([^)]*\)\s*\{/g);
    if (!setupBodyRange) {
        return null;
    }

    const setupBody = script.content.slice(setupBodyRange.bodyStart, setupBodyRange.bodyEnd);
    const returnObject = findReturnObject(setupBody);
    let edit;

    if (returnObject) {
        const setupBodyStart = script.contentStart + setupBodyRange.bodyStart;
        const returnBodyStart = setupBodyStart + returnObject.bodyStart;
        const returnBodyEnd = setupBodyStart + returnObject.bodyEnd;
        const closingIndent = getLineIndentAtOffset(document, returnBodyEnd);
        const entryIndent = `${closingIndent}  `;
        const entries = splitTopLevelEntries(returnObject.body).filter(entry => entry.text.trim());
        if (entries.length > 0) {
            const insertOffset = returnBodyStart + returnObject.body.trimEnd().length;
            edit = {
                newText: `,\n${entryIndent}${name}`,
                range: rangeFromOffsets(document, insertOffset, insertOffset)
            };
        } else {
            edit = {
                newText: `\n${entryIndent}${name}\n${closingIndent}`,
                range: rangeFromOffsets(document, returnBodyStart, returnBodyStart)
            };
        }
    } else {
        const setupBodyEnd = script.contentStart + setupBodyRange.bodyEnd;
        const closingIndent = getLineIndentAtOffset(document, setupBodyEnd);
        const insertOffset = getLineStartOffset(document, setupBodyEnd);
        edit = {
            newText: `${closingIndent}  return {\n${closingIndent}    ${name}\n${closingIndent}  };\n`,
            range: rangeFromOffsets(document, insertOffset, insertOffset)
        };
    }

    return createChangesAction(
        `Expose \`${name}\` from setup()`,
        "quickfix",
        document.uri,
        [edit],
        diagnostic
    );
}

function createComponentEventHandlerScaffoldAction(document, analysis, diagnostic) {
    if (!/Unknown template symbol/.test(diagnostic.message || "")) {
        return null;
    }
    const handlerName = extractIdentifierFromRange(document, diagnostic.range);
    if (!handlerName || analysis.scriptAnalysis.exposedSymbols.has(handlerName) || analysis.scriptAnalysis.declarations.has(handlerName)) {
        return null;
    }

    const attribute = findTemplateAttributeByRange(analysis.templateAnalysis, diagnostic.range);
    const nodes = analysis.templateAnalysis.nodes || [];
    const ownerNode = attribute
        ? nodes.find(node => (node.attrs || []).includes(attribute)) || null
        : null;
    if (!attribute || ownerNode?.kind !== "component" || !ownerNode.componentContract) {
        return null;
    }

    const eventName = normalizeComponentEventAttributeName(attribute.name);
    if (!eventName || !ownerNode.componentContract.emits.has(eventName)) {
        return null;
    }

    const scaffold = createComponentEventHandlerScaffoldEdits(document, analysis, handlerName, eventName);
    if (!scaffold) {
        return null;
    }

    if (scaffold.documentChanges) {
        return createWorkspaceEditAction(
            scaffold.title,
            "quickfix",
            [{
                edits: scaffold.documentChanges,
                textDocument: {
                    uri: document.uri,
                    version: null
                }
            }],
            diagnostic
        );
    }

    return createChangesAction(
        scaffold.title,
        "quickfix",
        document.uri,
        scaffold.edits,
        diagnostic
    );
}

function createComponentEventHandlerScaffoldEdits(document, analysis, handlerName, eventName) {
    const script = analysis.descriptor.script;
    if (!script?.content || !/^[A-Za-z_$][\w$]*$/.test(handlerName)) {
        return null;
    }

    if (script.setup) {
        const insertOffset = script.contentEnd;
        const lineIndent = getLineIndentAtOffset(document, insertOffset);
        const prefix = script.content.trim() ? "\n\n" : "\n";
        return {
            edits: [{
                newText: `${prefix}const ${handlerName} = (...args) => {\n${lineIndent}  // TODO: handle \`${eventName}\`\n${lineIndent}};\n`,
                range: rangeFromOffsets(document, insertOffset, insertOffset)
            }],
            title: `Create handler \`${handlerName}\` for \`${eventName}\``
        };
    }

    const setupBodyRange = findFunctionBody(script.content, /\bsetup\s*\([^)]*\)\s*\{/g);
    if (!setupBodyRange) {
        return null;
    }
    const setupBodyEnd = script.contentStart + setupBodyRange.bodyEnd;
    const closingIndent = getLineIndentAtOffset(document, setupBodyEnd);
    const entryIndent = `${closingIndent}  `;
    const insertOffset = getLineStartOffset(document, setupBodyEnd);
    const edits = [{
        newText: `${entryIndent}const ${handlerName} = (...args) => {\n${entryIndent}  // TODO: handle \`${eventName}\`\n${entryIndent}};\n`,
        range: rangeFromOffsets(document, insertOffset, insertOffset)
    }];

    const setupBody = script.content.slice(setupBodyRange.bodyStart, setupBodyRange.bodyEnd);
    const returnObject = findReturnObject(setupBody);
    if (returnObject) {
        const setupBodyStart = script.contentStart + setupBodyRange.bodyStart;
        const returnBodyStart = setupBodyStart + returnObject.bodyStart;
        const returnBodyEnd = setupBodyStart + returnObject.bodyEnd;
        const returnIndent = `${closingIndent}  `;
        const entries = splitTopLevelEntries(returnObject.body).filter(entry => entry.text.trim());
        if (entries.length > 0) {
            const returnInsertOffset = returnBodyStart + returnObject.body.trimEnd().length;
            edits.push({
                newText: `,\n${returnIndent}${handlerName}`,
                range: rangeFromOffsets(document, returnInsertOffset, returnInsertOffset)
            });
        } else {
            edits.push({
                newText: `\n${returnIndent}${handlerName}\n${closingIndent}`,
                range: rangeFromOffsets(document, returnBodyStart, returnBodyStart)
            });
        }
    } else {
        edits.push({
            newText: `${closingIndent}  return {\n${closingIndent}    ${handlerName}\n${closingIndent}  };\n`,
            range: rangeFromOffsets(document, insertOffset, insertOffset)
        });
    }

    return {
        documentChanges: edits,
        title: `Create and expose handler \`${handlerName}\` for \`${eventName}\``
    };
}

function createRegisterImportedComponentAction(document, analysis, diagnostic) {
    if (!/not registered in defineOptions/.test(diagnostic.message || "")) {
        return null;
    }
    const name = extractIdentifierFromRange(document, diagnostic.range);
    if (!name || !analysis.descriptor.script) {
        return null;
    }

    const script = analysis.descriptor.script;
    const source = script.content;
    const modulesRange = findDefineOptionsModulesRange(source);
    let edit;

    if (modulesRange) {
        const existingItems = source.slice(modulesRange.arrayStart + 1, modulesRange.arrayEnd).trim();
        const prefix = existingItems ? ", " : "";
        edit = {
            newText: `${prefix}${name}`,
            range: rangeFromOffsets(
                document,
                script.contentStart + modulesRange.arrayEnd,
                script.contentStart + modulesRange.arrayEnd
            )
        };
    } else if (script.setup) {
        const insertOffset = script.contentStart + findSetupHelperInsertOffset(source);
        edit = {
            newText: `\ndefineOptions({\n  modules: [${name}]\n});\n`,
            range: rangeFromOffsets(document, insertOffset, insertOffset)
        };
    } else {
        const exportObject = findExportDefaultObjectRange(source);
        if (!exportObject) {
            return null;
        }
        edit = {
            newText: `\n  modules: [${name}],`,
            range: rangeFromOffsets(
                document,
                script.contentStart + exportObject.bodyStart,
                script.contentStart + exportObject.bodyStart
            )
        };
    }

    return createChangesAction(
        `Register \`${name}\` in modules`,
        "quickfix",
        document.uri,
        [edit],
        diagnostic
    );
}

function createTeleportDisabledAction(document, analysis, diagnostic) {
    if (!/should declare a `to`\/`target` attribute/.test(diagnostic.message || "")) {
        return null;
    }
    const node = findTemplateNodeByRange(analysis.templateAnalysis, diagnostic.range);
    if (!node) {
        return null;
    }
    return createChangesAction(
        "Render Teleport in place with `disabled`",
        "quickfix",
        document.uri,
        [{
            newText: " disabled",
            range: rangeFromOffsets(document, node.openEnd - 1, node.openEnd - 1)
        }],
        diagnostic
    );
}

function createTeleportTargetAction(document, analysis, diagnostic) {
    if (!/should declare a `to`\/`target` attribute/.test(diagnostic.message || "")) {
        return null;
    }
    const node = findTemplateNodeByRange(analysis.templateAnalysis, diagnostic.range);
    if (!node) {
        return null;
    }
    return createChangesAction(
        "Add Teleport target `to=\"#modal-root\"`",
        "quickfix",
        document.uri,
        [{
            newText: ' to="#modal-root"',
            range: rangeFromOffsets(document, node.openEnd - 1, node.openEnd - 1)
        }],
        diagnostic
    );
}

function createClosingTagFixAction(document, diagnostic) {
    const mismatch = /Closing tag `<\/(.+?)>` does not match the currently open tag `<(.+?)>`\./.exec(diagnostic.message || "");
    if (!mismatch) {
        return null;
    }
    return createChangesAction(
        `Change closing tag to \`</${mismatch[2]}>\``,
        "quickfix",
        document.uri,
        [{
            newText: mismatch[2],
            range: diagnostic.range
        }],
        diagnostic
    );
}

function createUnclosedTagFixAction(document, analysis, diagnostic) {
    const match = /Tag `<(.+?)>` is not closed\./.exec(diagnostic.message || "");
    if (!match) {
        return null;
    }
    const node = findTemplateNodeByRange(analysis.templateAnalysis, diagnostic.range);
    const templateBlock = analysis.descriptor.template;
    if (!node || !templateBlock) {
        return null;
    }
    const insertOffset = findUnclosedTagInsertOffset(document, templateBlock, node);
    const indent = getLineIndentAtOffset(document, node.openStart);
    const prefix = requiresLeadingLineBreak(document, insertOffset) ? "\n" : "";
    return createChangesAction(
        `Insert closing tag \`</${match[1]}>\``,
        "quickfix",
        document.uri,
        [{
            newText: `${prefix}${indent}</${match[1]}>`,
            range: rangeFromOffsets(document, insertOffset, insertOffset)
        }],
        diagnostic
    );
}

function createRemoveUnexpectedClosingTagAction(document, diagnostic) {
    const match = /Unexpected closing tag `<\/(.+?)>`\./.exec(diagnostic.message || "");
    if (!match) {
        return null;
    }
    const closingRange = findFullClosingTagRange(document, diagnostic.range);
    if (!closingRange) {
        return null;
    }
    return createChangesAction(
        `Remove unexpected closing tag \`</${match[1]}>\``,
        "quickfix",
        document.uri,
        [{
            newText: "",
            range: closingRange
        }],
        diagnostic
    );
}

function createRepeatKeyAction(document, analysis, diagnostic) {
    if (!/`x-repeat` should declare a stable `key/.test(diagnostic.message || "")) {
        return null;
    }
    const attribute = findTemplateAttributeByRange(analysis.templateAnalysis, diagnostic.range);
    const node = attribute ? getTemplateNodeAtOffset(analysis.templateAnalysis, attribute.startOffset) : null;
    if (!node) {
        return null;
    }
    return createChangesAction(
        "Add stable repeat key `key={{id}}`",
        "quickfix",
        document.uri,
        [{
            newText: ' key={{id}}',
            range: rangeFromOffsets(document, node.openEnd - 1, node.openEnd - 1)
        }],
        diagnostic
    );
}

function createWrapSingleRootAction(document, analysis, diagnostic) {
    const match = /`<(.+?)>` should wrap exactly one direct child/.exec(diagnostic.message || "");
    if (!match) {
        return null;
    }
    const node = findTemplateNodeByRange(analysis.templateAnalysis, diagnostic.range);
    if (!node || node.closeStart === null || node.closeEnd === null) {
        return null;
    }
    const outerIndent = getLineIndentAtOffset(document, node.openStart);
    const wrapperIndent = `${outerIndent}  `;
    const contentIndent = `${wrapperIndent}  `;
    const currentContent = document.getText(rangeFromOffsets(document, node.openEnd, node.closeStart));
    const wrappedContent = normalizeIndentedBlock(currentContent, contentIndent);
    if (!wrappedContent) {
        return null;
    }
    return createChangesAction(
        `Wrap \`<${match[1]}>\` content in a single root <div>`,
        "refactor",
        document.uri,
        [{
            newText: `\n${wrapperIndent}<div class="${String(match[1]).toLowerCase()}-root">\n${wrappedContent}\n${wrapperIndent}</div>\n${outerIndent}`,
            range: rangeFromOffsets(document, node.openEnd, node.closeStart)
        }],
        diagnostic
    );
}

function createKeepAliveMaxAction(document, analysis, diagnostic) {
    if (!/`<KeepAlive>` `max` should be a non-negative number/.test(diagnostic.message || "")) {
        return null;
    }
    const attribute = findTemplateAttributeByRange(analysis.templateAnalysis, diagnostic.range);
    if (!attribute) {
        return null;
    }
    if (attribute.valueRange) {
        return createChangesAction(
            "Normalize KeepAlive max to `1`",
            "quickfix",
            document.uri,
            [{
                newText: "1",
                range: attribute.valueRange
            }],
            diagnostic
        );
    }
    return createChangesAction(
        "Set KeepAlive max to `1`",
        "quickfix",
        document.uri,
        [{
            newText: 'max="1"',
            range: attribute.fullRange
        }],
        diagnostic
    );
}

function createSuspenseTimeoutAction(document, analysis, diagnostic) {
    if (!/`<Suspense>` `timeout` should be a non-negative number/.test(diagnostic.message || "")) {
        return null;
    }
    const attribute = findTemplateAttributeByRange(analysis.templateAnalysis, diagnostic.range);
    if (!attribute) {
        return null;
    }
    if (attribute.valueRange) {
        return createChangesAction(
            "Normalize Suspense timeout to `0`",
            "quickfix",
            document.uri,
            [{
                newText: "0",
                range: attribute.valueRange
            }],
            diagnostic
        );
    }
    return createChangesAction(
        "Set Suspense timeout to `0`",
        "quickfix",
        document.uri,
        [{
            newText: 'timeout="0"',
            range: attribute.fullRange
        }],
        diagnostic
    );
}

function createSuspenseTransitionDurationAction(document, analysis, diagnostic) {
    const match = /`<Suspense>` `([^`]+)` should be a non-negative number/.exec(diagnostic.message || "");
    if (!match || !/^transition-(?:duration|enter-duration|leave-duration)$/.test(match[1])) {
        return null;
    }
    const attribute = findTemplateAttributeByRange(analysis.templateAnalysis, diagnostic.range);
    if (!attribute) {
        return null;
    }
    const replacement = "180";
    if (attribute.valueRange) {
        return createChangesAction(
            `Normalize Suspense ${attribute.name} to \`${replacement}\``,
            "quickfix",
            document.uri,
            [{
                newText: replacement,
                range: attribute.valueRange
            }],
            diagnostic
        );
    }
    return createChangesAction(
        `Set Suspense ${attribute.name} to \`${replacement}\``,
        "quickfix",
        document.uri,
        [{
            newText: `${attribute.name}="${replacement}"`,
            range: attribute.fullRange
        }],
        diagnostic
    );
}

function createSuspenseFallbackAction(document, analysis, diagnostic) {
    if (!/`<Suspense>` should provide a `fallback` attribute/.test(diagnostic.message || "")) {
        return null;
    }
    const node = findTemplateNodeByRange(analysis.templateAnalysis, diagnostic.range);
    if (!node) {
        return null;
    }
    return createChangesAction(
        'Add Suspense fallback `fallback="Loading..."`',
        "quickfix",
        document.uri,
        [{
            newText: ' fallback="Loading..."',
            range: rangeFromOffsets(document, node.openEnd - 1, node.openEnd - 1)
        }],
        diagnostic
    );
}

function createSuspenseFallbackSlotAction(document, analysis, diagnostic) {
    if (!/`<Suspense>` should provide a `fallback` attribute/.test(diagnostic.message || "")) {
        return null;
    }
    const node = findTemplateNodeByRange(analysis.templateAnalysis, diagnostic.range);
    if (!node || node.closeStart === null) {
        return null;
    }
    const insertionIndent = getLineIndentAtOffset(document, node.closeStart);
    const childIndent = `${insertionIndent}  `;
    return createChangesAction(
        "Add Suspense fallback slot block",
        "refactor",
        document.uri,
        [{
            newText: `\n${childIndent}<slot name="fallback">\n${childIndent}  <div>Loading...</div>\n${childIndent}</slot>`,
            range: rangeFromOffsets(document, node.closeStart, node.closeStart)
        }],
        diagnostic
    );
}

function createSuspenseErrorAction(document, analysis, diagnostic) {
    if (!/`<Suspense>` should provide an `error` attribute/.test(diagnostic.message || "")) {
        return null;
    }
    const node = findTemplateNodeByRange(analysis.templateAnalysis, diagnostic.range);
    if (!node) {
        return null;
    }
    return createChangesAction(
        'Add Suspense error `error="Load failed."`',
        "quickfix",
        document.uri,
        [{
            newText: ' error="Load failed."',
            range: rangeFromOffsets(document, node.openEnd - 1, node.openEnd - 1)
        }],
        diagnostic
    );
}

function createSuspenseErrorSlotAction(document, analysis, diagnostic) {
    if (!/`<Suspense>` should provide an `error` attribute/.test(diagnostic.message || "")) {
        return null;
    }
    const node = findTemplateNodeByRange(analysis.templateAnalysis, diagnostic.range);
    if (!node || node.closeStart === null) {
        return null;
    }
    const insertionIndent = getLineIndentAtOffset(document, node.closeStart);
    const childIndent = `${insertionIndent}  `;
    return createChangesAction(
        "Add Suspense error slot block",
        "refactor",
        document.uri,
        [{
            newText: `\n${childIndent}<slot name="error">\n${childIndent}  <div>Load failed.</div>\n${childIndent}</slot>`,
            range: rangeFromOffsets(document, node.closeStart, node.closeStart)
        }],
        diagnostic
    );
}

function createSuspenseRetryKeyAction(document, analysis, diagnostic) {
    if (!/`<Suspense>` error states can recover more explicitly when `retry-key`/.test(diagnostic.message || "")) {
        return null;
    }
    const node = findTemplateNodeByRange(analysis.templateAnalysis, diagnostic.range);
    if (!node || hasSuspenseRetryKey(node)) {
        return null;
    }
    return createChangesAction(
        'Add Suspense retry binding `retry-key={{retryToken}}`',
        "quickfix",
        document.uri,
        [{
            newText: ' retry-key={{retryToken}}',
            range: rangeFromOffsets(document, node.openEnd - 1, node.openEnd - 1)
        }],
        diagnostic
    );
}

function createConvertTransitionGroupAction(document, analysis, diagnostic) {
    if (!/`<Transition>` should wrap exactly one direct child/.test(diagnostic.message || "")) {
        return null;
    }
    const node = findTemplateNodeByRange(analysis.templateAnalysis, diagnostic.range);
    if (!node || node.closeStart === null || node.closeEnd === null) {
        return null;
    }
    const closingNameRange = findClosingTagNameRange(document, node);
    if (!closingNameRange) {
        return null;
    }
    return createChangesAction(
        "Convert `<Transition>` to `<TransitionGroup>`",
        "refactor",
        document.uri,
        [
            {
                newText: "TransitionGroup",
                range: node.nameRange
            },
            {
                newText: "TransitionGroup",
                range: closingNameRange
            }
        ],
        diagnostic
    );
}

function createTransitionGroupChildKeyAction(document, analysis, diagnostic) {
    if (!/`<TransitionGroup>` direct children should declare a stable `key` attribute/.test(diagnostic.message || "")) {
        return null;
    }
    const node = findTemplateNodeByRange(analysis.templateAnalysis, diagnostic.range);
    if (!node) {
        return null;
    }
    return createChangesAction(
        `Add stable child key \`${buildTransitionGroupKeyInsert(node).trim()}\``,
        "quickfix",
        document.uri,
        [{
            newText: buildTransitionGroupKeyInsert(node),
            range: rangeFromOffsets(document, node.openEnd - 1, node.openEnd - 1)
        }],
        diagnostic
    );
}

function createRoutePathAction(document, analysis, diagnostic) {
    if (!/`<route>` should declare a `path` attribute/.test(diagnostic.message || "")) {
        return null;
    }
    const node = findTemplateNodeByRange(analysis.templateAnalysis, diagnostic.range);
    if (!node) {
        return null;
    }
    return createChangesAction(
        "Add route path `path=\"/\"`",
        "quickfix",
        document.uri,
        [{
            newText: ' path="/"',
            range: rangeFromOffsets(document, node.openEnd - 1, node.openEnd - 1)
        }],
        diagnostic
    );
}

function createModuleNameAction(document, analysis, diagnostic) {
    if (!/`<module>` should declare a `name` attribute/.test(diagnostic.message || "")) {
        return null;
    }
    const node = findTemplateNodeByRange(analysis.templateAnalysis, diagnostic.range);
    if (!node) {
        return null;
    }
    return createChangesAction(
        "Add module name `name=\"ChildModule\"`",
        "quickfix",
        document.uri,
        [{
            newText: ' name="ChildModule"',
            range: rangeFromOffsets(document, node.openEnd - 1, node.openEnd - 1)
        }],
        diagnostic
    );
}

function createContextualTemplateRefactorActions(document, analysis, range) {
    if (!range || !analysis.descriptor.template) {
        return [];
    }
    const node = findTemplateNodeForActionRange(document, analysis.templateAnalysis, range);
    if (!node || !canRefactorTemplateNode(node)) {
        return [];
    }

    const actions = [];
    const lowerName = String(node.name || "").toLowerCase();

    if (lowerName === "slot") {
        const slotName = String(getTemplateAttribute(node, "name")?.value || "").trim().toLowerCase();
        if (slotName === "fallback" || slotName === "error") {
            const slotToAttrAction = createConvertSuspenseSlotNodeToAttributeAction(document, analysis, node, slotName);
            if (slotToAttrAction) {
                actions.push(slotToAttrAction);
            }
        } else {
            const inlineNamedSlotAction = createInlineNamedSlotBlockAction(document, node);
            if (inlineNamedSlotAction) {
                actions.push(inlineNamedSlotAction);
            }
        }
        return actions;
    }

    if (lowerName !== "transition" && lowerName !== "transitiongroup") {
        const wrapTransitionAction = createWrapTemplateNodeAction(
            document,
            node,
            "Transition",
            'name="fade"',
            "Wrap current node with `<Transition>`"
        );
        if (wrapTransitionAction) {
            actions.push(wrapTransitionAction);
        }
    }

    if (lowerName !== "keepalive") {
        const wrapKeepAliveAction = createWrapTemplateNodeAction(
            document,
            node,
            "KeepAlive",
            "",
            "Wrap current node with `<KeepAlive>`"
        );
        if (wrapKeepAliveAction) {
            actions.push(wrapKeepAliveAction);
        }
    }

    if (lowerName !== "suspense") {
        const wrapSuspenseAction = createWrapTemplateNodeAction(
            document,
            node,
            "Suspense",
            'fallback="Loading..." error="Load failed."',
            "Wrap current node with `<Suspense>`"
        );
        if (wrapSuspenseAction) {
            actions.push(wrapSuspenseAction);
        }
    }

    if (lowerName !== "teleport") {
        const wrapTeleportAction = createWrapTemplateNodeAction(
            document,
            node,
            "Teleport",
            'to="#modal-root"',
            "Wrap current node with `<Teleport>`"
        );
        if (wrapTeleportAction) {
            actions.push(wrapTeleportAction);
        }
    }

    const extractFallbackSlotAction = createExtractNodeToSuspenseSlotAction(document, analysis, node, "fallback");
    if (extractFallbackSlotAction) {
        actions.push(extractFallbackSlotAction);
    }
    const extractErrorSlotAction = createExtractNodeToSuspenseSlotAction(document, analysis, node, "error");
    if (extractErrorSlotAction) {
        actions.push(extractErrorSlotAction);
    }

    const extractNamedSlotAction = createExtractNodeToNamedSlotAction(document, analysis, node);
    if (extractNamedSlotAction) {
        actions.push(extractNamedSlotAction);
    }

    actions.push(...createSyncComponentContractUsageActions(document, analysis, node));
    actions.push(...createSyncChildComponentContractActions(analysis, node));

    if (lowerName === "suspense") {
        const fallbackSlotAction = createConvertSuspenseAttributeToSlotAction(document, analysis, node, "fallback");
        if (fallbackSlotAction) {
            actions.push(fallbackSlotAction);
        }
        const errorSlotAction = createConvertSuspenseAttributeToSlotAction(document, analysis, node, "error");
        if (errorSlotAction) {
            actions.push(errorSlotAction);
        }
        const fallbackAttrAction = createConvertSuspenseSlotToAttributeAction(document, analysis, node, "fallback");
        if (fallbackAttrAction) {
            actions.push(fallbackAttrAction);
        }
        const errorAttrAction = createConvertSuspenseSlotToAttributeAction(document, analysis, node, "error");
        if (errorAttrAction) {
            actions.push(errorAttrAction);
        }
    }

    const extractComponentAction = createExtractTemplateNodeComponentAction(document, analysis, node);
    if (extractComponentAction) {
        actions.push(extractComponentAction);
    }

    return actions;
}

function createSyncComponentContractUsageActions(document, analysis, node) {
    if (node?.kind !== "component" || !node.componentContract) {
        return [];
    }

    const sync = buildComponentContractSyncEdits(document, analysis, node);
    const cleanup = buildComponentContractCleanupEdits(document, analysis, node);
    if (!sync && !cleanup) {
        return [];
    }

    const actions = [];
    if (sync?.propEdit) {
        actions.push(createChangesAction(
            `Insert missing props from \`${node.name}\` contract`,
            "refactor.rewrite",
            document.uri,
            [
                sync.propEdit,
                ...sync.propScriptEdits
            ]
        ));
    }
    if (sync?.eventEdit) {
        actions.push(createChangesAction(
            `Insert missing event handlers from \`${node.name}\` contract`,
            "refactor.rewrite",
            document.uri,
            [
                sync.eventEdit,
                ...sync.eventScriptEdits
            ]
        ));
    }
    if (sync?.slotEdit) {
        actions.push(createChangesAction(
            `Insert missing named slots from \`${node.name}\` contract`,
            "refactor.rewrite",
            document.uri,
            [sync.slotEdit]
        ));
    }
    if (sync && (sync.allEdits.length > 1 || (sync.allEdits.length === 1 && (sync.missingProps.length + sync.missingEvents.length + sync.missingSlots.length) > 1))) {
        actions.push(createChangesAction(
            `Sync \`${node.name}\` with component contract`,
            "refactor.rewrite",
            document.uri,
            sync.allEdits
        ));
    }
    if (cleanup?.propEdits?.length) {
        actions.push(createChangesAction(
            `Remove unknown props from \`${node.name}\` usage`,
            "refactor.rewrite",
            document.uri,
            cleanup.propEdits
        ));
    }
    if (cleanup?.eventEdits?.length) {
        actions.push(createChangesAction(
            `Remove unknown event handlers from \`${node.name}\` usage`,
            "refactor.rewrite",
            document.uri,
            cleanup.eventEdits
        ));
    }
    if (cleanup?.slotEdits?.length) {
        actions.push(createChangesAction(
            `Remove unknown named slots from \`${node.name}\` usage`,
            "refactor.rewrite",
            document.uri,
            cleanup.slotEdits
        ));
    }
    if (cleanup && (cleanup.allEdits.length > 1 || (cleanup.allEdits.length === 1 && (cleanup.unknownProps.length + cleanup.unknownEvents.length + cleanup.unknownSlots.length) > 1))) {
        actions.push(createChangesAction(
            `Prune \`${node.name}\` usage to component contract`,
            "refactor.rewrite",
            document.uri,
            cleanup.allEdits
        ));
    }
    if (sync && cleanup) {
        const normalizeEdits = [
            ...sync.allEdits,
            ...cleanup.allEdits
        ];
        if (normalizeEdits.length > 0) {
            actions.push(createChangesAction(
                `Normalize \`${node.name}\` usage against component contract`,
                "refactor.rewrite",
                document.uri,
                normalizeEdits
            ));
        }
    }
    return actions;
}

function createSyncChildComponentContractActions(analysis, node) {
    if (node?.kind !== "component" || !node.componentContract) {
        return [];
    }

    const syncAll = buildComponentContractDefinitionSyncEdit(analysis, node);
    if (!syncAll) {
        return [];
    }

    const actions = [
        createWorkspaceEditAction(
            `Sync \`${node.name}\` child contract from current usage`,
            "refactor.rewrite",
            [{
                edits: syncAll.edits,
                textDocument: {
                    uri: syncAll.uri,
                    version: null
                }
            }]
        )
    ];

    const syncProps = buildComponentContractDefinitionSyncEdit(analysis, node, {
        includeEvents: false,
        includeProps: true,
        includeSlots: false
    });
    if (syncProps) {
        actions.push(createWorkspaceEditAction(
            `Sync \`${node.name}\` child props from current usage`,
            "refactor.rewrite",
            [{
                edits: syncProps.edits,
                textDocument: {
                    uri: syncProps.uri,
                    version: null
                }
            }]
        ));
    }

    const syncEvents = buildComponentContractDefinitionSyncEdit(analysis, node, {
        includeEvents: true,
        includeProps: false,
        includeSlots: false
    });
    if (syncEvents) {
        actions.push(createWorkspaceEditAction(
            `Sync \`${node.name}\` child emits from current usage`,
            "refactor.rewrite",
            [{
                edits: syncEvents.edits,
                textDocument: {
                    uri: syncEvents.uri,
                    version: null
                }
            }]
        ));
    }

    const syncSlots = buildComponentContractDefinitionSyncEdit(analysis, node, {
        includeEvents: false,
        includeProps: false,
        includeSlots: true
    });
    if (syncSlots) {
        actions.push(createWorkspaceEditAction(
            `Sync \`${node.name}\` child slots from current usage`,
            "refactor.rewrite",
            [{
                edits: syncSlots.edits,
                textDocument: {
                    uri: syncSlots.uri,
                    version: null
                }
            }]
        ));
    }

    return actions;
}

function buildComponentContractDefinitionSyncEdit(analysis, node, options = {}) {
    const includeProps = options.includeProps !== false;
    const includeEvents = options.includeEvents !== false;
    const includeSlots = options.includeSlots !== false;
    const componentUri = node?.componentSymbol?.targetUri || node?.importedComponentSymbol?.targetUri || null;
    if (!componentUri) {
        return null;
    }
    const context = readNdComponentSourceContext(componentUri);
    if (!context?.descriptor?.script?.setup) {
        return null;
    }

    const missingProps = [];
    const missingEvents = [];
    const missingSlots = [];
    for (const attr of node.attrs || []) {
        const eventName = normalizeComponentEventAttributeName(attr.name);
        if (eventName) {
            if (!node.componentContract.emits.has(eventName)) {
                missingEvents.push(eventName);
            }
            continue;
        }
        if (shouldIgnoreComponentAttribute(attr.name)) {
            continue;
        }
        const propName = normalizeContractPropName(attr.name);
        if (propName && !node.componentContract.props.has(propName)) {
            missingProps.push(propName);
        }
    }

    for (const child of getDirectTemplateChildren(analysis.templateAnalysis.nodes || [], node)) {
        if (String(child?.name || "").toLowerCase() !== "slot") {
            continue;
        }
        const slotName = normalizeContractSlotName(String(getTemplateAttribute(child, "name")?.value || "").trim());
        if (slotName && slotName !== "default" && !node.componentContract.slots.has(slotName)) {
            missingSlots.push(slotName);
        }
    }

    const uniqueProps = Array.from(new Set(missingProps.map(normalizePropRenameInput).filter(Boolean)));
    const uniqueEvents = Array.from(new Set(missingEvents.map(normalizeEventRenameInput).filter(Boolean)));
    const uniqueSlots = Array.from(new Set(missingSlots.map(normalizeSlotRenameInput).filter(Boolean)));

    const edits = [];
    if (includeProps && uniqueProps.length > 0) {
        const edit = createPropContractInsertionEdit(context, uniqueProps);
        if (edit) {
            edits.push(edit);
        }
    }
    if (includeEvents && uniqueEvents.length > 0) {
        const edit = createEmitContractInsertionEdit(context, uniqueEvents);
        if (edit) {
            edits.push(edit);
        }
    }
    if (includeSlots && uniqueSlots.length > 0) {
        const edit = createSlotContractInsertionEdit(context, uniqueSlots);
        if (edit) {
            edits.push(edit);
        }
    }

    if (edits.length === 0) {
        return null;
    }
    return {
        edits,
        uri: componentUri
    };
}

function buildComponentContractCleanupEdits(document, analysis, node) {
    const contract = node.componentContract;
    const unknownPropAttributes = [];
    const unknownEventAttributes = [];
    const unknownSlotNodes = [];

    for (const attr of node.attrs || []) {
        const eventName = normalizeComponentEventAttributeName(attr.name);
        if (eventName) {
            if (!contract.emits.has(eventName)) {
                unknownEventAttributes.push(attr);
            }
            continue;
        }
        if (shouldIgnoreComponentAttribute(attr.name)) {
            continue;
        }
        const propName = normalizeContractPropName(attr.name);
        if (propName && !contract.props.has(propName)) {
            unknownPropAttributes.push(attr);
        }
    }

    for (const child of getDirectTemplateChildren(analysis.templateAnalysis.nodes || [], node)) {
        if (String(child?.name || "").toLowerCase() !== "slot") {
            continue;
        }
        const slotName = normalizeContractSlotName(String(getTemplateAttribute(child, "name")?.value || "").trim());
        if (slotName && slotName !== "default" && !contract.slots.has(slotName)) {
            unknownSlotNodes.push(child);
        }
    }

    const propEdits = unknownPropAttributes.map(attr => ({
        newText: "",
        range: expandAttributeRemovalRange(document, attr.fullRange)
    }));
    const eventEdits = unknownEventAttributes.map(attr => ({
        newText: "",
        range: expandAttributeRemovalRange(document, attr.fullRange)
    }));
    const slotEdits = unknownSlotNodes.map(child => ({
        newText: "",
        range: expandTemplateNodeRemovalRange(document, child)
    }));

    const allEdits = [
        ...propEdits,
        ...eventEdits,
        ...slotEdits
    ];
    if (allEdits.length === 0) {
        return null;
    }

    return {
        allEdits,
        eventEdits,
        propEdits,
        slotEdits,
        unknownEvents: unknownEventAttributes,
        unknownProps: unknownPropAttributes,
        unknownSlots: unknownSlotNodes
    };
}

function buildComponentContractSyncEdits(document, analysis, node) {
    const contract = node.componentContract;
    const existingProps = new Set();
    const existingEvents = new Set();
    for (const attr of node.attrs || []) {
        const eventName = normalizeComponentEventAttributeName(attr.name);
        if (eventName) {
            existingEvents.add(eventName);
            continue;
        }
        if (!shouldIgnoreComponentAttribute(attr.name)) {
            existingProps.add(normalizeContractPropName(attr.name));
        }
    }

    const existingSlots = new Set();
    for (const child of getDirectTemplateChildren(analysis.templateAnalysis.nodes || [], node)) {
        if (String(child.name || "").toLowerCase() !== "slot") {
            continue;
        }
        const slotName = String(getTemplateAttribute(child, "name")?.value || "").trim();
        if (!slotName) {
            continue;
        }
        existingSlots.add(normalizeContractSlotName(slotName));
    }

    const missingProps = Array.from(contract.props.values())
        .filter(entry => !existingProps.has(normalizeContractPropName(entry.label)));
    const missingEvents = Array.from(contract.emits.values())
        .filter(entry => !existingEvents.has(normalizeContractEventName(entry.label)));
    const missingSlots = Array.from(contract.slots.values())
        .filter(entry => normalizeContractSlotName(entry.label) !== "default" && !existingSlots.has(normalizeContractSlotName(entry.label)));
    const propScriptEdits = createComponentContractPropBindingScaffoldEdits(document, analysis, missingProps);
    const eventScriptEdits = createComponentContractEventHandlerBatchScaffoldEdits(document, analysis, missingEvents);
    const isSelfClosing = isTemplateSelfClosingNode(document, node);

    const insertionOffset = resolveTemplateAttributeInsertOffset(document, node);
    const propSnippet = missingProps
        .map(entry => ` ${normalizeContractPropName(entry.label)}={{${buildContractBindingName(entry.label)}}}`)
        .join("");
    const eventSnippet = missingEvents
        .map(entry => ` ${formatEventAttributeLabel(entry.label)}={{${buildContractHandlerName(entry.label)}}}`)
        .join("");

    const propEdit = propSnippet
        ? {
            newText: propSnippet,
            range: rangeFromOffsets(document, insertionOffset, insertionOffset)
        }
        : null;
    const eventEdit = eventSnippet
        ? {
            newText: eventSnippet,
            range: rangeFromOffsets(document, insertionOffset, insertionOffset)
        }
        : null;
    const combinedAttrEdit = (propSnippet || eventSnippet)
        ? {
            newText: `${propSnippet}${eventSnippet}`,
            range: rangeFromOffsets(document, insertionOffset, insertionOffset)
        }
        : null;

    let slotEdit = null;
    let syncTemplateEdit = combinedAttrEdit;
    if (missingSlots.length > 0 && node.closeStart !== null && node.closeStart !== undefined) {
        const insertionIndent = getLineIndentAtOffset(document, node.closeStart);
        const childIndent = `${insertionIndent}  `;
        const bodyIndent = `${childIndent}  `;
        slotEdit = {
            newText: `\n${missingSlots.map(entry => `${childIndent}<slot name="${entry.label}">\n${bodyIndent}<div>${entry.label} content</div>\n${childIndent}</slot>`).join("\n")}`,
            range: rangeFromOffsets(document, node.closeStart, node.closeStart)
        };
    } else if (missingSlots.length > 0 && isSelfClosing) {
        slotEdit = {
            newText: buildExpandedComponentContractNode(document, node, "", missingSlots),
            range: rangeFromOffsets(document, node.openStart, node.openEnd)
        };
        syncTemplateEdit = {
            newText: buildExpandedComponentContractNode(document, node, `${propSnippet}${eventSnippet}`, missingSlots),
            range: rangeFromOffsets(document, node.openStart, node.openEnd)
        };
    }

    const mergedEdits = [];
    if (isSelfClosing && missingSlots.length > 0) {
        mergedEdits.push(syncTemplateEdit);
    } else {
        if (combinedAttrEdit && (missingProps.length > 0 || missingEvents.length > 0)) {
            mergedEdits.push(combinedAttrEdit);
        }
    }
    mergedEdits.push(...propScriptEdits);
    mergedEdits.push(...eventScriptEdits);
    if (slotEdit && (!isSelfClosing || missingSlots.length === 0)) {
        mergedEdits.push(slotEdit);
    }

    if (mergedEdits.length === 0) {
        return null;
    }

    return {
        allEdits: mergedEdits,
        eventEdit: missingEvents.length > 0 ? eventEdit : null,
        eventScriptEdits,
        missingEvents,
        missingProps,
        missingSlots,
        propEdit: missingProps.length > 0 ? propEdit : null,
        propScriptEdits,
        slotEdit
    };
}

function buildContractBindingName(label) {
    return toCamelCase(normalizeContractPropName(label) || label) || "value";
}

function buildContractHandlerName(label) {
    const normalized = normalizeContractEventName(label);
    const segments = normalized.split(/[:\-]+/).filter(Boolean);
    const suffix = segments
        .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join("");
    return `handle${suffix || "Event"}`;
}

function createComponentContractPropBindingScaffoldEdits(document, analysis, missingProps) {
    const bindingNames = Array.from(new Set(
        (missingProps || [])
            .map(entry => buildContractBindingName(entry.label))
            .filter(name => /^[A-Za-z_$][\w$]*$/.test(name))
            .filter(name => !analysis.scriptAnalysis.exposedSymbols.has(name) && !analysis.scriptAnalysis.declarations.has(name))
    ));
    if (bindingNames.length === 0) {
        return [];
    }
    const script = analysis.descriptor.script;
    if (!script?.content) {
        return [];
    }

    if (script.setup) {
        const insertOffset = script.contentEnd;
        const prefix = script.content.trim() ? "\n\n" : "\n";
        const block = bindingNames
            .map(name => `const ${name} = ${buildContractBindingInitializer(name)};`)
            .join("\n\n");
        return [{
            newText: `${prefix}${block}\n`,
            range: rangeFromOffsets(document, insertOffset, insertOffset)
        }];
    }

    const setupBodyRange = findFunctionBody(script.content, /\bsetup\s*\([^)]*\)\s*\{/g);
    if (!setupBodyRange) {
        return [];
    }
    const setupBodyEnd = script.contentStart + setupBodyRange.bodyEnd;
    const closingIndent = getLineIndentAtOffset(document, setupBodyEnd);
    const entryIndent = `${closingIndent}  `;
    const insertOffset = getLineStartOffset(document, setupBodyEnd);
    const edits = [{
        newText: `${bindingNames.map(name => `${entryIndent}const ${name} = ${buildContractBindingInitializer(name)};`).join("\n\n")}\n`,
        range: rangeFromOffsets(document, insertOffset, insertOffset)
    }];

    appendSetupReturnExposureEdits(edits, document, script, setupBodyRange, bindingNames);
    return edits;
}

function createComponentContractEventHandlerBatchScaffoldEdits(document, analysis, missingEvents) {
    const handlerSpecs = Array.from(new Map(
        (missingEvents || [])
            .map(entry => {
                const handlerName = buildContractHandlerName(entry.label);
                return [handlerName, {
                    eventName: normalizeContractEventName(entry.label),
                    handlerName
                }];
            })
            .filter(([, spec]) =>
                /^[A-Za-z_$][\w$]*$/.test(spec.handlerName)
                && !analysis.scriptAnalysis.exposedSymbols.has(spec.handlerName)
                && !analysis.scriptAnalysis.declarations.has(spec.handlerName)
            )
    ).values());
    if (handlerSpecs.length === 0) {
        return [];
    }
    const script = analysis.descriptor.script;
    if (!script?.content) {
        return [];
    }

    if (script.setup) {
        const insertOffset = script.contentEnd;
        const lineIndent = getLineIndentAtOffset(document, insertOffset);
        const prefix = script.content.trim() ? "\n\n" : "\n";
        const block = handlerSpecs
            .map(spec => `const ${spec.handlerName} = (...args) => {\n${lineIndent}  // TODO: handle \`${spec.eventName}\`\n${lineIndent}};`)
            .join("\n\n");
        return [{
            newText: `${prefix}${block}\n`,
            range: rangeFromOffsets(document, insertOffset, insertOffset)
        }];
    }

    const setupBodyRange = findFunctionBody(script.content, /\bsetup\s*\([^)]*\)\s*\{/g);
    if (!setupBodyRange) {
        return [];
    }
    const setupBodyEnd = script.contentStart + setupBodyRange.bodyEnd;
    const closingIndent = getLineIndentAtOffset(document, setupBodyEnd);
    const entryIndent = `${closingIndent}  `;
    const insertOffset = getLineStartOffset(document, setupBodyEnd);
    const edits = [{
        newText: `${handlerSpecs.map(spec => `${entryIndent}const ${spec.handlerName} = (...args) => {\n${entryIndent}  // TODO: handle \`${spec.eventName}\`\n${entryIndent}};`).join("\n\n")}\n`,
        range: rangeFromOffsets(document, insertOffset, insertOffset)
    }];

    appendSetupReturnExposureEdits(edits, document, script, setupBodyRange, handlerSpecs.map(spec => spec.handlerName));
    return edits;
}

function appendSetupReturnExposureEdits(edits, document, script, setupBodyRange, names) {
    const uniqueNames = Array.from(new Set((names || []).filter(Boolean)));
    if (uniqueNames.length === 0) {
        return;
    }
    const setupBody = script.content.slice(setupBodyRange.bodyStart, setupBodyRange.bodyEnd);
    const returnObject = findReturnObject(setupBody);
    const setupBodyEnd = script.contentStart + setupBodyRange.bodyEnd;
    const closingIndent = getLineIndentAtOffset(document, setupBodyEnd);

    if (returnObject) {
        const setupBodyStart = script.contentStart + setupBodyRange.bodyStart;
        const returnBodyStart = setupBodyStart + returnObject.bodyStart;
        const returnIndent = `${closingIndent}  `;
        const entries = splitTopLevelEntries(returnObject.body).filter(entry => entry.text.trim());
        if (entries.length > 0) {
            const returnInsertOffset = returnBodyStart + returnObject.body.trimEnd().length;
            edits.push({
                newText: `,\n${returnIndent}${uniqueNames.join(`,\n${returnIndent}`)}`,
                range: rangeFromOffsets(document, returnInsertOffset, returnInsertOffset)
            });
        } else {
            edits.push({
                newText: `\n${returnIndent}${uniqueNames.join(`,\n${returnIndent}`)}\n${closingIndent}`,
                range: rangeFromOffsets(document, returnBodyStart, returnBodyStart)
            });
        }
        return;
    }

    const insertOffset = getLineStartOffset(document, setupBodyEnd);
    edits.push({
        newText: `${closingIndent}  return {\n${closingIndent}    ${uniqueNames.join(`,\n${closingIndent}    `)}\n${closingIndent}  };\n`,
        range: rangeFromOffsets(document, insertOffset, insertOffset)
    });
}

function buildContractBindingInitializer(name) {
    const normalized = toCamelCase(name);
    if (/^(is|has|can|should|show|allow|enable|visible|ready|disabled|checked|selected|loading|open)/i.test(normalized)) {
        return "false";
    }
    if (/(list|items|rows|options|children|records|tabs|steps|messages|users)$/i.test(normalized)) {
        return "[]";
    }
    if (/(count|total|size|length|index|page|limit|max|min|age|time|duration|offset|amount|price|score|year|month|day)$/i.test(normalized)) {
        return "0";
    }
    if (/(data|config|payload|model|options|meta|detail|details|params|filters)$/i.test(normalized)) {
        return "{}";
    }
    return "\"\"";
}

function isTemplateSelfClosingNode(document, node) {
    const openTagText = document.getText(rangeFromOffsets(document, node.openStart, node.openEnd));
    return /\/>\s*$/.test(openTagText);
}

function resolveTemplateAttributeInsertOffset(document, node) {
    const openTagText = document.getText(rangeFromOffsets(document, node.openStart, node.openEnd));
    const suffixMatch = /\/?>\s*$/.exec(openTagText);
    if (!suffixMatch) {
        return node.openEnd - 1;
    }
    return node.openStart + suffixMatch.index;
}

function buildExpandedComponentContractNode(document, node, attrSnippet, slotEntries) {
    const currentIndent = getLineIndentAtOffset(document, node.openStart);
    const childIndent = `${currentIndent}  `;
    const bodyIndent = `${childIndent}  `;
    const openTagText = document.getText(rangeFromOffsets(document, node.openStart, node.openEnd));
    const expandedOpenTag = openTagText.replace(/\s*\/>\s*$/, `${attrSnippet}>`);
    const slotBlocks = (slotEntries || [])
        .map(entry => `${childIndent}<slot name="${entry.label}">\n${bodyIndent}<div>${entry.label} content</div>\n${childIndent}</slot>`)
        .join("\n");
    return `${expandedOpenTag}\n${slotBlocks}\n${currentIndent}</${node.name}>`;
}

function findUnclosedTagInsertOffset(document, templateBlock, node) {
    const text = document.getText();
    const searchStart = node.openEnd;
    const templateEnd = templateBlock.contentEnd;
    const afterOpen = text.slice(searchStart, templateEnd);
    const nextClosing = /<\/[A-Za-z][\w:-]*\s*>/.exec(afterOpen);
    if (nextClosing) {
        return searchStart + nextClosing.index;
    }
    return templateEnd;
}

function requiresLeadingLineBreak(document, offset) {
    if (offset <= 0) {
        return false;
    }
    const previous = document.getText(rangeFromOffsets(document, offset - 1, offset));
    return previous !== "\n";
}

function findFullClosingTagRange(document, range) {
    if (!range) {
        return null;
    }
    const text = document.getText();
    const startOffset = document.offsetAt(range.start);
    const endOffset = document.offsetAt(range.end);
    const openOffset = text.lastIndexOf("</", startOffset);
    if (openOffset < 0) {
        return null;
    }
    const closeOffset = text.indexOf(">", endOffset);
    if (closeOffset < 0) {
        return null;
    }
    return rangeFromOffsets(document, openOffset, closeOffset + 1);
}

function findClosingTagNameRange(document, node) {
    if (node?.closeStart === null || node?.closeStart === undefined) {
        return null;
    }
    const text = document.getText();
    const closeText = text.slice(node.closeStart, node.closeEnd || node.closeStart);
    const nameMatch = /^<\/([A-Za-z][\w:-]*)/.exec(closeText);
    if (!nameMatch) {
        return null;
    }
    const nameStart = node.closeStart + closeText.indexOf(nameMatch[1]);
    return rangeFromOffsets(document, nameStart, nameStart + nameMatch[1].length);
}

function buildTransitionGroupKeyInsert(node) {
    const repeatAttribute = getTemplateAttribute(node, "x-repeat");
    if (repeatAttribute) {
        return " key={{id}}";
    }
    const idAttribute = getTemplateAttribute(node, "id");
    const idPreview = getTemplateAttributePreview(idAttribute);
    const keyValue = sanitizeStaticKey(String(idPreview || `${String(node.name || "item").toLowerCase()}-item`));
    return ` key="${keyValue}"`;
}

function sanitizeStaticKey(value) {
    return String(value || "item")
        .replace(/^['"]|['"]$/g, "")
        .replace(/[{}]/g, "")
        .replace(/\s+/g, "-")
        .replace(/[^A-Za-z0-9_-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        || "item";
}

function findTemplateNodeForActionRange(document, templateAnalysis, range) {
    if (!range) {
        return null;
    }
    const startOffset = document.offsetAt(range.start);
    const endOffset = document.offsetAt(range.end);
    const collapsed = startOffset === endOffset;

    const candidates = (templateAnalysis.nodes || [])
        .filter(node => {
            const nodeEnd = node.closeEnd || node.openEnd;
            if (collapsed) {
                return startOffset >= node.openStart && startOffset <= nodeEnd;
            }
            return startOffset >= node.openStart && endOffset <= nodeEnd;
        })
        .sort((left, right) => ((left.closeEnd || left.openEnd) - left.openStart) - ((right.closeEnd || right.openEnd) - right.openStart));

    return candidates[0] || null;
}

function canRefactorTemplateNode(node) {
    const lowerName = String(node?.name || "").toLowerCase();
    if (lowerName === "slot") {
        const slotName = String(getTemplateAttribute(node, "name")?.value || "").trim().toLowerCase();
        return !!slotName;
    }
    return !!node
        && lowerName !== "slot"
        && lowerName !== "template"
        && !["if", "else", "elseif", "endif", "for", "router", "route", "module"].includes(lowerName);
}

function createWrapTemplateNodeAction(document, node, wrapperName, wrapperAttributes = "", title) {
    const nodeEnd = node.closeEnd || node.openEnd;
    if (!nodeEnd || nodeEnd <= node.openStart) {
        return null;
    }

    const outerIndent = getLineIndentAtOffset(document, node.openStart);
    const innerIndent = `${outerIndent}  `;
    const currentNodeText = document.getText(rangeFromOffsets(document, node.openStart, nodeEnd));
    const wrappedNodeText = normalizeIndentedBlock(currentNodeText, innerIndent);
    if (!wrappedNodeText) {
        return null;
    }

    const openTag = wrapperAttributes
        ? `<${wrapperName} ${wrapperAttributes}>`
        : `<${wrapperName}>`;

    return createChangesAction(
        title,
        "refactor",
        document.uri,
        [{
            newText: `${openTag}\n${wrappedNodeText}\n${outerIndent}</${wrapperName}>`,
            range: rangeFromOffsets(document, node.openStart, nodeEnd)
        }]
    );
}

function createExtractTemplateNodeComponentAction(document, analysis, node) {
    const scriptBlock = analysis.descriptor.script;
    if (!scriptBlock?.setup) {
        return null;
    }

    const nodeEnd = node.closeEnd || node.openEnd;
    if (!nodeEnd || nodeEnd <= node.openStart) {
        return null;
    }

    const subtreeNodes = collectTemplateSubtreeNodes(analysis.templateAnalysis.nodes || [], node);
    const bindingResult = collectExtractableTemplateBindings(analysis, node);
    if (!bindingResult.supported) {
        return null;
    }

    const componentImports = collectExtractableComponentImports(subtreeNodes);
    if (!componentImports.supported) {
        return null;
    }

    const bindingNames = new Set(bindingResult.bindings.map(item => item.name));
    if (componentImports.imports.some(item => bindingNames.has(item.name))) {
        return null;
    }

    const componentName = buildExtractedComponentName(node, analysis);
    const componentUri = resolveSiblingDocumentUri(document.uri, `${componentName}.nd`);
    const importSpecifier = `./${componentName}.nd`;
    const replacement = buildExtractedComponentInvocation(componentName, bindingResult.bindings);
    const templateRange = rangeFromOffsets(document, node.openStart, nodeEnd);
    const scriptInsertOffset = scriptBlock.contentStart + findSetupHelperInsertOffset(scriptBlock.content);
    const modulesRange = findDefineOptionsModulesRange(scriptBlock.content);
    const mainDocumentEdits = [
        {
            newText: replacement,
            range: templateRange
        }
    ];

    if (modulesRange) {
        mainDocumentEdits.push({
            newText: `import ${componentName} from "${importSpecifier}";\n`,
            range: rangeFromOffsets(document, scriptInsertOffset, scriptInsertOffset)
        });
        const existingItems = scriptBlock.content.slice(modulesRange.arrayStart + 1, modulesRange.arrayEnd).trim();
        mainDocumentEdits.push({
            newText: `${existingItems ? ", " : ""}${componentName}`,
            range: rangeFromOffsets(
                document,
                scriptBlock.contentStart + modulesRange.arrayEnd,
                scriptBlock.contentStart + modulesRange.arrayEnd
            )
        });
    } else {
        mainDocumentEdits.push({
            newText: `import ${componentName} from "${importSpecifier}";\n\ndefineOptions({\n  modules: [${componentName}]\n});\n`,
            range: rangeFromOffsets(document, scriptInsertOffset, scriptInsertOffset)
        });
    }

    const childDocumentText = buildExtractedComponentDocument(
        document,
        node,
        bindingResult.bindings,
        componentImports.imports
    );

    return createWorkspaceEditAction(
        `Extract current node to local component \`${componentName}.nd\``,
        "refactor.extract",
        [
            {
                kind: "create",
                uri: componentUri
            },
            {
                textDocument: {
                    uri: document.uri,
                    version: document.version ?? null
                },
                edits: mainDocumentEdits
            },
            {
                textDocument: {
                    uri: componentUri,
                    version: null
                },
                edits: [{
                    newText: childDocumentText,
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 0, character: 0 }
                    }
                }]
            }
        ]
    );
}

function collectTemplateSubtreeNodes(nodes, rootNode) {
    const collected = [];
    const pending = [rootNode.nodeIndex];
    const nodeMap = new Map((nodes || []).map(node => [node.nodeIndex, node]));

    while (pending.length > 0) {
        const nodeIndex = pending.shift();
        const current = nodeMap.get(nodeIndex);
        if (!current) {
            continue;
        }
        collected.push(current);
        for (const childIndex of current.children || []) {
            pending.push(childIndex);
        }
    }

    return collected;
}

function collectExtractableTemplateBindings(analysis, node) {
    const bindings = [];
    const seen = new Set();
    const nodeEnd = node.closeEnd || node.openEnd;
    const functionLikeBindings = new Set();
    for (const subtreeNode of collectTemplateSubtreeNodes(analysis.templateAnalysis.nodes || [], node)) {
        for (const attr of subtreeNode.attrs || []) {
            if (!attr?.name?.startsWith("e-")) {
                continue;
            }
            for (const token of collectExpressionIdentifierReferences(attr.value, attr.valueStartOffset || 0)) {
                functionLikeBindings.add(token.name);
            }
        }
    }
    const references = collectSimpleTemplateReferences(
        analysis.descriptor.template || { content: "", contentStart: 0, contentEnd: 0 },
        analysis.templateAnalysis
    ).filter(reference => reference.offset >= node.openStart && reference.offset <= nodeEnd);

    for (const reference of references) {
        if (BUILTIN_IDENTIFIERS.has(reference.name) || seen.has(reference.name)) {
            continue;
        }
        const symbol = resolveKnownSymbolAtOffset(analysis, reference.name, reference.offset);
        if (!symbol || symbol.defaultLibrary || symbol.kind === "component") {
            return {
                bindings: [],
                supported: false
            };
        }
        seen.add(reference.name);
        bindings.push({
            kind: functionLikeBindings.has(reference.name) ? "function" : symbol.kind,
            name: reference.name
        });
    }

    return {
        bindings,
        supported: true
    };
}

function collectExtractableComponentImports(nodes) {
    const imports = [];
    const seen = new Set();

    for (const node of nodes) {
        if (node.kind !== "component") {
            continue;
        }
        const symbol = node.importedComponentSymbol || node.componentSymbol;
        if (!symbol) {
            continue;
        }
        if (!symbol.targetUri || !symbol.specifier) {
            return {
                imports: [],
                supported: false
            };
        }
        const importKey = `${symbol.name}:${symbol.specifier}`;
        if (seen.has(importKey)) {
            continue;
        }
        seen.add(importKey);
        imports.push({
            name: symbol.name,
            specifier: symbol.specifier
        });
    }

    return {
        imports,
        supported: true
    };
}

function buildExtractedComponentName(node, analysis) {
    const classPreview = getTemplateAttributePreview(getTemplateAttribute(node, "class"));
    const idPreview = getTemplateAttributePreview(getTemplateAttribute(node, "id"));
    const base = toPascalCase(String(classPreview || idPreview || node.name || "ExtractedBlock"));
    const suffix = looksLikeComponentTag(String(node.name || ""))
        ? "Block"
        : toPascalCase(String(node.name || "Section"));
    const preferred = `${base}${base.endsWith(suffix) ? "" : suffix}` || "ExtractedBlock";
    const takenNames = new Set([
        ...analysis.scriptAnalysis.declarations.keys(),
        ...analysis.scriptAnalysis.exposedSymbols.keys(),
        ...analysis.scriptAnalysis.templateComponents.keys(),
        ...analysis.scriptAnalysis.importedTemplateComponents.keys()
    ]);

    let candidate = preferred;
    let counter = 2;
    while (takenNames.has(candidate)) {
        candidate = `${preferred}${counter}`;
        counter += 1;
    }
    return candidate;
}

function buildExtractedComponentInvocation(componentName, bindings) {
    const attrs = bindings.map(binding => `${binding.name}={{${binding.name}}}`).join(" ");
    return attrs ? `<${componentName} ${attrs} />` : `<${componentName} />`;
}

function buildExtractedComponentDocument(document, node, bindings, componentImports) {
    const nodeEnd = node.closeEnd || node.openEnd;
    const nodeText = document.getText(rangeFromOffsets(document, node.openStart, nodeEnd));
    const templateContent = normalizeIndentedBlock(nodeText, "  ");
    const importLines = [];
    if (componentImports.length > 0) {
        importLines.push(...componentImports.map(item => `import ${item.name} from "${item.specifier}";`));
    }
    if (bindings.some(binding => binding.kind !== "function")) {
        importLines.push('import { useComputed } from "nodomx";');
    }

    const scriptLines = [];
    if (importLines.length > 0) {
        scriptLines.push(...importLines, "");
    }
    if (componentImports.length > 0) {
        scriptLines.push(
            "defineOptions({",
            `  modules: [${componentImports.map(item => item.name).join(", ")}]`,
            "});",
            ""
        );
    }
    if (bindings.length > 0) {
        scriptLines.push("const props = defineProps();");
        for (const binding of bindings) {
            if (binding.kind === "function") {
                scriptLines.push(`const ${binding.name} = (...args) => props.${binding.name}?.(...args);`);
            } else {
                scriptLines.push(`const ${binding.name} = useComputed(() => props.${binding.name});`);
            }
        }
    }

    const normalizedScriptLines = trimTrailingBlankLines(scriptLines);
    const scriptContent = normalizedScriptLines.length > 0
        ? `${normalizedScriptLines.join("\n")}\n`
        : "";

    return [
        "<template>",
        templateContent,
        "</template>",
        "",
        "<script setup>",
        scriptContent,
        "</script>",
        ""
    ].join("\n");
}

function createExtractNodeToNamedSlotAction(document, analysis, node) {
    if (!node || String(node.name || "").toLowerCase() === "slot") {
        return null;
    }

    const nodeEnd = node.closeEnd || node.openEnd;
    if (!nodeEnd || nodeEnd <= node.openStart) {
        return null;
    }

    const slotName = buildNamedTemplateSlotName(node, analysis);
    const currentIndent = getLineIndentAtOffset(document, node.openStart);
    const slotContent = normalizeIndentedBlock(
        document.getText(rangeFromOffsets(document, node.openStart, nodeEnd)),
        `${currentIndent}  `
    );

    return createChangesAction(
        `Extract current node to named slot block \`${slotName}\``,
        "refactor.extract",
        document.uri,
        [{
            newText: `<slot name="${slotName}">\n${slotContent}\n${currentIndent}</slot>`,
            range: rangeFromOffsets(document, node.openStart, nodeEnd)
        }]
    );
}

function createInlineNamedSlotBlockAction(document, node) {
    if (!node || String(node.name || "").toLowerCase() !== "slot") {
        return null;
    }

    const slotName = String(getTemplateAttribute(node, "name")?.value || "").trim();
    if (!slotName || /^(fallback|error)$/i.test(slotName) || node.closeStart === null || node.closeStart === undefined) {
        return null;
    }

    const innerContent = document.getText(rangeFromOffsets(document, node.openEnd, node.closeStart));
    if (!innerContent.trim()) {
        return null;
    }

    return createChangesAction(
        `Inline named slot block \`${slotName}\``,
        "refactor.inline",
        document.uri,
        [{
            newText: normalizeIndentedBlock(innerContent, getLineIndentAtOffset(document, node.openStart)),
            range: rangeFromOffsets(document, node.openStart, node.closeEnd || node.openEnd)
        }]
    );
}

function buildNamedTemplateSlotName(node, analysis) {
    const seed = getTemplateAttributePreview(getTemplateAttribute(node, "class"))
        || getTemplateAttributePreview(getTemplateAttribute(node, "id"))
        || getTemplateAttributePreview(getTemplateAttribute(node, "name"))
        || String(node.name || "content");
    const normalizedSeed = toKebabCase(seed).replace(/-slot$/i, "") || "content";
    const takenNames = new Set(
        (analysis.templateAnalysis.nodes || [])
            .filter(item => String(item.name || "").toLowerCase() === "slot")
            .map(item => toKebabCase(String(getTemplateAttribute(item, "name")?.value || "")))
            .filter(Boolean)
    );

    let candidate = `${normalizedSeed}-slot`;
    let counter = 2;
    while (takenNames.has(candidate)) {
        candidate = `${normalizedSeed}-slot-${counter}`;
        counter += 1;
    }
    return candidate;
}

function createExtractNodeToSuspenseSlotAction(document, analysis, node, slotName) {
    if (!node || String(node.name || "").toLowerCase() === "slot") {
        return null;
    }
    const parentNode = getParentTemplateNode(analysis.templateAnalysis.nodes || [], node);
    if (!parentNode || !isSuspenseWrapper(parentNode.name)) {
        return null;
    }
    const directChildren = getDirectTemplateChildren(analysis.templateAnalysis.nodes || [], parentNode);
    if (directChildren.some(child => isSuspenseNamedSlotNode(child, slotName))) {
        return null;
    }
    const nodeEnd = node.closeEnd || node.openEnd;
    const nodeText = document.getText(rangeFromOffsets(document, node.openStart, nodeEnd));
    const currentIndent = getLineIndentAtOffset(document, node.openStart);
    const slotContent = normalizeIndentedBlock(nodeText, `${currentIndent}  `);
    const replacement = [
        `<slot name="${slotName}">`,
        slotContent,
        `${currentIndent}</slot>`
    ].join("\n");

    return createChangesAction(
        `Extract current node to Suspense ${slotName} slot block`,
        "refactor.extract",
        document.uri,
        [{
            newText: replacement,
            range: rangeFromOffsets(document, node.openStart, nodeEnd)
        }]
    );
}

function resolveSiblingDocumentUri(documentUri, filename) {
    try {
        return new URL(`./${filename}`, documentUri).href;
    } catch {
        return documentUri.replace(/[^/]+$/, filename);
    }
}

function toPascalCase(value) {
    const parts = String(value || "")
        .replace(/\.[^.]+$/, "")
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean);
    return parts.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join("") || "Extracted";
}

function toKebabCase(value) {
    return String(value || "")
        .replace(/\.[^.]+$/, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/[^A-Za-z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase();
}

function createConvertSuspenseAttributeToSlotAction(document, analysis, node, slotName) {
    if (!node || String(node.name || "").toLowerCase() !== "suspense" || node.closeStart === null || node.closeStart === undefined) {
        return null;
    }

    const attribute = getTemplateAttribute(node, slotName);
    if (!attribute) {
        return null;
    }

    const directChildren = getDirectTemplateChildren(analysis.templateAnalysis.nodes || [], node);
    if (directChildren.some(child => isSuspenseNamedSlotNode(child, slotName))) {
        return null;
    }

    const slotText = escapeTemplateText(String(attribute.value || ""));
    const outerIndent = getLineIndentAtOffset(document, node.openStart);
    const slotIndent = `${outerIndent}  `;
    const contentIndent = `${slotIndent}  `;
    const slotRange = rangeFromOffsets(document, node.closeStart, node.closeStart);
    const removeRange = expandAttributeRemovalRange(document, attribute.fullRange);

    return createChangesAction(
        `Convert Suspense ${slotName} attribute to slot block`,
        "refactor",
        document.uri,
        [
            {
                newText: "",
                range: removeRange
            },
            {
                newText: `\n${slotIndent}<slot name="${slotName}">\n${contentIndent}<div>${slotText || (slotName === "fallback" ? "Loading..." : "Load failed.")}</div>\n${slotIndent}</slot>\n${outerIndent}`,
                range: slotRange
            }
        ]
    );
}

function expandAttributeRemovalRange(document, range) {
    if (!range) {
        return range;
    }
    const text = document.getText();
    let startOffset = document.offsetAt(range.start);
    const endOffset = document.offsetAt(range.end);
    while (startOffset > 0) {
        const previous = text[startOffset - 1];
        if (previous === "\n" || previous === "\r" || !/\s/.test(previous)) {
            break;
        }
        startOffset -= 1;
    }
    return rangeFromOffsets(document, startOffset, endOffset);
}

function escapeTemplateText(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function normalizeIndentedBlock(source, indent) {
    const lines = normalizeLineEndings(source).split("\n");
    while (lines.length > 0 && lines[0].trim() === "") {
        lines.shift();
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
        lines.pop();
    }
    if (lines.length === 0) {
        return "";
    }
    const minIndent = lines
        .filter(line => line.trim().length > 0)
        .reduce((min, line) => {
            const currentIndent = (/^\s*/.exec(line)?.[0].length) || 0;
            return Math.min(min, currentIndent);
        }, Number.MAX_SAFE_INTEGER);
    return lines.map(line => {
        if (!line.trim()) {
            return "";
        }
        return `${indent}${line.slice(minIndent)}`;
    }).join("\n");
}

function createConvertSuspenseSlotToAttributeAction(document, analysis, node, slotName) {
    const directChildren = getDirectTemplateChildren(analysis.templateAnalysis.nodes || [], node);
    const slotNode = directChildren.find(child => isSuspenseNamedSlotNode(child, slotName));
    if (!slotNode) {
        return null;
    }
    return createConvertSuspenseSlotNodeToAttributeAction(document, analysis, slotNode, slotName);
}

function createConvertSuspenseSlotNodeToAttributeAction(document, analysis, slotNode, slotName) {
    if (!slotNode || String(slotNode.name || "").toLowerCase() !== "slot") {
        return null;
    }
    const nodes = analysis.templateAnalysis.nodes || [];
    const parentNode = getParentTemplateNode(nodes, slotNode);
    if (!parentNode || !isSuspenseWrapper(parentNode.name) || getTemplateAttribute(parentNode, slotName)) {
        return null;
    }
    const slotValue = extractSuspenseSlotAttributeValue(document, slotNode, slotName);
    return createChangesAction(
        `Convert Suspense ${slotName} slot block to ${slotName} attribute`,
        "refactor",
        document.uri,
        [
            {
                newText: ` ${slotName}=${slotValue}`,
                range: rangeFromOffsets(document, parentNode.openEnd - 1, parentNode.openEnd - 1)
            },
            {
                newText: "",
                range: expandTemplateNodeRemovalRange(document, slotNode)
            }
        ]
    );
}

function extractSuspenseSlotAttributeValue(document, slotNode, slotName) {
    const fallbackValue = slotName === "error" ? "Load failed." : "Loading...";
    if (slotNode.closeStart === null || slotNode.closeStart === undefined) {
        return JSON.stringify(fallbackValue);
    }
    const rawContent = document.getText(rangeFromOffsets(document, slotNode.openEnd, slotNode.closeStart)).trim();
    const mustacheMatch = /^\{\{\s*([\s\S]+?)\s*\}\}$/.exec(rawContent);
    if (mustacheMatch) {
        return `{{${mustacheMatch[1].trim()}}}`;
    }
    const normalizedText = rawContent
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return JSON.stringify(normalizedText || fallbackValue);
}

function expandTemplateNodeRemovalRange(document, node) {
    const text = document.getText();
    let startOffset = node.openStart;
    const endOffset = node.closeEnd || node.openEnd;
    while (startOffset > 0 && (text[startOffset - 1] === " " || text[startOffset - 1] === "\t")) {
        startOffset -= 1;
    }
    if (startOffset > 0 && text[startOffset - 1] === "\n") {
        startOffset -= 1;
    }

    let nextEnd = endOffset;
    while (nextEnd < text.length && (text[nextEnd] === " " || text[nextEnd] === "\t")) {
        nextEnd += 1;
    }
    if (nextEnd < text.length && text[nextEnd] === "\r") {
        nextEnd += 1;
    }
    if (nextEnd < text.length && text[nextEnd] === "\n") {
        nextEnd += 1;
    }

    return rangeFromOffsets(document, startOffset, nextEnd);
}

function createChangesAction(title, kind, uri, edits, diagnostic) {
    return {
        diagnostics: diagnostic ? [diagnostic] : [],
        edit: {
            changes: {
                [uri]: edits
            }
        },
        kind,
        title
    };
}

function createComponentContractRenameActions(document, analysis, diagnostic) {
    const issue = resolveUnknownComponentContractIssue(analysis, diagnostic);
    if (!issue) {
        return [];
    }

    const actions = [];
    const candidate = findClosestContractEntry(issue.currentName, issue.entries);
    if (candidate) {
        actions.push(createChangesAction(
            `Rename ${issue.kind} to \`${candidate.replacement}\``,
            "quickfix",
            document.uri,
            [{
                newText: candidate.replacement,
                range: issue.range
            }],
            diagnostic
        ));
    }

    const declarationAction = createComponentContractDeclarationAction(issue, diagnostic);
    if (declarationAction) {
        actions.push(declarationAction);
    }

    return actions;
}

function createRemoveUnknownComponentContractUsageAction(document, analysis, diagnostic) {
    const message = String(diagnostic.message || "");
    const attribute = findTemplateAttributeByRange(analysis.templateAnalysis, diagnostic.range);
    const nodes = analysis.templateAnalysis.nodes || [];
    const ownerNode = attribute
        ? nodes.find(node => (node.attrs || []).includes(attribute)) || null
        : null;

    if (/^Unknown prop `/.test(message) && attribute?.fullRange) {
        return createChangesAction(
            `Remove unknown prop \`${attribute.name}\` from component usage`,
            "quickfix",
            document.uri,
            [{
                newText: "",
                range: expandAttributeRemovalRange(document, attribute.fullRange)
            }],
            diagnostic
        );
    }

    if (/^Unknown emitted event handler `/.test(message) && attribute?.fullRange) {
        return createChangesAction(
            `Remove unknown event handler \`${attribute.name}\` from component usage`,
            "quickfix",
            document.uri,
            [{
                newText: "",
                range: expandAttributeRemovalRange(document, attribute.fullRange)
            }],
            diagnostic
        );
    }

    if (/^Unknown named slot `/.test(message)) {
        const slotNode = ownerNode?.name === "slot"
            ? ownerNode
            : (attribute ? nodes.find(node => (node.attrs || []).includes(attribute) && String(node.name || "").toLowerCase() === "slot") || null : null);
        const slotName = String(getTemplateAttribute(slotNode, "name")?.value || "").trim();
        if (!slotNode) {
            return null;
        }
        return createChangesAction(
            `Remove unknown named slot \`${slotName || "slot"}\` from component usage`,
            "quickfix",
            document.uri,
            [{
                newText: "",
                range: expandTemplateNodeRemovalRange(document, slotNode)
            }],
            diagnostic
        );
    }

    return null;
}

function createBatchComponentContractActions(document, analysis, diagnostics) {
    const groups = new Map();

    for (const diagnostic of diagnostics || []) {
        const issue = resolveUnknownComponentContractIssue(analysis, diagnostic);
        if (!issue) {
            continue;
        }
        const key = `${issue.componentUri || "local"}::${issue.componentName}`;
        let group = groups.get(key);
        if (!group) {
            group = {
                componentName: issue.componentName,
                componentUri: issue.componentUri,
                declarationEdits: [],
                diagnostics: [],
                localEdits: []
            };
            groups.set(key, group);
        }
        group.diagnostics.push(diagnostic);

        const declaration = createComponentContractDeclarationEdit(issue);
        if (declaration?.edits?.length) {
            group.declarationEdits.push(...declaration.edits);
        }

        const removal = createRemoveUnknownComponentContractUsageAction(document, analysis, diagnostic);
        const localChanges = removal?.edit?.changes?.[document.uri] || [];
        if (localChanges.length > 0) {
            group.localEdits.push(...localChanges);
        }
    }

    const actions = [];
    for (const group of groups.values()) {
        const declarationEdits = dedupeTextEdits(group.declarationEdits);
        const localEdits = dedupeTextEdits(group.localEdits);
        const representativeDiagnostic = group.diagnostics[0];

        if (declarationEdits.length > 1) {
            actions.push(createWorkspaceEditAction(
                `Declare all current unknown contract entries in \`${group.componentName}\``,
                "quickfix",
                [{
                    edits: declarationEdits,
                    textDocument: {
                        uri: group.componentUri,
                        version: null
                    }
                }],
                representativeDiagnostic
            ));
        }

        if (localEdits.length > 1) {
            actions.push(createChangesAction(
                `Remove all unknown usage from \`${group.componentName}\``,
                "quickfix",
                document.uri,
                localEdits,
                representativeDiagnostic
            ));
        }
    }

    return actions;
}

function resolveUnknownComponentContractIssue(analysis, diagnostic) {
    const message = String(diagnostic.message || "");
    const attribute = findTemplateAttributeByRange(analysis.templateAnalysis, diagnostic.range);
    const nodes = analysis.templateAnalysis.nodes || [];
    const ownerNode = attribute
        ? nodes.find(node => (node.attrs || []).includes(attribute)) || null
        : null;

    if (/^Unknown prop `/.test(message) && attribute && ownerNode?.componentContract) {
        return {
            componentName: ownerNode.name,
            componentUri: ownerNode.componentSymbol?.targetUri || ownerNode.importedComponentSymbol?.targetUri || null,
            currentName: attribute.name,
            entries: Array.from(ownerNode.componentContract.props.values()).map(entry => ({
                normalized: normalizeContractPropName(entry.label),
                replacement: normalizeContractPropName(entry.label)
            })),
            kind: "prop",
            range: attribute.range
        };
    }

    if (/^Unknown emitted event handler `/.test(message) && attribute && ownerNode?.componentContract) {
        return {
            componentName: ownerNode.name,
            componentUri: ownerNode.componentSymbol?.targetUri || ownerNode.importedComponentSymbol?.targetUri || null,
            currentName: attribute.name,
            entries: Array.from(ownerNode.componentContract.emits.values()).map(entry => ({
                normalized: normalizeContractEventName(entry.label),
                replacement: formatEventAttributeLabel(entry.label)
            })),
            kind: "event handler",
            range: attribute.range
        };
    }

    if (/^Unknown named slot `/.test(message)) {
        const slotNode = ownerNode?.name === "slot"
            ? ownerNode
            : (attribute ? nodes.find(node => (node.attrs || []).includes(attribute)) || null : null);
        const parentNode = getParentTemplateNode(nodes, slotNode);
        const slotNameAttribute = slotNode ? getTemplateAttribute(slotNode, "name") : null;
        if (slotNameAttribute && parentNode?.componentContract) {
            return {
                componentName: parentNode.name,
                componentUri: parentNode.componentSymbol?.targetUri || parentNode.importedComponentSymbol?.targetUri || null,
                currentName: slotNameAttribute.value || "",
                entries: Array.from(parentNode.componentContract.slots.values()).map(entry => ({
                    normalized: normalizeContractSlotName(entry.label),
                    replacement: entry.label
                })),
                kind: "slot",
                range: slotNameAttribute.valueRange || slotNameAttribute.range
            };
        }
    }

    return null;
}

function findClosestContractEntry(currentName, entries) {
    const normalizedCurrent = normalizeContractSearchToken(currentName);
    if (!normalizedCurrent || !entries?.length) {
        return null;
    }

    let best = null;
    for (const entry of entries) {
        const normalizedEntry = normalizeContractSearchToken(entry.normalized || entry.replacement);
        if (!normalizedEntry) {
            continue;
        }
        const distance = levenshteinDistance(normalizedCurrent, normalizedEntry);
        const threshold = Math.max(1, Math.ceil(Math.max(normalizedCurrent.length, normalizedEntry.length) / 2));
        if (distance > threshold) {
            continue;
        }
        if (!best || distance < best.distance) {
            best = {
                distance,
                replacement: entry.replacement
            };
        }
    }
    return best;
}

function normalizeContractSearchToken(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/^on[:-]?/, "")
        .replace(/[^a-z0-9]+/g, "");
}

function formatEventAttributeLabel(eventName) {
    const normalized = normalizeContractEventName(eventName);
    return normalized.includes(":") ? `on:${normalized}` : `on-${normalized}`;
}

function buildComponentContractRenameEdit(target, nextName, localDocumentUri = null) {
    const renameTarget = normalizeComponentContractRenameTarget(target, nextName);
    if (!renameTarget) {
        return null;
    }

    const changes = {};
    if (target.definitionUri && renameTarget.definitionReplacement) {
        changes[target.definitionUri] = [{
            newText: renameTarget.definitionReplacement,
            range: target.definitionRange
        }];
    }
    for (const reference of target.referenceLocations || []) {
        const uri = reference.uri || localDocumentUri;
        if (!uri || !renameTarget.localReplacement) {
            continue;
        }
        if (target.definitionUri === uri && rangesEqual(target.definitionRange, reference.range)) {
            continue;
        }
        if (!changes[uri]) {
            changes[uri] = [];
        }
        if (changes[uri].some(item => rangesEqual(item.range, reference.range))) {
            continue;
        }
        changes[uri].push({
            newText: renameTarget.localReplacement,
            range: reference.range
        });
    }
    if (localDocumentUri && target.localRange && renameTarget.localReplacement) {
        if (!changes[localDocumentUri]) {
            changes[localDocumentUri] = [];
        }
        if (!changes[localDocumentUri].some(item => rangesEqual(item.range, target.localRange))) {
            changes[localDocumentUri].push({
                newText: renameTarget.localReplacement,
                range: target.localRange
            });
        }
    }
    if (Object.keys(changes).length === 0) {
        return null;
    }
    return { changes };
}

function normalizeComponentContractRenameTarget(target, nextName) {
    const rawValue = String(nextName || "").trim();
    if (!rawValue) {
        return null;
    }

    if (target.kind === "prop") {
        const canonical = normalizePropRenameInput(rawValue);
        const definitionReplacement = formatContractDefinitionReplacement(target.definitionEntry, canonical, "prop");
        if (!canonical || !definitionReplacement) {
            return null;
        }
        return {
            definitionReplacement,
            localReplacement: normalizeContractPropName(canonical)
        };
    }

    if (target.kind === "event") {
        const canonical = normalizeEventRenameInput(rawValue);
        const definitionReplacement = formatContractDefinitionReplacement(target.definitionEntry, canonical, "event");
        if (!canonical || !definitionReplacement) {
            return null;
        }
        return {
            definitionReplacement,
            localReplacement: String(target.localLabel || "").startsWith("on:")
                ? `on:${normalizeContractEventName(canonical)}`
                : formatEventAttributeLabel(canonical)
        };
    }

    if (target.kind === "slot") {
        const canonical = normalizeSlotRenameInput(rawValue);
        const definitionReplacement = formatContractDefinitionReplacement(target.definitionEntry, canonical, "slot");
        if (!canonical || !definitionReplacement) {
            return null;
        }
        return {
            definitionReplacement,
            localReplacement: canonical
        };
    }

    return null;
}

function normalizePropRenameInput(value) {
    const trimmed = String(value || "").trim();
    if (!/^[A-Za-z_$][\w$-]*$/.test(trimmed)) {
        return "";
    }
    return toCamelCase(trimmed);
}

function normalizeEventRenameInput(value) {
    const trimmed = String(value || "").trim().replace(/^on[:-]?/, "");
    if (!trimmed || !/^[A-Za-z_$][\w$:-]*$/.test(trimmed)) {
        return "";
    }
    return trimmed;
}

function normalizeSlotRenameInput(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed || !/^[A-Za-z_$][\w$-]*$/.test(trimmed)) {
        return "";
    }
    return trimmed;
}

function formatContractDefinitionReplacement(entry, canonicalName, kind) {
    const context = readContractEntrySource(entry);
    if (!context) {
        return null;
    }
    const currentText = context.source.slice(context.startOffset, context.endOffset).trim();

    if (/^name\s*=/.test(currentText)) {
        const quote = currentText.includes("'") && !currentText.includes("\"") ? "'" : "\"";
        return `name=${quote}${canonicalName}${quote}`;
    }
    if ((currentText.startsWith("\"") && currentText.endsWith("\"")) || (currentText.startsWith("'") && currentText.endsWith("'"))) {
        const quote = currentText[0];
        return `${quote}${canonicalName}${quote}`;
    }
    if (/^[A-Za-z_$][\w$]*$/.test(currentText)) {
        if (/^[A-Za-z_$][\w$]*$/.test(canonicalName)) {
            return canonicalName;
        }
        if (context.beforeChar === ".") {
            return null;
        }
        return `'${canonicalName}'`;
    }
    return kind ? `'${canonicalName}'` : null;
}

function readContractEntrySource(entry) {
    const uri = entry?.uri;
    const range = entry?.range;
    if (!uri || !range || !/^file:\/\//.test(uri)) {
        return null;
    }
    const filePath = fileURLToPath(uri);
    if (!fs.existsSync(filePath)) {
        return null;
    }
    const source = fs.readFileSync(filePath, "utf8");
    const startOffset = offsetFromZeroBasedPosition(source, range.start);
    const endOffset = offsetFromZeroBasedPosition(source, range.end);
    return {
        beforeChar: startOffset > 0 ? source[startOffset - 1] : "",
        endOffset,
        source,
        startOffset
    };
}

function offsetFromZeroBasedPosition(source, position) {
    const safeSource = String(source || "");
    const targetLine = Math.max(0, Number(position?.line) || 0);
    const targetCharacter = Math.max(0, Number(position?.character) || 0);
    let line = 0;
    let offset = 0;
    while (offset < safeSource.length && line < targetLine) {
        if (safeSource[offset] === "\n") {
            line += 1;
        }
        offset += 1;
    }
    return Math.max(0, Math.min(safeSource.length, offset + targetCharacter));
}

function createComponentContractDeclarationAction(issue, diagnostic) {
    const declaration = createComponentContractDeclarationEdit(issue);
    if (!declaration) {
        return null;
    }
    return createWorkspaceEditAction(
        declaration.title,
        "quickfix",
        [{
            edits: declaration.edits,
            textDocument: {
                uri: declaration.uri,
                version: null
            }
        }],
        diagnostic
    );
}

function createComponentContractDeclarationEdit(issue) {
    const context = readNdComponentSourceContext(issue.componentUri);
    if (!context?.descriptor?.script?.setup) {
        return null;
    }

    if (issue.kind === "prop") {
        const canonical = normalizePropRenameInput(issue.currentName);
        const edit = canonical ? createPropContractInsertionEdit(context, [canonical]) : null;
        return edit ? {
            edits: [edit],
            title: `Declare prop \`${normalizeContractPropName(canonical)}\` in \`${issue.componentName}\``,
            uri: issue.componentUri
        } : null;
    }

    if (issue.kind === "event handler") {
        const canonical = normalizeEventRenameInput(issue.currentName);
        const edit = canonical ? createEmitContractInsertionEdit(context, [canonical]) : null;
        return edit ? {
            edits: [edit],
            title: `Declare event \`${canonical}\` in \`${issue.componentName}\``,
            uri: issue.componentUri
        } : null;
    }

    if (issue.kind === "slot") {
        const canonical = normalizeSlotRenameInput(issue.currentName);
        const edit = canonical && canonical !== "default"
            ? createSlotContractInsertionEdit(context, [canonical])
            : null;
        return edit ? {
            edits: [edit],
            title: `Declare slot \`${canonical}\` in \`${issue.componentName}\``,
            uri: issue.componentUri
        } : null;
    }

    return null;
}

function readNdComponentSourceContext(targetUri) {
    if (!targetUri || !/^file:\/\//.test(targetUri)) {
        return null;
    }
    try {
        const filePath = fileURLToPath(targetUri);
        const source = fs.readFileSync(filePath, "utf8");
        return {
            descriptor: parseNdDocument(source, targetUri),
            source,
            uri: targetUri
        };
    } catch {
        return null;
    }
}

function createPropContractInsertionEdit(context, names) {
    const normalized = Array.from(new Set((names || []).map(normalizePropRenameInput).filter(Boolean)));
    if (normalized.length === 0) {
        return null;
    }
    return createTypedContractInsertionEdit(context, "defineProps", "prop", normalized)
        || createObjectMacroInsertionEdit(
            context,
            "defineProps",
            normalized.map(name => formatObjectContractKey(name, "null")).join(", ")
        );
}

function createEmitContractInsertionEdit(context, names) {
    const normalized = Array.from(new Set((names || []).map(normalizeEventRenameInput).filter(Boolean)));
    if (normalized.length === 0) {
        return null;
    }
    return createTypedContractInsertionEdit(context, "defineEmits", "event", normalized)
        || createArrayMacroInsertionEdit(
            context,
            "defineEmits",
            normalized.map(name => JSON.stringify(name)).join(", ")
        )
        || createObjectMacroInsertionEdit(
            context,
            "defineEmits",
            normalized.map(name => formatObjectContractKey(name, "null")).join(", ")
        );
}

function createSlotContractInsertionEdit(context, names) {
    const normalized = Array.from(new Set((names || []).map(normalizeSlotRenameInput).filter(name => name && name !== "default")));
    if (normalized.length === 0) {
        return null;
    }
    return createTypedContractInsertionEdit(context, "defineSlots", "slot", normalized)
        || createObjectMacroInsertionEdit(
            context,
            "defineSlots",
            normalized.map(name => formatObjectContractKey(name, "true")).join(", ")
        );
}

function createTypedContractInsertionEdit(context, macroName, kind, names) {
    const scriptBlock = context.descriptor?.script;
    if (!scriptBlock?.content || !names?.length) {
        return null;
    }
    for (const call of findMacroCalls(scriptBlock.content, macroName)) {
        const typeArgument = getFirstTypeArgument(call);
        if (!typeArgument?.text) {
            continue;
        }
        const target = resolveTypedMacroInsertionTarget(context, call, typeArgument);
        if (!target) {
            continue;
        }
        const lines = buildTypedContractInsertionLines(kind, names);
        if (lines.length === 0) {
            continue;
        }
        return createTypedBodyInsertionEdit(context, target, lines);
    }
    return null;
}

function resolveTypedMacroInsertionTarget(context, call, typeArgument) {
    const scriptBlock = context.descriptor?.script;
    const typeText = String(typeArgument.text || "").trim();
    if (!scriptBlock?.content || !typeText) {
        return null;
    }
    if (typeText.startsWith("{")) {
        const openBrace = typeText.indexOf("{");
        const closeBrace = findMatchingBrace(typeText, openBrace);
        if (closeBrace < 0) {
            return null;
        }
        return {
            absoluteBodyEnd: scriptBlock.contentStart + call.typeArgumentsStart + typeArgument.start + closeBrace,
            absoluteBodyStart: scriptBlock.contentStart + call.typeArgumentsStart + typeArgument.start + openBrace + 1
        };
    }
    if (!/^[A-Za-z_$][\w$]*$/.test(typeText)) {
        return null;
    }
    return findNamedTypeLiteralDeclaration(context, typeText);
}

function findNamedTypeLiteralDeclaration(context, typeName) {
    const scriptBlock = context.descriptor?.script;
    if (!scriptBlock?.content) {
        return null;
    }
    const source = scriptBlock.content;
    const patterns = [
        new RegExp(`\\btype\\s+${escapeRegExp(typeName)}\\s*=`, "g"),
        new RegExp(`\\binterface\\s+${escapeRegExp(typeName)}\\b`, "g")
    ];
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            const searchStart = (match.index || 0) + match[0].length;
            const openBrace = source.indexOf("{", searchStart);
            if (openBrace < 0) {
                continue;
            }
            const closeBrace = findMatchingBrace(source, openBrace);
            if (closeBrace < 0) {
                continue;
            }
            return {
                absoluteBodyEnd: scriptBlock.contentStart + closeBrace,
                absoluteBodyStart: scriptBlock.contentStart + openBrace + 1
            };
        }
    }
    return null;
}

function buildTypedContractInsertionLines(kind, names) {
    if (kind === "prop") {
        return names.map(name => `${formatTypedObjectTypeKey(name)}?: unknown;`);
    }
    if (kind === "event") {
        return names.map(name => `(event: ${JSON.stringify(name)}): void;`);
    }
    if (kind === "slot") {
        return names.map(name => `${formatTypedObjectTypeKey(name)}?: () => unknown;`);
    }
    return [];
}

function formatTypedObjectTypeKey(name) {
    return /^[A-Za-z_$][\w$]*$/.test(name)
        ? name
        : JSON.stringify(name);
}

function createTypedBodyInsertionEdit(context, target, lines) {
    const document = createTextBufferDocumentLike(context.uri, context.source);
    const bodyText = context.source.slice(target.absoluteBodyStart, target.absoluteBodyEnd);
    const closingIndent = getLineIndentAtOffset(document, target.absoluteBodyEnd);
    const entryIndent = `${closingIndent}  `;
    if (bodyText.trim()) {
        const insertOffset = target.absoluteBodyStart + bodyText.trimEnd().length;
        return {
            newText: `\n${entryIndent}${lines.join(`\n${entryIndent}`)}`,
            range: rangeFromOffsets(document, insertOffset, insertOffset)
        };
    }
    return {
        newText: `\n${entryIndent}${lines.join(`\n${entryIndent}`)}\n${closingIndent}`,
        range: rangeFromOffsets(document, target.absoluteBodyStart, target.absoluteBodyStart)
    };
}

function createObjectMacroInsertionEdit(context, macroName, entryText) {
    const scriptBlock = context.descriptor?.script;
    if (!scriptBlock?.content) {
        return null;
    }
    for (const call of findMacroCalls(scriptBlock.content, macroName)) {
        const argument = getFirstCallArgument(call);
        if (!argument?.text) {
            return {
                newText: `{ ${entryText} }`,
                range: rangeFromOffsets(createTextBufferDocumentLike(context.uri, context.source), scriptBlock.contentStart + call.openParen + 1, scriptBlock.contentStart + call.openParen + 1)
            };
        }
        if (!argument?.text?.startsWith("{")) {
            continue;
        }
        const openBrace = argument.text.indexOf("{");
        const closeBrace = findMatchingBrace(argument.text, openBrace);
        if (closeBrace < 0) {
            continue;
        }
        const innerText = argument.text.slice(openBrace + 1, closeBrace);
        const insertOffset = scriptBlock.contentStart + call.openParen + 1 + argument.start + closeBrace;
        return {
            newText: innerText.trim() ? `, ${entryText}` : entryText,
            range: rangeFromOffsets(createTextBufferDocumentLike(context.uri, context.source), insertOffset, insertOffset)
        };
    }
    return null;
}

function createArrayMacroInsertionEdit(context, macroName, entryText) {
    const scriptBlock = context.descriptor?.script;
    if (!scriptBlock?.content) {
        return null;
    }
    for (const call of findMacroCalls(scriptBlock.content, macroName)) {
        const argument = getFirstCallArgument(call);
        if (!argument?.text) {
            return {
                newText: `[${entryText}]`,
                range: rangeFromOffsets(createTextBufferDocumentLike(context.uri, context.source), scriptBlock.contentStart + call.openParen + 1, scriptBlock.contentStart + call.openParen + 1)
            };
        }
        if (!argument?.text?.startsWith("[")) {
            continue;
        }
        const openBracket = argument.text.indexOf("[");
        const closeBracket = findMatchingBracket(argument.text, openBracket);
        if (closeBracket < 0) {
            continue;
        }
        const innerText = argument.text.slice(openBracket + 1, closeBracket);
        const insertOffset = scriptBlock.contentStart + call.openParen + 1 + argument.start + closeBracket;
        return {
            newText: innerText.trim() ? `, ${entryText}` : entryText,
            range: rangeFromOffsets(createTextBufferDocumentLike(context.uri, context.source), insertOffset, insertOffset)
        };
    }
    return null;
}

function getFirstCallArgument(call) {
    if (!call?.argumentsText) {
        return null;
    }
    const entry = splitTopLevelEntries(call.argumentsText).find(item => item.text.trim());
    if (!entry) {
        return null;
    }
    const leadingTrim = entry.text.length - entry.text.trimStart().length;
    return {
        start: entry.start + leadingTrim,
        text: entry.text.trim()
    };
}

function getFirstTypeArgument(call) {
    if (!call?.typeArgumentsText) {
        return null;
    }
    const entry = splitTopLevelEntries(call.typeArgumentsText).find(item => item.text.trim());
    if (!entry) {
        return null;
    }
    const leadingTrim = entry.text.length - entry.text.trimStart().length;
    return {
        start: entry.start + leadingTrim,
        text: entry.text.trim()
    };
}

function formatObjectContractKey(name, valueText) {
    return /^[A-Za-z_$][\w$]*$/.test(name)
        ? `${name}: ${valueText}`
        : `'${name}': ${valueText}`;
}

function toCamelCase(value) {
    return String(value || "")
        .trim()
        .replace(/[-_\s]+([A-Za-z0-9])/g, (_match, letter) => String(letter || "").toUpperCase())
        .replace(/^[A-Z]/, match => match.toLowerCase());
}

function levenshteinDistance(left, right) {
    const rows = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
    for (let i = 0; i <= left.length; i += 1) {
        rows[i][0] = i;
    }
    for (let j = 0; j <= right.length; j += 1) {
        rows[0][j] = j;
    }
    for (let i = 1; i <= left.length; i += 1) {
        for (let j = 1; j <= right.length; j += 1) {
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
            rows[i][j] = Math.min(
                rows[i - 1][j] + 1,
                rows[i][j - 1] + 1,
                rows[i - 1][j - 1] + cost
            );
        }
    }
    return rows[left.length][right.length];
}

function createWorkspaceEditAction(title, kind, documentChanges, diagnostic) {
    return {
        diagnostics: diagnostic ? [diagnostic] : [],
        edit: {
            documentChanges
        },
        kind,
        title
    };
}

function dedupeCodeActions(actions) {
    const seen = new Set();
    return actions.filter(action => {
        const key = `${action.kind}:${action.title}:${JSON.stringify(action.edit || {})}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function dedupeTextEdits(edits) {
    const seen = new Set();
    return (edits || []).filter(edit => {
        const range = edit?.range;
        const key = `${range?.start?.line}:${range?.start?.character}:${range?.end?.line}:${range?.end?.character}:${edit?.newText || ""}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function dedupeDocumentLinks(links) {
    const seen = new Set();
    return links.filter(link => {
        const key = `${link.target}:${link.range.start.line}:${link.range.start.character}:${link.range.end.line}:${link.range.end.character}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function resolveImportSpecifierUri(documentUri, specifier) {
    if (!specifier || !documentUri || !/^file:\/\//.test(documentUri)) {
        return null;
    }
    try {
        if (specifier.startsWith(".")) {
            return new URL(specifier, documentUri).href;
        }
        if (path.isAbsolute(specifier)) {
            return pathToFileURL(specifier).href;
        }
    } catch {
        return null;
    }
    return null;
}

function findTemplateNodeByRange(templateAnalysis, range) {
    if (!range) {
        return null;
    }
    return templateAnalysis.nodes.find(node => rangesEqual(node.nameRange, range)) || null;
}

function findTemplateAttributeByRange(templateAnalysis, range) {
    if (!range) {
        return null;
    }
    for (const node of templateAnalysis.nodes) {
        for (const attribute of node.attrs) {
            if (rangesEqual(attribute.range, range)
                || rangesEqual(attribute.valueRange, range)
                || rangesEqual(attribute.fullRange, range)) {
                return attribute;
            }
        }
    }
    return null;
}

function pushFoldingRange(ranges, seen, document, startOffset, endOffset, kind) {
    const start = document.positionAt(startOffset);
    const end = document.positionAt(endOffset);
    if (start.line >= end.line) {
        return;
    }
    const range = {
        endCharacter: end.character,
        endLine: end.line - (end.character === 0 ? 1 : 0),
        kind,
        startCharacter: start.character,
        startLine: start.line
    };
    if (range.startLine >= range.endLine) {
        return;
    }
    const key = `${range.startLine}:${range.startCharacter}-${range.endLine}:${range.endCharacter}`;
    if (seen.has(key)) {
        return;
    }
    seen.add(key);
    ranges.push(range);
}

function findDefineOptionsModulesRange(source) {
    const match = /\bdefineOptions\s*\(/g.exec(source);
    if (!match) {
        return null;
    }
    const objectOpen = source.indexOf("{", match.index || 0);
    if (objectOpen < 0) {
        return null;
    }
    const objectClose = findMatchingBrace(source, objectOpen);
    if (objectClose < 0) {
        return null;
    }
    const objectBody = source.slice(objectOpen + 1, objectClose);
    const modulesMatch = /\bmodules\s*:\s*\[/g.exec(objectBody);
    if (!modulesMatch) {
        return null;
    }
    const arrayOpen = objectOpen + 1 + (modulesMatch.index || 0) + modulesMatch[0].lastIndexOf("[");
    const arrayClose = findMatchingBracket(source, arrayOpen);
    if (arrayClose < 0) {
        return null;
    }
    return {
        arrayEnd: arrayClose,
        arrayStart: arrayOpen,
        objectClose,
        objectOpen
    };
}

function findExportDefaultObjectRange(source) {
    const match = /\bexport\s+default\s*\{/g.exec(source);
    if (!match) {
        return null;
    }
    const objectOpen = source.indexOf("{", match.index || 0);
    if (objectOpen < 0) {
        return null;
    }
    const objectClose = findMatchingBrace(source, objectOpen);
    if (objectClose < 0) {
        return null;
    }
    return {
        bodyEnd: objectClose,
        bodyStart: objectOpen + 1,
        objectClose,
        objectOpen
    };
}

function findSetupHelperInsertOffset(source) {
    let cursor = 0;
    for (const match of source.matchAll(/\bimport\b[\s\S]*?;[ \t]*(?:\r?\n|$)/g)) {
        cursor = (match.index || 0) + match[0].length;
    }
    return cursor;
}

function extractIdentifierFromRange(document, range) {
    const startOffset = document.offsetAt(range.start);
    const token = readIdentifierAt(document.getText(), startOffset);
    return token?.text || null;
}

function rangesEqual(left, right) {
    return left
        && right
        && left.start.line === right.start.line
        && left.start.character === right.start.character
        && left.end.line === right.end.line
        && left.end.character === right.end.character;
}

function analyzeScriptBlock(document, scriptBlock) {
    const imports = extractImports(document, scriptBlock.content, scriptBlock.contentStart);
    const moduleBindings = extractModuleOptionBindings(scriptBlock.content);
    if (scriptBlock.setup) {
        return analyzeScriptSetupBlock(document, scriptBlock, imports, moduleBindings);
    }
    const content = scriptBlock.content;
    const contentStart = scriptBlock.contentStart;
    const setupBodyRange = findFunctionBody(content, /\bsetup\s*\([^)]*\)\s*\{/g);
    if (!setupBodyRange) {
        return createEmptyScriptAnalysis(imports);
    }

    const setupBody = content.slice(setupBodyRange.bodyStart, setupBodyRange.bodyEnd);
    const setupBodyOffset = contentStart + setupBodyRange.bodyStart;
    const declarations = extractDeclarations(document, setupBody, setupBodyOffset);
    const exposedSymbols = extractReturnedSymbols(document, setupBody, setupBodyOffset, declarations);
    const templateComponents = createTemplateComponentMap(imports, declarations, moduleBindings);

    return {
        declarations: new Map([...imports.declarations, ...declarations]),
        exposedSymbols,
        importedTemplateComponents: imports.templateComponents,
        moduleBindings,
        templateComponents
    };
}

function analyzeScriptSetupBlock(document, scriptBlock, imports, moduleBindings) {
    const declarations = new Map(imports.declarations);
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
        exposedSymbols: declarations,
        importedTemplateComponents: imports.templateComponents,
        moduleBindings,
        templateComponents: createTemplateComponentMap(imports, declarations, moduleBindings)
    };
}

function extractImports(document, source, baseOffset) {
    const declarations = new Map();
    const templateComponents = new Map();
    const importRe = /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']/g;

    for (const match of source.matchAll(importRe)) {
        const name = match[1];
        const specifier = match[2];
        const nameOffset = baseOffset + (match.index || 0) + match[0].indexOf(name);
        const specifierOffset = baseOffset + (match.index || 0) + match[0].lastIndexOf(specifier);
        const targetUri = specifier.toLowerCase().endsWith(".nd")
            ? resolveImportSpecifierUri(document.uri, specifier)
            : null;
        const symbol = {
            detail: specifier.toLowerCase().endsWith(".nd") ? "Imported .nd component" : "Imported symbol",
            kind: specifier.toLowerCase().endsWith(".nd") ? "component" : "variable",
            name,
            range: rangeFromOffsets(document, nameOffset, nameOffset + name.length),
            specifier,
            specifierRange: rangeFromOffsets(document, specifierOffset, specifierOffset + specifier.length),
            targetUri
        };
        declarations.set(name, symbol);
        if (specifier.toLowerCase().endsWith(".nd")) {
            templateComponents.set(name, symbol);
        }
    }

    return {
        declarations,
        templateComponents
    };
}

function createTemplateComponentMap(imports, declarations, moduleBindings) {
    const templateComponents = new Map(imports.templateComponents);
    for (const name of moduleBindings) {
        const symbol = declarations.get(name) || imports.declarations.get(name);
        if (!symbol) {
            continue;
        }
        templateComponents.set(name, {
            ...symbol,
            detail: "Component registered for template usage"
        });
    }
    return templateComponents;
}

function extractModuleOptionBindings(source) {
    const names = new Set();
    const patterns = [
        /defineOptions\s*\(\s*\{[\s\S]*?\bmodules\s*:\s*\[([\s\S]*?)\][\s\S]*?\}\s*\)/g,
        /\bmodules\s*:\s*\[([\s\S]*?)\]/g
    ];

    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            for (const identifier of match[1].matchAll(IDENTIFIER_RE)) {
                names.add(identifier[0]);
            }
        }
    }

    return Array.from(names);
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

function collectReferenceDiagnostics(document, descriptor, scriptAnalysis, templateAnalysis = createEmptyTemplateAnalysis()) {
    if (!descriptor.template) {
        return [];
    }

    const diagnostics = [];
    const references = collectSimpleTemplateReferences(descriptor.template, templateAnalysis);
    for (const reference of references) {
        if (
            BUILTIN_IDENTIFIERS.has(reference.name)
            || scriptAnalysis.exposedSymbols.has(reference.name)
            || !!resolveTemplateScopedSymbol(templateAnalysis, reference.offset, reference.name)
        ) {
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

function collectSimpleTemplateReferences(templateBlock, templateAnalysis = createEmptyTemplateAnalysis()) {
    const references = [];
    const content = templateBlock.content;

    for (const match of content.matchAll(/\{\{\s*(?:this\.)?([A-Za-z_$][\w$]*)(?:\.[A-Za-z_$][\w$]*)*\s*\}\}/g)) {
        const identifier = match[1];
        const full = match[0];
        const referenceOffset = templateBlock.contentStart + (match.index || 0) + full.indexOf(identifier);
        references.push({
            name: identifier,
            offset: referenceOffset
        });
    }

    for (const node of templateAnalysis.nodes || []) {
        for (const attr of node.attrs || []) {
            if (!shouldCollectAttributeReferences(attr)) {
                continue;
            }
            for (const token of collectExpressionIdentifierReferences(attr.value, attr.valueStartOffset || 0)) {
                references.push({
                    name: token.name,
                    offset: token.start
                });
            }
        }
    }

    return references;
}

function resolveKnownSymbol(scriptAnalysis, name) {
    return scriptAnalysis.exposedSymbols.get(name)
        || scriptAnalysis.declarations.get(name)
        || getTemplateComponentSymbol(scriptAnalysis, name)
        || getImportedTemplateComponentSymbol(scriptAnalysis, name)
        || null;
}

function resolveKnownSymbolAtOffset(analysis, name, offset) {
    return resolveKnownSymbol(analysis.scriptAnalysis, name)
        || resolveTemplateScopedSymbol(analysis.templateAnalysis, offset, name)
        || null;
}

function shouldCollectAttributeReferences(attribute) {
    if (!attribute?.value || !attribute.valueStartOffset) {
        return false;
    }
    return attribute.valueKind === "mustache"
        || attribute.valueKind === "expression"
        || attribute.name.startsWith("e-")
        || attribute.name.startsWith("x-");
}

function collectExpressionIdentifierReferences(source, baseOffset) {
    const references = [];
    for (const token of scanIdentifiers(source, baseOffset)) {
        const previousChar = token.index > 0 ? source[token.index - 1] : "";
        if (previousChar === ".") {
            continue;
        }
        references.push(token);
    }
    return references;
}

function getTemplateComponentSymbol(scriptAnalysis, name) {
    return getKnownTemplateComponent(scriptAnalysis.templateComponents, name);
}

function getImportedTemplateComponentSymbol(scriptAnalysis, name) {
    return getKnownTemplateComponent(scriptAnalysis.importedTemplateComponents, name);
}

function isRenameableToken(scriptAnalysis, name) {
    return !!resolveKnownSymbol(scriptAnalysis, name) && !BUILTIN_IDENTIFIERS.has(name);
}

function collectSymbolReferences(document, analysis, name) {
    const ranges = [];
    const seen = new Set();
    const addRange = (range) => {
        if (!range) {
            return;
        }
        const key = `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        ranges.push(range);
    };

    const symbol = resolveKnownSymbol(analysis.scriptAnalysis, name);
    if (symbol?.range) {
        addRange(symbol.range);
    }

    for (const reference of collectSimpleTemplateReferences(
        analysis.descriptor.template || { content: "", contentStart: 0, contentEnd: 0 },
        analysis.templateAnalysis
    )) {
        if (reference.name !== name) {
            continue;
        }
        addRange(rangeFromOffsets(document, reference.offset, reference.offset + name.length));
    }

    for (const node of analysis.templateAnalysis.nodes) {
        const componentSymbol = node.componentSymbol || node.importedComponentSymbol;
        if (!componentSymbol) {
            continue;
        }
        if (componentSymbol.name !== name) {
            continue;
        }
        addRange(node.nameRange);
    }

    if (analysis.descriptor.script) {
        for (const reference of collectScriptIdentifierReferences(analysis.descriptor.script, name)) {
            addRange(rangeFromOffsets(document, reference.start, reference.end));
        }
    }

    return ranges.sort(compareRanges);
}

function collectScriptIdentifierReferences(scriptBlock, name) {
    const references = [];
    for (const token of scanIdentifiers(scriptBlock.content, scriptBlock.contentStart)) {
        if (token.name !== name) {
            continue;
        }
        const previousChar = token.index > 0 ? scriptBlock.content[token.index - 1] : "";
        if (previousChar === ".") {
            continue;
        }
        references.push({
            start: token.start,
            end: token.end
        });
    }
    return references;
}

function scanLiteralTokens(source, baseOffset) {
    const tokens = [];
    let index = 0;

    while (index < source.length) {
        const char = source[index];
        const next = source[index + 1];

        if (char === "/" && next === "/") {
            index = skipLineComment(source, index);
            continue;
        }

        if (char === "/" && next === "*") {
            index = skipBlockComment(source, index);
            continue;
        }

        if (char === "\"" || char === "'" || char === "`") {
            const end = skipQuotedText(source, index, char);
            tokens.push({
                kind: "string",
                length: end - index,
                start: baseOffset + index
            });
            index = end;
            continue;
        }

        if (isNumericLiteralStart(source, index)) {
            const end = scanNumericLiteralEnd(source, index);
            tokens.push({
                kind: "number",
                length: end - index,
                start: baseOffset + index
            });
            index = end;
            continue;
        }

        index += 1;
    }

    return tokens;
}

function scanIdentifiers(source, baseOffset) {
    const tokens = [];
    let index = 0;

    while (index < source.length) {
        const char = source[index];
        const next = source[index + 1];

        if (char === "\"" || char === "'" || char === "`") {
            index = skipQuotedText(source, index, char);
            continue;
        }

        if (char === "/" && next === "/") {
            index = skipLineComment(source, index);
            continue;
        }

        if (char === "/" && next === "*") {
            index = skipBlockComment(source, index);
            continue;
        }

        if (isIdentifierStartChar(char)) {
            let end = index + 1;
            while (end < source.length && isIdentifierChar(source[end])) {
                end += 1;
            }
            tokens.push({
                end: baseOffset + end,
                index,
                name: source.slice(index, end),
                start: baseOffset + index
            });
            index = end;
            continue;
        }

        index += 1;
    }

    return tokens;
}

function skipQuotedText(source, start, quote) {
    let index = start + 1;
    while (index < source.length) {
        const char = source[index];
        if (char === "\\" && index + 1 < source.length) {
            index += 2;
            continue;
        }
        if (char === quote) {
            return index + 1;
        }
        index += 1;
    }
    return source.length;
}

function skipLineComment(source, start) {
    const end = source.indexOf("\n", start + 2);
    return end === -1 ? source.length : end + 1;
}

function skipBlockComment(source, start) {
    const end = source.indexOf("*/", start + 2);
    return end === -1 ? source.length : end + 2;
}

function isNumericLiteral(value) {
    return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(String(value || "").trim());
}

function isNumericLiteralStart(source, index) {
    const char = source[index];
    if (!/[0-9]/.test(char || "")) {
        return false;
    }
    const previousChar = index > 0 ? source[index - 1] : "";
    return !/[A-Za-z0-9_$]/.test(previousChar || "");
}

function scanNumericLiteralEnd(source, start) {
    let index = start + 1;
    while (index < source.length && /[0-9_]/.test(source[index])) {
        index += 1;
    }
    if (source[index] === "." && /[0-9]/.test(source[index + 1] || "")) {
        index += 1;
        while (index < source.length && /[0-9_]/.test(source[index])) {
            index += 1;
        }
    }
    return index;
}

function isIdentifierStartChar(char) {
    return typeof char === "string" && /[A-Za-z_$]/.test(char);
}

function compareRanges(left, right) {
    if (left.start.line !== right.start.line) {
        return left.start.line - right.start.line;
    }
    return left.start.character - right.start.character;
}

function pushSemanticToken(tokens, document, start, length, type, modifiers = []) {
    if (!length || length < 0) {
        return;
    }
    const position = document.positionAt(start);
    tokens.push({
        character: position.character,
        length,
        line: position.line,
        modifiers,
        start,
        tokenType: type
    });
}

function pushSemanticTokenRange(tokens, document, range, type, modifiers = []) {
    if (!range || range.start.line !== range.end.line) {
        return;
    }
    const start = document.offsetAt(range.start);
    const length = document.offsetAt(range.end) - start;
    pushSemanticToken(tokens, document, start, length, type, modifiers);
}

function mapSemanticType(kind) {
    switch (kind) {
        case "component":
            return "class";
        case "function":
            return "function";
        default:
            return "variable";
    }
}

function getLineStartOffset(document, offset) {
    const position = document.positionAt(offset);
    return document.offsetAt({
        line: position.line,
        character: 0
    });
}

function getLineIndentAtOffset(document, offset) {
    const lineStart = getLineStartOffset(document, offset);
    const lineText = document.getText(rangeFromOffsets(document, lineStart, offset));
    const indentMatch = /^\s*/.exec(lineText);
    return indentMatch ? indentMatch[0] : "";
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
        componentContract: createEmptyComponentContract(),
        declarations: new Map(),
        exposedSymbols: new Map(),
        importedTemplateComponents: new Map(),
        moduleBindings: [],
        templateComponents: new Map()
    };
}

function createEmptyTemplateAnalysis() {
    return {
        diagnostics: [],
        nodes: []
    };
}

function getTemplateCompletionContext(text, block, offset) {
    const localOffset = offset - block.contentStart;
    const before = block.content.slice(0, Math.max(0, localOffset));

    if (/\{\{[^}]*$/.test(before)) {
        return { kind: "mustache" };
    }

    const openTagStart = before.lastIndexOf("<");
    const closeTagStart = before.lastIndexOf(">");
    if (openTagStart === -1 || openTagStart < closeTagStart) {
        return { kind: "template" };
    }

    const openTagSlice = before.slice(openTagStart);
    if (/^<\/?[A-Za-z0-9_-]*$/.test(openTagSlice)) {
        return { kind: "tag" };
    }

    if (/^<[^>\n]+\s+[^\n>]*$/.test(openTagSlice)) {
        return { kind: "attribute" };
    }

    return { kind: "template" };
}

function formatBlock(block) {
    const attrs = String(block.attrs || "").trim();
    const openTag = attrs ? `<${block.type}${attrs.startsWith(" ") ? attrs : ` ${attrs}`}>` : `<${block.type}>`;
    const closeTag = `</${block.type}>`;
    const content = block.type === "template"
        ? formatTemplateContent(block.content)
        : formatGenericBlockContent(block.content);

    if (!content) {
        return `${openTag}\n${closeTag}`;
    }
    return `${openTag}\n${content}\n${closeTag}`;
}

function formatTemplateContent(source) {
    const lines = normalizeBlockLines(source);
    const formatted = [];
    let indent = 0;

    for (const line of lines) {
        if (!line) {
            if (formatted.length > 0 && formatted[formatted.length - 1] !== "") {
                formatted.push("");
            }
            continue;
        }
        if (shouldDecreaseTemplateIndent(line)) {
            indent = Math.max(indent - 1, 0);
        }
        formatted.push(`${"  ".repeat(indent + 1)}${line}`);
        indent += getTemplateIndentDelta(line);
    }

    return trimTrailingBlankLines(formatted).join("\n");
}

function formatGenericBlockContent(source) {
    const rawLines = normalizeLineEndings(source).split("\n");
    while (rawLines.length > 0 && rawLines[0].trim() === "") {
        rawLines.shift();
    }
    while (rawLines.length > 0 && rawLines[rawLines.length - 1].trim() === "") {
        rawLines.pop();
    }
    if (rawLines.length === 0) {
        return "";
    }

    const indentation = rawLines
        .filter(line => line.trim().length > 0)
        .reduce((min, line) => {
            const leading = (/^\s*/.exec(line)?.[0].length) || 0;
            return Math.min(min, leading);
        }, Number.MAX_SAFE_INTEGER);

    return rawLines.map(line => {
        if (!line.trim()) {
            return "";
        }
        return `  ${line.slice(indentation)}`;
    }).join("\n");
}

function normalizeBlockLines(source) {
    return trimTrailingBlankLines(
        normalizeLineEndings(source)
            .split("\n")
            .map(line => line.trim())
            .slice(dropLeadingBlankLines(
                normalizeLineEndings(source)
                    .split("\n")
                    .map(line => line.trim())
            ))
    );
}

function normalizeLineEndings(source) {
    return String(source || "").replace(/\r\n?/g, "\n");
}

function dropLeadingBlankLines(lines) {
    let index = 0;
    while (index < lines.length && lines[index] === "") {
        index += 1;
    }
    return index;
}

function trimTrailingBlankLines(lines) {
    const nextLines = [...lines];
    while (nextLines.length > 0 && nextLines[nextLines.length - 1] === "") {
        nextLines.pop();
    }
    return nextLines;
}

function shouldDecreaseTemplateIndent(line) {
    return /^<\//.test(line);
}

function getTemplateIndentDelta(line) {
    const tagName = getTemplateTagName(line);
    if (!tagName) {
        return 0;
    }
    if (/^<\//.test(line)) {
        return 0;
    }
    if (line.endsWith("/>") || HTML_VOID_TAGS.has(tagName.toLowerCase())) {
        return 0;
    }
    if (new RegExp(`</${tagName}\\s*>`).test(line)) {
        return 0;
    }
    return 1;
}

function getTemplateTagName(line) {
    const match = /^<\/?([A-Za-z][\w:-]*)/.exec(line);
    return match?.[1] || null;
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

function findMatchingParenthesis(source, openIndex) {
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

        if (char === "(") {
            depth += 1;
        } else if (char === ")") {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }

    return -1;
}

function findMatchingAngleBracket(source, openIndex) {
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

        if (char === "<") {
            depth += 1;
            continue;
        }

        if (char === ">" && source[index - 1] !== "=") {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }

    return -1;
}

function findMatchingBracket(source, openIndex) {
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

        if (char === "[") {
            depth += 1;
        } else if (char === "]") {
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

function extractStatementBindingName(statement) {
    return /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)\b/.exec(String(statement || "").trim())?.[1] || "";
}

function escapeRegExp(source) {
    return String(source || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function createTextBufferDocumentLike(uri, text) {
    return {
        getText(range = null) {
            if (!range) {
                return text;
            }
            return text.slice(
                offsetAt(text, range.start),
                offsetAt(text, range.end)
            );
        },
        offsetAt(position) {
            return offsetAt(text, position);
        },
        positionAt(offset) {
            return positionAt(text, offset);
        },
        uri
    };
}

function offsetAt(text, position) {
    const lines = String(text || "").split(/\r?\n/);
    const targetLine = Math.max(0, Math.min(Number(position?.line) || 0, Math.max(0, lines.length - 1)));
    const targetCharacter = Math.max(0, Number(position?.character) || 0);
    let offset = 0;
    for (let index = 0; index < targetLine; index += 1) {
        offset += lines[index].length + 1;
    }
    return Math.min(offset + targetCharacter, String(text || "").length);
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
