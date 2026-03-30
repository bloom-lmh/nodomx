import { Module } from "@nodomx/runtime-module";
export declare class Teleport extends Module {
    private lastTeleportTarget?;
    template(): string;
    onUpdate(): void;
    mount(): void;
    unmount(passive?: boolean): void;
    private syncTeleportTarget;
    private moveTeleportNode;
    private resolveTeleportTarget;
}
export declare class Suspense extends Module {
    private suspenseBranchCleanupTimers;
    private suspenseFallbackTimer?;
    private suspenseError?;
    private suspensePaused;
    private suspensePending;
    private suspensePendingCount;
    private suspensePhase;
    private suspenseRetryKey;
    private suspenseShowError;
    private suspenseShowFallback;
    private suspenseSubscriptions;
    private suspenseTimeout;
    private suspenseTrackedComponents;
    data(): object;
    template(): string;
    onInit(): void;
    onBeforeRender(): void;
    onRender(): void;
    onActivated(): void;
    onDeactivated(): void;
    onBeforeUnMount(): void;
    onUnMount(): void;
    hasRetryableSuspenseError(cascade?: boolean): boolean;
    retryBoundary(retryKey?: string, cascade?: boolean): boolean;
    private refreshSuspenseState;
    private syncSuspenseViewState;
    private syncSuspenseSubscriptions;
    private clearSuspenseResources;
    private clearSuspenseFallbackTimer;
    private queueSuspenseRender;
    private syncSuspenseBranchCleanup;
    private clearSuspenseBranchCleanup;
    private cleanupSuspenseBranchDom;
    private setSuspensePhase;
    private emitSuspenseHook;
}
