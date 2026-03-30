import {
    CodeActionKind,
    CompletionItemKind,
    DiagnosticSeverity,
    InsertTextFormat,
    ProposedFeatures,
    SemanticTokensBuilder,
    SymbolKind,
    TextDocumentSyncKind,
    createConnection
} from "vscode-languageserver/node.js";
import { TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
    analyzeNdDocument,
    formatNdDocument,
    getNdCodeActions,
    getNdCompletions,
    getNdDefinition,
    getNdDocumentLinks,
    getNdDocumentSymbols,
    getNdFoldingRanges,
    getNdHover,
    getNdReferences,
    getNdRenameEdit,
    getNdSemanticTokens,
    getNdSelectionRanges,
    ND_SEMANTIC_TOKEN_MODIFIERS,
    ND_SEMANTIC_TOKEN_TYPES
} from "./language-core.mjs";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize(() => ({
    capabilities: {
        completionProvider: {
            triggerCharacters: ["<", "{", ":", "\"", "'", ".", " ", "/", "-"]
        },
        codeActionProvider: true,
        definitionProvider: true,
        documentLinkProvider: {
            resolveProvider: false
        },
        documentFormattingProvider: true,
        documentSymbolProvider: true,
        foldingRangeProvider: true,
        hoverProvider: true,
        referencesProvider: true,
        renameProvider: true,
        selectionRangeProvider: true,
        semanticTokensProvider: {
            full: true,
            legend: {
                tokenModifiers: ND_SEMANTIC_TOKEN_MODIFIERS,
                tokenTypes: ND_SEMANTIC_TOKEN_TYPES
            }
        },
        textDocumentSync: TextDocumentSyncKind.Incremental
    }
}));

documents.onDidOpen(event => validate(event.document));
documents.onDidChangeContent(event => validate(event.document));
documents.onDidClose(event => {
    connection.sendDiagnostics({
        uri: event.document.uri,
        diagnostics: []
    });
});

connection.onCompletion(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }

    return getNdCompletions(document, params.position).map(item => ({
        detail: item.detail,
        insertText: item.insertText,
        insertTextFormat: item.insertTextFormat === "snippet" ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
        kind: toCompletionKind(item.kind),
        label: item.label
    }));
});

connection.onDefinition(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }
    return getNdDefinition(document, params.position);
});

connection.onDocumentLinks(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    return getNdDocumentLinks(document);
});

connection.onHover(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }
    return getNdHover(document, params.position);
});

connection.onReferences(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    return getNdReferences(document, params.position);
});

connection.onRenameRequest(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }
    return getNdRenameEdit(document, params.position, params.newName);
});

connection.onDocumentSymbol(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    return getNdDocumentSymbols(document).map(symbol => mapDocumentSymbol(symbol));
});

connection.onCodeAction(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    return getNdCodeActions(document, params.context, params.range).map(action => ({
        diagnostics: action.diagnostics,
        edit: action.edit,
        kind: action.kind === "quickfix"
            ? CodeActionKind.QuickFix
            : (action.kind || CodeActionKind.Refactor),
        title: action.title
    }));
});

connection.onFoldingRanges(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    return getNdFoldingRanges(document);
});

connection.onDocumentFormatting(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    return formatNdDocument(document);
});

connection.onSelectionRanges(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    return getNdSelectionRanges(document, params.positions);
});

connection.languages.semanticTokens.on(params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return {
            data: []
        };
    }
    const builder = new SemanticTokensBuilder();
    for (const token of getNdSemanticTokens(document)) {
        builder.push(
            token.line,
            token.character,
            token.length,
            ND_SEMANTIC_TOKEN_TYPES.indexOf(token.tokenType),
            encodeTokenModifiers(token.modifiers)
        );
    }
    return builder.build();
});

documents.listen(connection);
connection.listen();

function validate(document) {
    const analysis = analyzeNdDocument(document);
    connection.sendDiagnostics({
        diagnostics: analysis.diagnostics.map(diagnostic => ({
            message: diagnostic.message,
            range: diagnostic.range,
            severity: toDiagnosticSeverity(diagnostic.severity)
        })),
        uri: document.uri
    });
}

function toCompletionKind(kind) {
    switch (kind) {
        case "api":
            return CompletionItemKind.Function;
        case "block":
            return CompletionItemKind.Snippet;
        case "directive":
        case "event":
        case "html-attr":
            return CompletionItemKind.Property;
        case "component":
            return CompletionItemKind.Class;
        case "html-tag":
            return CompletionItemKind.Class;
        case "function":
            return CompletionItemKind.Function;
        default:
            return CompletionItemKind.Variable;
    }
}

function toDiagnosticSeverity(severity) {
    return severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning;
}

function mapDocumentSymbol(symbol) {
    return {
        children: symbol.children?.map(child => mapDocumentSymbol(child)),
        kind: toSymbolKind(symbol.kind),
        name: symbol.name,
        range: symbol.range,
        selectionRange: symbol.selectionRange
    };
}

function toSymbolKind(kind) {
    switch (kind) {
        case "block":
            return SymbolKind.Module;
        case "component":
            return SymbolKind.Class;
        case "tag":
            return SymbolKind.Object;
        case "function":
            return SymbolKind.Function;
        default:
            return SymbolKind.Variable;
    }
}

function encodeTokenModifiers(modifiers = []) {
    return modifiers.reduce((mask, modifier) => {
        const index = ND_SEMANTIC_TOKEN_MODIFIERS.indexOf(modifier);
        return index >= 0 ? mask | (1 << index) : mask;
    }, 0);
}
