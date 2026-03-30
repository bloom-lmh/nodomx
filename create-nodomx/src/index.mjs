import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, "..");
const ownPackageJson = JSON.parse(await fs.readFile(path.join(packageDir, "package.json"), "utf8"));
const repoRoot = path.resolve(packageDir, "..");
const workspaceVersions = {
    devServer: await readVersion(path.join(repoRoot, "rollup-plugin-dev-server", "package.json"), ownPackageJson.version),
    ndCompiler: await readVersion(path.join(repoRoot, "nd-compiler", "package.json"), ownPackageJson.version),
    ndPlugin: await readVersion(path.join(repoRoot, "rollup-plugin-nd", "package.json"), ownPackageJson.version),
    nodom: await readVersion(path.join(repoRoot, "nodomx", "package.json"), ownPackageJson.version),
    nodomReactivity: await readVersion(path.join(repoRoot, "nodomx", "packages", "reactivity", "package.json"), ownPackageJson.version),
    nodomRuntimeCore: await readVersion(path.join(repoRoot, "nodomx", "packages", "runtime-core", "package.json"), ownPackageJson.version),
    nodomSsr: await readVersion(path.join(repoRoot, "ssr", "package.json"), ownPackageJson.version),
    nodomStore: await readVersion(path.join(repoRoot, "store", "package.json"), ownPackageJson.version),
    vitePlugin: await readVersion(path.join(repoRoot, "vite-plugin-nodomx", "package.json"), ownPackageJson.version)
};

export async function createProject(targetDir, options = {}) {
    const targetPath = path.resolve(targetDir);
    const projectName = options.projectName || path.basename(targetPath);
    const packageMode = options.packageMode || "registry";
    const template = options.template || "vite";
    const router = options.router === true;
    const store = options.store === true;
    const typescript = options.typescript === true || template === "library";
    const install = options.install === true;
    const force = options.force === true;
    const packageSpecs = resolvePackageSpecs(packageMode, options.repoRoot, options.registryVersion || ownPackageJson.version);
    const templateDir = resolveTemplateDir(template);
    const replacements = {
        "__DEV_SERVER_SPEC__": packageSpecs.devServer,
        "__ND_COMPILER_SPEC__": packageSpecs.ndCompiler,
        "__ND_PLUGIN_SPEC__": packageSpecs.ndPlugin,
        "__NODOM_REACTIVITY_SPEC__": packageSpecs.nodomReactivity,
        "__NODOM_RUNTIME_CORE_SPEC__": packageSpecs.nodomRuntimeCore,
        "__NODOM_SSR_SPEC__": packageSpecs.nodomSsr,
        "__NODOM_STORE_SPEC__": packageSpecs.nodomStore,
        "__NODOM_SPEC__": packageSpecs.nodom,
        "__VITE_PLUGIN_SPEC__": packageSpecs.vitePlugin,
        "__PROJECT_NAME__": sanitizePackageName(projectName)
    };

    if (!projectName || projectName === "." || projectName === path.sep) {
        throw new Error("Please provide a project directory name.");
    }
    validateTemplateOptions(template, {
        router,
        store,
        typescript
    });

    await ensureEmptyDirectory(targetPath, force);
    await copyTemplate(templateDir, targetPath, replacements, {
        skipNames: new Set(["features"])
    });
    await applyTemplateFeatures(template, targetPath, replacements, {
        router,
        store,
        typescript
    });

    if (install) {
        runInstall(targetPath);
    }

    return {
        packageMode,
        projectName,
        router,
        store,
        template,
        typescript,
        targetPath
    };
}

export function parseArgs(args) {
    const flags = {
        force: false,
        install: false,
        packageMode: "registry",
        router: false,
        store: false,
        template: "vite",
        typescript: false
    };
    const positional = [];

    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "--install") {
            flags.install = true;
        } else if (arg === "--force") {
            flags.force = true;
        } else if (arg === "--package-mode") {
            flags.packageMode = args[index + 1];
            index += 1;
        } else if (arg === "--template") {
            flags.template = args[index + 1];
            index += 1;
        } else if (arg === "--router") {
            flags.router = true;
        } else if (arg === "--store") {
            flags.store = true;
        } else if (arg === "--typescript" || arg === "--ts") {
            flags.typescript = true;
        } else if (arg === "--help" || arg === "-h") {
            flags.help = true;
        } else {
            positional.push(arg);
        }
    }

    if (!["registry", "local"].includes(flags.packageMode)) {
        throw new Error(`Unsupported package mode: ${flags.packageMode}`);
    }
    if (!["basic", "vite", "library", "docs", "ssr"].includes(flags.template)) {
        throw new Error(`Unsupported template: ${flags.template}`);
    }

    return {
        flags,
        targetDir: positional[0]
    };
}

async function copyTemplate(fromDir, toDir, replacements, options = {}) {
    await fs.mkdir(toDir, { recursive: true });
    const skipNames = options.skipNames || new Set();
    const entries = await fs.readdir(fromDir, { withFileTypes: true });
    for (const entry of entries) {
        if (skipNames.has(entry.name)) {
            continue;
        }
        const sourcePath = path.join(fromDir, entry.name);
        const targetName = entry.name === "_gitignore" ? ".gitignore" : entry.name;
        const targetPath = path.join(toDir, targetName);
        if (entry.isDirectory()) {
            await copyTemplate(sourcePath, targetPath, replacements, options);
            continue;
        }
        const raw = await fs.readFile(sourcePath, "utf8");
        const rendered = applyReplacements(raw, replacements);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, rendered, "utf8");
    }
}

function applyReplacements(content, replacements) {
    return Object.entries(replacements).reduce(
        (result, [token, value]) => result.replaceAll(token, value),
        content
    );
}

async function ensureEmptyDirectory(targetPath, force) {
    const stat = await safeStat(targetPath);
    if (!stat) {
        await fs.mkdir(targetPath, { recursive: true });
        return;
    }

    const entries = await fs.readdir(targetPath);
    if (entries.length === 0) {
        return;
    }
    if (!force) {
        throw new Error(`Target directory is not empty: ${targetPath}`);
    }
}

function resolvePackageSpecs(mode, repoRootOption, registryVersion) {
    if (mode === "local") {
        const repoRoot = repoRootOption ? path.resolve(repoRootOption) : path.resolve(packageDir, "..");
        return {
            devServer: `file:${slash(path.join(repoRoot, "rollup-plugin-dev-server"))}`,
            ndCompiler: `file:${slash(path.join(repoRoot, "nd-compiler"))}`,
            ndPlugin: `file:${slash(path.join(repoRoot, "rollup-plugin-nd"))}`,
            nodomReactivity: `file:${slash(path.join(repoRoot, "nodomx", "packages", "reactivity"))}`,
            nodomRuntimeCore: `file:${slash(path.join(repoRoot, "nodomx", "packages", "runtime-core"))}`,
            nodomSsr: `file:${slash(path.join(repoRoot, "ssr"))}`,
            nodomStore: `file:${slash(path.join(repoRoot, "store"))}`,
            nodom: `file:${slash(path.join(repoRoot, "nodomx"))}`,
            vitePlugin: `file:${slash(path.join(repoRoot, "vite-plugin-nodomx"))}`
        };
    }

    return {
        devServer: `^${workspaceVersions.devServer || registryVersion}`,
        ndCompiler: `^${workspaceVersions.ndCompiler || registryVersion}`,
        ndPlugin: `^${workspaceVersions.ndPlugin || registryVersion}`,
        nodomReactivity: `^${workspaceVersions.nodomReactivity || registryVersion}`,
        nodomRuntimeCore: `^${workspaceVersions.nodomRuntimeCore || registryVersion}`,
        nodomSsr: `^${workspaceVersions.nodomSsr || registryVersion}`,
        nodomStore: `^${workspaceVersions.nodomStore || registryVersion}`,
        nodom: `^${workspaceVersions.nodom || registryVersion}`,
        vitePlugin: `^${workspaceVersions.vitePlugin || registryVersion}`
    };
}

function resolveTemplateDir(template) {
    return path.join(packageDir, "template", template);
}

async function applyTemplateFeatures(template, targetPath, replacements, options) {
    if (template !== "vite") {
        return;
    }
    if (options.router) {
        await copyTemplate(path.join(resolveTemplateDir(template), "features", "router"), targetPath, replacements);
    }
    if (options.store) {
        await copyTemplate(path.join(resolveTemplateDir(template), "features", "store-common"), targetPath, replacements);
        await copyTemplate(
            path.join(resolveTemplateDir(template), "features", options.router ? "router-store" : "store-standalone"),
            targetPath,
            replacements
        );
    }
    if (options.typescript) {
        await applyTypescriptProfile(targetPath, {
            router: options.router,
            store: options.store
        });
    }
}

function runInstall(targetPath) {
    const result = spawnSync("npm", ["install"], {
        cwd: targetPath,
        stdio: "inherit",
        shell: process.platform === "win32"
    });

    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`npm install failed with exit code ${result.status}.`);
    }
}

function sanitizePackageName(name) {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/^-+|-+$/g, "") || "nodomx-app";
}

async function applyTypescriptProfile(targetPath, options) {
    const packageJsonFile = path.join(targetPath, "package.json");
    const packageJson = JSON.parse(await fs.readFile(packageJsonFile, "utf8"));
    packageJson.devDependencies = {
        ...(packageJson.devDependencies || {}),
        typescript: "^5.9.2"
    };
    packageJson.scripts = {
        ...(packageJson.scripts || {}),
        typecheck: "tsc --noEmit"
    };
    await fs.writeFile(packageJsonFile, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

    const viteConfigJs = path.join(targetPath, "vite.config.mjs");
    const viteConfigTs = path.join(targetPath, "vite.config.ts");
    if (await safeStat(viteConfigJs)) {
        const source = await fs.readFile(viteConfigJs, "utf8");
        await fs.writeFile(viteConfigTs, source, "utf8");
        await fs.rm(viteConfigJs, { force: true });
    }

    await fs.writeFile(path.join(targetPath, "tsconfig.json"), createTsConfig(), "utf8");
    await fs.mkdir(path.join(targetPath, "src"), { recursive: true });
    await fs.writeFile(path.join(targetPath, "src", "env.d.ts"), createNdEnvTypes(), "utf8");

    await replaceFileExtension(targetPath, path.join("src", "main.js"), path.join("src", "main.ts"), source =>
        normalizeImportExtensions(source, [
            ["./router/index.js", "./router/index"],
            ["./stores/index.js", "./stores/index"]
        ])
    );

    if (options.router) {
        await replaceFileExtension(targetPath, path.join("src", "router", "index.js"), path.join("src", "router", "index.ts"), source =>
            normalizeImportExtensions(source, [["./routes.js", "./routes"]])
        );
        await replaceFileExtension(targetPath, path.join("src", "router", "routes.js"), path.join("src", "router", "routes.ts"), source =>
            normalizeImportExtensions(source, [
                ["../views/HomeView.nd", "../views/HomeView.nd"],
                ["../views/AboutView.nd", "../views/AboutView.nd"]
            ])
        );
    }

    if (options.store) {
        await replaceFileExtension(targetPath, path.join("src", "stores", "counter.js"), path.join("src", "stores", "counter.ts"), () =>
            createTypedCounterStoreSource()
        );
        await replaceFileExtension(targetPath, path.join("src", "stores", "index.js"), path.join("src", "stores", "index.ts"), source =>
            normalizeImportExtensions(source, [["./counter.js", "./counter"]])
        );

        const appNdPath = path.join(targetPath, "src", "App.nd");
        if (await safeStat(appNdPath)) {
            const source = await fs.readFile(appNdPath, "utf8");
            await fs.writeFile(appNdPath, normalizeImportExtensions(source, [["./stores/index.js", "./stores/index"]]), "utf8");
        }
        const homeViewPath = path.join(targetPath, "src", "views", "HomeView.nd");
        if (await safeStat(homeViewPath)) {
            const source = await fs.readFile(homeViewPath, "utf8");
            await fs.writeFile(homeViewPath, normalizeImportExtensions(source, [["../stores/index.js", "../stores/index"]]), "utf8");
        }
    }
}

async function replaceFileExtension(targetPath, fromRelative, toRelative, transform) {
    const fromFile = path.join(targetPath, fromRelative);
    if (!(await safeStat(fromFile))) {
        return;
    }
    const source = await fs.readFile(fromFile, "utf8");
    const nextSource = typeof transform === "function" ? transform(source) : source;
    const toFile = path.join(targetPath, toRelative);
    await fs.mkdir(path.dirname(toFile), { recursive: true });
    await fs.writeFile(toFile, nextSource, "utf8");
    await fs.rm(fromFile, { force: true });
}

function normalizeImportExtensions(source, replacements) {
    return replacements.reduce((result, [from, to]) => result.replaceAll(from, to), source);
}

function createTsConfig() {
    return `${JSON.stringify({
        compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            jsx: "preserve",
            resolveJsonModule: true,
            isolatedModules: true,
            esModuleInterop: true,
            lib: ["ES2022", "DOM", "DOM.Iterable"],
            noEmit: true,
            skipLibCheck: true,
            types: ["vite/client"]
        },
        include: ["src/**/*.ts", "src/**/*.d.ts", "src/**/*.nd", "vite.config.ts"]
    }, null, 2)}\n`;
}

function createNdEnvTypes() {
    return [
        "declare module \"*.nd\" {",
        "  import type { UnknownClass } from \"nodomx\";",
        "  const component: UnknownClass;",
        "  export default component;",
        "}",
        "",
        "declare module \"vite-plugin-nodomx\" {",
        "  import type { Plugin } from \"vite\";",
        "  export function nodomx(options?: Record<string, unknown>): Plugin;",
        "}",
        "",
        "declare module \"vite-plugin-nodomx/runtime\" {",
        "  export function bootstrapNodomxViteApp(options: {",
        "    nodom: unknown;",
        "    hot?: unknown;",
        "    deps?: string[];",
        "    load: () => Promise<unknown>;",
        "    selector?: string;",
        "  }): Promise<unknown>;",
        "}",
        "",
        "declare module \"@nodomx/store\" {",
        "  export function createStore(): unknown;",
        "  export function defineStore(id: string, definition: unknown): any;",
        "  export function storeToRefs(store: unknown): Record<string, { value: unknown }>;",
        "}"
    ].join("\n") + "\n";
}

function createTypedCounterStoreSource() {
    return [
        "import { defineStore } from \"@nodomx/store\";",
        "",
        "type CounterState = {",
        "  count: number;",
        "  title: string;",
        "};",
        "",
        "type CounterStore = CounterState & {",
        "  $reset(): void;",
        "  doubleCount: number;",
        "  increment(): void;",
        "  reset(): void;",
        "};",
        "",
        "export const useCounterStore = defineStore(\"counter\", {",
        "  state: (): CounterState => ({",
        "    count: 1,",
        "    title: \"NodomX Starter Store\"",
        "  }),",
        "  getters: {",
        "    doubleCount(store: CounterState) {",
        "      return store.count * 2;",
        "    }",
        "  },",
        "  actions: {",
        "    increment(this: CounterStore) {",
        "      this.count += 1;",
        "    },",
        "    reset(this: CounterStore) {",
        "      this.$reset();",
        "    }",
        "  }",
        "});",
        ""
    ].join("\n");
}

function validateTemplateOptions(template, options) {
    if (template === "basic" && (options.router || options.store || options.typescript)) {
        throw new Error("The basic template does not support --router, --store, or --typescript.");
    }
    if (template === "library" && (options.router || options.store)) {
        throw new Error("The library template does not support --router or --store.");
    }
    if (template === "docs" && (options.router || options.store || options.typescript)) {
        throw new Error("The docs template does not support --router, --store, or --typescript.");
    }
    if (template === "ssr" && (options.router || options.store || options.typescript)) {
        throw new Error("The ssr template does not support --router, --store, or --typescript yet.");
    }
}

async function safeStat(targetPath) {
    try {
        return await fs.stat(targetPath);
    } catch {
        return null;
    }
}

function slash(value) {
    return value.replace(/\\/g, "/");
}

async function readVersion(packageJsonPath, fallbackVersion) {
    try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
        return packageJson.version || fallbackVersion;
    } catch {
        return fallbackVersion;
    }
}
