#!/usr/bin/env node
import path from "node:path";
import {
    defaultDeclarationOutFile,
    describeNdError,
    runNdTypeCheck,
    watchNdTypes
} from "../src/index.js";

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
}

const inputPath = path.resolve(args[0]);
const declarationSuffixIndex = args.findIndex(arg => arg === "--declaration-suffix");
const watch = args.includes("--watch");
const silent = args.includes("--silent");
const declaration = args.includes("--declaration");

if (declarationSuffixIndex !== -1 && !args[declarationSuffixIndex + 1]) {
    throw new Error("Missing value for --declaration-suffix.");
}

const options = {
    declaration,
    declarationSuffix: declarationSuffixIndex !== -1 ? normalizeSuffix(args[declarationSuffixIndex + 1]) : undefined
};

if (watch) {
    const watcher = await watchNdTypes(inputPath, {
        ...options,
        onReady(summary) {
            if (silent) {
                return;
            }
            printSummary(summary, "Watching");
        },
        onChecked(result) {
            if (silent) {
                return;
            }
            const details = result.declarationFile ? ` -> ${result.declarationFile}` : "";
            console.log(`Type-checked ${result.inputFile}${details}`);
        },
        onRemoved(filePath) {
            if (silent) {
                return;
            }
            console.log(`Removed generated type output for ${filePath}`);
        },
        onError(errorLike, filePath) {
            const error = normalizeCliError(errorLike, filePath);
            printError(error);
        }
    });
    await watcher.ready;
} else {
    const summary = await runNdTypeCheck(inputPath, options);
    if (!silent) {
        printSummary(summary, "Checked");
    }
    if (summary.errors.length > 0) {
        for (const error of summary.errors) {
            printError(error);
        }
        process.exitCode = 1;
    } else if (declaration) {
        for (const result of summary.results) {
            if (result.declarationFile) {
                console.log(`Types: ${result.declarationFile}`);
            }
        }
    }
}

function normalizeSuffix(suffix) {
    return suffix.startsWith(".") ? suffix : `.${suffix}`;
}

function normalizeCliError(errorLike, filePath) {
    if (errorLike && typeof errorLike === "object" && "message" in errorLike && "line" in errorLike && "column" in errorLike) {
        return errorLike;
    }
    return describeNdError(errorLike, "", {
        filename: filePath
    });
}

function printSummary(summary, verb) {
    const fileCount = summary.files?.length || 0;
    if (summary.errors?.length > 0) {
        console.log(`${verb} ${fileCount} .nd file(s) with ${summary.errors.length} error(s).`);
    } else {
        console.log(`${verb} ${fileCount} .nd file(s) successfully.`);
    }
}

function printError(error) {
    const location = error.line && error.column
        ? `${error.filename}:${error.line}:${error.column}`
        : error.filename;
    console.error(`${location}`);
    console.error(error.message);
    if (error.frame) {
        console.error(error.frame);
    }
}

function printHelp() {
    console.log("Usage: nd-tsc <input.nd|dir> [--declaration] [--declaration-suffix .d.nd.ts] [--watch] [--silent]");
    console.log("Examples:");
    console.log("  nd-tsc ./src");
    console.log("  nd-tsc ./src --declaration");
    console.log("  nd-tsc ./src --watch");
    console.log(`  nd-tsc ./src --declaration --declaration-suffix ${defaultDeclarationOutFile("Component.nd").replace("Component", "<name>")}`);
}
