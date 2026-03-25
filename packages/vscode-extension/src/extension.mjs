import path from "node:path";
import * as vscode from "vscode";
import { compileFile } from "@nodomx/nd-compiler";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";

let client;

export async function activate(context) {
    if (isLanguageServerEnabled()) {
        client = await startLanguageClient(context);
        context.subscriptions.push({
            dispose() {
                if (client) {
                    client.stop();
                }
            }
        });
    }

    const compileCommand = vscode.commands.registerCommand(
        "nodomx.compileCurrentNdFile",
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage("Open a .nd file first.");
                return;
            }

            const document = editor.document;
            if (!isNdDocument(document)) {
                vscode.window.showWarningMessage("The active file is not a .nd file.");
                return;
            }

            await document.save();

            try {
                const result = await compileDocument(document);
                const compiledDoc = await vscode.workspace.openTextDocument(result.outputFile);
                await vscode.window.showTextDocument(compiledDoc, { preview: false });
                vscode.window.showInformationMessage(`Compiled ${path.basename(document.fileName)} -> ${path.basename(result.outputFile)}`);
            } catch (error) {
                vscode.window.showErrorMessage(`NodomX ND compile failed: ${toErrorMessage(error)}`);
            }
        }
    );

    const saveListener = vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (!isNdDocument(document) || !isCompileOnSaveEnabled()) {
            return;
        }

        try {
            const result = await compileDocument(document);
            vscode.window.setStatusBarMessage(`NodomX ND compiled: ${path.basename(result.outputFile)}`, 2000);
        } catch (error) {
            vscode.window.showErrorMessage(`NodomX ND compile failed: ${toErrorMessage(error)}`);
        }
    });

    context.subscriptions.push(compileCommand, saveListener);
}

export async function deactivate() {
    if (client) {
        await client.stop();
    }
}

async function compileDocument(document) {
    const config = vscode.workspace.getConfiguration("nodomx.nd");
    const outputSuffix = config.get("outputSuffix") || ".nd.gen.mjs";
    const importSource = config.get("importSource") || undefined;
    const outFile = toOutFile(document.fileName, outputSuffix);

    return compileFile(document.fileName, {
        importSource,
        outFile
    });
}

function isNdDocument(document) {
    return !!document?.fileName && (document.languageId === "nd" || document.fileName.endsWith(".nd"));
}

function isCompileOnSaveEnabled() {
    return vscode.workspace.getConfiguration("nodomx.nd").get("compileOnSave") !== false;
}

function isLanguageServerEnabled() {
    return vscode.workspace.getConfiguration("nodomx.nd").get("enableLanguageServer") !== false;
}

function toOutFile(fileName, outputSuffix) {
    const parsed = path.parse(fileName);
    const suffix = outputSuffix.startsWith(".") ? outputSuffix : `.${outputSuffix}`;
    return path.join(parsed.dir, `${parsed.name}${suffix}`);
}

function toErrorMessage(error) {
    return error && error.message ? error.message : String(error);
}

async function startLanguageClient(context) {
    const serverModule = context.asAbsolutePath(path.join("dist", "server.cjs"));
    const serverOptions = {
        debug: {
            module: serverModule,
            options: {
                execArgv: ["--nolazy", "--inspect=6011"]
            },
            transport: TransportKind.ipc
        },
        run: {
            module: serverModule,
            transport: TransportKind.ipc
        }
    };

    const clientOptions = {
        documentSelector: [
            { language: "nd", scheme: "file" },
            { language: "nd", scheme: "untitled" }
        ],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher("**/*.nd")
        }
    };

    const languageClient = new LanguageClient(
        "nodomx-nd-language-server",
        "NodomX ND Language Server",
        serverOptions,
        clientOptions
    );

    await languageClient.start();
    return languageClient;
}
