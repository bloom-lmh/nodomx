import { Expression } from "@nodomx/runtime-template";
import { ModuleFactory } from "@nodomx/runtime-registry";
import { Scheduler } from "@nodomx/runtime-scheduler";
import { PatchFlags } from "@nodomx/shared";
import { Util } from "@nodomx/shared";
import { CssManager } from "./cssmanager";
import { appendRenderedChild, canReuseRenderedSubtree, findPreviousChild, resolveRenderedKey, reuseRenderedDom } from "./reuse";
const transitionRuntimeStates = new WeakMap();
export class Renderer {
    static setRootEl(rootEl) {
        this.rootEl = rootEl;
    }
    static getRootEl() {
        return this.rootEl;
    }
    static add(module) {
        if (!module || this.waitSet.has(module.id)) {
            return;
        }
        this.waitSet.add(module.id);
        this.waitList.push(module.id);
        Scheduler.request();
    }
    static remove(module) {
        const index = this.waitList.indexOf(module.id);
        if (index !== -1) {
            this.waitList.splice(index, 1, null);
        }
        this.waitSet.delete(module.id);
    }
    static render() {
        var _a;
        while (this.waitList.length > 0) {
            const id = this.waitList.shift();
            if (!id) {
                continue;
            }
            this.waitSet.delete(id);
            (_a = ModuleFactory.get(id)) === null || _a === void 0 ? void 0 : _a.render();
        }
    }
    static flush(maxRounds = 20) {
        let rounds = 0;
        while (this.waitList.length > 0 && rounds < maxRounds) {
            this.render();
            rounds++;
        }
    }
    static renderDom(module, src, model, parent, key, notRenderChild, previousDom, dirtyPaths) {
        const srcModule = ModuleFactory.get(src.moduleId) || module;
        const renderedKey = resolveRenderedKey(src, resolveNodeKey(src, srcModule, model, key));
        if (canReuseRenderedSubtree(src, previousDom, dirtyPaths)) {
            const reused = reuseRenderedDom(previousDom, src, model, parent);
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
        const dst = {
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
            }
            else if (src.assets && src.assets.size > 0) {
                dst.assets || (dst.assets = {});
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
        }
        else if (src.expressions) {
            let value = "";
            for (const expr of src.expressions) {
                if (expr instanceof Expression) {
                    const nextValue = expr.val(srcModule, dst.model);
                    value += nextValue !== undefined && nextValue !== null ? nextValue : "";
                }
                else {
                    value += expr;
                }
            }
            dst.textContent = value;
        }
        else {
            dst.textContent = src.textContent;
        }
        cacheStaticRenderBlueprint(src, dst);
        appendRenderedChild(parent, dst);
        return dst;
    }
    static handleDirectives(module, src, dst) {
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
    static handleProps(module, src, dst, srcModule) {
        var _a;
        if (((_a = src.props) === null || _a === void 0 ? void 0 : _a.size) > 0) {
            for (const prop of src.props) {
                if (prop[0] === "key") {
                    continue;
                }
                const value = prop[1] instanceof Expression ? prop[1].val(srcModule, dst.model) : prop[1];
                dst.props[prop[0]] = normalizePropValue(value);
            }
        }
        if (src.key === 1) {
            mergeRootProps(module, dst);
        }
    }
    static renderChildren(module, src, dst, key, previousDom, dirtyPaths) {
        var _a;
        const dynamicChildIndexes = new Set(src.dynamicChildIndexes || []);
        for (let index = 0; index < (((_a = src.children) === null || _a === void 0 ? void 0 : _a.length) || 0); index++) {
            const child = src.children[index];
            const previousChild = findPreviousChild(previousDom, child, key);
            const isDynamicChild = dynamicChildIndexes.has(index);
            if (src.blockTree
                && !isDynamicChild
                && previousChild
                && canReuseRenderedSubtree(child, previousChild, dirtyPaths)) {
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
            const renderedChild = this.renderDom(module, child, dst.model, dst, key, false, previousChild, dirtyPaths);
            if (src.blockTree && isDynamicChild && renderedChild) {
                dst.dynamicChildKeys || (dst.dynamicChildKeys = []);
                dst.dynamicChildKeys.push(renderedChild.key);
            }
        }
    }
    static updateToHtml(module, dom, oldDom) {
        var _a, _b;
        const el = oldDom.node;
        if (!el) {
            dom.node = this.renderToHtml(module, dom, (_a = oldDom.parent) === null || _a === void 0 ? void 0 : _a.node);
            return dom.node;
        }
        dom.node = el;
        if (dom.tagName) {
            syncDomState(module, dom, oldDom, el);
            moveTeleportNode(dom, el, (_b = oldDom.parent) === null || _b === void 0 ? void 0 : _b.node);
        }
        else {
            el.textContent = dom.textContent;
        }
        return el;
    }
    static renderToHtml(module, src, parentEl) {
        const el = src.tagName ? createElementNode(src) : createTextNode(src);
        if (el && src.tagName && !src.childModuleId) {
            appendChildren(el, src);
        }
        if (el) {
            moveTeleportNode(src, el, parentEl || undefined);
        }
        return el;
        function createElementNode(dom) {
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
            let el;
            if (dom.tagName === "style") {
                el = document.createElement("style");
            }
            else if (dom.isSvg) {
                el = document.createElementNS("http://www.w3.org/2000/svg", dom.tagName);
                if (dom.tagName === "svg") {
                    el.setAttribute("xmlns", "http://www.w3.org/2000/svg");
                }
            }
            else {
                el = document.createElement(dom.tagName);
            }
            dom.node = el;
            if (dom.props) {
                for (const prop of Object.keys(dom.props)) {
                    el.setAttribute(prop, dom.props[prop]);
                }
            }
            if (dom.assets) {
                for (const asset of Object.keys(dom.assets)) {
                    el[asset] = dom.assets[asset];
                }
            }
            module.eventFactory.handleDomEvent(dom);
            queueTransitionEnter(module, dom, el);
            return el;
        }
        function createTextNode(dom) {
            if (CssManager.handleStyleTextDom(module, dom)) {
                return;
            }
            dom.node = document.createTextNode(dom.textContent || "");
            return dom.node;
        }
        function appendChildren(parentNode, dom) {
            if (!dom.children || dom.children.length === 0) {
                return;
            }
            for (const child of dom.children) {
                let childNode;
                if (child.tagName) {
                    childNode = createElementNode(child);
                    if (childNode instanceof Element) {
                        appendChildren(childNode, child);
                    }
                }
                else {
                    childNode = createTextNode(child);
                }
                if (childNode) {
                    parentNode.appendChild(childNode);
                }
            }
        }
    }
    static syncTeleports(dom) {
        var _a;
        if (!dom) {
            return;
        }
        if (dom.node) {
            moveTeleportNode(dom, dom.node, (_a = dom.parent) === null || _a === void 0 ? void 0 : _a.node);
        }
        if (dom.children) {
            for (const child of dom.children) {
                this.syncTeleports(child);
            }
        }
    }
    static runLeaveTransition(module, dom, removeNode) {
        const transition = resolveTransitionDescriptor(dom);
        const node = dom.node;
        if (!transition || !(node instanceof Element)) {
            return false;
        }
        const state = getTransitionRuntimeState(node);
        const { leaveActiveClass, leaveDuration, leaveFromClass, leaveToClass } = transition;
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
    static handleChangedDoms(module, changeDoms) {
        var _a;
        const slotDoms = {};
        const replaceList = [];
        const addOrMove = [];
        for (const item of changeDoms) {
            if (item[1].slotModuleId && item[1].slotModuleId !== module.id) {
                const slotKey = String(item[1].slotModuleId);
                slotDoms[slotKey] || (slotDoms[slotKey] = []);
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
                        Renderer.add(ModuleFactory.get(item[1].childModuleId));
                    }
                    else {
                        this.updateToHtml(module, item[1], item[2]);
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
            this.replace(module, item[1], item[2]);
        }
        if (addOrMove.length > 1) {
            addOrMove.sort((left, right) => (left[4] > right[4] ? 1 : -1));
        }
        while (addOrMove.length > 0) {
            const item = addOrMove.shift();
            const parentNode = (_a = item[3]) === null || _a === void 0 ? void 0 : _a.node;
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
            let index = item[4];
            const offset = addOrMove.filter(change => {
                var _a;
                return change[0] === 4
                    && ((_a = change[3]) === null || _a === void 0 ? void 0 : _a.node) === parentNode
                    && change[4] >= index
                    && change[5] < index;
            }).length;
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
        function moveNode(node, parentNode, loc) {
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
                }
                else {
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
            }
            else {
                parentNode.appendChild(node);
                parentNode.appendChild(moduleNode);
            }
        }
        function findModuleNode(node) {
            var _a;
            return node
                && node instanceof Comment
                && node.nextSibling
                && node.nextSibling instanceof Element
                && ((_a = node.textContent) === null || _a === void 0 ? void 0 : _a.endsWith(node.nextSibling.getAttribute("role") || ""))
                ? node.nextSibling
                : null;
        }
    }
    static replace(module, src, dst) {
        var _a, _b, _c, _d, _e, _f;
        const el = this.renderToHtml(module, src, null);
        if (isActiveTeleport(src)) {
            moveTeleportNode(src, el, (_a = dst.parent) === null || _a === void 0 ? void 0 : _a.node);
            if ((_b = dst.node) === null || _b === void 0 ? void 0 : _b.parentElement) {
                dst.node.parentElement.removeChild(dst.node);
            }
            module.domManager.freeNode(dst, true);
            return;
        }
        if (dst.childModuleId) {
            const childModule = ModuleFactory.get(dst.childModuleId);
            const parentEl = (_d = (_c = childModule === null || childModule === void 0 ? void 0 : childModule.srcDom) === null || _c === void 0 ? void 0 : _c.node) === null || _d === void 0 ? void 0 : _d.parentElement;
            if (!parentEl) {
                return;
            }
            const previousSibling = (_e = childModule.srcDom.node) === null || _e === void 0 ? void 0 : _e.previousSibling;
            childModule.destroy();
            if (previousSibling) {
                Util.insertAfter(el, previousSibling);
            }
            else if (parentEl.childNodes.length === 0) {
                parentEl.appendChild(el);
            }
            else {
                parentEl.insertBefore(el, parentEl.childNodes[0]);
            }
            return;
        }
        const parentEl = (_f = dst.node) === null || _f === void 0 ? void 0 : _f.parentElement;
        if (!parentEl || !dst.node) {
            return;
        }
        parentEl.replaceChild(el, dst.node);
        module.domManager.freeNode(dst, true);
    }
}
Renderer.waitList = [];
Renderer.waitSet = new Set();
function cloneStaticRenderBlueprint(module, src, model, parent, scopeKey) {
    if (!canCacheStaticRenderBlueprint(src) || !src.renderBlueprint) {
        return;
    }
    return cloneRenderBlueprintNode(module, src, src.renderBlueprint, model, parent, scopeKey);
}
function cloneRenderBlueprintNode(module, src, blueprint, model, parent, scopeKey) {
    var _a, _b, _c, _d;
    const srcModule = ModuleFactory.get(src.moduleId) || module;
    const renderedKey = resolveRenderedKey(src, resolveNodeKey(src, srcModule, model, scopeKey));
    const cloned = {
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
    cloned.keepAlive = cloneKeepAliveState(blueprint.keepAlive);
    cloned.transition = blueprint.transition
        ? { ...blueprint.transition }
        : undefined;
    cloned.teleportDisabled = blueprint.teleportDisabled;
    cloned.teleportTarget = blueprint.teleportTarget;
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
    }
    else {
        cloned.textContent = blueprint.textContent;
    }
    if (((_a = blueprint.children) === null || _a === void 0 ? void 0 : _a.length) && ((_b = src.children) === null || _b === void 0 ? void 0 : _b.length)) {
        cloned.children = [];
        for (let index = 0; index < blueprint.children.length; index++) {
            const childSrc = src.children[index];
            const childBlueprint = blueprint.children[index];
            if (!childSrc || !childBlueprint) {
                continue;
            }
            appendRenderedChild(cloned, cloneRenderBlueprintNode(module, childSrc, childBlueprint, model, cloned, scopeKey));
        }
    }
    if (((_c = src.dynamicChildIndexes) === null || _c === void 0 ? void 0 : _c.length) && ((_d = cloned.children) === null || _d === void 0 ? void 0 : _d.length)) {
        const dynamicChildKeys = src.dynamicChildIndexes
            .map(index => { var _a, _b; return (_b = (_a = cloned.children) === null || _a === void 0 ? void 0 : _a[index]) === null || _b === void 0 ? void 0 : _b.key; })
            .filter((value) => value !== undefined && value !== null);
        if (dynamicChildKeys.length > 0) {
            cloned.dynamicChildKeys = dynamicChildKeys;
        }
    }
    return cloned;
}
function cloneKeepAliveState(value) {
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
function cacheStaticRenderBlueprint(src, dom) {
    if (!canCacheStaticRenderBlueprint(src) || src.renderBlueprint) {
        return;
    }
    src.renderBlueprint = createRenderBlueprint(dom);
}
function createRenderBlueprint(dom) {
    var _a, _b;
    const blueprint = {
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
    blueprint.keepAlive = cloneKeepAliveState(dom.keepAlive);
    blueprint.transition = dom.transition
        ? { ...dom.transition }
        : undefined;
    blueprint.teleportDisabled = dom.teleportDisabled;
    blueprint.teleportTarget = dom.teleportTarget;
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
    }
    else {
        blueprint.textContent = dom.textContent;
    }
    if ((_a = dom.children) === null || _a === void 0 ? void 0 : _a.length) {
        blueprint.children = dom.children.map(child => createRenderBlueprint(child));
    }
    if ((_b = dom.dynamicChildKeys) === null || _b === void 0 ? void 0 : _b.length) {
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
function canCacheStaticRenderBlueprint(src) {
    var _a;
    return src.hoisted
        && src.key !== 1
        && !((_a = src.directives) === null || _a === void 0 ? void 0 : _a.length)
        && !hasStatefulRuntimeSubtree(src);
}
function hasStatefulRuntimeSubtree(src) {
    var _a, _b;
    if ((_a = src.directives) === null || _a === void 0 ? void 0 : _a.some(directive => {
        var _a, _b, _c, _d;
        return ((_a = directive.type) === null || _a === void 0 ? void 0 : _a.name) === "module"
            || ((_b = directive.type) === null || _b === void 0 ? void 0 : _b.name) === "keepalive"
            || ((_c = directive.type) === null || _c === void 0 ? void 0 : _c.name) === "transition"
            || ((_d = directive.type) === null || _d === void 0 ? void 0 : _d.name) === "teleport";
    })) {
        return true;
    }
    return !!((_b = src.children) === null || _b === void 0 ? void 0 : _b.some(child => hasStatefulRuntimeSubtree(child)));
}
function normalizePropValue(value) {
    return value === undefined
        || value === null
        || value === ""
        || (typeof value === "string" && value.trim() === "")
        ? ""
        : value;
}
function mergeRootProps(module, dom) {
    var _a, _b;
    if (!module.props) {
        return;
    }
    for (const key of Object.keys(module.props)) {
        if ((_a = module.excludedProps) === null || _a === void 0 ? void 0 : _a.includes(key)) {
            continue;
        }
        let value = (_b = dom.props) === null || _b === void 0 ? void 0 : _b[key];
        let nextValue = module.props[key];
        if (typeof nextValue === "string") {
            nextValue = nextValue.trim();
        }
        if (!nextValue) {
            dom.props[key] = normalizePropValue(value);
            continue;
        }
        if (key === "style") {
            value = value ? `${nextValue};${value}`.replace(/;{2,}/g, ";") : nextValue;
        }
        else if (key === "class") {
            value = value ? `${value} ${nextValue}` : nextValue;
        }
        else if (!value) {
            value = nextValue;
        }
        dom.props[key] = normalizePropValue(value);
    }
}
function resolveNodeKey(src, srcModule, model, fallbackKey) {
    const keyProp = src.getProp("key");
    if (keyProp instanceof Expression) {
        const resolved = keyProp.val(srcModule, model);
        if (resolved !== undefined && resolved !== null && resolved !== "") {
            return resolved;
        }
    }
    else if (keyProp !== undefined && keyProp !== null && keyProp !== "") {
        return keyProp;
    }
    return fallbackKey;
}
function syncDomState(module, dom, oldDom, el) {
    var _a, _b;
    const patchFlag = (_b = (_a = dom.patchFlag) !== null && _a !== void 0 ? _a : oldDom.patchFlag) !== null && _b !== void 0 ? _b : PatchFlags.BAIL;
    if (!isTargetedPatch(patchFlag)) {
        syncProps(el, dom.props, oldDom.props);
        syncAssets(el, dom.assets, oldDom.assets);
        module.eventFactory.handleDomEvent(dom, oldDom);
        return;
    }
    if (patchFlag & PatchFlags.CLASS) {
        syncNamedProp(el, "class", dom.props, oldDom.props);
    }
    if (patchFlag & PatchFlags.STYLE) {
        syncNamedProp(el, "style", dom.props, oldDom.props);
    }
    if (patchFlag & PatchFlags.PROPS) {
        for (const key of dom.dynamicProps || []) {
            syncNamedProp(el, key, dom.props, oldDom.props);
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
function isTargetedPatch(flag) {
    if (!flag || (flag & PatchFlags.BAIL) !== 0 || (flag & PatchFlags.DIRECTIVES) !== 0) {
        return false;
    }
    return true;
}
function syncProps(el, nextProps, prevProps) {
    var _a;
    if (nextProps) {
        for (const key of Object.keys(nextProps)) {
            el.setAttribute(key, String((_a = nextProps[key]) !== null && _a !== void 0 ? _a : ""));
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
function syncAssets(el, nextAssets, prevAssets) {
    if (nextAssets) {
        for (const key of Object.keys(nextAssets)) {
            el[key] = nextAssets[key];
            if (prevAssets) {
                delete prevAssets[key];
            }
        }
    }
    if (prevAssets) {
        for (const key of Object.keys(prevAssets)) {
            el[key] = null;
        }
    }
}
function syncNamedProp(el, key, nextProps, prevProps) {
    const nextValue = nextProps === null || nextProps === void 0 ? void 0 : nextProps[key];
    const prevValue = prevProps === null || prevProps === void 0 ? void 0 : prevProps[key];
    if (nextValue === prevValue) {
        return;
    }
    if (nextValue === undefined || nextValue === null || nextValue === "") {
        el.removeAttribute(key);
    }
    else {
        el.setAttribute(key, String(nextValue));
    }
}
function syncNamedAsset(el, key, nextAssets, prevAssets) {
    const nextValue = nextAssets === null || nextAssets === void 0 ? void 0 : nextAssets[key];
    const prevValue = prevAssets === null || prevAssets === void 0 ? void 0 : prevAssets[key];
    if (nextValue === prevValue) {
        return;
    }
    el[key] = nextValue === undefined ? null : nextValue;
}
function resolveTeleportTarget(target) {
    if (typeof target === "string" && target.trim()) {
        return document.querySelector(target);
    }
    return target instanceof Element ? target : null;
}
function moveTeleportNode(dom, node, fallbackParent) {
    const teleportDom = dom;
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
function isActiveTeleport(dom) {
    const teleportDom = dom;
    return !!dom.tagName && !teleportDom.teleportDisabled && !!resolveTeleportTarget(teleportDom.teleportTarget);
}
function captureTransitionMoveRect(dom, node) {
    const transition = resolveTransitionDescriptor(dom);
    if (!(transition === null || transition === void 0 ? void 0 : transition.group) || !(node instanceof Element) || typeof node.getBoundingClientRect !== "function") {
        return null;
    }
    return node.getBoundingClientRect();
}
function queueTransitionEnter(module, dom, node) {
    const transition = resolveTransitionDescriptor(dom);
    if (!transition || !(node instanceof Element)) {
        return;
    }
    const state = getTransitionRuntimeState(node);
    const { enterActiveClass, enterDuration, enterFromClass, enterToClass, leaveActiveClass, leaveFromClass, leaveToClass } = transition;
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
function queueTransitionMove(module, dom, node, previousRect) {
    var _a, _b;
    const transition = resolveTransitionDescriptor(dom);
    if (!(transition === null || transition === void 0 ? void 0 : transition.group) || !(node instanceof HTMLElement) || !previousRect) {
        return;
    }
    const nextRect = (_a = node.getBoundingClientRect) === null || _a === void 0 ? void 0 : _a.call(node);
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
    (_b = node.getBoundingClientRect) === null || _b === void 0 ? void 0 : _b.call(node);
    state.cancelMoveFrame = scheduleNextFrame(() => {
        state.cancelMoveFrame = undefined;
        addTransitionClasses(node, [transition.moveClass]);
        node.style.transition = previousTransition || `transform ${transition.moveDuration}ms ease`;
        node.style.transform = previousTransform || "";
        emitTransitionHook(module, "onMove", node);
        state.cancelMoveTimer = scheduleDelay(transition.moveDuration, () => {
            var _a;
            state.cancelMoveTimer = undefined;
            removeTransitionClasses(node, [transition.moveClass]);
            (_a = state.restoreMoveStyles) === null || _a === void 0 ? void 0 : _a.call(state);
            state.restoreMoveStyles = undefined;
            state.phase = undefined;
            emitTransitionHook(module, "onAfterMove", node);
        });
    });
}
function resolveTransitionDescriptor(dom) {
    const transition = dom.transition;
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
function normalizeTransitionDuration(value, fallback) {
    return typeof value === "number" && Number.isFinite(value)
        ? Math.max(0, value)
        : fallback;
}
function addTransitionClasses(node, classes) {
    const tokens = classes
        .flatMap(value => typeof value === "string" ? value.split(/\s+/) : [])
        .map(value => value.trim())
        .filter(Boolean);
    if (tokens.length > 0) {
        node.classList.add(...tokens);
    }
}
function removeTransitionClasses(node, classes) {
    const tokens = classes
        .flatMap(value => typeof value === "string" ? value.split(/\s+/) : [])
        .map(value => value.trim())
        .filter(Boolean);
    if (tokens.length > 0) {
        node.classList.remove(...tokens);
    }
}
function scheduleNextFrame(callback) {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        let cancelled = false;
        let secondFrame;
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
            var _a, _b;
            cancelled = true;
            (_a = window.cancelAnimationFrame) === null || _a === void 0 ? void 0 : _a.call(window, firstFrame);
            if (secondFrame !== undefined) {
                (_b = window.cancelAnimationFrame) === null || _b === void 0 ? void 0 : _b.call(window, secondFrame);
            }
        };
    }
    const timerId = window.setTimeout(callback, 16);
    return () => clearTimeout(timerId);
}
function emitTransitionHook(module, eventName, node) {
    var _a, _b;
    (_b = (_a = module).emitHook) === null || _b === void 0 ? void 0 : _b.call(_a, eventName, node);
}
function scheduleDelay(delay, callback) {
    const timerId = window.setTimeout(callback, delay);
    return () => clearTimeout(timerId);
}
function getTransitionRuntimeState(node) {
    let state = transitionRuntimeStates.get(node);
    if (!state) {
        state = {};
        transitionRuntimeStates.set(node, state);
    }
    return state;
}
function cancelTransitionPhase(module, node, state, phase, transition) {
    var _a;
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
    cancelFrame === null || cancelFrame === void 0 ? void 0 : cancelFrame();
    cancelTimer === null || cancelTimer === void 0 ? void 0 : cancelTimer();
    state[cancelFrameKey] = undefined;
    state[cancelTimerKey] = undefined;
    if (phase === "move") {
        removeTransitionClasses(node, [transition.moveClass]);
        (_a = state.restoreMoveStyles) === null || _a === void 0 ? void 0 : _a.call(state);
        state.restoreMoveStyles = undefined;
    }
    else {
        const isEnter = phase === "enter";
        removeTransitionClasses(node, isEnter
            ? [transition.enterActiveClass, transition.enterFromClass, transition.enterToClass]
            : [transition.leaveActiveClass, transition.leaveFromClass, transition.leaveToClass]);
    }
    if (state.phase === phase) {
        emitTransitionHook(module, phase === "enter"
            ? "onEnterCancelled"
            : phase === "leave"
                ? "onLeaveCancelled"
                : "onMoveCancelled", node);
        state.phase = undefined;
    }
}
//# sourceMappingURL=renderer.js.map