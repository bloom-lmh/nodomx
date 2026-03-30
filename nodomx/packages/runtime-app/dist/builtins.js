import { Module } from "@nodomx/runtime-module";
import { ModuleFactory } from "@nodomx/runtime-registry";
import { Renderer } from "@nodomx/runtime-view";
import { EModuleState, Util } from "@nodomx/shared";
import { getAsyncComponentStatus, retryAsyncComponent, subscribeAsyncComponent } from "./async-component";
export class Teleport extends Module {
    template() {
        return `
            <div class="nd-teleport-host" style="display:contents">
                <slot />
            </div>
        `;
    }
    onUpdate() {
        this.syncTeleportTarget();
    }
    mount() {
        if (this.state === EModuleState.MOUNTED || !this.domManager.renderedTree) {
            return;
        }
        this.doModuleEvent("onBeforeMount");
        const root = new DocumentFragment();
        const el = Renderer.renderToHtml(this, this.domManager.renderedTree, root);
        this.moveTeleportNode(el);
        this.doModuleEvent("onMount");
        this.state = EModuleState.MOUNTED;
    }
    unmount(passive) {
        var _a;
        if (this.state !== EModuleState.MOUNTED || ModuleFactory.getMain() === this) {
            return;
        }
        Renderer.remove(this);
        this.doModuleEvent("onBeforeUnMount");
        this.eventFactory.clear();
        const renderedTree = this.domManager.renderedTree;
        this.domManager.renderedTree = null;
        if (passive) {
            this.state = EModuleState.INIT;
        }
        else {
            this.state = EModuleState.UNMOUNTED;
        }
        for (const child of this.children) {
            child.unmount(true);
        }
        if ((_a = renderedTree === null || renderedTree === void 0 ? void 0 : renderedTree.node) === null || _a === void 0 ? void 0 : _a.parentElement) {
            renderedTree.node.parentElement.removeChild(renderedTree.node);
        }
        this.lastTeleportTarget = undefined;
        this.doModuleEvent("onUnMount");
    }
    syncTeleportTarget() {
        var _a;
        const node = (_a = this.domManager.renderedTree) === null || _a === void 0 ? void 0 : _a.node;
        if (!node) {
            return;
        }
        this.moveTeleportNode(node);
    }
    moveTeleportNode(node) {
        var _a;
        const target = this.resolveTeleportTarget();
        if (target) {
            if (node.parentElement !== target) {
                target.appendChild(node);
            }
            this.lastTeleportTarget = target;
            return;
        }
        const sourceAnchor = (_a = this.srcDom) === null || _a === void 0 ? void 0 : _a.node;
        const sourceParent = sourceAnchor === null || sourceAnchor === void 0 ? void 0 : sourceAnchor.parentElement;
        if (sourceAnchor && sourceParent) {
            Util.insertAfter(node, sourceAnchor);
            this.lastTeleportTarget = sourceParent;
        }
    }
    resolveTeleportTarget() {
        var _a, _b, _c, _d;
        if (isTruthyTeleportFlag((_a = this.props) === null || _a === void 0 ? void 0 : _a.disabled)) {
            return null;
        }
        const target = (_c = (_b = this.props) === null || _b === void 0 ? void 0 : _b.to) !== null && _c !== void 0 ? _c : (_d = this.props) === null || _d === void 0 ? void 0 : _d.target;
        if (typeof target === "string" && target.trim()) {
            return document.querySelector(target);
        }
        if (target instanceof Element) {
            return target;
        }
        return null;
    }
}
ModuleFactory.addClass(Teleport, "Teleport");
export class Suspense extends Module {
    constructor() {
        super(...arguments);
        this.suspenseBranchCleanupTimers = new Map();
        this.suspensePaused = false;
        this.suspensePending = false;
        this.suspensePendingCount = 0;
        this.suspensePhase = "idle";
        this.suspenseRetryKey = "";
        this.suspenseShowError = false;
        this.suspenseShowFallback = false;
        this.suspenseSubscriptions = new Map();
        this.suspenseTimeout = 0;
        this.suspenseTrackedComponents = new Set();
    }
    data() {
        return {
            defaultStyle: "display:contents",
            branchTransitionDuration: undefined,
            branchTransitionEnabled: false,
            branchTransitionEnterActiveClass: undefined,
            branchTransitionEnterDuration: undefined,
            branchTransitionEnterFromClass: undefined,
            branchTransitionEnterToClass: undefined,
            branchTransitionLeaveActiveClass: undefined,
            branchTransitionLeaveDuration: undefined,
            branchTransitionLeaveFromClass: undefined,
            branchTransitionLeaveToClass: undefined,
            branchTransitionName: "nd-suspense",
            errorMessage: "",
            errorStyle: "display:none",
            errorText: "Async content failed to load.",
            fallbackStyle: "display:none",
            fallbackText: "Loading...",
            pendingCount: 0,
            phase: "idle",
            retryKey: "",
            showError: false,
            showErrorPlain: false,
            showErrorText: false,
            showErrorTransition: false,
            showFallback: false,
            showFallbackPlain: false,
            showFallbackText: false,
            showFallbackTransition: false,
            suspenseOwner: ""
        };
    }
    template() {
        return `
            <div class="nd-suspense-host" style="display:contents">
                <div
                    class="nd-suspense-default"
                    data-nd-suspense-branch="default"
                    data-nd-suspense-owner={{suspenseOwner}}
                    style={{defaultStyle}}
                >
                    <slot />
                </div>
                <if cond={{showErrorTransition}}>
                    <Transition
                        name={{branchTransitionName}}
                        duration={{branchTransitionDuration}}
                        enter-duration={{branchTransitionEnterDuration}}
                        leave-duration={{branchTransitionLeaveDuration}}
                        enter-from-class={{branchTransitionEnterFromClass}}
                        enter-active-class={{branchTransitionEnterActiveClass}}
                        enter-to-class={{branchTransitionEnterToClass}}
                        leave-from-class={{branchTransitionLeaveFromClass}}
                        leave-active-class={{branchTransitionLeaveActiveClass}}
                        leave-to-class={{branchTransitionLeaveToClass}}
                    >
                        <div
                            x-if={{showError}}
                            class="nd-suspense-error"
                            data-nd-suspense-branch="error"
                            data-nd-suspense-owner={{suspenseOwner}}
                            style={{errorStyle}}
                        >
                            <slot name="error" innerrender />
                            <div x-if={{showErrorText}} class="nd-suspense-error-text">{{errorText}}</div>
                        </div>
                    </Transition>
                </if>
                <endif />
                <if cond={{showErrorPlain}}>
                    <div
                        x-if={{showError}}
                        class="nd-suspense-error"
                        data-nd-suspense-branch="error"
                        data-nd-suspense-owner={{suspenseOwner}}
                        style={{errorStyle}}
                    >
                        <slot name="error" innerrender />
                        <div x-if={{showErrorText}} class="nd-suspense-error-text">{{errorText}}</div>
                    </div>
                </if>
                <endif />
                <if cond={{showFallbackTransition}}>
                    <Transition
                        name={{branchTransitionName}}
                        duration={{branchTransitionDuration}}
                        enter-duration={{branchTransitionEnterDuration}}
                        leave-duration={{branchTransitionLeaveDuration}}
                        enter-from-class={{branchTransitionEnterFromClass}}
                        enter-active-class={{branchTransitionEnterActiveClass}}
                        enter-to-class={{branchTransitionEnterToClass}}
                        leave-from-class={{branchTransitionLeaveFromClass}}
                        leave-active-class={{branchTransitionLeaveActiveClass}}
                        leave-to-class={{branchTransitionLeaveToClass}}
                    >
                        <div
                            x-if={{showFallback}}
                            class="nd-suspense-fallback"
                            data-nd-suspense-branch="fallback"
                            data-nd-suspense-owner={{suspenseOwner}}
                            style={{fallbackStyle}}
                        >
                            <slot name="fallback" innerrender />
                            <div x-if={{showFallbackText}} class="nd-suspense-fallback-text">{{fallbackText}}</div>
                        </div>
                    </Transition>
                </if>
                <endif />
                <if cond={{showFallbackPlain}}>
                    <div
                        x-if={{showFallback}}
                        class="nd-suspense-fallback"
                        data-nd-suspense-branch="fallback"
                        data-nd-suspense-owner={{suspenseOwner}}
                        style={{fallbackStyle}}
                    >
                        <slot name="fallback" innerrender />
                        <div x-if={{showFallbackText}} class="nd-suspense-fallback-text">{{fallbackText}}</div>
                    </div>
                </if>
                <endif />
            </div>
        `;
    }
    onInit() {
        this.model["suspenseOwner"] = String(this.id);
        this.syncSuspenseViewState();
    }
    onBeforeRender() {
        this.syncSuspenseViewState();
    }
    onRender() {
        this.refreshSuspenseState();
    }
    onActivated() {
        this.suspensePaused = false;
        this.refreshSuspenseState();
    }
    onDeactivated() {
        this.suspensePaused = true;
        this.clearSuspenseFallbackTimer();
        this.clearSuspenseBranchCleanup("error");
        this.clearSuspenseBranchCleanup("fallback");
    }
    onBeforeUnMount() {
        this.clearSuspenseResources();
    }
    onUnMount() {
        this.clearSuspenseResources();
    }
    hasRetryableSuspenseError(cascade = true) {
        const trackedAsyncComponents = collectTrackedAsyncComponents(this);
        if (trackedAsyncComponents.some(item => item.status.error !== undefined)) {
            return true;
        }
        if (!cascade) {
            return false;
        }
        return collectNestedSuspenseBoundaries(this).some(child => child.hasRetryableSuspenseError(true));
    }
    retryBoundary(retryKey, cascade = true) {
        const trackedAsyncComponents = collectTrackedAsyncComponents(this);
        const retriedComponents = trackedAsyncComponents.filter(item => item.status.error !== undefined);
        let nestedRetryCount = 0;
        if (cascade) {
            for (const child of collectNestedSuspenseBoundaries(this)) {
                if (child.retryBoundary(retryKey, true)) {
                    nestedRetryCount += 1;
                }
            }
        }
        if (retriedComponents.length === 0 && nestedRetryCount === 0) {
            return false;
        }
        this.suspenseRetryKey = retryKey || this.suspenseRetryKey;
        this.suspensePending = false;
        this.suspenseShowError = false;
        this.suspenseShowFallback = false;
        this.suspenseError = undefined;
        this.clearSuspenseFallbackTimer();
        this.syncSuspenseViewState();
        this.queueSuspenseRender();
        this.emitSuspenseHook("onSuspenseRetry", {
            boundaryId: this.id,
            nestedRetryCount,
            pendingCount: retriedComponents.length,
            phase: "pending",
            retryKey: this.suspenseRetryKey || undefined,
            sourceBoundaryId: this.id,
            timeout: this.suspenseTimeout
        });
        for (const item of retriedComponents) {
            void retryAsyncComponent(item.component);
        }
        return true;
    }
    refreshSuspenseState() {
        var _a, _b, _c, _d, _e;
        let trackedAsyncComponents = collectTrackedAsyncComponents(this);
        if (trackedAsyncComponents.length > 0) {
            this.suspenseTrackedComponents = new Set(trackedAsyncComponents.map(item => item.component));
        }
        else if (this.suspenseTrackedComponents.size > 0) {
            trackedAsyncComponents = Array.from(this.suspenseTrackedComponents)
                .map(component => {
                const status = getAsyncComponentStatus(component);
                return status
                    ? {
                        component,
                        status
                    }
                    : null;
            })
                .filter(Boolean);
        }
        this.syncSuspenseSubscriptions(trackedAsyncComponents.map(item => item.component));
        let changed = false;
        const timeout = resolveSuspenseTimeout((_a = this.props) === null || _a === void 0 ? void 0 : _a.timeout);
        const retryKey = resolveSuspenseRetryKey((_c = (_b = this.props) === null || _b === void 0 ? void 0 : _b["retry-key"]) !== null && _c !== void 0 ? _c : (_d = this.props) === null || _d === void 0 ? void 0 : _d.retryKey);
        if (shouldRetrySuspense(this, trackedAsyncComponents, this.suspenseRetryKey, retryKey)) {
            this.retryBoundary(retryKey, true);
            return;
        }
        this.suspenseRetryKey = retryKey;
        const pendingCount = trackedAsyncComponents.filter(item => item.status.loading && !item.status.resolved && !item.status.error).length;
        const pending = pendingCount > 0;
        this.suspensePendingCount = pendingCount;
        const errorStatus = (_e = trackedAsyncComponents.find(item => !!item.status.error)) === null || _e === void 0 ? void 0 : _e.status;
        const hadTrackedAsync = trackedAsyncComponents.length > 0;
        const wasAsyncActive = this.suspensePhase === "pending" || this.suspensePhase === "fallback" || this.suspensePhase === "error";
        if ((errorStatus === null || errorStatus === void 0 ? void 0 : errorStatus.error) !== undefined) {
            changed = changed
                || this.suspensePending
                || this.suspenseShowFallback
                || !this.suspenseShowError
                || !Object.is(this.suspenseError, errorStatus.error);
            this.suspensePending = false;
            this.suspenseShowFallback = false;
            this.suspenseShowError = true;
            this.suspenseTimeout = timeout;
            this.clearSuspenseFallbackTimer();
            this.setSuspensePhase("error", {
                boundaryId: this.id,
                error: errorStatus.error,
                pendingCount,
                phase: "error",
                sourceBoundaryId: this.id,
                timeout
            });
            this.suspenseError = errorStatus.error;
            const viewChanged = this.syncSuspenseViewState();
            if (changed || viewChanged) {
                this.queueSuspenseRender();
            }
            return;
        }
        if (!pending) {
            changed = this.suspensePending || this.suspenseShowFallback || this.suspenseShowError || this.suspenseError !== undefined;
            this.suspensePending = false;
            this.suspenseShowFallback = false;
            this.suspenseShowError = false;
            this.suspenseError = undefined;
            this.suspensePendingCount = 0;
            this.suspenseTimeout = 0;
            this.clearSuspenseFallbackTimer();
            if (hadTrackedAsync && wasAsyncActive) {
                this.setSuspensePhase("resolved", {
                    boundaryId: this.id,
                    pendingCount: 0,
                    phase: "resolved",
                    sourceBoundaryId: this.id,
                    timeout: 0
                });
            }
            else if (!hadTrackedAsync) {
                this.suspensePhase = "idle";
            }
        }
        else {
            if (this.suspensePhase !== "pending" && this.suspensePhase !== "fallback") {
                this.setSuspensePhase("pending", {
                    boundaryId: this.id,
                    pendingCount,
                    phase: "pending",
                    retryKey: this.suspenseRetryKey || retryKey || undefined,
                    sourceBoundaryId: this.id,
                    timeout
                });
            }
            changed = !this.suspensePending || this.suspenseShowError || this.suspenseError !== undefined;
            this.suspensePending = true;
            this.suspenseShowError = false;
            this.suspenseError = undefined;
            if (timeout <= 0) {
                changed = changed || !this.suspenseShowFallback;
                this.suspenseShowFallback = true;
                this.suspenseTimeout = timeout;
                this.clearSuspenseFallbackTimer();
                this.setSuspensePhase("fallback", {
                    boundaryId: this.id,
                    pendingCount,
                    phase: "fallback",
                    retryKey: this.suspenseRetryKey || retryKey || undefined,
                    sourceBoundaryId: this.id,
                    timeout
                });
            }
            else if (this.suspenseShowFallback) {
                this.suspenseTimeout = timeout;
                this.clearSuspenseFallbackTimer();
                this.setSuspensePhase("fallback", {
                    boundaryId: this.id,
                    pendingCount,
                    retryKey: this.suspenseRetryKey || retryKey || undefined,
                    timeout
                });
            }
            else if (!this.suspenseFallbackTimer || this.suspenseTimeout !== timeout) {
                this.suspenseTimeout = timeout;
                this.clearSuspenseFallbackTimer();
                this.suspenseFallbackTimer = setTimeout(() => {
                    this.suspenseFallbackTimer = undefined;
                    if (!this.suspensePending || this.suspenseShowFallback || this.suspenseShowError) {
                        return;
                    }
                    this.suspenseShowFallback = true;
                    this.setSuspensePhase("fallback", {
                        boundaryId: this.id,
                        pendingCount: collectTrackedAsyncComponents(this).filter(item => item.status.loading && !item.status.resolved && !item.status.error).length,
                        retryKey: this.suspenseRetryKey || retryKey || undefined,
                        timeout: this.suspenseTimeout
                    });
                    this.syncSuspenseViewState();
                    this.queueSuspenseRender();
                }, timeout);
            }
        }
        const viewChanged = this.syncSuspenseViewState();
        if (changed || viewChanged) {
            this.queueSuspenseRender();
        }
    }
    syncSuspenseViewState() {
        var _a, _b;
        const hasFallbackSlot = this.slots.has("fallback");
        const hasErrorSlot = this.slots.has("error");
        const branchTransition = resolveSuspenseBranchTransition(this.props);
        const errorMessage = normalizeSuspenseErrorMessage(this.suspenseError);
        const errorText = normalizeSuspenseErrorText((_a = this.props) === null || _a === void 0 ? void 0 : _a.error, this.suspenseError);
        const fallbackText = normalizeSuspenseFallbackText((_b = this.props) === null || _b === void 0 ? void 0 : _b.fallback);
        const nextDefaultStyle = this.suspenseShowFallback || this.suspenseShowError ? "display:none" : "display:contents";
        const nextErrorStyle = this.suspenseShowError ? "display:contents" : "display:none";
        const nextFallbackStyle = this.suspenseShowFallback ? "display:contents" : "display:none";
        const nextShowErrorText = this.suspenseShowError && !hasErrorSlot;
        const nextShowFallbackText = this.suspenseShowFallback && !hasFallbackSlot;
        const showErrorTransition = this.suspenseShowError && !!branchTransition;
        const showFallbackTransition = this.suspenseShowFallback && !!branchTransition;
        this.syncSuspenseBranchCleanup("error", this.suspenseShowError, branchTransition);
        this.syncSuspenseBranchCleanup("fallback", this.suspenseShowFallback, branchTransition);
        let changed = false;
        changed = setSuspenseModelValue(this, "branchTransitionDuration", branchTransition === null || branchTransition === void 0 ? void 0 : branchTransition.duration) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionEnabled", !!branchTransition) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionEnterActiveClass", branchTransition === null || branchTransition === void 0 ? void 0 : branchTransition.enterActiveClass) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionEnterDuration", branchTransition === null || branchTransition === void 0 ? void 0 : branchTransition.enterDuration) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionEnterFromClass", branchTransition === null || branchTransition === void 0 ? void 0 : branchTransition.enterFromClass) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionEnterToClass", branchTransition === null || branchTransition === void 0 ? void 0 : branchTransition.enterToClass) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionLeaveActiveClass", branchTransition === null || branchTransition === void 0 ? void 0 : branchTransition.leaveActiveClass) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionLeaveDuration", branchTransition === null || branchTransition === void 0 ? void 0 : branchTransition.leaveDuration) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionLeaveFromClass", branchTransition === null || branchTransition === void 0 ? void 0 : branchTransition.leaveFromClass) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionLeaveToClass", branchTransition === null || branchTransition === void 0 ? void 0 : branchTransition.leaveToClass) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionName", (branchTransition === null || branchTransition === void 0 ? void 0 : branchTransition.name) || "nd-suspense") || changed;
        changed = setSuspenseModelValue(this, "defaultStyle", nextDefaultStyle) || changed;
        changed = setSuspenseModelValue(this, "errorMessage", errorMessage) || changed;
        changed = setSuspenseModelValue(this, "errorStyle", nextErrorStyle) || changed;
        changed = setSuspenseModelValue(this, "errorText", errorText) || changed;
        changed = setSuspenseModelValue(this, "fallbackStyle", nextFallbackStyle) || changed;
        changed = setSuspenseModelValue(this, "fallbackText", fallbackText) || changed;
        changed = setSuspenseModelValue(this, "pendingCount", this.suspensePendingCount) || changed;
        changed = setSuspenseModelValue(this, "phase", this.suspensePhase) || changed;
        changed = setSuspenseModelValue(this, "retryKey", this.suspenseRetryKey) || changed;
        changed = setSuspenseModelValue(this, "showError", this.suspenseShowError) || changed;
        changed = setSuspenseModelValue(this, "showErrorPlain", this.suspenseShowError && !branchTransition) || changed;
        changed = setSuspenseModelValue(this, "showErrorText", nextShowErrorText) || changed;
        changed = setSuspenseModelValue(this, "showErrorTransition", showErrorTransition) || changed;
        changed = setSuspenseModelValue(this, "showFallback", this.suspenseShowFallback) || changed;
        changed = setSuspenseModelValue(this, "showFallbackPlain", this.suspenseShowFallback && !branchTransition) || changed;
        changed = setSuspenseModelValue(this, "showFallbackText", nextShowFallbackText) || changed;
        changed = setSuspenseModelValue(this, "showFallbackTransition", showFallbackTransition) || changed;
        changed = setSuspenseModelValue(this, "suspenseOwner", String(this.id)) || changed;
        return changed;
    }
    syncSuspenseSubscriptions(components) {
        const componentSet = new Set(components.filter(Boolean));
        for (const [component, unsubscribe] of this.suspenseSubscriptions.entries()) {
            if (componentSet.has(component)) {
                continue;
            }
            unsubscribe();
            this.suspenseSubscriptions.delete(component);
        }
        for (const component of componentSet) {
            if (this.suspenseSubscriptions.has(component)) {
                continue;
            }
            const unsubscribe = subscribeAsyncComponent(component, () => {
                this.refreshSuspenseState();
            });
            this.suspenseSubscriptions.set(component, unsubscribe);
        }
    }
    clearSuspenseResources() {
        this.clearSuspenseFallbackTimer();
        this.clearSuspenseBranchCleanup("error");
        this.clearSuspenseBranchCleanup("fallback");
        for (const unsubscribe of this.suspenseSubscriptions.values()) {
            unsubscribe();
        }
        this.suspenseSubscriptions.clear();
        this.suspenseTrackedComponents.clear();
    }
    clearSuspenseFallbackTimer() {
        if (this.suspenseFallbackTimer) {
            clearTimeout(this.suspenseFallbackTimer);
            this.suspenseFallbackTimer = undefined;
        }
    }
    queueSuspenseRender() {
        this.markDirty();
        if (!this.suspensePaused) {
            Renderer.add(this);
        }
    }
    syncSuspenseBranchCleanup(branch, visible, transition) {
        if (visible || !transition) {
            this.clearSuspenseBranchCleanup(branch);
            return;
        }
        if (this.suspenseBranchCleanupTimers.has(branch)) {
            return;
        }
        const delay = resolveSuspenseBranchTransitionDelay(transition);
        const timer = setTimeout(() => {
            this.suspenseBranchCleanupTimers.delete(branch);
            const stillVisible = branch === "error" ? this.suspenseShowError : this.suspenseShowFallback;
            if (stillVisible) {
                return;
            }
            this.cleanupSuspenseBranchDom(branch);
        }, delay);
        this.suspenseBranchCleanupTimers.set(branch, timer);
    }
    clearSuspenseBranchCleanup(branch) {
        const timer = this.suspenseBranchCleanupTimers.get(branch);
        if (timer) {
            clearTimeout(timer);
            this.suspenseBranchCleanupTimers.delete(branch);
        }
    }
    cleanupSuspenseBranchDom(branch) {
        const owner = String(this.id);
        const selector = `.nd-suspense-${branch}[data-nd-suspense-owner="${owner}"]`;
        for (const node of Array.from(document.querySelectorAll(selector))) {
            if (node.parentElement) {
                node.parentElement.removeChild(node);
            }
        }
    }
    setSuspensePhase(nextPhase, detail) {
        const sameError = nextPhase !== "error" || Object.is(this.suspenseError, detail.error);
        if (this.suspensePhase === nextPhase && sameError) {
            return;
        }
        this.suspensePhase = nextPhase;
        switch (nextPhase) {
            case "pending":
                this.emitSuspenseHook("onSuspensePending", detail);
                break;
            case "fallback":
                this.emitSuspenseHook("onSuspenseFallback", detail);
                break;
            case "resolved":
                this.emitSuspenseHook("onSuspenseResolve", detail);
                break;
            case "error":
                this.emitSuspenseHook("onSuspenseError", detail);
                break;
            default:
                break;
        }
    }
    emitSuspenseHook(name, detail) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const ownDetail = {
            ...detail,
            boundaryId: (_a = detail.boundaryId) !== null && _a !== void 0 ? _a : this.id,
            nested: false,
            phase: (_b = detail.phase) !== null && _b !== void 0 ? _b : this.suspensePhase,
            sourceBoundaryId: (_d = (_c = detail.sourceBoundaryId) !== null && _c !== void 0 ? _c : detail.boundaryId) !== null && _d !== void 0 ? _d : this.id
        };
        this.emitHook(name, ownDetail);
        let parent = this.getParent();
        while (parent && parent !== this) {
            parent.emitHook(name, {
                ...detail,
                boundaryId: (_e = detail.boundaryId) !== null && _e !== void 0 ? _e : this.id,
                nested: true,
                phase: (_f = detail.phase) !== null && _f !== void 0 ? _f : this.suspensePhase,
                sourceBoundaryId: (_h = (_g = detail.sourceBoundaryId) !== null && _g !== void 0 ? _g : detail.boundaryId) !== null && _h !== void 0 ? _h : this.id
            });
            parent = (_j = parent.getParent) === null || _j === void 0 ? void 0 : _j.call(parent);
        }
    }
}
ModuleFactory.addClass(Suspense, "Suspense");
function isTruthyTeleportFlag(value) {
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        return normalized === "" || normalized === "true" || normalized === "1";
    }
    return value === true;
}
function collectTrackedAsyncComponents(rootModule) {
    var _a;
    const tracked = new Map();
    const walk = (dom, branch = "default") => {
        var _a;
        if (!dom) {
            return;
        }
        const nextBranch = resolveSuspenseBranch(dom, branch);
        if (dom.childModuleId) {
            const childModule = ModuleFactory.get(dom.childModuleId);
            if (!childModule || nextBranch !== "default") {
                return;
            }
            if (childModule.constructor === Suspense) {
                return;
            }
            const status = getAsyncComponentStatus(childModule.constructor);
            if (status) {
                tracked.set(childModule.constructor, status);
                return;
            }
            walk((_a = childModule.domManager) === null || _a === void 0 ? void 0 : _a.renderedTree, nextBranch);
            return;
        }
        for (const child of dom.children || []) {
            walk(child, nextBranch);
        }
    };
    walk((_a = rootModule.domManager) === null || _a === void 0 ? void 0 : _a.renderedTree);
    return Array.from(tracked.entries()).map(([component, status]) => ({
        component,
        status
    }));
}
function collectNestedSuspenseBoundaries(rootModule) {
    var _a;
    const boundaries = new Set();
    const walk = (dom, branch = "default") => {
        var _a;
        if (!dom) {
            return;
        }
        const nextBranch = resolveSuspenseBranch(dom, branch);
        if (dom.childModuleId) {
            const childModule = ModuleFactory.get(dom.childModuleId);
            if (!childModule || nextBranch !== "default") {
                return;
            }
            if (childModule.constructor === Suspense) {
                boundaries.add(childModule);
                return;
            }
            walk((_a = childModule.domManager) === null || _a === void 0 ? void 0 : _a.renderedTree, nextBranch);
            return;
        }
        for (const child of dom.children || []) {
            walk(child, nextBranch);
        }
    };
    walk((_a = rootModule.domManager) === null || _a === void 0 ? void 0 : _a.renderedTree);
    return Array.from(boundaries);
}
function resolveSuspenseBranch(dom, currentBranch) {
    var _a;
    const branch = (_a = dom.props) === null || _a === void 0 ? void 0 : _a["data-nd-suspense-branch"];
    if (branch === "default" || branch === "error" || branch === "fallback") {
        return branch;
    }
    return currentBranch;
}
function resolveSuspenseTimeout(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.max(0, value);
    }
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed)) {
            return Math.max(0, parsed);
        }
    }
    return 0;
}
function resolveSuspenseBranchTransition(props) {
    const enabledFlag = readSuspenseBranchTransitionProp(props, "transition", "branch-transition", "branchTransition");
    const name = readSuspenseBranchTransitionProp(props, "transition-name", "transitionName");
    const duration = readSuspenseBranchTransitionProp(props, "transition-duration", "transitionDuration");
    const enterDuration = readSuspenseBranchTransitionProp(props, "transition-enter-duration", "transitionEnterDuration");
    const leaveDuration = readSuspenseBranchTransitionProp(props, "transition-leave-duration", "transitionLeaveDuration");
    const enterFromClass = readSuspenseBranchTransitionProp(props, "transition-enter-from-class", "transitionEnterFromClass");
    const enterActiveClass = readSuspenseBranchTransitionProp(props, "transition-enter-active-class", "transitionEnterActiveClass");
    const enterToClass = readSuspenseBranchTransitionProp(props, "transition-enter-to-class", "transitionEnterToClass");
    const leaveFromClass = readSuspenseBranchTransitionProp(props, "transition-leave-from-class", "transitionLeaveFromClass");
    const leaveActiveClass = readSuspenseBranchTransitionProp(props, "transition-leave-active-class", "transitionLeaveActiveClass");
    const leaveToClass = readSuspenseBranchTransitionProp(props, "transition-leave-to-class", "transitionLeaveToClass");
    const enabled = resolveSuspenseBranchTransitionEnabled(enabledFlag)
        || name !== undefined
        || duration !== undefined
        || enterDuration !== undefined
        || leaveDuration !== undefined
        || enterFromClass !== undefined
        || enterActiveClass !== undefined
        || enterToClass !== undefined
        || leaveFromClass !== undefined
        || leaveActiveClass !== undefined
        || leaveToClass !== undefined;
    if (!enabled) {
        return null;
    }
    return {
        duration: normalizeSuspenseTransitionDuration(duration),
        enterActiveClass: normalizeSuspenseTransitionClass(enterActiveClass),
        enterDuration: normalizeSuspenseTransitionDuration(enterDuration),
        enterFromClass: normalizeSuspenseTransitionClass(enterFromClass),
        enterToClass: normalizeSuspenseTransitionClass(enterToClass),
        leaveActiveClass: normalizeSuspenseTransitionClass(leaveActiveClass),
        leaveDuration: normalizeSuspenseTransitionDuration(leaveDuration),
        leaveFromClass: normalizeSuspenseTransitionClass(leaveFromClass),
        leaveToClass: normalizeSuspenseTransitionClass(leaveToClass),
        name: normalizeSuspenseTransitionName(name)
    };
}
function readSuspenseBranchTransitionProp(props, ...names) {
    if (!props) {
        return undefined;
    }
    for (const name of names) {
        if (name in props) {
            return props[name];
        }
    }
    return undefined;
}
function resolveSuspenseBranchTransitionEnabled(value) {
    if (value === undefined || value === null) {
        return false;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        return normalized === "" || normalized === "true" || normalized === "1";
    }
    return value === true;
}
function normalizeSuspenseTransitionName(value) {
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    return "nd-suspense";
}
function normalizeSuspenseTransitionClass(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const normalized = value.trim();
    return normalized || undefined;
}
function normalizeSuspenseTransitionDuration(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.max(0, value);
    }
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    return undefined;
}
function resolveSuspenseBranchTransitionDelay(transition) {
    var _a;
    if (!transition) {
        return 0;
    }
    const duration = (_a = transition.leaveDuration) !== null && _a !== void 0 ? _a : transition.duration;
    if (typeof duration === "number" && Number.isFinite(duration)) {
        return Math.max(0, duration) + 20;
    }
    if (typeof duration === "string" && duration.trim()) {
        const parsed = Number(duration.trim());
        if (Number.isFinite(parsed)) {
            return Math.max(0, parsed) + 20;
        }
    }
    return 270;
}
function resolveSuspenseRetryKey(value) {
    if (value === undefined || value === null) {
        return "";
    }
    if (typeof value === "string") {
        return value.trim();
    }
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
        return String(value);
    }
    try {
        return JSON.stringify(value) || "";
    }
    catch {
        return String(value);
    }
}
function shouldRetrySuspense(module, trackedAsyncComponents, previousRetryKey, nextRetryKey) {
    if (!nextRetryKey || nextRetryKey === previousRetryKey) {
        return false;
    }
    if (trackedAsyncComponents.some(item => item.status.error !== undefined)) {
        return true;
    }
    return collectNestedSuspenseBoundaries(module).some(child => child.hasRetryableSuspenseError(true));
}
function normalizeSuspenseFallbackText(value) {
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    return "Loading...";
}
function normalizeSuspenseErrorText(value, error) {
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    if (error instanceof Error && error.message.trim()) {
        return error.message.trim();
    }
    if (typeof error === "string" && error.trim()) {
        return error.trim();
    }
    return "Async content failed to load.";
}
function normalizeSuspenseErrorMessage(error) {
    if (error instanceof Error && error.message.trim()) {
        return error.message.trim();
    }
    if (typeof error === "string" && error.trim()) {
        return error.trim();
    }
    return "";
}
function setSuspenseModelValue(module, key, value) {
    if (Object.is(module.model[key], value)) {
        return false;
    }
    module.model[key] = value;
    return true;
}
//# sourceMappingURL=builtins.js.map