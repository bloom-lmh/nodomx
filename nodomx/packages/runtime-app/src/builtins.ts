import { Module } from "@nodomx/runtime-module";
import { ModuleFactory } from "@nodomx/runtime-registry";
import { Renderer } from "@nodomx/runtime-view";
import { EModuleState, type RenderedDom, Util } from "@nodomx/shared";
import { getAsyncComponentStatus, retryAsyncComponent, subscribeAsyncComponent, type AsyncComponentStatus } from "./async-component";

type TeleportTarget = Element | null;
type SuspenseTrackedAsync = {
    component: unknown;
    status: AsyncComponentStatus;
};
type SuspenseBranch = "default" | "error" | "fallback";
type SuspensePhase = "error" | "fallback" | "idle" | "pending" | "resolved";
type SuspenseHookDetail = {
    boundaryId?: number;
    error?: unknown;
    nested?: boolean;
    nestedRetryCount?: number;
    pendingCount: number;
    phase?: SuspensePhase;
    retryKey?: string;
    sourceBoundaryId?: number;
    timeout: number;
};

export class Teleport extends Module {
    private lastTeleportTarget?: TeleportTarget;

    public template(): string {
        return `
            <div class="nd-teleport-host" style="display:contents">
                <slot />
            </div>
        `;
    }

    public onUpdate(): void {
        this.syncTeleportTarget();
    }

    public mount(): void {
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

    public unmount(passive?: boolean): void {
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
        } else {
            this.state = EModuleState.UNMOUNTED;
        }

        for (const child of this.children) {
            child.unmount(true);
        }

        if (renderedTree?.node?.parentElement) {
            renderedTree.node.parentElement.removeChild(renderedTree.node);
        }

        this.lastTeleportTarget = undefined;
        this.doModuleEvent("onUnMount");
    }

    private syncTeleportTarget(): void {
        const node = this.domManager.renderedTree?.node;
        if (!node) {
            return;
        }
        this.moveTeleportNode(node);
    }

    private moveTeleportNode(node: Node): void {
        const target = this.resolveTeleportTarget();
        if (target) {
            if (node.parentElement !== target) {
                target.appendChild(node);
            }
            this.lastTeleportTarget = target;
            return;
        }

        const sourceAnchor = this.srcDom?.node;
        const sourceParent = sourceAnchor?.parentElement;
        if (sourceAnchor && sourceParent) {
            Util.insertAfter(node, sourceAnchor);
            this.lastTeleportTarget = sourceParent;
        }
    }

    private resolveTeleportTarget(): TeleportTarget {
        if (isTruthyTeleportFlag(this.props?.disabled)) {
            return null;
        }

        const target = this.props?.to ?? this.props?.target;
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
    private suspenseBranchCleanupTimers: Map<Exclude<SuspenseBranch, "default">, ReturnType<typeof setTimeout>> = new Map();
    private suspenseFallbackTimer?: ReturnType<typeof setTimeout>;
    private suspenseError?: unknown;
    private suspensePaused = false;
    private suspensePending = false;
    private suspensePendingCount = 0;
    private suspensePhase: SuspensePhase = "idle";
    private suspenseRetryKey = "";
    private suspenseShowError = false;
    private suspenseShowFallback = false;
    private suspenseSubscriptions: Map<unknown, () => void> = new Map();
    private suspenseTimeout = 0;
    private suspenseTrackedComponents: Set<unknown> = new Set();

    public data(): object {
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

    public template(): string {
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

    public onInit(): void {
        this.model["suspenseOwner"] = String(this.id);
        this.syncSuspenseViewState();
    }

    public onBeforeRender(): void {
        this.syncSuspenseViewState();
    }

    public onRender(): void {
        this.refreshSuspenseState();
    }

    public onActivated(): void {
        this.suspensePaused = false;
        this.refreshSuspenseState();
    }

    public onDeactivated(): void {
        this.suspensePaused = true;
        this.clearSuspenseFallbackTimer();
        this.clearSuspenseBranchCleanup("error");
        this.clearSuspenseBranchCleanup("fallback");
    }

    public onBeforeUnMount(): void {
        this.clearSuspenseResources();
    }

    public onUnMount(): void {
        this.clearSuspenseResources();
    }

    public hasRetryableSuspenseError(cascade = true): boolean {
        const trackedAsyncComponents = collectTrackedAsyncComponents(this);
        if (trackedAsyncComponents.some(item => item.status.error !== undefined)) {
            return true;
        }
        if (!cascade) {
            return false;
        }
        return collectNestedSuspenseBoundaries(this).some(child => child.hasRetryableSuspenseError(true));
    }

    public retryBoundary(retryKey?: string, cascade = true): boolean {
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

    private refreshSuspenseState(): void {
        let trackedAsyncComponents = collectTrackedAsyncComponents(this);
        if (trackedAsyncComponents.length > 0) {
            this.suspenseTrackedComponents = new Set(trackedAsyncComponents.map(item => item.component));
        } else if (this.suspenseTrackedComponents.size > 0) {
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
                .filter(Boolean) as SuspenseTrackedAsync[];
        }
        this.syncSuspenseSubscriptions(trackedAsyncComponents.map(item => item.component));

        let changed = false;
        const timeout = resolveSuspenseTimeout(this.props?.timeout);
        const retryKey = resolveSuspenseRetryKey(this.props?.["retry-key"] ?? this.props?.retryKey);
        if (shouldRetrySuspense(this, trackedAsyncComponents, this.suspenseRetryKey, retryKey)) {
            this.retryBoundary(retryKey, true);
            return;
        }
        this.suspenseRetryKey = retryKey;

        const pendingCount = trackedAsyncComponents.filter(item => item.status.loading && !item.status.resolved && !item.status.error).length;
        const pending = pendingCount > 0;
        this.suspensePendingCount = pendingCount;
        const errorStatus = trackedAsyncComponents.find(item => !!item.status.error)?.status;
        const hadTrackedAsync = trackedAsyncComponents.length > 0;
        const wasAsyncActive = this.suspensePhase === "pending" || this.suspensePhase === "fallback" || this.suspensePhase === "error";

        if (errorStatus?.error !== undefined) {
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
            } else if (!hadTrackedAsync) {
                this.suspensePhase = "idle";
            }
        } else {
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
            } else if (this.suspenseShowFallback) {
                this.suspenseTimeout = timeout;
                this.clearSuspenseFallbackTimer();
                this.setSuspensePhase("fallback", {
                    boundaryId: this.id,
                    pendingCount,
                    retryKey: this.suspenseRetryKey || retryKey || undefined,
                    timeout
                });
            } else if (!this.suspenseFallbackTimer || this.suspenseTimeout !== timeout) {
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

    private syncSuspenseViewState(): boolean {
        const hasFallbackSlot = this.slots.has("fallback");
        const hasErrorSlot = this.slots.has("error");
        const branchTransition = resolveSuspenseBranchTransition(this.props);
        const errorMessage = normalizeSuspenseErrorMessage(this.suspenseError);
        const errorText = normalizeSuspenseErrorText(this.props?.error, this.suspenseError);
        const fallbackText = normalizeSuspenseFallbackText(this.props?.fallback);
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
        changed = setSuspenseModelValue(this, "branchTransitionDuration", branchTransition?.duration) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionEnabled", !!branchTransition) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionEnterActiveClass", branchTransition?.enterActiveClass) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionEnterDuration", branchTransition?.enterDuration) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionEnterFromClass", branchTransition?.enterFromClass) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionEnterToClass", branchTransition?.enterToClass) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionLeaveActiveClass", branchTransition?.leaveActiveClass) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionLeaveDuration", branchTransition?.leaveDuration) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionLeaveFromClass", branchTransition?.leaveFromClass) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionLeaveToClass", branchTransition?.leaveToClass) || changed;
        changed = setSuspenseModelValue(this, "branchTransitionName", branchTransition?.name || "nd-suspense") || changed;
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

    private syncSuspenseSubscriptions(components: unknown[]): void {
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

    private clearSuspenseResources(): void {
        this.clearSuspenseFallbackTimer();
        this.clearSuspenseBranchCleanup("error");
        this.clearSuspenseBranchCleanup("fallback");
        for (const unsubscribe of this.suspenseSubscriptions.values()) {
            unsubscribe();
        }
        this.suspenseSubscriptions.clear();
        this.suspenseTrackedComponents.clear();
    }

    private clearSuspenseFallbackTimer(): void {
        if (this.suspenseFallbackTimer) {
            clearTimeout(this.suspenseFallbackTimer);
            this.suspenseFallbackTimer = undefined;
        }
    }

    private queueSuspenseRender(): void {
        this.markDirty();
        if (!this.suspensePaused) {
            Renderer.add(this);
        }
    }

    private syncSuspenseBranchCleanup(
        branch: Exclude<SuspenseBranch, "default">,
        visible: boolean,
        transition: ReturnType<typeof resolveSuspenseBranchTransition>
    ): void {
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

    private clearSuspenseBranchCleanup(branch: Exclude<SuspenseBranch, "default">): void {
        const timer = this.suspenseBranchCleanupTimers.get(branch);
        if (timer) {
            clearTimeout(timer);
            this.suspenseBranchCleanupTimers.delete(branch);
        }
    }

    private cleanupSuspenseBranchDom(branch: Exclude<SuspenseBranch, "default">): void {
        const owner = String(this.id);
        const selector = `.nd-suspense-${branch}[data-nd-suspense-owner="${owner}"]`;
        for (const node of Array.from(document.querySelectorAll(selector))) {
            if (node.parentElement) {
                node.parentElement.removeChild(node);
            }
        }
    }

    private setSuspensePhase(nextPhase: SuspensePhase, detail: SuspenseHookDetail): void {
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

    private emitSuspenseHook(name: string, detail: SuspenseHookDetail): void {
        const ownDetail = {
            ...detail,
            boundaryId: detail.boundaryId ?? this.id,
            nested: false,
            phase: detail.phase ?? this.suspensePhase,
            sourceBoundaryId: detail.sourceBoundaryId ?? detail.boundaryId ?? this.id
        };
        this.emitHook(name, ownDetail);

        let parent = this.getParent();
        while (parent && parent !== this) {
            parent.emitHook(name, {
                ...detail,
                boundaryId: detail.boundaryId ?? this.id,
                nested: true,
                phase: detail.phase ?? this.suspensePhase,
                sourceBoundaryId: detail.sourceBoundaryId ?? detail.boundaryId ?? this.id
            });
            parent = parent.getParent?.();
        }
    }
}

ModuleFactory.addClass(Suspense, "Suspense");

function isTruthyTeleportFlag(value: unknown): boolean {
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        return normalized === "" || normalized === "true" || normalized === "1";
    }
    return value === true;
}

function collectTrackedAsyncComponents(rootModule: Suspense): SuspenseTrackedAsync[] {
    const tracked = new Map<unknown, AsyncComponentStatus>();
    const walk = (dom?: RenderedDom | null, branch: SuspenseBranch = "default"): void => {
        if (!dom) {
            return;
        }
        const nextBranch = resolveSuspenseBranch(dom, branch);
        if (dom.childModuleId) {
            const childModule = ModuleFactory.get(dom.childModuleId) as Module | undefined;
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
            walk(childModule.domManager?.renderedTree, nextBranch);
            return;
        }
        for (const child of dom.children || []) {
            walk(child, nextBranch);
        }
    };
    walk(rootModule.domManager?.renderedTree);
    return Array.from(tracked.entries()).map(([component, status]) => ({
        component,
        status
    }));
}

function collectNestedSuspenseBoundaries(rootModule: Suspense): Suspense[] {
    const boundaries = new Set<Suspense>();
    const walk = (dom?: RenderedDom | null, branch: SuspenseBranch = "default"): void => {
        if (!dom) {
            return;
        }
        const nextBranch = resolveSuspenseBranch(dom, branch);
        if (dom.childModuleId) {
            const childModule = ModuleFactory.get(dom.childModuleId) as Module | undefined;
            if (!childModule || nextBranch !== "default") {
                return;
            }
            if (childModule.constructor === Suspense) {
                boundaries.add(childModule as Suspense);
                return;
            }
            walk(childModule.domManager?.renderedTree, nextBranch);
            return;
        }
        for (const child of dom.children || []) {
            walk(child, nextBranch);
        }
    };
    walk(rootModule.domManager?.renderedTree);
    return Array.from(boundaries);
}

function resolveSuspenseBranch(dom: RenderedDom, currentBranch: SuspenseBranch): SuspenseBranch {
    const branch = dom.props?.["data-nd-suspense-branch"];
    if (branch === "default" || branch === "error" || branch === "fallback") {
        return branch;
    }
    return currentBranch;
}

function resolveSuspenseTimeout(value: unknown): number {
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

function resolveSuspenseBranchTransition(props?: Record<string, unknown>): {
    duration?: number | string;
    enterActiveClass?: string;
    enterDuration?: number | string;
    enterFromClass?: string;
    enterToClass?: string;
    leaveActiveClass?: string;
    leaveDuration?: number | string;
    leaveFromClass?: string;
    leaveToClass?: string;
    name: string;
} | null {
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

function readSuspenseBranchTransitionProp(props: Record<string, unknown> | undefined, ...names: string[]): unknown {
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

function resolveSuspenseBranchTransitionEnabled(value: unknown): boolean {
    if (value === undefined || value === null) {
        return false;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        return normalized === "" || normalized === "true" || normalized === "1";
    }
    return value === true;
}

function normalizeSuspenseTransitionName(value: unknown): string {
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    return "nd-suspense";
}

function normalizeSuspenseTransitionClass(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    const normalized = value.trim();
    return normalized || undefined;
}

function normalizeSuspenseTransitionDuration(value: unknown): number | string | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.max(0, value);
    }
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    return undefined;
}

function resolveSuspenseBranchTransitionDelay(
    transition: ReturnType<typeof resolveSuspenseBranchTransition>
): number {
    if (!transition) {
        return 0;
    }
    const duration = transition.leaveDuration ?? transition.duration;
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

function resolveSuspenseRetryKey(value: unknown): string {
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
    } catch {
        return String(value);
    }
}

function shouldRetrySuspense(
    module: Suspense,
    trackedAsyncComponents: SuspenseTrackedAsync[],
    previousRetryKey: string,
    nextRetryKey: string
): boolean {
    if (!nextRetryKey || nextRetryKey === previousRetryKey) {
        return false;
    }
    if (trackedAsyncComponents.some(item => item.status.error !== undefined)) {
        return true;
    }
    return collectNestedSuspenseBoundaries(module).some(child => child.hasRetryableSuspenseError(true));
}

function normalizeSuspenseFallbackText(value: unknown): string {
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    return "Loading...";
}

function normalizeSuspenseErrorText(value: unknown, error?: unknown): string {
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

function normalizeSuspenseErrorMessage(error?: unknown): string {
    if (error instanceof Error && error.message.trim()) {
        return error.message.trim();
    }
    if (typeof error === "string" && error.trim()) {
        return error.trim();
    }
    return "";
}

function setSuspenseModelValue(module: Module, key: string, value: unknown): boolean {
    if (Object.is(module.model[key], value)) {
        return false;
    }
    module.model[key] = value;
    return true;
}
