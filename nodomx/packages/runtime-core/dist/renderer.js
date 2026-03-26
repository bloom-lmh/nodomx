import { ModuleFactory } from "./modulefactory";
import { Expression } from "./expression";
import { CssManager } from "./cssmanager";
import { Util } from "./util";
/**
 * 渲染器
 * @remarks
 * nodom渲染操作在渲染器中实现
 */
export class Renderer {
    /**
     * 设置根容器
     * @param rootEl - 根html element
     */
    static setRootEl(rootEl) {
        this.rootEl = rootEl;
    }
    /**
     * 获取根容器
     * @returns 根 html element
     */
    static getRootEl() {
        return this.rootEl;
    }
    /**
     * 添加到渲染列表
     * @param module - 模块
     */
    static add(module) {
        if (!module) {
            return;
        }
        //如果已经在列表中，不再添加
        if (!this.waitList.includes(module.id)) {
            //计算优先级
            this.waitList.push(module.id);
        }
    }
    /**
     * 从渲染队列移除
     * @param module -  模块
     */
    static remove(module) {
        let index;
        if ((index = this.waitList.indexOf(module.id)) !== -1) {
            //不能破坏watiList顺序，用null替换
            this.waitList.splice(index, 1, null);
        }
    }
    /**
     * 渲染
     * @remarks
     * 如果存在渲染队列，则从队列中取出并依次渲染
     */
    static render() {
        for (; this.waitList.length > 0;) {
            const id = this.waitList[0];
            if (id) { //存在id为null情况，remove方法造成
                const m = ModuleFactory.get(id);
                m === null || m === void 0 ? void 0 : m.render();
            }
            //渲染后移除
            this.waitList.shift();
        }
    }
    /**
     * flush pending render queue synchronously
     * @param maxRounds - max render rounds
     */
    static flush(maxRounds = 20) {
        let rounds = 0;
        while (this.waitList.length > 0 && rounds < maxRounds) {
            this.render();
            rounds++;
        }
    }
    /**
     * 渲染dom
     * @remarks
     * 此过程将VirtualDom转换为RenderedDom。
     * 当对单个节点进行更新渲染时，可避免整个模块的渲染，这种方式适用于组件、指令等编码过程使用。
     * @param module -          模块
     * @param src -             源dom
     * @param model -           模型
     * @param parent -          父dom
     * @param key -             附加key，放在domkey的后面
     * @param notRenderChild -  不渲染子节点
     * @returns                 渲染后节点
     */
    static renderDom(module, src, model, parent, key, notRenderChild) {
        //初始化渲染节点
        const dst = {
            key: key ? src.key + '_' + key : src.key,
            model: model,
            vdom: src,
            parent: parent,
            moduleId: src.moduleId,
            slotModuleId: src.slotModuleId,
            staticNum: src.staticNum
        };
        //静态节点只渲染1次
        if (src.staticNum > 0) {
            src.staticNum--;
        }
        //源模块（编译模板时产生的模块）
        //表达式不能用module，因为涉及到方法调用时，必须用srcModule
        const srcModule = ModuleFactory.get(dst.moduleId);
        //标签
        if (src.tagName) {
            dst.tagName = src.tagName;
            //字节点map
            dst.locMap = new Map();
            //添加key属性
            dst.props = {};
            //设置svg标志
            if (src.isSvg) {
                dst.isSvg = src.isSvg;
            }
        }
        //处理model指令
        const mdlDir = src.getDirective('model');
        if (mdlDir) {
            mdlDir.exec(module, dst);
        }
        if (dst.tagName) { //标签节点
            this.handleProps(module, src, dst, srcModule);
            //处理style标签，如果为style，则不处理assets
            if (src.tagName === 'style') {
                CssManager.handleStyleDom(module, dst);
            }
            else if (src.assets && src.assets.size > 0) {
                dst.assets || (dst.assets = {});
                for (const p of src.assets) {
                    dst.assets[p[0]] = p[1];
                }
            }
            //处理directive时，导致禁止后续渲染，则不再渲染，如show指令
            if (!this.handleDirectives(module, src, dst)) {
                return null;
            }
            //非子模块节点，处理事件
            if (src.events) {
                dst.events || (dst.events = []);
                for (const ev of src.events) {
                    dst.events.push(ev);
                }
            }
            //子节点渲染
            if (!notRenderChild) {
                if (src.children && src.children.length > 0) {
                    dst.children = [];
                    for (const c of src.children) {
                        this.renderDom(module, c, dst.model, dst, key);
                    }
                }
            }
        }
        else { //文本节点
            if (src.expressions) { //文本节点
                let value = '';
                for (const expr of src.expressions) {
                    if (expr instanceof Expression) { //处理表达式
                        const v1 = expr.val(srcModule, dst.model);
                        value += v1 !== undefined && v1 !== null ? v1 : '';
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
        }
        //添加到dom tree，必须放在handleDirectives后，因为有可能directive执行后返回false
        if (parent) {
            if (!parent.children) {
                parent.children = [];
            }
            //添加到childMap
            parent.locMap.set(dst.key, parent.children.length);
            //添加到children树组
            parent.children.push(dst);
        }
        return dst;
    }
    /**
     * 处理指令
     * @param module -  模块
     * @param src -     编译节点
     * @param dst -     渲染节点
     * @returns         true继续执行，false不执行后续渲染代码，也不加入渲染树
    */
    static handleDirectives(module, src, dst) {
        if (!src.directives || src.directives.length === 0) {
            return true;
        }
        for (const d of src.directives) {
            //model指令不执行
            if (d.type.name === 'model') {
                continue;
            }
            if (!d.exec(module, dst)) {
                return false;
            }
        }
        return true;
    }
    /**
     * 处理属性
     * @param module -      模块
     * @param src -         编译节点
     * @param dst -         渲染节点
     * @param srcModule -   源模块
     */
    static handleProps(module, src, dst, srcModule) {
        var _a;
        if (((_a = src.props) === null || _a === void 0 ? void 0 : _a.size) > 0) {
            for (const k of src.props) {
                const v = k[1] instanceof Expression ? k[1].val(srcModule, dst.model) : k[1];
                dst.props[k[0]] = handleValue(v);
            }
        }
        //如果为子模块，则合并srcDom属性
        if (src.key === 1) {
            mergeProps(module, dst);
        }
        /**
         * 对空value进行处理
         * @param v -   待处理value
         * @returns     空字符串或原value
         */
        function handleValue(v) {
            // 属性值为空，则设置为''
            return (v === undefined || v === null || v === '' || typeof v === 'string' && v.trim() === '') ? '' : v;
        }
        /**
         * 处理根节点属性
         * @param module -  所属模块
         * @param dom -     dom节点
         */
        function mergeProps(module, dom) {
            var _a;
            if (module.props) {
                for (const k of Object.keys(module.props)) {
                    let value = dom.props[k];
                    if ((_a = module.excludedProps) === null || _a === void 0 ? void 0 : _a.includes(k)) {
                        continue;
                    }
                    let v = module.props[k];
                    if (v) {
                        if (typeof v === 'string') {
                            v = v.trim();
                        }
                        //合并style  props.style + dst.style
                        if ('style' === k) {
                            if (!value) {
                                value = v;
                            }
                            else {
                                value = (v + ';' + value).replace(/;{2,}/g, ';');
                            }
                        }
                        else if ('class' === k) { //合并class,dst.class + props.class 
                            if (!value) {
                                value = v;
                            }
                            else {
                                value += ' ' + v;
                            }
                        }
                        else if (!value) { //其他情况，如果不存在dst.props[k]，则直接用module.props[k]
                            value = v;
                        }
                    }
                    dom.props[k] = handleValue(value);
                }
            }
        }
    }
    /**
     * 更新到html树
     * @param module -  模块
     * @param dom -     渲染节点
     * @param oldDom -  旧节点
     * @returns         渲染后的节点
     */
    static updateToHtml(module, dom, oldDom) {
        var _a;
        const el = oldDom.node;
        if (!el) {
            dom.node = this.renderToHtml(module, dom, (_a = oldDom.parent) === null || _a === void 0 ? void 0 : _a.node);
            return dom.node;
        }
        else if (dom.tagName) { //html dom节点已存在
            //设置element key属性
            for (const prop of ['props', 'assets']) {
                const old = oldDom[prop];
                //设置属性
                if (dom[prop]) {
                    for (const k of Object.keys(dom[prop])) {
                        const pv = dom[prop][k];
                        if (prop === 'props') { //attribute
                            el.setAttribute(k, pv);
                        }
                        else { //asset
                            el[k] = pv;
                        }
                        //删除旧节点对应k
                        if (old) {
                            delete old[k];
                        }
                    }
                }
                //清理多余属性
                if (old) {
                    const keys = Object.keys(old);
                    if (keys.length > 0) {
                        for (const k of keys) {
                            if (prop === 'props') { //attribute
                                el.removeAttribute(k);
                            }
                            else { //asset
                                el[k] = null;
                            }
                        }
                    }
                }
            }
            //删除旧事件
            // module.eventFactory.removeEvent(dom);
            //绑定事件
            module.eventFactory.handleDomEvent(dom, oldDom);
        }
        else { //文本节点
            el['textContent'] = dom.textContent;
        }
        return el;
    }
    /**
     * 渲染到html树
     * @param module - 	        模块
     * @param src -             渲染节点
     * @param parentEl - 	    父html
     * @returns                 渲染后的html节点
     */
    static renderToHtml(module, src, parentEl) {
        let el;
        if (src.tagName) {
            el = newEl(src);
        }
        else {
            el = newText(src);
        }
        // element、渲染子节点且不为子模块，处理子节点
        if (el && src.tagName && !src.childModuleId) {
            genSub(el, src);
        }
        if (el && parentEl) {
            parentEl.appendChild(el);
        }
        return el;
        /**
         * 新建element节点
         * @param dom - 	虚拟dom
         * @returns 		新的html element
         */
        function newEl(dom) {
            let el;
            // 子模块自行渲染
            if (dom.childModuleId) {
                const m = ModuleFactory.get(dom.childModuleId);
                //创建替代节点
                if (m) {
                    const comment = document.createComment("module " + m.constructor.name + ':' + m.id);
                    Renderer.add(m);
                    dom.node = comment;
                    return comment;
                }
                return;
            }
            //style，只处理文本节点
            if (dom.tagName === 'style') {
                genSub(el, dom);
                return;
            }
            //处理svg节点
            if (dom.isSvg) {
                el = document.createElementNS("http://www.w3.org/2000/svg", dom.tagName);
                if (dom.tagName === 'svg') {
                    el.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
                }
            }
            else { //普通节点
                el = document.createElement(dom.tagName);
            }
            //保存element
            dom.node = el;
            //设置属性
            for (const p of Object.keys(dom.props)) {
                el.setAttribute(p, dom.props[p]);
            }
            //asset
            if (dom.assets) {
                for (const p of Object.keys(dom.assets)) {
                    el[p] = dom.assets[p];
                }
            }
            module.eventFactory.handleDomEvent(dom);
            return el;
        }
        /**
         * 新建文本节点
         */
        function newText(dom) {
            //样式表处理，如果是样式表文本，则不添加到dom树
            if (CssManager.handleStyleTextDom(module, dom)) {
                return;
            }
            dom.node = document.createTextNode(dom.textContent || '');
            return dom.node;
        }
        /**
         * 生成子节点
         * @param pEl -     父节点
         * @param dom -     dom节点
         */
        function genSub(pEl, dom) {
            if (dom.children && dom.children.length > 0) {
                dom.children.forEach(item => {
                    let el1;
                    if (item.tagName) {
                        el1 = newEl(item);
                        //element节点，产生子节点
                        if (el1 instanceof Element) {
                            genSub(el1, item);
                        }
                    }
                    else {
                        el1 = newText(item);
                    }
                    if (el1) {
                        pEl.appendChild(el1);
                    }
                });
            }
        }
    }
    /**
     * 处理更改的dom节点
     * @param module -        待处理模块
     * @param changeDoms -    修改后的dom节点数组
     */
    static handleChangedDoms(module, changeDoms) {
        const slotDoms = {};
        //替换数组
        const repArr = [];
        //添加或移动节点
        const addOrMove = [];
        //保留原有html节点
        for (const item of changeDoms) {
            //如果为slot节点，则记录，单独处理
            if (item[1].slotModuleId && item[1].slotModuleId !== module.id) {
                if (slotDoms[item[1].slotModuleId]) {
                    slotDoms[item[1].slotModuleId].push(item);
                }
                else {
                    slotDoms[item[1].slotModuleId] = [item];
                }
                continue;
            }
            switch (item[0]) {
                case 1: //添加
                    addOrMove.push(item);
                    break;
                case 2: //修改
                    //子模块不处理，由setProps处理
                    if (item[1].childModuleId) {
                        Renderer.add(ModuleFactory.get(item[1].childModuleId));
                    }
                    else {
                        this.updateToHtml(module, item[1], item[2]);
                    }
                    break;
                case 3: //删除
                    module.domManager.freeNode(item[1], true);
                    break;
                case 4: //移动
                    addOrMove.push(item);
                    break;
                default: //替换
                    repArr.push(item);
            }
        }
        //替换
        if (repArr.length > 0) {
            for (const item of repArr) {
                this.replace(module, item[1], item[2]);
            }
        }
        if (addOrMove.length > 1) {
            addOrMove.sort((a, b) => a[4] > b[4] ? 1 : -1);
        }
        for (; addOrMove.length > 0;) {
            const item = addOrMove[0];
            const pEl = item[3].node;
            if (!pEl) {
                continue;
            }
            //如果为add，则新建节点，否则直接取旧节点
            const n1 = item[0] === 1 ? Renderer.renderToHtml(module, item[1], null) : item[1].node;
            if (n1) {
                let index = item[4];
                //检查 目标位置 > item[4]且 原位置 < item[4] 的兄弟节点，此类节点后续要移走，会影响节点位置，需要在当前
                const arr = addOrMove.filter(ii => ii[0] === 4 && ii[3].node === pEl && ii[4] >= item[4] && ii[5] < item[4]);
                index += arr.length;
                moveNode2Loc(n1, pEl, index);
            }
            //首节点处理后移除
            addOrMove.shift();
        }
        //处理slot节点改变后影响的子模块
        const keys = Object.keys(slotDoms);
        if (keys && keys.length > 0) {
            for (const k of keys) {
                const m = ModuleFactory.get(parseInt(k));
                if (m) {
                    Renderer.add(m);
                }
            }
        }
        /**
         * 移动节点到指定位置
         * @param node -    待插入节点
         * @param pEl -     父节点
         * @param loc -     位置
         */
        function moveNode2Loc(node, pEl, loc) {
            const mdl = findMdlNode(node);
            let findLoc = false;
            for (let i = 0, index = 0; i < pEl.childNodes.length; i++, index++) {
                const c = pEl.childNodes[i];
                //子模块占位符和模块算一个计数位置
                if (findMdlNode(c) !== null) {
                    i++;
                }
                //找到插入位置
                if (index === loc) {
                    if (mdl === null) {
                        pEl.insertBefore(node, c);
                    }
                    else { //占位符和模块一并移动
                        pEl.insertBefore(mdl, c);
                        pEl.insertBefore(node, mdl);
                    }
                    findLoc = true;
                    break;
                }
            }
            //只能作为pEl的最后节点
            if (!findLoc) {
                if (mdl === null) {
                    pEl.appendChild(node);
                }
                else {
                    pEl.appendChild(node);
                    pEl.appendChild(mdl);
                }
            }
        }
        /**
         * 找到注释节点对应的子模块节点
         * @param node      注释节点
         * @returns         注释节点对应的子模块节点或null
         */
        function findMdlNode(node) {
            return node && node instanceof Comment && node.nextSibling && node.nextSibling instanceof Element
                && node.textContent.endsWith(node.nextSibling.getAttribute('role')) ? node.nextSibling : null;
        }
    }
    /**
     * 替换节点
     * @param module -  模块
     * @param src -     待替换节点
     * @param dst -     被替换节点
     */
    static replace(module, src, dst) {
        var _a, _b;
        const el = this.renderToHtml(module, src, null);
        if (dst.childModuleId) { //被替换节点为子模块
            const m1 = ModuleFactory.get(dst.childModuleId);
            const pEl = (_a = m1.srcDom.node) === null || _a === void 0 ? void 0 : _a.parentElement;
            if (!pEl) {
                return;
            }
            const el1 = m1.srcDom.node.previousSibling;
            m1.destroy();
            if (el1) {
                Util.insertAfter(el, el1);
            }
            else if (pEl.childNodes.length === 0) {
                pEl.appendChild(el);
            }
            else {
                pEl.insertBefore(el, pEl.childNodes[0]);
            }
        }
        else {
            const pEl = (_b = dst.node) === null || _b === void 0 ? void 0 : _b.parentElement;
            if (!pEl) {
                return;
            }
            pEl.replaceChild(el, dst.node);
            module.domManager.freeNode(dst, true);
        }
    }
}
/**
 * 等待渲染列表
 */
Renderer.waitList = [];
//# sourceMappingURL=renderer.js.map