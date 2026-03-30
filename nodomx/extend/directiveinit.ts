import {
    Model,
    Module,
    ModuleFactory,
    NError,
    NEvent,
    Nodom,
    NodomMessage,
    RenderedDom,
    Renderer,
    Util
} from "@nodomx/core";
import type { KeepAliveConfig } from "@nodomx/shared";

type TeleportRenderedDom = RenderedDom & {
    keepAlive?: boolean | KeepAliveConfig;
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

/**
     * 指令类型初始化
     * @remarks
     * 每个指令类型都有一个名字、处理函数和优先级，处理函数`不能用箭头函数`
     * 处理函数在渲染时执行，包含两个参数 module(模块)、dom(目标虚拟dom)
     * 处理函数的this指向指令对象
     * 处理函数的返回值`true`表示继续，`false`表示后续指令不再执行，同时该节点不加入渲染树 
     */
(function () {
    /**
     * module 指令
     * 用于指定该元素为模块容器，表示子模块
     * 用法 x-module='模块类名'
     */
    Nodom.createDirective(
        'module',
        function (module: Module, dom: RenderedDom) {
            if(!this.value){
                return false;
            }
            const requestedClass = typeof this.value === 'string'
                ? ModuleFactory.getClass(this.value)
                : typeof this.value === 'function'
                    ? this.value
                    : undefined;
            let m = <Module>module.objectManager.getDomParam(dom.key,'$savedModule');
            if(m && requestedClass && m.constructor !== requestedClass){
                m.destroy();
                module.objectManager.removeDomParam(dom.key,'$savedModule');
                m = undefined;
            }
            if(!m){
                m = ModuleFactory.get(this.value) as Module;
                if (!m) {
                    return false;
                }
                module.objectManager.setDomParam(dom.key,'$savedModule',m);
            }
            module.addChild(m);
            //保存到dom上，提升渲染性能
            dom.childModuleId = m.id;
            if(!dom.props){
                dom.props = {role:m.constructor.name}
            }else{
                dom.props['role'] = m.constructor.name;
            }
            //设置props
            let o = {};
            for (const p of Object.keys(dom.props)) {
                const v = dom.props[p];
                if (p[0] === '$') { //数据
                    if (!o['$data']) {
                        o['$data'] = {};
                    }
                    o['$data'][p.substring(1)] = v;
                    //删除属性
                    delete dom.props[p];
                } else {
                    o[p] = v;
                }
            }
            //传递给模块
            m.setProps(o, dom);
            return true;
        },
        8
    );

    Nodom.createDirective(
        'keepalive',
        function (module: Module, dom: RenderedDom) {
            const keepAliveConfig = resolveKeepAliveConfig(module, dom, this.value);
            (dom as TeleportRenderedDom).keepAlive = keepAliveConfig;
            const childModule = dom.childModuleId
                ? ModuleFactory.get(dom.childModuleId)
                : module.objectManager.getDomParam(dom.key,'$savedModule');
            (childModule as Module & { setKeepAliveManaged?: (managed: boolean) => void } | undefined)
                ?.setKeepAliveManaged?.(isKeepAliveDirectiveActive(keepAliveConfig));
            return true;
        },
        9
    );

    Nodom.createDirective(
        'transition',
        function (module: Module, dom: RenderedDom) {
            (dom as TeleportRenderedDom).transition = resolveTransitionConfig(module, dom, this.value);
            return true;
        },
        9
    );

    /**
     *  model指令
     */
    Nodom.createDirective(
        'model',
        function (module: Module, dom: RenderedDom) {
            const model: Model = module.get(dom.model,this.value);
            if (model) {
                dom.model = model;
            }
            return true;
        },
        1
    );

    /**
     * 指令名 repeat
     * 描述：重复指令
     */
    Nodom.createDirective(
        'repeat',
        function (module: Module, dom: RenderedDom) {
            const rows = this.value as unknown[];
            // 无数据不渲染
            if (!Util.isArray(rows) || rows.length === 0) {
                return false;
            }
            const src = dom.vdom;
            //索引名
            const idxName = src.getProp('index');
            const parent = dom.parent;
            //禁用该指令
            this.disabled = true;
            //避免在渲染时对src设置了model，此处需要删除
            for(let i = 0; i < rows.length; i++) {
                const row = rows[i] as Record<string, unknown> | undefined;
                if(!row){
                    continue;
                }
                if (idxName && typeof row === 'object') {
                    row[<string>idxName] = i;
                }
                const renderKey = typeof row === 'object' && row && '__key' in row
                    ? row.__key as string | number
                    : i;
                const d = Renderer.renderDom(module, src as any, row, parent, renderKey);
                //删除index属性
                if (idxName) {
                    delete d.props['index'];
                }
            }
            //启用该指令
            this.disabled = false;
            return false;
        },
        2
    );

    /**
     * 递归指令
     * 作用：在dom内部递归，用于具有相同数据结构的节点递归生成
     * 递归指令不允许嵌套
     * name表示递归名字，必须与内部的recur标签的ref保持一致，名字默认为default
     * 典型模版
     * ```
     * <recur name='r1'>
     *      <element1>...</element1>
     *      <element2>...</element2>
     *      <recur ref='r1' />
     * </recur>
     * ```
     */
    Nodom.createDirective(
        'recur',
        function (module: Module, dom: RenderedDom) {
            const src = dom.vdom;
            //当前节点是递归节点存放容器
            if (dom.props.hasOwnProperty('ref')) {
                //如果出现在repeat中，src为单例，需要在使用前清空子节点，避免沿用上次的子节点
                src.children = [];
                //递归存储名
                const name = '$recurs.' + (dom.props['ref'] || 'default');
                const node = module.objectManager.get(name);
                if (!node) {
                    return true;
                }
                const model = dom.model;
                const cond = node.getDirective('recur');
                const m = model[cond.value];
                //不存在子层数组，不再递归
                if (!m) {
                    return true;
                }
                //克隆，后续可以继续用
                const node1 = node.clone();
                node1.removeDirective('recur');
                dom.children ||= [];
                if (!Array.isArray(m)) {  //非数组recur
                    Renderer.renderDom(module,node1,m,dom,m.__key);
                }else{  //数组内recur，依赖repeat得到model，repeat会取一次数组元素，所以需要dom model
                    Renderer.renderDom(module,node1,model,dom,m['__key']);
                }
                //删除ref属性
                delete dom.props['ref'];
            } else { //递归节点
                const data = dom.model[this.value];
                if (!data) {
                    return true;
                }
                //递归名，默认default
                const name = '$recurs.' + (dom.props['name'] || 'default');
                //删除name属性
                delete dom.props['name'];
                //保存递归定义的节点
                if (!module.objectManager.get(name)) {
                    module.objectManager.set(name, src);
                }
            }
            return true;
        },
        2
    );

    /**
     * 指令名 if
     * 描述：条件指令
     */
    Nodom.createDirective('if',
        function (module: Module, dom: RenderedDom) {
            if(!dom.parent){
                return;
            }
            module.objectManager.setDomParam(dom.parent.key, '$if', this.value);
            return this.value;
        },
        5
    );

    /**
     * 指令名 else
     * 描述：else指令
     */
    Nodom.createDirective(
        'else',
        function (module: Module, dom: RenderedDom) {
            if(!dom.parent){
                return;
            }
            return  !module.objectManager.getDomParam(dom.parent.key, '$if');
        },
        5
    );

    /**
     * elseif 指令
     */
    Nodom.createDirective('elseif',
        function (module: Module, dom: RenderedDom) {
            if(!dom.parent){
                return;
            }
            const v = module.objectManager.getDomParam(dom.parent.key, '$if');
            if (v === true) {
                return false;
            } else {
                if (!this.value) {
                    return false;
                } else {
                    module.objectManager.setDomParam(dom.parent.key, '$if', true);
                }
            }
            return true;
        },
        5
    );

    /**
     * elseif 指令
     */
    Nodom.createDirective(
        'endif',
        function (module: Module, dom: RenderedDom) {
            if(!dom.parent){
                return;
            }
            module.objectManager.removeDomParam(dom.parent.key, '$if');
            //endif 不显示
            return false;
        },
        5
    );

    /**
     * 指令名 show
     * 描述：显示指令
     */
    Nodom.createDirective(
        'show',
        function (module: Module, dom: RenderedDom) {
            //show指令参数 {origin:通过style设置的初始display属性,rendered:是否渲染过}
            let showParam = module.objectManager.getDomParam(dom.key, '$show');
            //为false且未渲染过，则不渲染
            if(!this.value && (!showParam || !showParam['rendered'])){
                return false;
            }
            
            if(!showParam){
                showParam = {};
                module.objectManager.setDomParam(dom.key, '$show',showParam);
            }
            let style = dom.props['style'] as string | undefined;
            const reg =  /display\s*\:[\w\-]+/;
            let regResult: RegExpExecArray | null;
            let display: string | undefined;
            if(style){
                regResult = reg.exec(style);
                //保存第一个style display属性
                if(regResult !== null){
                    const ra = regResult[0].split(':');
                    display = ra[1].trim();
                    //保存第一个display属性
                    if(!showParam['origin'] && display !== 'none'){
                        showParam['origin'] = display;
                    }
                }
            }

            // 渲染标识，value为false且尚未进行渲染，则不渲染
            if(!this.value){  
                if(style){
                    if(display){
                        //把之前的display替换为none
                        if(display!=='none'){
                            style = style.substring(0,regResult.index) + 'display:none' + style.substring(regResult.index + regResult[0].length);
                        }
                    }else{
                        style += ';display:none';
                    }
                }else{
                    style = 'display:none';
                }
            }else{
                //设置渲染标志
                showParam['rendered'] = true;
                if(display === 'none'){
                    if(style){
                        if(showParam['origin']){
                            style = style.substring(0,regResult.index) + 'display:' + showParam['origin'] + style.substring(regResult.index + regResult[0].length);
                        }else{
                            style = style.substring(0,regResult.index) + style.substring(regResult.index + regResult[0].length);
                        }
                    }
                }
            }
            if(style){
                dom.props['style'] = style;
            }
            return true;
        },
        5
    );
    
    /**
     * 指令名 field
     * 描述：字段指令
     */
    Nodom.createDirective('field',
        function (module: Module, dom: RenderedDom) {
            dom.assets ||= {};
            //修正staticnum
            if(dom.staticNum === 0){
                dom.staticNum = 1;
            }
            const dataValue = module.get(dom.model,this.value);
            if(dom.tagName === 'select'){
                dom.props['value'] = dataValue;
                //延迟设置value，避免option尚未渲染
                setTimeout(()=>{
                    const el = <HTMLSelectElement>dom.node;
                    if(el){
                        el.value = <string>dataValue;
                    }
                },0);
            }else if(dom.tagName === 'input'){
                switch(dom.props['type']){
                    case 'radio':
                        const value = dom.props['value'];
                        dom.props['name'] = this.value;
                        if (dataValue == value) {
                            dom.props['checked'] = 'checked';
                            dom.assets['checked'] = true;
                        } else {
                            delete dom.props['checked'];
                            dom.assets['checked'] = false;
                        }
                        break;
                    case 'checkbox':
                        //设置状态和value
                        const yv = dom.props['yes-value'];
                        //当前值为yes-value
                        if (dataValue == yv) {
                            dom.props['value'] = yv;
                            dom.assets['checked'] = true;
                        } else { //当前值为no-value
                            dom.props['value'] = dom.props['no-value'];
                            dom.assets['checked'] = false;
                        }
                        break;
                    default:
                        const v = (dataValue !== undefined && dataValue !== null) ? dataValue : '';
                        dom.props['value'] = v;
                        dom.assets['value'] = v;

                }
            }else{
                const v = (dataValue !== undefined && dataValue !== null) ? dataValue : '';
                dom.props['value'] = v;
                dom.assets['value'] = v;
            }
            //设置dom参数，避免二次添加事件
            if (!module.objectManager.getDomParam(dom.vdom.key,'$addedFieldEvent')) {
                module.objectManager.setDomParam(dom.vdom.key,'$addedFieldEvent',true);
                const event = new NEvent(module, 'change',
                    (model, dom)=> {
                        const el = dom.node as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
                        if (!el) {
                            return;
                        }
                        const type = dom.props['type'];
                        let field = this.value;
                        let v = 'value' in el ? el.value : undefined;
                        //根据选中状态设置checkbox的value
                        if (type === 'checkbox') {
                            if (dom.props['yes-value'] == v) {
                                v = dom.props['no-value'] as string | undefined;
                            } else {
                                v = dom.props['yes-value'] as string | undefined;
                            }
                        } else if (type === 'radio') {
                            if (!('checked' in el) || !el.checked) {
                                v = undefined;
                            }
                        }
                        //修改字段值,需要处理.运算符
                        module.set(model,field,v);
                    }
                );
                dom.vdom.addEvent(event,0);
            }
            return true;
        },
        10
    );

    /**
     * route指令
     */
    Nodom.createDirective('route',
        function (module: Module, dom: RenderedDom) {
            if(!Nodom['$Router']){
                throw new NError('uninit',NodomMessage.TipWords.route);
            }
            //a标签需要设置href
            if (dom.tagName === 'a') {
                dom.props['href'] = 'javascript:void(0)';
            }
            const v = this.value;
            dom.props['path'] = (v === undefined || v === null || v === '' || typeof v === 'string' && v.trim() === '')?'':v;
            //有激活属性
            const acName = dom.props['active'] as string | undefined;
            //添加激活model
            if(acName){
                const router = Nodom['$Router'];
                router.addActiveDom(module,dom);
                //如果有active属性，尝试激活路径
                if (dom.model && (dom.model as Record<string, unknown>)[acName]) {
                    router.activePath(this.value);
                }
            }
            //添加click事件,避免重复创建事件对象，创建后缓存
            if(!module.objectManager.getDomParam(dom.vdom.key,'$addedRouteEvent')){
                module.objectManager.setDomParam(dom.vdom.key,'$addedRouteEvent',true);
                const event = new NEvent(module, 'click',null,
                    function (model, d) {
                        const path = d.props['path'];
                        if (Util.isEmpty(path)) {
                            return;
                        }
                        Nodom['$Router'].go(path);
                    }
                );
                dom.vdom.addEvent(event);
            }
            return true;
        },
        10
    );

    /**
     * 增加router指令
     */
    Nodom.createDirective('router',
        function (module: Module, dom: RenderedDom) {
            const router = Nodom['$Router'];
            if(!router){
                throw new NError('uninit',NodomMessage.TipWords.route);
            }
            router.registRouter(module,dom);
            return true;
        },
        10
    );

    /**
     * teleport 指令
     */
    Nodom.createDirective('teleport',
        function (module: Module, dom: RenderedDom) {
            const teleportDom = dom as TeleportRenderedDom;
            teleportDom.teleportTarget = dom.props?.['to'] ?? dom.props?.['target'];
            teleportDom.teleportDisabled = resolveTeleportDisabled(dom.props?.['disabled']);
            if(teleportDom.props){
                delete teleportDom.props['to'];
                delete teleportDom.props['target'];
                delete teleportDom.props['disabled'];
            }
            return true;
        },
        10
    );

    /**
     * 插头指令
     * 用于模块中，可实现同名替换
     */
    Nodom.createDirective('slot',
        function (module: Module, dom: RenderedDom) {
            this.value ||= 'default';
            const mid = dom.parent.childModuleId;
            //父dom有module指令，表示为替代节点，替换子模块中的对应的slot节点；否则为子模块定义slot节点
            if (mid) {
                const m = ModuleFactory.get(mid);
                //子模块不存在则不处理
                if(!m){
                    return false;
                }
                const previousSlot = m.slots.get(this.value);
                m.slots.set(this.value,dom);
                dom.slotModuleId = mid;
                //保持key带slot标识
                if(!dom.vdom.slotModuleId){
                    dom.key += 's';
                    updateKey(dom.vdom , 's');
                }
                if(previousSlot !== dom){
                    m.markDirty?.(`slots.${this.value}`);
                    Renderer.add(m);
                }
                //innerrender，此次不渲染
                if(dom.vdom.props?.has('innerrender')){
                    return false;
                }
                return true;

                /**
                 * 更新虚拟dom key，避免在新模块中重复
                 * @param vdom -    虚拟dom
                 * @param key -     附加key
                 */
                function updateKey(vdom,key){
                    vdom.key += key;
                    vdom.slotModuleId = mid;
                    if(vdom.children){
                        for(const c of vdom.children){
                            updateKey(c,key);
                        }
                    }
                }
            } else { //源slot节点
                const sdom = module.slots.get(this.value);
                if(sdom){
                    if(dom.vdom.hasProp('innerrender')){  //内部数据渲染
                        if(sdom.vdom.children && dom.parent){
                            const slotModel = createInnerRenderSlotModel(dom.model, sdom.model);
                            for(let c of sdom.vdom.children){
                                Renderer.renderDom(module,c as any,slotModel as any,dom.parent,dom.key);
                            }
                        }
                    }else{ //替换为存储的已渲染节点
                        if(sdom?.children && dom.parent){ 
                            for(let c of sdom.children){
                                dom.parent.children.push(c);
                                c.parent  = dom.parent;
                            }
                        }
                    }
                }
                return false;
           }
        },
        5
    );
}());

function createInnerRenderSlotModel(innerModel: unknown, outerModel: unknown){
    if(!innerModel || typeof innerModel !== 'object'){
        return outerModel || innerModel;
    }
    if(!outerModel || typeof outerModel !== 'object'){
        return innerModel;
    }
    return new Proxy(innerModel as object, {
        get(target, key, receiver){
            if(Reflect.has(target, key)){
                return Reflect.get(target, key, receiver);
            }
            return Reflect.get(outerModel as object, key, outerModel);
        },
        has(target, key){
            return Reflect.has(target, key) || Reflect.has(outerModel as object, key);
        },
        ownKeys(target){
            return Array.from(new Set([
                ...Reflect.ownKeys(outerModel as object),
                ...Reflect.ownKeys(target)
            ]));
        },
        getOwnPropertyDescriptor(target, key){
            return Reflect.getOwnPropertyDescriptor(target, key)
                || Reflect.getOwnPropertyDescriptor(outerModel as object, key)
                || {
                    configurable: true,
                    enumerable: true,
                    writable: true,
                    value: undefined
                };
        },
        set(target, key, value, receiver){
            if(Reflect.has(target, key) || !Reflect.has(outerModel as object, key)){
                return Reflect.set(target, key, value, receiver);
            }
            return Reflect.set(outerModel as object, key, value);
        }
    });
}

function resolveTeleportDisabled(value: unknown): boolean {
    if(typeof value === 'string'){
        const normalized = value.trim().toLowerCase();
        return normalized === '' || normalized === 'true' || normalized === '1';
    }
    return value === true;
}

function resolveKeepAliveEnabled(value: unknown): boolean {
    if(value === undefined || value === null){
        return true;
    }
    if(typeof value === 'string'){
        const normalized = value.trim().toLowerCase();
        return !(normalized === 'false' || normalized === '0');
    }
    return value !== false;
}

function resolveKeepAliveConfig(module: Module, dom: RenderedDom, value: unknown): KeepAliveConfig {
    if(value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)){
        return {
            disabled: !resolveKeepAliveEnabled(value),
            scopeKey: dom.key
        };
    }
    const config = value as Record<string, unknown>;
    return {
        disabled: resolveKeepAliveDisabled(resolveDirectiveValue(module, dom, config.disabled)),
        exclude: normalizeKeepAlivePattern(resolveDirectiveValue(module, dom, config.exclude)),
        include: normalizeKeepAlivePattern(resolveDirectiveValue(module, dom, config.include)),
        max: resolveKeepAliveMax(resolveDirectiveValue(module, dom, config.max)),
        scopeKey: typeof config.scopeKey === 'number' || typeof config.scopeKey === 'string'
            ? config.scopeKey
            : dom.key
    };
}

function resolveKeepAliveDisabled(value: unknown): boolean {
    if(value === undefined || value === null){
        return false;
    }
    return resolveKeepAliveEnabled(value);
}

function normalizeKeepAlivePattern(value: unknown): KeepAliveConfig['include'] | undefined {
    if(value instanceof RegExp){
        return value;
    }
    if(Array.isArray(value)){
        const normalized = value
            .map(item => String(item ?? '').trim())
            .filter(item => item.length > 0);
        return normalized.length > 0 ? normalized : undefined;
    }
    if(typeof value === 'string'){
        const normalized = value.trim();
        return normalized ? normalized : undefined;
    }
    return undefined;
}

function isKeepAliveDirectiveActive(value: boolean | KeepAliveConfig | undefined): boolean {
    if(value === undefined || value === false){
        return false;
    }
    if(value === true){
        return true;
    }
    return !value.disabled;
}

function resolveKeepAliveMax(value: unknown): number | undefined {
    if(typeof value === 'number' && Number.isFinite(value)){
        return Math.max(0, Math.floor(value));
    }
    if(typeof value === 'string' && value.trim()){
        const parsed = Number(value.trim());
        if(Number.isFinite(parsed)){
            return Math.max(0, Math.floor(parsed));
        }
    }
    return undefined;
}

function resolveTransitionConfig(module: Module, dom: RenderedDom, value: unknown) {
    if(!value || typeof value !== 'object'){
        return {
            name: 'nd'
        };
    }
    const config = value as Record<string, unknown>;
    return {
        duration: resolveTransitionDuration(resolveDirectiveValue(module, dom, config.duration)),
        enterActiveClass: normalizeTransitionClass(resolveDirectiveValue(module, dom, config.enterActiveClass)),
        enterDuration: resolveTransitionDuration(resolveDirectiveValue(module, dom, config.enterDuration)),
        enterFromClass: normalizeTransitionClass(resolveDirectiveValue(module, dom, config.enterFromClass)),
        enterToClass: normalizeTransitionClass(resolveDirectiveValue(module, dom, config.enterToClass)),
        group: resolveDirectiveValue(module, dom, config.group) === true,
        leaveActiveClass: normalizeTransitionClass(resolveDirectiveValue(module, dom, config.leaveActiveClass)),
        leaveDuration: resolveTransitionDuration(resolveDirectiveValue(module, dom, config.leaveDuration)),
        leaveFromClass: normalizeTransitionClass(resolveDirectiveValue(module, dom, config.leaveFromClass)),
        leaveToClass: normalizeTransitionClass(resolveDirectiveValue(module, dom, config.leaveToClass)),
        moveClass: normalizeTransitionClass(resolveDirectiveValue(module, dom, config.moveClass)),
        moveDuration: resolveTransitionDuration(resolveDirectiveValue(module, dom, config.moveDuration)),
        name: normalizeTransitionName(resolveDirectiveValue(module, dom, config.name))
    };
}

function resolveDirectiveValue(module: Module, dom: RenderedDom, value: unknown): unknown {
    if(value && typeof value === 'object' && typeof (value as { val?: unknown }).val === 'function'){
        return (value as { val: (module: Module, model: unknown) => unknown }).val(module, dom.model);
    }
    return value;
}

function normalizeTransitionName(value: unknown): string {
    if(typeof value === 'string' && value.trim()){
        return value.trim();
    }
    return 'nd';
}

function normalizeTransitionClass(value: unknown): string | undefined {
    if(typeof value !== 'string'){
        return undefined;
    }
    const normalized = value.trim();
    return normalized ? normalized : undefined;
}

function resolveTransitionDuration(value: unknown): number | undefined {
    if(typeof value === 'number' && Number.isFinite(value)){
        return Math.max(0, value);
    }
    if(typeof value === 'string' && value.trim()){
        const parsed = Number(value.trim());
        if(Number.isFinite(parsed)){
            return Math.max(0, parsed);
        }
    }
    return undefined;
}
