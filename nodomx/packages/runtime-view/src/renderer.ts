import { Expression } from "@nodomx/runtime-template";
import { VirtualDom } from "@nodomx/runtime-template";
import { ModuleFactory } from "@nodomx/runtime-registry";
import { Scheduler } from "@nodomx/runtime-scheduler";
import { ChangedDom, PatchFlags, RenderedDom } from "@nodomx/shared";
import { Util } from "@nodomx/shared";
import type { ModelLike, ModuleLike } from "@nodomx/shared";
import { CssManager } from "./cssmanager";
import { appendRenderedChild, canReuseRenderedSubtree, findPreviousChild, resolveRenderedKey, reuseRenderedDom } from "./reuse";

type TeleportRenderedDom = RenderedDom & {
    transition?: {
        duration?: number;
        enterActiveClass?: string;
        enterDuration?: number;
        enterFromClass?: string;
        enterToClass?: string;
        group?: boolean;
        leaveActiveClass?: string;
        leaveDuration?: number;
        leaveFromClass?: string;
        leaveToClass?: string;
        moveClass?: string;
        moveDuration?: number;
        name?: string;
    };
    teleportDisabled?: boolean;
    teleportTarget?: unknown;
};

type ModuleWithHooks = ModuleLike & {
    emitHook?: (eventName: string, ...args: unknown[]) => boolean;
};

type TransitionRuntimeState = {
    cancelEnterFrame?: () => void;
    cancelEnterTimer?: () => void;
    cancelLeaveFrame?: () => void;
    cancelLeaveTimer?: () => void;
    cancelMoveFrame?: () => void;
    cancelMoveTimer?: () => void;
    restoreMoveStyles?: () => void;
    phase?: "enter" | "leave" | "move";
};

const transitionRuntimeStates = new WeakMap<Element, TransitionRuntimeState>();

export class Renderer {
    private static rootEl: HTMLElement;
    private static waitList: Array<number | null> = [];
    private static waitSet: Set<number> = new Set();

    public static setRootEl(rootEl: HTMLElement): void {
        this.rootEl = rootEl;
    }

    public static getRootEl(): HTMLElement {
        return this.rootEl;
    }

    public static add(module: ModuleLike): void {
        if (!module || this.waitSet.has(module.id)) {
            return;
        }
        this.waitSet.add(module.id);
        this.waitList.push(module.id);
        Scheduler.request();
    }

    public static remove(module: ModuleLike): void {
        const index = this.waitList.indexOf(module.id);
        if (index !== -1) {
            this.waitList.splice(index, 1, null);
        }
        this.waitSet.delete(module.id);
    }

    public static render(): void {
        while (this.waitList.length > 0) {
            const id = this.waitList.shift();
            if (!id) {
                continue;
            }
            this.waitSet.delete(id);
            ModuleFactory.get(id)?.render();
        }
    }

    public static flush(maxRounds: number = 20): void {
        let rounds = 0;
        while (this.waitList.length > 0 && rounds < maxRounds) {
            this.render();
            rounds++;
        }
    }

    public static renderDom(
        module: ModuleLike,
        src: VirtualDom,
        model: ModelLike,
        parent?: RenderedDom,
        key?: number | string,
        notRenderChild?: boolean,
        previousDom?: RenderedDom,
        dirtyPaths?: string[]
    ): RenderedDom {
        const srcModule = (ModuleFactory.get(src.moduleId as number) as ModuleLike | undefined) || module;
        const renderedKey = resolveRenderedKey(src, resolveNodeKey(src, srcModule, model, key));
        if (canReuseRenderedSubtree(src, previousDom, dirtyPaths)) {
            const reused = reuseRenderedDom(previousDom as RenderedDom, src, model, parent);
            reused.key = renderedKey;
            reused.moduleId = src.moduleId;
            reused.slotModuleId = src.slotModuleId;
            reused.staticNum = src.staticNum;
            reused.patchFlag = src.patchFlag;
            reused.dynamicProps = [...(src.dynamicProps || [])];
            reused.hoisted = src.hoisted;
            reused.blockRoot = src.blockRoot;
            reused.structureFlags = src.structureFlags;
            reused.childrenPatchFlag = src.childrenPatchFlag;
            reused.childrenStructureFlags = src.childrenStructureFlags;
            appendRenderedChild(parent, reused);
            return reused;
        }
        const clonedBlueprint = !previousDom
            ? cloneStaticRenderBlueprint(module, src, model, parent, key)
            : undefined;
        if (clonedBlueprint) {
            appendRenderedChild(parent, clonedBlueprint);
            return clonedBlueprint;
        }

        const dst: RenderedDom = {
            key: renderedKey,
            model,
            vdom: src,
            parent,
            moduleId: src.moduleId,
            slotModuleId: src.slotModuleId,
            staticNum: src.staticNum,
            patchFlag: src.patchFlag,
            dynamicProps: [...(src.dynamicProps || [])],
            hoisted: src.hoisted,
            blockRoot: src.blockRoot,
            structureFlags: src.structureFlags,
            childrenPatchFlag: src.childrenPatchFlag,
            childrenStructureFlags: src.childrenStructureFlags,
            __skipDiff: false
        };

        if (src.staticNum > 0) {
            src.staticNum--;
        }

        if (src.tagName) {
            dst.tagName = src.tagName;
            dst.locMap = new Map();
            dst.props = {};
            if (src.isSvg) {
                dst.isSvg = src.isSvg;
            }
        }

        const modelDirective = src.getDirective("model");
        if (modelDirective) {
            modelDirective.exec(module, dst);
        }

        if (dst.tagName) {
            this.handleProps(module, src, dst, srcModule);
            if (src.tagName === "style") {
                CssManager.handleStyleDom(module, dst);
            } else if (src.assets && src.assets.size > 0) {
                dst.assets ||= {};
                for (const asset of src.assets) {
                    dst.assets[asset[0]] = asset[1];
                }
            }
            if (!this.handleDirectives(module, src, dst)) {
                return null;
            }
            if (src.events) {
                dst.events = [...src.events];
            }
            if (!notRenderChild && src.children && src.children.length > 0) {
                dst.children = [];
                this.renderChildren(module, src, dst, key, previousDom, dirtyPaths);
            }
        } else if (src.expressions) {
            let value = "";
            for (const expr of src.expressions) {
                if (expr instanceof Expression) {
                    const nextValue = expr.val(srcModule as ModuleLike, dst.model as ModelLike);
                    value += nextValue !== undefined && nextValue !== null ? nextValue : "";
                } else {
                    value += expr;
                }
            }
            dst.textContent = value;
        } else {
            dst.textContent = src.textContent;
        }

        cacheStaticRenderBlueprint(src, dst);
        appendRenderedChild(parent, dst);
        return dst;
    }

    private static handleDirectives(module: ModuleLike, src: VirtualDom, dst: RenderedDom): boolean {
        if (!src.directives || src.directives.length === 0) {
            return true;
        }
        for (const directive of src.directives) {
            if (directive.type.name === "model") {
                continue;
            }
            if (!directive.exec(module, dst)) {
                return false;
            }
        }
        return true;
    }

    private static handleProps(module: ModuleLike, src: VirtualDom, dst: RenderedDom, srcModule: ModuleLike): void {
        if (src.props?.size > 0) {
            for (const prop of src.props) {
                if (prop[0] === "key") {
                    continue;
                }
                const value = prop[1] instanceof Expression ? prop[1].val(srcModule, dst.model as ModelLike) : prop[1];
                dst.props![prop[0]] = normalizePropValue(value);
            }
        }
        if (src.key === 1) {
            mergeRootProps(module, dst);
        }
    }

    private static renderChildren(
        module: ModuleLike,
        src: VirtualDom,
        dst: RenderedDom,
        key: number | string | undefined,
        previousDom: RenderedDom | undefined,
        dirtyPaths?: string[]
    ): void {
        const dynamicChildIndexes = new Set(src.dynamicChildIndexes || []);
        for (let index = 0; index < (src.children?.length || 0); index++) {
            const child = src.children[index];
            const previousChild = findPreviousChild(previousDom, child, key);
            const isDynamicChild = dynamicChildIndexes.has(index);
            if (
                src.blockTree
                && !isDynamicChild
                && previousChild
                && canReuseRenderedSubtree(child, previousChild, dirtyPaths)
            ) {
                const reused = reuseRenderedDom(previousChild, child, dst.model, dst);
                reused.key = previousChild.key;
                reused.moduleId = child.moduleId;
                reused.slotModuleId = child.slotModuleId;
                reused.staticNum = child.staticNum;
                reused.patchFlag = child.patchFlag;
                reused.dynamicProps = [...(child.dynamicProps || [])];
                reused.hoisted = child.hoisted;
                reused.blockRoot = child.blockRoot;
                reused.structureFlags = child.structureFlags;
                reused.childrenPatchFlag = child.childrenPatchFlag;
                reused.childrenStructureFlags = child.childrenStructureFlags;
                appendRenderedChild(dst, reused);
                continue;
            }

            const renderedChild = this.renderDom(
                module,
                child,
                dst.model as ModelLike,
                dst,
                key,
                false,
                previousChild,
                dirtyPaths
            );
            if (src.blockTree && isDynamicChild && renderedChild) {
                dst.dynamicChildKeys ||= [];
                dst.dynamicChildKeys.push(renderedChild.key);
            }
        }
    }

    public static updateToHtml(module: ModuleLike, dom: RenderedDom, oldDom: RenderedDom): Node {
        const el = oldDom.node;
        if (!el) {
            dom.node = this.renderToHtml(module, dom, oldDom.parent?.node as Node);
            return dom.node as Node;
        }
        dom.node = el;
        if (dom.tagName) {
            syncDomState(module, dom, oldDom, el);
            moveTeleportNode(dom, el, oldDom.parent?.node as Node | undefined);
        } else {
            (el as Text).textContent = dom.textContent as string;
        }
        return el;
    }

    public static renderToHtml(module: ModuleLike, src: RenderedDom, parentEl: Node | null): Node {
        const el = src.tagName ? createElementNode(src) : createTextNode(src);
        if (el && src.tagName && !src.childModuleId) {
            appendChildren(el, src);
        }
        if (el) {
            moveTeleportNode(src, el, parentEl || undefined);
        }
        return el as Node;

        function createElementNode(dom: RenderedDom): Node | undefined {
            if (dom.childModuleId) {
                const childModule = ModuleFactory.get(dom.childModuleId);
                if (childModule) {
                    const comment = document.createComment(`module ${childModule.constructor.name}:${childModule.id}`);
                    Renderer.add(childModule);
                    dom.node = comment;
                    return comment;
                }
                return;
            }
            let el: Element;
            if (dom.tagName === "style") {
                el = document.createElement("style");
            } else if (dom.isSvg) {
                el = document.createElementNS("http://www.w3.org/2000/svg", dom.tagName as string);
                if (dom.tagName === "svg") {
                    el.setAttribute("xmlns", "http://www.w3.org/2000/svg");
                }
            } else {
                el = document.createElement(dom.tagName as string);
            }
            dom.node = el;
            if (dom.props) {
                for (const prop of Object.keys(dom.props)) {
                    el.setAttribute(prop, dom.props[prop] as string);
                }
            }
            if (dom.assets) {
                for (const asset of Object.keys(dom.assets)) {
                    (el as unknown as Record<string, unknown>)[asset] = dom.assets[asset];
                }
            }
            module.eventFactory.handleDomEvent(dom);
            queueTransitionEnter(module, dom, el);
            return el;
        }

        function createTextNode(dom: RenderedDom): Node | undefined {
            if (CssManager.handleStyleTextDom(module, dom)) {
                return;
            }
            dom.node = document.createTextNode((dom.textContent as string) || "");
            return dom.node;
        }

        function appendChildren(parentNode: Node, dom: RenderedDom): void {
            if (!dom.children || dom.children.length === 0) {
                return;
            }
            for (const child of dom.children) {
                let childNode: Node | undefined;
                if (child.tagName) {
                    childNode = createElementNode(child);
                    if (childNode instanceof Element) {
                        appendChildren(childNode, child);
                    }
                } else {
                    childNode = createTextNode(child);
                }
                if (childNode) {
                    parentNode.appendChild(childNode);
                }
            }
        }
    }

    public static syncTeleports(dom?: RenderedDom): void {
        if (!dom) {
            return;
        }
        if (dom.node) {
            moveTeleportNode(dom, dom.node, dom.parent?.node as Node | undefined);
        }
        if (dom.children) {
            for (const child of dom.children) {
                this.syncTeleports(child);
            }
        }
    }

    public static runLeaveTransition(module: ModuleLike, dom: RenderedDom, removeNode: () => void): boolean {
        const transition = resolveTransitionDescriptor(dom);
        const node = dom.node;
        if (!transition || !(node instanceof Element)) {
            return false;
        }
        const state = getTransitionRuntimeState(node);

        const {
            leaveActiveClass,
            leaveDuration,
            leaveFromClass,
            leaveToClass
        } = transition;

        cancelTransitionPhase(module, node, state, "enter", transition);
        cancelTransitionPhase(module, node, state, "leave", transition);

        state.phase = "leave";
        emitTransitionHook(module, "onBeforeLeave", node);
        removeTransitionClasses(node, [
            transition.enterActiveClass,
            transition.enterFromClass,
            transition.enterToClass
        ]);
        addTransitionClasses(node, [leaveFromClass, leaveActiveClass]);
        state.cancelLeaveFrame = scheduleNextFrame(() => {
            state.cancelLeaveFrame = undefined;
            removeTransitionClasses(node, [leaveFromClass]);
            addTransitionClasses(node, [leaveToClass]);
            emitTransitionHook(module, "onLeave", node);
            state.cancelLeaveTimer = scheduleDelay(leaveDuration, () => {
                state.cancelLeaveTimer = undefined;
                removeTransitionClasses(node, [leaveActiveClass, leaveToClass]);
                state.phase = undefined;
                removeNode();
                emitTransitionHook(module, "onAfterLeave", node);
            });
        });
        return true;
    }

    public static handleChangedDoms(module: ModuleLike, changeDoms: ChangedDom[]): void {
        const slotDoms: Record<string, ChangedDom[]> = {};
        const replaceList: ChangedDom[] = [];
        const addOrMove: ChangedDom[] = [];

        for (const item of changeDoms) {
            if (item[1].slotModuleId && item[1].slotModuleId !== module.id) {
                const slotKey = String(item[1].slotModuleId);
                slotDoms[slotKey] ||= [];
                slotDoms[slotKey].push(item);
                continue;
            }
            switch (item[0]) {
                case 1:
                case 4:
                    addOrMove.push(item);
                    break;
                case 2:
                    if (item[1].childModuleId) {
                        Renderer.add(ModuleFactory.get(item[1].childModuleId) as ModuleLike);
                    } else {
                        this.updateToHtml(module, item[1], item[2] as RenderedDom);
                    }
                    break;
                case 3:
                    module.domManager.freeNode(item[1], true);
                    break;
                default:
                    replaceList.push(item);
            }
        }

        for (const item of replaceList) {
            this.replace(module, item[1], item[2] as RenderedDom);
        }

        if (addOrMove.length > 1) {
            addOrMove.sort((left, right) => ((left[4] as number) > (right[4] as number) ? 1 : -1));
        }

        while (addOrMove.length > 0) {
            const item = addOrMove.shift() as ChangedDom;
            const parentNode = item[3]?.node as Node;
            if (!parentNode) {
                continue;
            }
            const teleportActive = isActiveTeleport(item[1]);
            const node = item[0] === 1
                ? Renderer.renderToHtml(module, item[1], teleportActive ? parentNode : null)
                : item[1].node;
            if (!node) {
                continue;
            }
            if (teleportActive) {
                moveTeleportNode(item[1], node, parentNode);
                continue;
            }
            const previousRect = item[0] === 4 ? captureTransitionMoveRect(item[1], node) : null;
            let index = item[4] as number;
            const offset = addOrMove.filter(change =>
                change[0] === 4
                && change[3]?.node === parentNode
                && (change[4] as number) >= index
                && (change[5] as number) < index
            ).length;
            moveNode(node, parentNode, index + offset);
            if (item[0] === 4) {
                queueTransitionMove(module, item[1], node, previousRect);
            }
        }

        for (const key of Object.keys(slotDoms)) {
            const slotModule = ModuleFactory.get(parseInt(key, 10));
            if (slotModule) {
                Renderer.add(slotModule);
            }
        }

        function moveNode(node: Node, parentNode: Node, loc: number): void {
            const moduleNode = findModuleNode(node);
            let inserted = false;
            for (let i = 0, index = 0; i < parentNode.childNodes.length; i++, index++) {
                const current = parentNode.childNodes[i];
                if (findModuleNode(current) !== null) {
                    i++;
                }
                if (index !== loc) {
                    continue;
                }
                if (moduleNode === null) {
                    parentNode.insertBefore(node, current);
                } else {
                    parentNode.insertBefore(moduleNode, current);
                    parentNode.insertBefore(node, moduleNode);
                }
                inserted = true;
                break;
            }
            if (inserted) {
                return;
            }
            if (moduleNode === null) {
                parentNode.appendChild(node);
            } else {
                parentNode.appendChild(node);
                parentNode.appendChild(moduleNode);
            }
        }

        function findModuleNode(node: Node | null): Node | null {
            return node
                && node instanceof Comment
                && node.nextSibling
                && node.nextSibling instanceof Element
                && node.textContent?.endsWith(node.nextSibling.getAttribute("role") || "")
                ? node.nextSibling
                : null;
        }
    }

    private static replace(module: ModuleLike, src: RenderedDom, dst: RenderedDom): void {
        const el = this.renderToHtml(module, src, null);
        if (isActiveTeleport(src)) {
            moveTeleportNode(src, el, dst.parent?.node as Node | undefined);
            if (dst.node?.parentElement) {
                dst.node.parentElement.removeChild(dst.node);
            }
            module.domManager.freeNode(dst, true);
            return;
        }
        if (dst.childModuleId) {
            const childModule = ModuleFactory.get(dst.childModuleId) as ModuleLike;
            const parentEl = childModule?.srcDom?.node?.parentElement;
            if (!parentEl) {
                return;
            }
            const previousSibling = childModule.srcDom.node?.previousSibling as Node | undefined;
            childModule.destroy();
            if (previousSibling) {
                Util.insertAfter(el, previousSibling);
            } else if (parentEl.childNodes.length === 0) {
                parentEl.appendChild(el);
            } else {
                parentEl.insertBefore(el, parentEl.childNodes[0]);
            }
            return;
        }
        const parentEl = dst.node?.parentElement;
        if (!parentEl || !dst.node) {
            return;
        }
        parentEl.replaceChild(el, dst.node);
        module.domManager.freeNode(dst, true);
    }
}

function cloneStaticRenderBlueprint(
    module: ModuleLike,
    src: VirtualDom,
    model: ModelLike,
    parent: RenderedDom | undefined,
    scopeKey?: number | string
): RenderedDom | undefined {
    if (!canCacheStaticRenderBlueprint(src) || !src.renderBlueprint) {
        return;
    }
    return cloneRenderBlueprintNode(module, src, src.renderBlueprint, model, parent, scopeKey);
}

function cloneRenderBlueprintNode(
    module: ModuleLike,
    src: VirtualDom,
    blueprint: RenderedDom,
    model: ModelLike,
    parent: RenderedDom | undefined,
    scopeKey?: number | string
): RenderedDom {
    const srcModule = (ModuleFactory.get(src.moduleId as number) as ModuleLike | undefined) || module;
    const renderedKey = resolveRenderedKey(src, resolveNodeKey(src, srcModule, model, scopeKey));
    const cloned: RenderedDom = {
        key: renderedKey,
        model,
        vdom: src,
        parent,
        moduleId: src.moduleId,
        slotModuleId: src.slotModuleId,
        staticNum: src.staticNum,
        patchFlag: src.patchFlag,
        dynamicProps: [...(src.dynamicProps || [])],
        hoisted: src.hoisted,
        blockRoot: src.blockRoot,
        structureFlags: src.structureFlags,
        childrenPatchFlag: src.childrenPatchFlag,
        childrenStructureFlags: src.childrenStructureFlags,
        __skipDiff: false
    };
    cloned.childModuleId = blueprint.childModuleId;
    (cloned as RenderedDom & { keepAlive?: RenderedDom["keepAlive"] }).keepAlive = cloneKeepAliveState(
        (blueprint as RenderedDom & { keepAlive?: RenderedDom["keepAlive"] }).keepAlive
    );
    (cloned as TeleportRenderedDom).transition = (blueprint as TeleportRenderedDom).transition
        ? { ...(blueprint as TeleportRenderedDom).transition }
        : undefined;
    (cloned as TeleportRenderedDom).teleportDisabled = (blueprint as TeleportRenderedDom).teleportDisabled;
    (cloned as TeleportRenderedDom).teleportTarget = (blueprint as TeleportRenderedDom).teleportTarget;

    if (blueprint.tagName) {
        cloned.tagName = blueprint.tagName;
        cloned.props = blueprint.props ? { ...blueprint.props } : {};
        cloned.locMap = new Map();
        if (blueprint.assets) {
            cloned.assets = { ...blueprint.assets };
        }
        if (blueprint.events) {
            cloned.events = [...blueprint.events];
        }
        if (blueprint.isSvg) {
            cloned.isSvg = true;
        }
    } else {
        cloned.textContent = blueprint.textContent;
    }

    if (blueprint.children?.length && src.children?.length) {
        cloned.children = [];
        for (let index = 0; index < blueprint.children.length; index++) {
            const childSrc = src.children[index];
            const childBlueprint = blueprint.children[index];
            if (!childSrc || !childBlueprint) {
                continue;
            }
            appendRenderedChild(
                cloned,
                cloneRenderBlueprintNode(module, childSrc, childBlueprint, model, cloned, scopeKey)
            );
        }
    }

    if (src.dynamicChildIndexes?.length && cloned.children?.length) {
        const dynamicChildKeys = src.dynamicChildIndexes
            .map(index => cloned.children?.[index]?.key)
            .filter((value): value is string | number => value !== undefined && value !== null);
        if (dynamicChildKeys.length > 0) {
            cloned.dynamicChildKeys = dynamicChildKeys;
        }
    }
    return cloned;
}

function cloneKeepAliveState(value: RenderedDom["keepAlive"]): RenderedDom["keepAlive"] {
    if (!value || typeof value !== "object") {
        return value;
    }
    const cloned = { ...value };
    if (Array.isArray(cloned.include)) {
        cloned.include = [...cloned.include];
    }
    if (Array.isArray(cloned.exclude)) {
        cloned.exclude = [...cloned.exclude];
    }
    return cloned;
}

function cacheStaticRenderBlueprint(src: VirtualDom, dom: RenderedDom): void {
    if (!canCacheStaticRenderBlueprint(src) || src.renderBlueprint) {
        return;
    }
    src.renderBlueprint = createRenderBlueprint(dom);
}

function createRenderBlueprint(dom: RenderedDom): RenderedDom {
    const blueprint: RenderedDom = {
        key: dom.key,
        staticNum: dom.staticNum,
        patchFlag: dom.patchFlag,
        dynamicProps: [...(dom.dynamicProps || [])],
        hoisted: dom.hoisted,
        blockRoot: dom.blockRoot,
        structureFlags: dom.structureFlags,
        moduleId: dom.moduleId,
        slotModuleId: dom.slotModuleId,
        childModuleId: dom.childModuleId
    };

    (blueprint as RenderedDom & { keepAlive?: RenderedDom["keepAlive"] }).keepAlive = cloneKeepAliveState(
        (dom as RenderedDom & { keepAlive?: RenderedDom["keepAlive"] }).keepAlive
    );
    (blueprint as TeleportRenderedDom).transition = (dom as TeleportRenderedDom).transition
        ? { ...(dom as TeleportRenderedDom).transition }
        : undefined;
    (blueprint as TeleportRenderedDom).teleportDisabled = (dom as TeleportRenderedDom).teleportDisabled;
    (blueprint as TeleportRenderedDom).teleportTarget = (dom as TeleportRenderedDom).teleportTarget;

    if (dom.tagName) {
        blueprint.tagName = dom.tagName;
        blueprint.props = dom.props ? { ...dom.props } : {};
        if (dom.assets) {
            blueprint.assets = { ...dom.assets };
        }
        if (dom.events) {
            blueprint.events = [...dom.events];
        }
        if (dom.isSvg) {
            blueprint.isSvg = true;
        }
    } else {
        blueprint.textContent = dom.textContent;
    }

    if (dom.children?.length) {
        blueprint.children = dom.children.map(child => createRenderBlueprint(child));
    }
    if (dom.dynamicChildKeys?.length) {
        blueprint.dynamicChildKeys = [...dom.dynamicChildKeys];
    }
    if (dom.childrenPatchFlag) {
        blueprint.childrenPatchFlag = dom.childrenPatchFlag;
    }
    if (dom.childrenStructureFlags) {
        blueprint.childrenStructureFlags = dom.childrenStructureFlags;
    }
    return blueprint;
}

function canCacheStaticRenderBlueprint(src: VirtualDom): boolean {
    return src.hoisted
        && src.key !== 1
        && !src.directives?.length
        && !hasStatefulRuntimeSubtree(src);
}

function hasStatefulRuntimeSubtree(src: VirtualDom): boolean {
    if (src.directives?.some(directive =>
        directive.type?.name === "module"
        || directive.type?.name === "keepalive"
        || directive.type?.name === "transition"
        || directive.type?.name === "teleport"
    )) {
        return true;
    }
    return !!src.children?.some(child => hasStatefulRuntimeSubtree(child));
}

function normalizePropValue(value: unknown): unknown {
    return value === undefined
        || value === null
        || value === ""
        || (typeof value === "string" && value.trim() === "")
        ? ""
        : value;
}

function mergeRootProps(module: ModuleLike, dom: RenderedDom): void {
    if (!module.props) {
        return;
    }
    for (const key of Object.keys(module.props)) {
        if (module.excludedProps?.includes(key)) {
            continue;
        }
        let value = dom.props?.[key];
        let nextValue = module.props[key];
        if (typeof nextValue === "string") {
            nextValue = nextValue.trim();
        }
        if (!nextValue) {
            dom.props![key] = normalizePropValue(value);
            continue;
        }
        if (key === "style") {
            value = value ? `${nextValue};${value}`.replace(/;{2,}/g, ";") : nextValue;
        } else if (key === "class") {
            value = value ? `${value} ${nextValue}` : nextValue;
        } else if (!value) {
            value = nextValue;
        }
        dom.props![key] = normalizePropValue(value);
    }
}

function resolveNodeKey(
    src: VirtualDom,
    srcModule: ModuleLike,
    model: ModelLike,
    fallbackKey?: number | string
): number | string | undefined {
    const keyProp = src.getProp("key");
    if (keyProp instanceof Expression) {
        const resolved = keyProp.val(srcModule, model);
        if (resolved !== undefined && resolved !== null && resolved !== "") {
            return resolved as number | string;
        }
    } else if (keyProp !== undefined && keyProp !== null && keyProp !== "") {
        return keyProp as number | string;
    }
    return fallbackKey;
}

function syncDomState(module: ModuleLike, dom: RenderedDom, oldDom: RenderedDom, el: Node): void {
    const patchFlag = dom.patchFlag ?? oldDom.patchFlag ?? PatchFlags.BAIL;
    if (!isTargetedPatch(patchFlag)) {
        syncProps(el as HTMLElement, dom.props, oldDom.props);
        syncAssets(el, dom.assets, oldDom.assets);
        module.eventFactory.handleDomEvent(dom, oldDom);
        return;
    }

    if (patchFlag & PatchFlags.CLASS) {
        syncNamedProp(el as HTMLElement, "class", dom.props, oldDom.props);
    }
    if (patchFlag & PatchFlags.STYLE) {
        syncNamedProp(el as HTMLElement, "style", dom.props, oldDom.props);
    }
    if (patchFlag & PatchFlags.PROPS) {
        for (const key of dom.dynamicProps || []) {
            syncNamedProp(el as HTMLElement, key, dom.props, oldDom.props);
        }
    }
    if (patchFlag & PatchFlags.ASSETS) {
        for (const key of dom.dynamicProps || []) {
            syncNamedAsset(el, key, dom.assets, oldDom.assets);
        }
    }
    if (patchFlag & PatchFlags.EVENTS) {
        module.eventFactory.handleDomEvent(dom, oldDom);
    }
}

function isTargetedPatch(flag: PatchFlags): boolean {
    if (!flag || (flag & PatchFlags.BAIL) !== 0 || (flag & PatchFlags.DIRECTIVES) !== 0) {
        return false;
    }
    return true;
}

function syncProps(
    el: HTMLElement,
    nextProps?: Record<string, unknown>,
    prevProps?: Record<string, unknown>
): void {
    if (nextProps) {
        for (const key of Object.keys(nextProps)) {
            el.setAttribute(key, String(nextProps[key] ?? ""));
            if (prevProps) {
                delete prevProps[key];
            }
        }
    }
    if (prevProps) {
        for (const key of Object.keys(prevProps)) {
            el.removeAttribute(key);
        }
    }
}

function syncAssets(
    el: Node,
    nextAssets?: Record<string, unknown>,
    prevAssets?: Record<string, unknown>
): void {
    if (nextAssets) {
        for (const key of Object.keys(nextAssets)) {
            (el as unknown as Record<string, unknown>)[key] = nextAssets[key];
            if (prevAssets) {
                delete prevAssets[key];
            }
        }
    }
    if (prevAssets) {
        for (const key of Object.keys(prevAssets)) {
            (el as unknown as Record<string, unknown>)[key] = null;
        }
    }
}

function syncNamedProp(
    el: HTMLElement,
    key: string,
    nextProps?: Record<string, unknown>,
    prevProps?: Record<string, unknown>
): void {
    const nextValue = nextProps?.[key];
    const prevValue = prevProps?.[key];
    if (nextValue === prevValue) {
        return;
    }
    if (nextValue === undefined || nextValue === null || nextValue === "") {
        el.removeAttribute(key);
    } else {
        el.setAttribute(key, String(nextValue));
    }
}

function syncNamedAsset(
    el: Node,
    key: string,
    nextAssets?: Record<string, unknown>,
    prevAssets?: Record<string, unknown>
): void {
    const nextValue = nextAssets?.[key];
    const prevValue = prevAssets?.[key];
    if (nextValue === prevValue) {
        return;
    }
    (el as unknown as Record<string, unknown>)[key] = nextValue === undefined ? null : nextValue;
}

function resolveTeleportTarget(target: unknown): Element | null {
    if (typeof target === "string" && target.trim()) {
        return document.querySelector(target);
    }
    return target instanceof Element ? target : null;
}

function moveTeleportNode(dom: RenderedDom, node: Node, fallbackParent?: Node): void {
    const teleportDom = dom as TeleportRenderedDom;
    if (!dom.tagName) {
        if (fallbackParent) {
            fallbackParent.appendChild(node);
        }
        return;
    }
    const teleportTarget = !teleportDom.teleportDisabled
        ? resolveTeleportTarget(teleportDom.teleportTarget)
        : null;
    if (teleportTarget) {
        if (node.parentElement !== teleportTarget) {
            teleportTarget.appendChild(node);
        }
        return;
    }
    if (fallbackParent) {
        fallbackParent.appendChild(node);
    }
}

function isActiveTeleport(dom: RenderedDom): boolean {
    const teleportDom = dom as TeleportRenderedDom;
    return !!dom.tagName && !teleportDom.teleportDisabled && !!resolveTeleportTarget(teleportDom.teleportTarget);
}

function captureTransitionMoveRect(dom: RenderedDom, node: Node): DOMRect | null {
    const transition = resolveTransitionDescriptor(dom);
    if (!transition?.group || !(node instanceof Element) || typeof node.getBoundingClientRect !== "function") {
        return null;
    }
    return node.getBoundingClientRect();
}

function queueTransitionEnter(module: ModuleLike, dom: RenderedDom, node: Node): void {
    const transition = resolveTransitionDescriptor(dom);
    if (!transition || !(node instanceof Element)) {
        return;
    }
    const state = getTransitionRuntimeState(node);
    const {
        enterActiveClass,
        enterDuration,
        enterFromClass,
        enterToClass,
        leaveActiveClass,
        leaveFromClass,
        leaveToClass
    } = transition;

    cancelTransitionPhase(module, node, state, "leave", transition);
    cancelTransitionPhase(module, node, state, "enter", transition);

    state.phase = "enter";
    emitTransitionHook(module, "onBeforeEnter", node);
    removeTransitionClasses(node, [leaveActiveClass, leaveFromClass, leaveToClass]);
    addTransitionClasses(node, [enterFromClass, enterActiveClass]);
    state.cancelEnterFrame = scheduleNextFrame(() => {
        state.cancelEnterFrame = undefined;
        removeTransitionClasses(node, [enterFromClass]);
        addTransitionClasses(node, [enterToClass]);
        emitTransitionHook(module, "onEnter", node);
        state.cancelEnterTimer = scheduleDelay(enterDuration, () => {
            state.cancelEnterTimer = undefined;
            removeTransitionClasses(node, [enterActiveClass, enterToClass]);
            state.phase = undefined;
            emitTransitionHook(module, "onAfterEnter", node);
        });
    });
}

function queueTransitionMove(
    module: ModuleLike,
    dom: RenderedDom,
    node: Node,
    previousRect: DOMRect | null
): void {
    const transition = resolveTransitionDescriptor(dom);
    if (!transition?.group || !(node instanceof HTMLElement) || !previousRect) {
        return;
    }
    const nextRect = node.getBoundingClientRect?.();
    if (!nextRect) {
        return;
    }
    const deltaX = previousRect.left - nextRect.left;
    const deltaY = previousRect.top - nextRect.top;
    if (deltaX === 0 && deltaY === 0) {
        return;
    }
    const state = getTransitionRuntimeState(node);
    cancelTransitionPhase(module, node, state, "move", transition);

    const previousTransition = node.style.transition;
    const previousTransform = node.style.transform;
    state.restoreMoveStyles = () => {
        node.style.transition = previousTransition;
        node.style.transform = previousTransform;
    };

    state.phase = "move";
    emitTransitionHook(module, "onBeforeMove", node);
    node.style.transition = "none";
    node.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    node.getBoundingClientRect?.();
    state.cancelMoveFrame = scheduleNextFrame(() => {
        state.cancelMoveFrame = undefined;
        addTransitionClasses(node, [transition.moveClass]);
        node.style.transition = previousTransition || `transform ${transition.moveDuration}ms ease`;
        node.style.transform = previousTransform || "";
        emitTransitionHook(module, "onMove", node);
        state.cancelMoveTimer = scheduleDelay(transition.moveDuration, () => {
            state.cancelMoveTimer = undefined;
            removeTransitionClasses(node, [transition.moveClass]);
            state.restoreMoveStyles?.();
            state.restoreMoveStyles = undefined;
            state.phase = undefined;
            emitTransitionHook(module, "onAfterMove", node);
        });
    });
}

function resolveTransitionDescriptor(dom: RenderedDom): Required<NonNullable<TeleportRenderedDom["transition"]>> | null {
    const transition = (dom as TeleportRenderedDom).transition;
    if (!transition) {
        return null;
    }
    const name = typeof transition.name === "string" && transition.name.trim()
        ? transition.name.trim()
        : "nd";
    const duration = normalizeTransitionDuration(transition.duration, 250);
    return {
        duration,
        enterActiveClass: transition.enterActiveClass || `${name}-enter-active`,
        enterDuration: normalizeTransitionDuration(transition.enterDuration, duration),
        enterFromClass: transition.enterFromClass || `${name}-enter-from`,
        enterToClass: transition.enterToClass || `${name}-enter-to`,
        group: transition.group === true,
        leaveActiveClass: transition.leaveActiveClass || `${name}-leave-active`,
        leaveDuration: normalizeTransitionDuration(transition.leaveDuration, duration),
        leaveFromClass: transition.leaveFromClass || `${name}-leave-from`,
        leaveToClass: transition.leaveToClass || `${name}-leave-to`,
        moveClass: transition.moveClass || `${name}-move`,
        moveDuration: normalizeTransitionDuration(transition.moveDuration, duration),
        name
    };
}

function normalizeTransitionDuration(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value)
        ? Math.max(0, value)
        : fallback;
}

function addTransitionClasses(node: Element, classes: Array<string | undefined>): void {
    const tokens = classes
        .flatMap(value => typeof value === "string" ? value.split(/\s+/) : [])
        .map(value => value.trim())
        .filter(Boolean);
    if (tokens.length > 0) {
        node.classList.add(...tokens);
    }
}

function removeTransitionClasses(node: Element, classes: Array<string | undefined>): void {
    const tokens = classes
        .flatMap(value => typeof value === "string" ? value.split(/\s+/) : [])
        .map(value => value.trim())
        .filter(Boolean);
    if (tokens.length > 0) {
        node.classList.remove(...tokens);
    }
}

function scheduleNextFrame(callback: () => void): () => void {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        let cancelled = false;
        let secondFrame: number | undefined;
        const firstFrame = window.requestAnimationFrame(() => {
            if (cancelled) {
                return;
            }
            secondFrame = window.requestAnimationFrame(() => {
                if (!cancelled) {
                    callback();
                }
            });
        });
        return () => {
            cancelled = true;
            window.cancelAnimationFrame?.(firstFrame);
            if (secondFrame !== undefined) {
                window.cancelAnimationFrame?.(secondFrame);
            }
        };
    }
    const timerId = window.setTimeout(callback, 16);
    return () => clearTimeout(timerId);
}

function emitTransitionHook(module: ModuleLike, eventName: string, node: Element): void {
    (module as ModuleWithHooks).emitHook?.(eventName, node);
}

function scheduleDelay(delay: number, callback: () => void): () => void {
    const timerId = window.setTimeout(callback, delay);
    return () => clearTimeout(timerId);
}

function getTransitionRuntimeState(node: Element): TransitionRuntimeState {
    let state = transitionRuntimeStates.get(node);
    if (!state) {
        state = {};
        transitionRuntimeStates.set(node, state);
    }
    return state;
}

function cancelTransitionPhase(
    module: ModuleLike,
    node: Element,
    state: TransitionRuntimeState,
    phase: "enter" | "leave" | "move",
    transition: Required<NonNullable<TeleportRenderedDom["transition"]>>
): void {
    const cancelFrameKey = phase === "enter"
        ? "cancelEnterFrame"
        : phase === "leave"
            ? "cancelLeaveFrame"
            : "cancelMoveFrame";
    const cancelTimerKey = phase === "enter"
        ? "cancelEnterTimer"
        : phase === "leave"
            ? "cancelLeaveTimer"
            : "cancelMoveTimer";
    const cancelFrame = state[cancelFrameKey];
    const cancelTimer = state[cancelTimerKey];
    if (!cancelFrame && !cancelTimer && state.phase !== phase) {
        return;
    }
    cancelFrame?.();
    cancelTimer?.();
    state[cancelFrameKey] = undefined;
    state[cancelTimerKey] = undefined;
    if (phase === "move") {
        removeTransitionClasses(node, [transition.moveClass]);
        state.restoreMoveStyles?.();
        state.restoreMoveStyles = undefined;
    } else {
        const isEnter = phase === "enter";
        removeTransitionClasses(node, isEnter
            ? [transition.enterActiveClass, transition.enterFromClass, transition.enterToClass]
            : [transition.leaveActiveClass, transition.leaveFromClass, transition.leaveToClass]
        );
    }
    if (state.phase === phase) {
        emitTransitionHook(
            module,
            phase === "enter"
                ? "onEnterCancelled"
                : phase === "leave"
                    ? "onLeaveCancelled"
                    : "onMoveCancelled",
            node
        );
        state.phase = undefined;
    }
}

