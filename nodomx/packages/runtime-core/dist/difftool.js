/**
 * dom比较器
 */
export class DiffTool {
    /**
     * 比较节点
     *
     * @param src -         待比较节点（新树节点）
     * @param dst - 	    被比较节点 (旧树节点)
     * @param changeArr -   增删改的节点数组
     * @returns	            改变的节点数组
     */
    static compare(src, dst) {
        const changeArr = [];
        compare(src, dst);
        return changeArr;
        /**
         * 比较节点
         * @param src -     待比较节点（新节点）
         * @param dst - 	被比较节点 (旧节点)
         */
        function compare(src, dst) {
            //保留node
            src.node = dst.node;
            //设置继续使用标志
            dst['__used'] = true;
            if (!src.tagName) { //文本节点
                if (!dst.tagName) {
                    if ((src.staticNum || dst.staticNum) && src.textContent !== dst.textContent) {
                        addChange(2, src, dst, dst.parent);
                    }
                    else if (src.childModuleId !== dst.childModuleId) { //子模块不同
                        addChange(5, src, dst, dst.parent);
                    }
                }
                else { //节点类型不同，替换
                    addChange(5, src, dst, dst.parent);
                }
            }
            else {
                //节点类型不同或对应的子模块不同，替换
                if ((src.childModuleId || dst.childModuleId) && src.childModuleId !== dst.childModuleId || src.tagName !== dst.tagName) {
                    addChange(5, src, dst, dst.parent);
                }
                else { //节点类型相同，但有一个不是静态节点或为根节点，进行属性比较
                    if ((src.staticNum || dst.staticNum || dst.key === 1) && isChanged(src, dst)) {
                        addChange(2, src, dst, dst.parent);
                    }
                    // 非子模块不比较子节点或者作为slot的子模块
                    compareChildren(src, dst);
                }
            }
        }
        /**
         * 比较子节点
         * @param newNode -     新节点
         * @param oldNode -     旧节点
         */
        function compareChildren(newNode, oldNode) {
            //子节点处理
            if (!newNode.children || newNode.children.length === 0) {
                // 旧节点的子节点全部删除
                if (oldNode.children && oldNode.children.length > 0) {
                    oldNode.children.forEach(item => addChange(3, item, null, oldNode));
                }
            }
            else {
                //全部新加节点
                if (!oldNode.children || oldNode.children.length === 0) {
                    newNode.children.forEach((item, index) => addChange(1, item, null, oldNode, index));
                }
                else { //都有子节点
                    //旧树子节点索引
                    let oldIndex = 0;
                    for (let ii = 0; ii < newNode.children.length; ii++) {
                        const node = newNode.children[ii];
                        //相同序号节点
                        if (oldNode.children[oldIndex] && oldNode.children[oldIndex].key === node.key) {
                            if (oldIndex !== ii) {
                                addChange(4, node, null, oldNode, ii, oldIndex);
                            }
                            compare(node, oldNode.children[oldIndex]);
                        }
                        else {
                            //存在旧节点
                            //如果位置不同，则移动
                            //如果有修改，则修改
                            if (oldNode.locMap.has(node.key)) {
                                const nLoc = newNode.locMap.get(node.key);
                                const oLoc = oldNode.locMap.get(node.key);
                                //移动
                                if (nLoc !== oLoc) {
                                    addChange(4, node, null, oldNode, nLoc, oLoc);
                                    //旧树索引重新定位
                                    oldIndex = oLoc;
                                }
                                // 如果修改则添加到修改树组
                                compare(node, oldNode.children[oLoc]);
                            }
                            else { //新建节点
                                addChange(1, node, null, oldNode, ii);
                            }
                        }
                        //旧树索引后移
                        oldIndex++;
                    }
                    //删除多余节点
                    for (let o of oldNode.children) {
                        if (!o['__used']) {
                            addChange(3, o, dst);
                        }
                    }
                }
            }
        }
        /**
         * 判断节点是否修改
         * @param src - 新树节点
         * @param dst - 旧树节点
         * @returns     true/false
         */
        function isChanged(src, dst) {
            for (const p of ['props', 'assets', 'events']) {
                //属性比较
                if (!src[p] && dst[p] || src[p] && !dst[p]) {
                    return true;
                }
                else if (src[p] && dst[p]) {
                    const keys = Object.keys(src[p]);
                    const keys1 = Object.keys(dst[p]);
                    if (keys.length !== keys1.length) {
                        return true;
                    }
                    else {
                        for (const k of keys) {
                            if (src[p][k] !== dst[p][k]) {
                                return true;
                            }
                        }
                    }
                }
            }
            return false;
        }
        /**
         * 添加到修改数组
         * @param type -    类型 add 1, upd 2,del 3,move 4 ,rep 5
         * @param dom -     目标节点
         * @param dom1 -    相对节点（被替换时有效）
         * @param parent -  父节点
         * @param loc -     添加或移动的目标index
         * @param loc1 -    被移动前位置
         * @returns         changed dom
        */
        function addChange(type, dom, dom1, parent, loc, loc1) {
            const o = [type, dom, dom1, parent, loc, loc1];
            // 被替换的不需要保留node
            if (type === 5) {
                delete dom.node;
            }
            changeArr.push(o);
            return o;
        }
    }
}
//# sourceMappingURL=difftool.js.map