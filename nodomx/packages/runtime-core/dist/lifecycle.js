import { getCurrentScope } from "@nodomx/reactivity";
import { Nodom } from "./nodom";
function useRuntimeModule() {
    const scope = getCurrentScope();
    if (!scope) {
        throw new Error("This composition api can only be used during setup().");
    }
    return scope;
}
function registerHook(name, hook) {
    useRuntimeModule().addCompositionHook(name, hook);
}
export function useModule() {
    return useRuntimeModule();
}
export function useModel() {
    return useRuntimeModule().model;
}
export function useApp() {
    var _a;
    return (_a = useRuntimeModule().appContext) === null || _a === void 0 ? void 0 : _a.app;
}
export function useAttrs() {
    return (useRuntimeModule().props || {});
}
export const useProps = useAttrs;
export function useSlots() {
    return useRuntimeModule().slots;
}
export function defineProps() {
    return useAttrs();
}
export function withDefaults(props, defaults) {
    return {
        ...(defaults || {}),
        ...(props || {})
    };
}
export function provide(key, value) {
    useRuntimeModule().provide(key, value);
}
export function inject(key, defaultValue) {
    return useRuntimeModule().inject(key, defaultValue);
}
export const useInject = inject;
export function useRouter() {
    return Nodom["$Router"];
}
export function useRoute() {
    var _a;
    return (((_a = useRuntimeModule().model) === null || _a === void 0 ? void 0 : _a["$route"]) || {});
}
export function onInit(hook) {
    registerHook("onInit", hook);
}
export function onBeforeRender(hook) {
    registerHook("onBeforeRender", hook);
}
export function onRender(hook) {
    registerHook("onRender", hook);
}
export function onBeforeMount(hook) {
    registerHook("onBeforeMount", hook);
}
export function onMounted(hook) {
    registerHook("onMount", hook);
}
export function onBeforeUpdate(hook) {
    registerHook("onBeforeUpdate", hook);
}
export function onUpdated(hook) {
    registerHook("onUpdate", hook);
}
export function onBeforeUnmount(hook) {
    registerHook("onBeforeUnMount", hook);
}
export function onUnmounted(hook) {
    registerHook("onUnMount", hook);
}
//# sourceMappingURL=lifecycle.js.map