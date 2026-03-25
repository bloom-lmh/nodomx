import {
    CompletionItemKind,
    DiagnosticSeverity,
    InsertTextFormat,
    ProposedFeatures,
    TextDocumentSyncKind,
    createConnection
} from "vscode-languageserver/node.js";
import { TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
    analyzeNdDocument,
    getNdCompletions,
    getNdDefinition
} from "./language-core.mjs";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize(() => ({
    capabilities: {
        completionProvider: {
            triggerCharacters: ["<", "{", ":", "\"", "'", "."]
        },
        definitionProvider: true,
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
            return CompletionItemKind.Property;
        case "function":
            return CompletionItemKind.Function;
        default:
            return CompletionItemKind.Variable;
    }
}

function toDiagnosticSeverity(severity) {
    return severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning;
}
