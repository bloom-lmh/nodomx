import { getSequence } from "@nodomx/runtime-optimize";
import { ChangedDom, PatchFlags, RenderedDom, StructureFlags } from "@nodomx/shared";

type TeleportAwareRenderedDom = RenderedDom & {
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

export class DiffTool {
    public static compare(src: RenderedDom, dst: RenderedDom): ChangedDom[] {
        const changeArr: ChangedDom[] = [];
        clearUsed(dst);
        compareNode(src, dst);
        return changeArr;

        function compareNode(nextNode: RenderedDom, prevNode: RenderedDom): void {
            if (!nextNode || !prevNode) {
                return;
            }
            if (nextNode === prevNode || nextNode.__skipDiff) {
                nextNode.node = prevNode.node;
                prevNode["__used"] = true;
                return;
            }

            nextNode.node = prevNode.node;
            prevNode["__used"] = true;

            if (!nextNode.tagName) {
                if (!prevNode.tagName) {
                    if (shouldTextChange(nextNode, prevNode)) {
                        addChange(2, nextNode, prevNode, prevNode.parent);
                    } else if (nextNode.childModuleId !== prevNode.childModuleId) {
                        addChange(5, nextNode, prevNode, prevNode.parent);
                    }
                    return;
                }
                addChange(5, nextNode, prevNode, prevNode.parent);
                return;
            }

            if (((nextNode.childModuleId || prevNode.childModuleId) && nextNode.childModuleId !== prevNode.childModuleId)
                || nextNode.tagName !== prevNode.tagName) {
                addChange(5, nextNode, prevNode, prevNode.parent);
                return;
            }

            if (shouldUpdateNode(nextNode, prevNode)) {
                addChange(2, nextNode, prevNode, prevNode.parent);
            }
            compareChildren(nextNode, prevNode);
        }

        function compareChildren(nextNode: RenderedDom, prevNode: RenderedDom): void {
            const nextChildren = nextNode.children || [];
            const prevChildren = prevNode.children || [];
            const fragmentPatchFlag = nextNode.childrenPatchFlag ?? prevNode.childrenPatchFlag ?? PatchFlags.NONE;
            const structureFlags = nextNode.childrenStructureFlags ?? prevNode.childrenStructureFlags ?? StructureFlags.NONE;

            if (nextChildren.length === 0) {
                if (prevChildren.length > 0) {
                    prevChildren.forEach(item => addChange(3, item, null, prevNode));
                }
                return;
            }

            if (prevChildren.length === 0) {
                nextChildren.forEach((item, index) => addChange(1, item, null, prevNode, index));
                return;
            }

            if (canUseBlockDiff(nextNode)) {
                compareBlockChildren(nextNode, prevNode);
                return;
            }

            if ((fragmentPatchFlag & PatchFlags.UNKEYED_FRAGMENT) !== 0) {
                compareChildrenLegacy(nextNode, prevNode);
                return;
            }

            if (shouldPreferStructuralDiff(fragmentPatchFlag, structureFlags)) {
                compareChildrenLegacy(nextNode, prevNode);
                return;
            }

            if ((fragmentPatchFlag & PatchFlags.KEYED_FRAGMENT) === 0
                && (!canUseKeyedDiff(nextChildren) || !canUseKeyedDiff(prevChildren))) {
                compareChildrenLegacy(nextNode, prevNode);
                return;
            }

            const nextKeyToIndex = new Map<string | number, number>();
            for (let i = 0; i < nextChildren.length; i++) {
                nextKeyToIndex.set(nextChildren[i].key, i);
            }

            const newIndexToOldIndexMap = new Array(nextChildren.length).fill(-1);

            for (let oldIndex = 0; oldIndex < prevChildren.length; oldIndex++) {
                const prevChild = prevChildren[oldIndex];
                const newIndex = nextKeyToIndex.get(prevChild.key);
                if (newIndex === undefined) {
                    addChange(3, prevChild, null, prevNode);
                    continue;
                }
                newIndexToOldIndexMap[newIndex] = oldIndex;
                compareNode(nextChildren[newIndex], prevChild);
            }

            const stableSequence = getSequence(newIndexToOldIndexMap);
            let stableIndex = stableSequence.length - 1;

            for (let newIndex = nextChildren.length - 1; newIndex >= 0; newIndex--) {
                const nextChild = nextChildren[newIndex];
                const oldIndex = newIndexToOldIndexMap[newIndex];
                if (oldIndex === -1) {
                    addChange(1, nextChild, null, prevNode, newIndex);
                    continue;
                }
                if (stableIndex < 0 || newIndex !== stableSequence[stableIndex]) {
                    addChange(4, nextChild, null, prevNode, newIndex, oldIndex);
                    continue;
                }
                stableIndex--;
            }
        }

        function compareBlockChildren(nextNode: RenderedDom, prevNode: RenderedDom): void {
            const nextChildren = nextNode.children || [];
            const prevChildren = prevNode.children || [];
            const dynamicKeys = new Set(nextNode.dynamicChildKeys || []);
            const nextEntries: Array<{ child: RenderedDom; index: number }> = [];
            const nextKeyToIndex = new Map<string | number, number>();

            for (let index = 0; index < nextChildren.length; index++) {
                const child = nextChildren[index];
                if (dynamicKeys.has(child.key)) {
                    nextKeyToIndex.set(child.key, nextEntries.length);
                    nextEntries.push({ child, index });
                    continue;
                }
                const prevIndex = prevNode.locMap?.get(child.key);
                const prevChild = prevIndex !== undefined
                    ? prevChildren[prevIndex]
                    : prevChildren.find(item => item.key === child.key);
                if (prevChild) {
                    child.node = prevChild.node;
                    prevChild["__used"] = true;
                    continue;
                }
                addChange(1, child, null, prevNode, index);
            }

            const newIndexToOldIndexMap = new Array(nextEntries.length).fill(-1);

            for (let oldIndex = 0; oldIndex < prevChildren.length; oldIndex++) {
                const prevChild = prevChildren[oldIndex];
                if (prevChild["__used"]) {
                    continue;
                }
                const newIndex = nextKeyToIndex.get(prevChild.key);
                if (newIndex === undefined) {
                    addChange(3, prevChild, null, prevNode);
                    continue;
                }
                newIndexToOldIndexMap[newIndex] = oldIndex;
                compareNode(nextEntries[newIndex].child, prevChild);
            }

            const stableSequence = getSequence(newIndexToOldIndexMap);
            let stableIndex = stableSequence.length - 1;

            for (let newIndex = nextEntries.length - 1; newIndex >= 0; newIndex--) {
                const entry = nextEntries[newIndex];
                const oldIndex = newIndexToOldIndexMap[newIndex];
                if (oldIndex === -1) {
                    addChange(1, entry.child, null, prevNode, entry.index);
                    continue;
                }
                if (stableIndex < 0 || newIndex !== stableSequence[stableIndex]) {
                    addChange(4, entry.child, null, prevNode, entry.index, oldIndex);
                    continue;
                }
                stableIndex--;
            }
        }

        function compareChildrenLegacy(nextNode: RenderedDom, prevNode: RenderedDom): void {
            let oldIndex = 0;
            for (let i = 0; i < (nextNode.children?.length || 0); i++) {
                const child = nextNode.children![i];
                if (prevNode.children?.[oldIndex] && prevNode.children[oldIndex].key === child.key) {
                    if (oldIndex !== i) {
                        addChange(4, child, null, prevNode, i, oldIndex);
                    }
                    compareNode(child, prevNode.children[oldIndex]);
                } else if (prevNode.locMap?.has(child.key)) {
                    const nextLoc = nextNode.locMap?.get(child.key) as number;
                    const oldLoc = prevNode.locMap.get(child.key) as number;
                    if (nextLoc !== oldLoc) {
                        addChange(4, child, null, prevNode, nextLoc, oldLoc);
                        oldIndex = oldLoc;
                    }
                    compareNode(child, prevNode.children![oldLoc]);
                } else {
                    addChange(1, child, null, prevNode, i);
                }
                oldIndex++;
            }

            for (const child of prevNode.children || []) {
                if (!child["__used"]) {
                    addChange(3, child, null, prevNode);
                }
            }
        }

        function shouldTextChange(nextNode: RenderedDom, prevNode: RenderedDom): boolean {
            if (nextNode.childModuleId !== prevNode.childModuleId) {
                return true;
            }
            if ((nextNode.patchFlag ?? prevNode.patchFlag) === PatchFlags.TEXT) {
                return nextNode.textContent !== prevNode.textContent;
            }
            return !!(nextNode.staticNum || prevNode.staticNum) && nextNode.textContent !== prevNode.textContent;
        }

        function shouldUpdateNode(nextNode: RenderedDom, prevNode: RenderedDom): boolean {
            if (hasTeleportStateChanged(nextNode, prevNode)) {
                return true;
            }
            if (hasTransitionStateChanged(nextNode, prevNode)) {
                return true;
            }
            if (!(nextNode.staticNum || prevNode.staticNum || prevNode.key === 1)) {
                return false;
            }

            const patchFlag = nextNode.patchFlag ?? prevNode.patchFlag ?? PatchFlags.NONE;
            if (patchFlag === PatchFlags.NONE || (patchFlag & PatchFlags.BAIL) !== 0 || (patchFlag & PatchFlags.DIRECTIVES) !== 0 || prevNode.key === 1) {
                return isChanged(nextNode, prevNode);
            }

            if ((patchFlag & PatchFlags.TEXT) !== 0 && nextNode.textContent !== prevNode.textContent) {
                return true;
            }
            if ((patchFlag & PatchFlags.CLASS) !== 0 && nextNode.props?.["class"] !== prevNode.props?.["class"]) {
                return true;
            }
            if ((patchFlag & PatchFlags.STYLE) !== 0 && nextNode.props?.["style"] !== prevNode.props?.["style"]) {
                return true;
            }
            if ((patchFlag & PatchFlags.PROPS) !== 0 && hasChangedKeys(nextNode.dynamicProps, nextNode.props, prevNode.props)) {
                return true;
            }
            if ((patchFlag & PatchFlags.ASSETS) !== 0 && hasChangedKeys(nextNode.dynamicProps, nextNode.assets, prevNode.assets)) {
                return true;
            }
            if ((patchFlag & PatchFlags.EVENTS) !== 0 && !sameEventList(nextNode.events, prevNode.events)) {
                return true;
            }
            return false;
        }

        function isChanged(nextNode: RenderedDom, prevNode: RenderedDom): boolean {
            if (hasTeleportStateChanged(nextNode, prevNode)) {
                return true;
            }
            if (hasTransitionStateChanged(nextNode, prevNode)) {
                return true;
            }
            for (const prop of ["props", "assets", "events"] as const) {
                if ((!nextNode[prop] && prevNode[prop]) || (nextNode[prop] && !prevNode[prop])) {
                    return true;
                }
                if (!nextNode[prop] || !prevNode[prop]) {
                    continue;
                }
                const nextKeys = Object.keys(nextNode[prop] as object);
                const prevKeys = Object.keys(prevNode[prop] as object);
                if (nextKeys.length !== prevKeys.length) {
                    return true;
                }
                for (const key of nextKeys) {
                    if (nextNode[prop]![key] !== prevNode[prop]![key]) {
                        return true;
                    }
                }
            }
            return false;
        }

        function addChange(
            type: number,
            dom: RenderedDom,
            dom1?: RenderedDom,
            parent?: RenderedDom,
            loc?: number,
            loc1?: number
        ): ChangedDom {
            const changed = [type, dom, dom1, parent, loc, loc1] as ChangedDom;
            if (type === 5) {
                delete dom.node;
            }
            changeArr.push(changed);
            return changed;
        }
    }
}

function hasTeleportStateChanged(nextNode: RenderedDom, prevNode: RenderedDom): boolean {
    const nextTeleportNode = nextNode as TeleportAwareRenderedDom;
    const prevTeleportNode = prevNode as TeleportAwareRenderedDom;
    return nextTeleportNode.teleportTarget !== prevTeleportNode.teleportTarget
        || nextTeleportNode.teleportDisabled !== prevTeleportNode.teleportDisabled;
}

function hasTransitionStateChanged(nextNode: RenderedDom, prevNode: RenderedDom): boolean {
    const nextTransition = (nextNode as TeleportAwareRenderedDom).transition;
    const prevTransition = (prevNode as TeleportAwareRenderedDom).transition;
    if (nextTransition === prevTransition) {
        return false;
    }
    if (!nextTransition || !prevTransition) {
        return nextTransition !== prevTransition;
    }
    return nextTransition.name !== prevTransition.name
        || nextTransition.duration !== prevTransition.duration
        || nextTransition.enterDuration !== prevTransition.enterDuration
        || nextTransition.leaveDuration !== prevTransition.leaveDuration
        || nextTransition.moveDuration !== prevTransition.moveDuration
        || nextTransition.enterFromClass !== prevTransition.enterFromClass
        || nextTransition.enterActiveClass !== prevTransition.enterActiveClass
        || nextTransition.enterToClass !== prevTransition.enterToClass
        || nextTransition.leaveFromClass !== prevTransition.leaveFromClass
        || nextTransition.leaveActiveClass !== prevTransition.leaveActiveClass
        || nextTransition.leaveToClass !== prevTransition.leaveToClass
        || nextTransition.moveClass !== prevTransition.moveClass
        || nextTransition.group !== prevTransition.group;
}

function canUseBlockDiff(node: RenderedDom): boolean {
    return !!node.dynamicChildKeys && node.dynamicChildKeys.length > 0;
}

function clearUsed(dom: RenderedDom | undefined): void {
    if (!dom) {
        return;
    }
    delete dom["__used"];
    if (dom.children) {
        for (const child of dom.children) {
            clearUsed(child);
        }
    }
}

function canUseKeyedDiff(children: RenderedDom[]): boolean {
    const keys = new Set<string | number>();
    for (const child of children) {
        if (child.key === undefined || child.key === null || keys.has(child.key)) {
            return false;
        }
        keys.add(child.key);
    }
    return true;
}

function hasChangedKeys(
    keys: string[] | undefined,
    nextValues?: Record<string, unknown>,
    prevValues?: Record<string, unknown>
): boolean {
    if (!keys || keys.length === 0) {
        return false;
    }
    for (const key of keys) {
        if (nextValues?.[key] !== prevValues?.[key]) {
            return true;
        }
    }
    return false;
}

function sameEventList(left?: unknown[], right?: unknown[]): boolean {
    if (left === right) {
        return true;
    }
    if (!left || !right || left.length !== right.length) {
        return false;
    }
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) {
            return false;
        }
    }
    return true;
}

function shouldPreferStructuralDiff(fragmentPatchFlag: PatchFlags, structureFlags: StructureFlags): boolean {
    if ((fragmentPatchFlag & PatchFlags.KEYED_FRAGMENT) !== 0) {
        return false;
    }
    return (structureFlags & nonFragmentStructureFlags) !== 0;
}

const nonFragmentStructureFlags = StructureFlags.CONDITIONAL
    | StructureFlags.SLOT
    | StructureFlags.MODULE
    | StructureFlags.ROUTE_LINK
    | StructureFlags.ROUTE_VIEW
    | StructureFlags.RECURSIVE;
