import { DirectiveManager } from './directivemanager';
/**
 * 虚拟dom
 * @remarks
 * 编译后的dom节点，与渲染后的dom节点(RenderedDom)不同
 */
export class VirtualDom {
    /**
     * @param tag -     标签名
     * @param key -     key
     * @param module - 	模块
     */
    constructor(tag, key, module) {
        this.moduleId = module === null || module === void 0 ? void 0 : module.id;
        this.key = key;
        this.staticNum = 1;
        if (tag) {
            this.tagName = tag;
        }
    }
    /**
     * 移除多个指令
     * @param directives - 	待删除的指令类型数组或指令类型
     * @returns             如果虚拟dom上的指令集为空，则返回void
     */
    removeDirectives(directives) {
        if (!this.directives) {
            return;
        }
        //数组
        directives.forEach((d) => {
            this.removeDirective(d);
        });
    }
    /**
     * 移除指令
     * @param directive - 	待删除的指令类型名
     * @returns             如果虚拟dom上的指令集为空，则返回void
     */
    removeDirective(directive) {
        if (!this.directives) {
            return;
        }
        let ind;
        if ((ind = this.directives.findIndex((item) => item.type.name === directive)) !== -1) {
            this.directives.splice(ind, 1);
        }
        if (this.directives.length === 0) {
            delete this.directives;
        }
    }
    /**
     * 添加指令
     * @param directive -     指令对象
     * @param sort -          是否排序
     * @returns             如果虚拟dom上的指令集不为空，且指令集中已经存在传入的指令对象，则返回void
     */
    addDirective(directive, sort) {
        if (!this.directives) {
            this.directives = [directive];
            return;
        }
        else if (this.directives.find((item) => item.type.name === directive.type.name)) {
            return;
        }
        this.directives.push(directive);
        //指令按优先级排序
        if (sort) {
            this.sortDirective();
        }
    }
    /**
     * 指令排序
     * @returns           如果虚拟dom上指令集为空，则返回void
     */
    sortDirective() {
        if (!this.directives) {
            return;
        }
        if (this.directives.length > 1) {
            this.directives.sort((a, b) => {
                return DirectiveManager.getType(a.type.name).prio <
                    DirectiveManager.getType(b.type.name).prio
                    ? -1
                    : 1;
            });
        }
    }
    /**
     * 是否有某个类型的指令
     * @param typeName - 	    指令类型名
     * @returns             如果指令集不为空，且含有传入的指令类型名则返回true，否则返回false
     */
    hasDirective(typeName) {
        return this.directives && this.directives.find(item => item.type.name === typeName) !== undefined;
    }
    /**
     * 获取某个类型的指令
     * @param module -            模块
     * @param directiveType - 	指令类型名
     * @returns                 如果指令集为空，则返回void；否则返回指令类型名等于传入参数的指令对象
     */
    getDirective(directiveType) {
        if (!this.directives) {
            return;
        }
        return this.directives.find((item) => item.type.name === directiveType);
    }
    /**
     * 添加子节点
     * @param dom -       子节点
     * @param index -     指定位置，如果不传此参数，则添加到最后
     */
    add(dom, index) {
        if (!this.children) {
            this.children = [];
        }
        if (index) {
            this.children.splice(index, 0, dom);
        }
        else {
            this.children.push(dom);
        }
        dom.parent = this;
    }
    /**
     * 移除子节点
     * @param dom -   子节点
     */
    remove(dom) {
        const index = this.children.indexOf(dom);
        if (index !== -1) {
            this.children.splice(index, 1);
        }
    }
    /**
     * 是否拥有属性
     * @param propName -  属性名
     * @param isExpr -    是否只检查表达式属性
     * @returns         如果属性集含有传入的属性名返回true，否则返回false
     */
    hasProp(propName) {
        if (this.props) {
            return this.props.has(propName);
        }
    }
    /**
     * 获取属性值
     * @param propName -  属性名
     * @returns         传入属性名的value
     */
    getProp(propName) {
        if (this.props) {
            return this.props.get(propName);
        }
    }
    /**
     * 设置属性值
     * @param propName -  属性名
     * @param v -         属性值
     */
    setProp(propName, v) {
        if (!this.props) {
            this.props = new Map();
        }
        this.props.set(propName, v);
    }
    /**
     * 删除属性
     * @param props -     属性名或属性名数组
     * @returns         如果虚拟dom上的属性集为空，则返回void
     */
    delProp(props) {
        if (!this.props) {
            return;
        }
        this.props.delete(props);
    }
    /**
     * 设置asset
     * @param assetName -     asset name
     * @param value -         asset value
     */
    setAsset(assetName, value) {
        if (!this.assets) {
            this.assets = new Map();
        }
        this.assets.set(assetName, value);
        this.setStaticOnce();
    }
    /**
     * 删除asset
     * @param assetName -     asset name
     * @returns             如果虚拟dom上的直接属性集为空，则返回void
     */
    delAsset(assetName) {
        if (!this.assets) {
            return;
        }
        this.assets.delete(assetName);
        this.setStaticOnce();
    }
    /**
     * 设置cache参数
     * @param module -    模块
     * @param name -      参数名
     * @param value -     参数值
     */
    setParam(module, name, value) {
        module.objectManager.setDomParam(this.key, name, value);
    }
    /**
     * 获取参数值
     * @param module -    模块
     * @param name -      参数名
     * @returns         参数值
     */
    getParam(module, name) {
        return module.objectManager.getDomParam(this.key, name);
    }
    /**
     * 移除参数
     * @param module -    模块
     * @param name -      参数名
     */
    removeParam(module, name) {
        module.objectManager.removeDomParam(this.key, name);
    }
    /**
     * 设置单次静态标志
     */
    setStaticOnce() {
        if (this.staticNum !== -1) {
            this.staticNum = 1;
        }
    }
    /**
     * 克隆
     */
    clone() {
        const dst = new VirtualDom(this.tagName, this.key);
        dst.moduleId = this.moduleId;
        if (this.tagName) {
            //属性
            if (this.props && this.props.size > 0) {
                for (const p of this.props) {
                    dst.setProp(p[0], p[1]);
                }
            }
            if (this.assets && this.assets.size > 0) {
                for (const p of this.assets) {
                    dst.setAsset(p[0], p[1]);
                }
            }
            if (this.directives && this.directives.length > 0) {
                dst.directives = [];
                for (const d of this.directives) {
                    dst.directives.push(d.clone());
                }
            }
            //复制事件
            dst.events = this.events;
            //子节点clone
            if (this.children) {
                for (const c of this.children) {
                    dst.add(c.clone());
                }
            }
        }
        else {
            dst.expressions = this.expressions;
            dst.textContent = this.textContent;
        }
        dst.staticNum = this.staticNum;
        return dst;
    }
    /**
     * 保存事件
     * @param event - 	事件对象
     * @param index - 	位置
     */
    addEvent(event, index) {
        if (!this.events) {
            this.events = [event];
        }
        else if (!this.events.includes(event)) {
            if (index >= 0) {
                this.events.splice(index, 0, event);
            }
            else {
                this.events.push(event);
            }
        }
    }
}
//# sourceMappingURL=virtualdom.js.map