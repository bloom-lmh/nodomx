import {
    DefineElement,
    DefineElementManager,
    Directive,
    Expression,
    Module,
    NError,
    NodomMessage,
    VirtualDom
} from "@nodomx/core";

/**
 * module 元素
 * @remarks
 * module指令标签，用`<module name='class name' /> 代替 x-module='class name'`
 */
class MODULE extends DefineElement{
    constructor(node: VirtualDom,module:Module){
        super(node,module);
        //类名
        const clazz = <string>node.getProp('name');
        if (!clazz) {
            throw new NError('itemnotempty', NodomMessage.TipWords['element'],'MODULE', 'className');
        }
        node.delProp('name');
        node.addDirective(new Directive('module',clazz));
    }
}

/**
 * for 元素
 * @remarks
 * repeat指令标签，用`<for cond={{your expression}} /> 代替 x-repeat={{your expression}}`
 */
class FOR extends DefineElement{
    constructor(node: VirtualDom,module:Module){
        super(node,module);
        //条件
        const cond = <Expression>node.getProp('cond');
        if (!cond) {
            throw new NError('itemnotempty', NodomMessage.TipWords['element'], 'FOR', 'cond');
        }
        node.delProp('cond');
        node.addDirective(new Directive('repeat',cond));
    }
}
/**
 * 递归元素
 * @remarks
 * recur指令标签，用`<recur cond='recur field' /> 代替 x-recur='recur field'`
 */
class RECUR extends DefineElement{
    constructor(node: VirtualDom,module:Module){
        super(node,module);
        //条件
        const cond = <Expression>node.getProp('cond');
        node.delProp('cond');
        node.addDirective(new Directive('recur',cond));
    }
}

/**
 * IF 元素
 * @remarks
 * if指令标签，用`<if cond={{your expression}} /> 代替 x-if={{your expression}}`
 */
class IF extends DefineElement{
    constructor(node: VirtualDom,module:Module){
        super(node,module);
        //条件
        const cond = <Expression>node.getProp('cond');
        if (!cond) {
            throw new NError('itemnotempty', NodomMessage.TipWords['element'], 'IF', 'cond');
        }
        node.delProp('cond');
        node.addDirective(new Directive('if',cond));
    }
}

/**
 * ELSE 元素
 * @remarks
 * else指令标签，用`<else/> 代替 x-else`
 */
class ELSE extends DefineElement{
    constructor(node: VirtualDom,module:Module){
        super(node,module);
        node.addDirective(new Directive('else',null));
    }
}

/**
 * ELSEIF 元素
 * @remarks
 * elseif指令标签，用`<elseif cond={{your expression}} /> 代替 x-elseif={{your expression}}`
 */
class ELSEIF extends DefineElement{
    constructor(node: VirtualDom,module:Module){
        super(node,module);
        //条件
        const cond = <Expression>node.getProp('cond');
        if (!cond) {
            throw new NError('itemnotempty',NodomMessage.TipWords['element'], 'ELSEIF', 'cond');
        }
        node.delProp('cond');
        node.addDirective(new Directive('elseif',cond));
    }
}

/**
 * ENDIF 元素
 * @remarks
 * endif指令标签，用`<endif /> 代替 x-endif`
 */
class ENDIF extends DefineElement{
    constructor(node: VirtualDom,module:Module){
        super(node,module);
        node.addDirective(new Directive('endif',null));
    }
}

/**
 * SHOW 元素
 * @remarks
 * show指令标签，用`<show cond={{your expression}} /> 代替 x-show={{your expression}}`
 */
class SHOW extends DefineElement{
    constructor(node: VirtualDom,module:Module){
        super(node,module);
        //条件
        const cond = <Expression>node.getProp('cond');
        if (!cond) {
            throw new NError('itemnotempty', NodomMessage.TipWords['element'], 'SHOW', 'cond');
        }
        node.delProp('cond');
        node.addDirective(new Directive('show',cond));
    }
}

/**
 * 插槽
 * @remarks
 * slot指令标签，用`<slot name='slotname' > 代替 x-slot='slotname'`
 */
class SLOT extends DefineElement{
    constructor(node: VirtualDom,module:Module){
        super(node,module);
        //条件
        const cond = node.getProp('name') || 'default';
        node.delProp('name');
        node.addDirective(new Directive('slot',<string>cond));
    }
}

/**
 * 路由
 * @remarks
 * route指令标签，用`<route path='routepath' > 代替 x-route='routepath'`
 */
class ROUTE extends DefineElement{
    constructor(node: VirtualDom,module:Module){
        //默认标签为a
        if(!node.hasProp('tag')){
            node.setProp('tag','a');
        }
        super(node,module);
        //条件
        const cond = node.getProp('path');
        if (!cond) {
            throw new NError('itemnotempty', NodomMessage.TipWords['element'], 'ROUTE', 'path');
        }
        node.addDirective(new Directive('route',<string>cond));
    }
}

/**
 * 路由容器
 * @remarks
 * router指令标签，用`<router /> 代替 x-router`
 */
class ROUTER extends DefineElement{
    constructor(node: VirtualDom,module:Module){
        super(node,module);
        node.addDirective(new Directive('router',null));
    }
}

/**
 * Teleport 元素
 * @remarks
 * 用 `<Teleport to="#target">...</Teleport>` 把内容移动到其它 DOM 容器
 */
class KEEPALIVE extends DefineElement{
    constructor(node: VirtualDom,module:Module){
        super(node,module);
        const style = node.getProp('style');
        if(typeof style === 'string' && style.trim()){
            if(!/display\s*:/.test(style)){
                node.setProp('style', `${style};display:contents`);
            }
        }else if(style === undefined){
            node.setProp('style', 'display:contents');
        }
        const keepAliveValue = {
            disabled: node.hasProp('disabled') ? node.getProp('disabled') : false,
            exclude: node.hasProp('exclude') ? node.getProp('exclude') : undefined,
            include: node.hasProp('include') ? node.getProp('include') : undefined,
            max: node.hasProp('max') ? node.getProp('max') : undefined,
            scopeKey: node.key
        };
        node.delProp('disabled');
        node.delProp('exclude');
        node.delProp('include');
        node.delProp('max');
        for(const child of node.children || []){
            if(child.hasDirective('module')){
                child.addDirective(new Directive('keepalive', keepAliveValue as any));
            }
        }
    }
}

class TRANSITION extends DefineElement{
    constructor(node: VirtualDom,module:Module){
        super(node,module);
        const style = node.getProp('style');
        if(typeof style === 'string' && style.trim()){
            if(!/display\s*:/.test(style)){
                node.setProp('style', `${style};display:contents`);
            }
        }else if(style === undefined){
            node.setProp('style', 'display:contents');
        }
        const transitionValue = {
            duration: node.getProp('duration'),
            enterActiveClass: node.getProp('enter-active-class'),
            enterDuration: node.getProp('enter-duration'),
            enterFromClass: node.getProp('enter-from-class'),
            enterToClass: node.getProp('enter-to-class'),
            leaveActiveClass: node.getProp('leave-active-class'),
            leaveDuration: node.getProp('leave-duration'),
            leaveFromClass: node.getProp('leave-from-class'),
            leaveToClass: node.getProp('leave-to-class'),
            moveClass: node.getProp('move-class'),
            moveDuration: node.getProp('move-duration'),
            name: node.getProp('name')
        };
        [
            'duration',
            'enter-active-class',
            'enter-duration',
            'enter-from-class',
            'enter-to-class',
            'leave-active-class',
            'leave-duration',
            'leave-from-class',
            'leave-to-class',
            'move-class',
            'move-duration',
            'name'
        ].forEach(propName => node.delProp(propName));
        for(const child of node.children || []){
            if(child.tagName || child.children?.length){
                child.addDirective(new Directive('transition', transitionValue as any));
            }
        }
    }
}

class TRANSITIONGROUP extends DefineElement{
    constructor(node: VirtualDom,module:Module){
        super(node,module);
        const style = node.getProp('style');
        if(typeof style === 'string' && style.trim()){
            if(!/display\s*:/.test(style)){
                node.setProp('style', `${style};display:contents`);
            }
        }else if(style === undefined){
            node.setProp('style', 'display:contents');
        }
        const transitionValue = {
            duration: node.getProp('duration'),
            enterActiveClass: node.getProp('enter-active-class'),
            enterDuration: node.getProp('enter-duration'),
            enterFromClass: node.getProp('enter-from-class'),
            enterToClass: node.getProp('enter-to-class'),
            group: true,
            leaveActiveClass: node.getProp('leave-active-class'),
            leaveDuration: node.getProp('leave-duration'),
            leaveFromClass: node.getProp('leave-from-class'),
            leaveToClass: node.getProp('leave-to-class'),
            moveClass: node.getProp('move-class'),
            moveDuration: node.getProp('move-duration'),
            name: node.getProp('name')
        };
        [
            'duration',
            'enter-active-class',
            'enter-duration',
            'enter-from-class',
            'enter-to-class',
            'leave-active-class',
            'leave-duration',
            'leave-from-class',
            'leave-to-class',
            'move-class',
            'move-duration',
            'name'
        ].forEach(propName => node.delProp(propName));
        for(const child of node.children || []){
            if(child.tagName || child.children?.length){
                child.addDirective(new Directive('transition', transitionValue as any));
            }
        }
    }
}

class TELEPORT extends DefineElement{
    constructor(node: VirtualDom,module:Module){
        super(node,module);
        const style = node.getProp('style');
        if(typeof style === 'string' && style.trim()){
            if(!/display\s*:/.test(style)){
                node.setProp('style', `${style};display:contents`);
            }
        }else if(style === undefined){
            node.setProp('style', 'display:contents');
        }
        node.addDirective(new Directive('teleport',null));
    }
}

DefineElementManager.add([KEEPALIVE]);
DefineElementManager.add([TRANSITION]);
DefineElementManager.add([TRANSITIONGROUP]);

//添加到自定义元素管理器
DefineElementManager.add([MODULE,FOR,RECUR,IF,ELSE,ELSEIF,ENDIF,SHOW,SLOT,ROUTE,ROUTER,TELEPORT]);
