import { getSequence } from "@nodomx/runtime-optimize";
import { PatchFlags, StructureFlags } from "@nodomx/shared";
export class DiffTool {
    static compare(src, dst) {
        const changeArr = [];
        clearUsed(dst);
        compareNode(src, dst);
        return changeArr;
        function compareNode(nextNode, prevNode) {
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
                    }
                    else if (nextNode.childModuleId !== prevNode.childModuleId) {
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
        function compareChildren(nextNode, prevNode) {
            var _a, _b, _c, _d;
            const nextChildren = nextNode.children || [];
            const prevChildren = prevNode.children || [];
            const fragmentPatchFlag = (_b = (_a = nextNode.childrenPatchFlag) !== null && _a !== void 0 ? _a : prevNode.childrenPatchFlag) !== null && _b !== void 0 ? _b : PatchFlags.NONE;
            const structureFlags = (_d = (_c = nextNode.childrenStructureFlags) !== null && _c !== void 0 ? _c : prevNode.childrenStructureFlags) !== null && _d !== void 0 ? _d : StructureFlags.NONE;
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
            const nextKeyToIndex = new Map();
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
        function compareBlockChildren(nextNode, prevNode) {
            var _a;
            const nextChildren = nextNode.children || [];
            const prevChildren = prevNode.children || [];
            const dynamicKeys = new Set(nextNode.dynamicChildKeys || []);
            const nextEntries = [];
            const nextKeyToIndex = new Map();
            for (let index = 0; index < nextChildren.length; index++) {
                const child = nextChildren[index];
                if (dynamicKeys.has(child.key)) {
                    nextKeyToIndex.set(child.key, nextEntries.length);
                    nextEntries.push({ child, index });
                    continue;
                }
                const prevIndex = (_a = prevNode.locMap) === null || _a === void 0 ? void 0 : _a.get(child.key);
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
        function compareChildrenLegacy(nextNode, prevNode) {
            var _a, _b, _c, _d;
            let oldIndex = 0;
            for (let i = 0; i < (((_a = nextNode.children) === null || _a === void 0 ? void 0 : _a.length) || 0); i++) {
                const child = nextNode.children[i];
                if (((_b = prevNode.children) === null || _b === void 0 ? void 0 : _b[oldIndex]) && prevNode.children[oldIndex].key === child.key) {
                    if (oldIndex !== i) {
                        addChange(4, child, null, prevNode, i, oldIndex);
                    }
                    compareNode(child, prevNode.children[oldIndex]);
                }
                else if ((_c = prevNode.locMap) === null || _c === void 0 ? void 0 : _c.has(child.key)) {
                    const nextLoc = (_d = nextNode.locMap) === null || _d === void 0 ? void 0 : _d.get(child.key);
                    const oldLoc = prevNode.locMap.get(child.key);
                    if (nextLoc !== oldLoc) {
                        addChange(4, child, null, prevNode, nextLoc, oldLoc);
                        oldIndex = oldLoc;
                    }
                    compareNode(child, prevNode.children[oldLoc]);
                }
                else {
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
        function shouldTextChange(nextNode, prevNode) {
            var _a;
            if (nextNode.childModuleId !== prevNode.childModuleId) {
                return true;
            }
            if (((_a = nextNode.patchFlag) !== null && _a !== void 0 ? _a : prevNode.patchFlag) === PatchFlags.TEXT) {
                return nextNode.textContent !== prevNode.textContent;
            }
            return !!(nextNode.staticNum || prevNode.staticNum) && nextNode.textContent !== prevNode.textContent;
        }
        function shouldUpdateNode(nextNode, prevNode) {
            var _a, _b, _c, _d, _e, _f;
            if (hasTeleportStateChanged(nextNode, prevNode)) {
                return true;
            }
            if (hasTransitionStateChanged(nextNode, prevNode)) {
                return true;
            }
            if (!(nextNode.staticNum || prevNode.staticNum || prevNode.key === 1)) {
                return false;
            }
            const patchFlag = (_b = (_a = nextNode.patchFlag) !== null && _a !== void 0 ? _a : prevNode.patchFlag) !== null && _b !== void 0 ? _b : PatchFlags.NONE;
            if (patchFlag === PatchFlags.NONE || (patchFlag & PatchFlags.BAIL) !== 0 || (patchFlag & PatchFlags.DIRECTIVES) !== 0 || prevNode.key === 1) {
                return isChanged(nextNode, prevNode);
            }
            if ((patchFlag & PatchFlags.TEXT) !== 0 && nextNode.textContent !== prevNode.textContent) {
                return true;
            }
            if ((patchFlag & PatchFlags.CLASS) !== 0 && ((_c = nextNode.props) === null || _c === void 0 ? void 0 : _c["class"]) !== ((_d = prevNode.props) === null || _d === void 0 ? void 0 : _d["class"])) {
                return true;
            }
            if ((patchFlag & PatchFlags.STYLE) !== 0 && ((_e = nextNode.props) === null || _e === void 0 ? void 0 : _e["style"]) !== ((_f = prevNode.props) === null || _f === void 0 ? void 0 : _f["style"])) {
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
        function isChanged(nextNode, prevNode) {
            if (hasTeleportStateChanged(nextNode, prevNode)) {
                return true;
            }
            if (hasTransitionStateChanged(nextNode, prevNode)) {
                return true;
            }
            for (const prop of ["props", "assets", "events"]) {
                if ((!nextNode[prop] && prevNode[prop]) || (nextNode[prop] && !prevNode[prop])) {
                    return true;
                }
                if (!nextNode[prop] || !prevNode[prop]) {
                    continue;
                }
                const nextKeys = Object.keys(nextNode[prop]);
                const prevKeys = Object.keys(prevNode[prop]);
                if (nextKeys.length !== prevKeys.length) {
                    return true;
                }
                for (const key of nextKeys) {
                    if (nextNode[prop][key] !== prevNode[prop][key]) {
                        return true;
                    }
                }
            }
            return false;
        }
        function addChange(type, dom, dom1, parent, loc, loc1) {
            const changed = [type, dom, dom1, parent, loc, loc1];
            if (type === 5) {
                delete dom.node;
            }
            changeArr.push(changed);
            return changed;
        }
    }
}
function hasTeleportStateChanged(nextNode, prevNode) {
    const nextTeleportNode = nextNode;
    const prevTeleportNode = prevNode;
    return nextTeleportNode.teleportTarget !== prevTeleportNode.teleportTarget
        || nextTeleportNode.teleportDisabled !== prevTeleportNode.teleportDisabled;
}
function hasTransitionStateChanged(nextNode, prevNode) {
    const nextTransition = nextNode.transition;
    const prevTransition = prevNode.transition;
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
function canUseBlockDiff(node) {
    return !!node.dynamicChildKeys && node.dynamicChildKeys.length > 0;
}
function clearUsed(dom) {
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
function canUseKeyedDiff(children) {
    const keys = new Set();
    for (const child of children) {
        if (child.key === undefined || child.key === null || keys.has(child.key)) {
            return false;
        }
        keys.add(child.key);
    }
    return true;
}
function hasChangedKeys(keys, nextValues, prevValues) {
    if (!keys || keys.length === 0) {
        return false;
    }
    for (const key of keys) {
        if ((nextValues === null || nextValues === void 0 ? void 0 : nextValues[key]) !== (prevValues === null || prevValues === void 0 ? void 0 : prevValues[key])) {
            return true;
        }
    }
    return false;
}
function sameEventList(left, right) {
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
function shouldPreferStructuralDiff(fragmentPatchFlag, structureFlags) {
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
//# sourceMappingURL=difftool.js.map