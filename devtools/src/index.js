import { createHook } from "./hook.js";
import {
    DEVTOOLS_HOOK_KEY,
    ensureAppId,
    getGlobalTarget
} from "./shared.js";

export function createDevtools(options = {}) {
    const hook = installDevtoolsHook(options);
    return {
        name: "nodomx-devtools",
        install(app) {
            app.config.globalProperties.$devtools = hook;
            if (app.instance) {
                registerApp(app);
            }
            if (options.overlay !== false) {
                hook.openOverlay();
            }
        }
    };
}

export function installDevtoolsHook(options = {}) {
    const target = getGlobalTarget();
    if (!target) {
        return createHook(undefined, {
            ...options,
            overlay: false
        });
    }
    if (target[DEVTOOLS_HOOK_KEY]) {
        if (options.overlay !== false) {
            target[DEVTOOLS_HOOK_KEY].openOverlay();
        }
        return target[DEVTOOLS_HOOK_KEY];
    }
    const hook = createHook(target, options);
    target[DEVTOOLS_HOOK_KEY] = hook;
    if (options.overlay !== false) {
        hook.openOverlay();
    }
    return hook;
}

export function getDevtoolsHook() {
    return getGlobalTarget()?.[DEVTOOLS_HOOK_KEY];
}

export function registerApp(app) {
    const hook = getDevtoolsHook();
    if (!hook || !app) {
        return null;
    }
    ensureAppId(app);
    return hook.registerApp(app);
}

export function unregisterApp(app) {
    getDevtoolsHook()?.unregisterApp(app);
}

export function notifyDevtoolsUpdate(app, reason = "update", details = {}) {
    if (!app) {
        return;
    }
    ensureAppId(app);
    getDevtoolsHook()?.notifyUpdate(app, reason, details);
}
