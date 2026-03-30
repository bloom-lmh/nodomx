#!/usr/bin/env node
import path from "node:path";
import {
    compilePath,
    defaultDeclarationOutFile,
    defaultOutFile,
    watchNd
} from "../src/index.js";

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
}

const inputPath = path.resolve(args[0]);
const outIndex = args.findIndex(arg => arg === "--out");
const importIndex = args.findIndex(arg => arg === "--import-source");
const suffixIndex = args.findIndex(arg => arg === "--suffix");
const declarationSuffixIndex = args.findIndex(arg => arg === "--declaration-suffix");
const watch = args.includes("--watch");
const silent = args.includes("--silent");
const declaration = args.includes("--declaration");
const checkTypes = !args.includes("--no-check-types");
const typesOnly = args.includes("--types-only");

if (outIndex !== -1 && !args[outIndex + 1]) {
    throw new Error("Missing value for --out.");
}
if (importIndex !== -1 && !args[importIndex + 1]) {
    throw new Error("Missing value for --import-source.");
}
if (suffixIndex !== -1 && !args[suffixIndex + 1]) {
    throw new Error("Missing value for --suffix.");
}
if (declarationSuffixIndex !== -1 && !args[declarationSuffixIndex + 1]) {
    throw new Error("Missing value for --declaration-suffix.");
}
if (typesOnly && !declaration) {
    throw new Error("The --types-only option requires --declaration.");
}

const options = {
    declaration,
    declarationSuffix: declarationSuffixIndex !== -1 ? normalizeSuffix(args[declarationSuffixIndex + 1]) : undefined,
    importSource: importIndex !== -1 ? args[importIndex + 1] : undefined,
    outFile: outIndex !== -1 ? path.resolve(args[outIndex + 1]) : undefined,
    outputSuffix: suffixIndex !== -1 ? normalizeSuffix(args[suffixIndex + 1]) : undefined,
    templateTypeCheck: checkTypes,
    typesOnly
};

if (watch) {
    const watcher = await watchNd(inputPath, {
        ...options,
        onReady() {
            if (!silent) {
                console.log(`Watching ${inputPath}`);
            }
        },
        onCompiled(result) {
            if (!silent) {
                printResult(result);
            }
        },
        onRemoved(filePath) {
            if (!silent) {
                console.log(`Removed generated output for ${filePath}`);
            }
        },
        onError(error, filePath) {
            console.error(`Failed to compile ${filePath}: ${error.message}`);
        }
    });

    await watcher.ready;
} else {
    const results = await compilePath(inputPath, options);
    if (!silent) {
        if (results.length === 0) {
            console.log(`No .nd files found under ${inputPath}`);
        }
        for (const result of results) {
            printResult(result);
        }
    }
}

function printResult(result) {
    console.log(`Compiled ${result.inputFile}`);
    if (!options.typesOnly) {
        console.log(`Output: ${result.outputFile}`);
    }
    if (result.declarationFile) {
        console.log(`Types: ${result.declarationFile}`);
    }
    console.log(`Import source: ${result.importSource}`);
}

function normalizeSuffix(suffix) {
    return suffix.startsWith(".") ? suffix : `.${suffix}`;
}

function printHelp() {
    console.log("Usage: ndc <input.nd|dir> [--out output-file] [--suffix .nd.gen.mjs] [--declaration] [--declaration-suffix .d.nd.ts] [--import-source nodomx] [--watch] [--no-check-types] [--types-only]");
    console.log("Examples:");
    console.log("  ndc ./examples/Counter.nd");
    console.log("  ndc ./examples/Counter.nd --declaration");
    console.log("  ndc ./examples --watch");
    console.log(`  ndc ./examples/Counter.nd --out ${defaultOutFile("Counter.nd")}`);
    console.log(`  ndc ./examples/Counter.nd --declaration --declaration-suffix ${defaultDeclarationOutFile("Counter.nd").replace("Counter", "<name>")}`);
}
