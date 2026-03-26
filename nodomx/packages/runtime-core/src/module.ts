import { Compiler } from "./compiler";
import { CssManager } from "./cssmanager";
import { Model } from "./model";
import { ModuleFactory } from "./modulefactory";
import { ObjectManager } from "./objectmanager";
import { Renderer } from "./renderer";
import { Util } from "./util";
import { DiffTool } from "./difftool";
import { EModuleState, RenderedDom, UnknownMethod } from "./types";
import { EventFactory } from "./eventfactory";
import { DomManager } from "./dommanager";
import { ModelManager } from "./modelmanager";
import { Watcher } from "./wacher";
import {
    cloneStateValue,
    isComputed,
    isReactive,
    isRef,
    toRaw,
    withCurrentScope
} from "@nodomx/reactivity";
import type { AppContext, InjectionKey } from "./app";

type ModuleHotSnapshot = {
    children: ModuleHotSnapshot[];
    hotId: string;
    state: Record<string, unknown>;
};

export class Module {
    
    public id: number;

    
    public model:Model;

    
    public children: Array<Module> = [];

    
    private parentId: number;

    
    public state: EModuleState;

    
    public modelManager:ModelManager;
    
    
    public objectManager:ObjectManager;

    
    public domManager:DomManager;

    
    public eventFactory:EventFactory;

    
    public srcDom:RenderedDom;

    
    public props:object;

    public appContext?:AppContext;

    private provides?:Map<InjectionKey, unknown>;

    
    public modules: unknown[];

    
    public excludedProps:string[];

    
    private oldTemplate:string;

    
    public slots:Map<string,RenderedDom> = new Map();

    
    public cssRules:string[];

    
    private compositionCleanups:Array<() => void> = [];

    
    private compositionHooks:Map<string, UnknownMethod[]> = new Map();

    
    private setupState:Record<string, unknown>;

    
    constructor(id?:number) {
        this.id = id || Util.genId();

        this.domManager = new DomManager(this);
        this.objectManager = new ObjectManager(this);
        this.eventFactory = new EventFactory(this);
        this.appContext = ModuleFactory.getAppContext();

        ModuleFactory.add(this);
    }

    
    public init(){
        this.state = EModuleState.INIT;

        if(Array.isArray(this.modules)){
            for (const cls of this.modules) {
                ModuleFactory.addClass(cls);
            }
            delete this.modules;
        }
        this.appContext = this.appContext || ModuleFactory.getAppContext();
        this.applyGlobalProperties();

        this.model = new Model(this.data()||{} , this);
        this.initSetupState();
        this.doModuleEvent('onInit');
    }

    
    public template(props?:object):string{
        return null;
    }

    
    public data():object{
        return {};
    }

    
    public setup(): Record<string, unknown> | void {
        return;
    }
    
    
    public render(): boolean {

        if(this !== ModuleFactory.getMain() && (!this.srcDom || this.state === EModuleState.UNMOUNTED )){
            return;
        }

        const firstRender = this.oldTemplate===undefined;

        let templateStr = this.template(this.props);
        if(!templateStr){
            return;
        }
        templateStr = templateStr.trim();
        if(templateStr === ''){
            return;
        }

        if(templateStr !== this.oldTemplate){
            this.oldTemplate = templateStr;
            this.compile(templateStr);
        }

        if(!this.domManager.vdomTree){
            return;
        }

        if(firstRender){
            this.doModuleEvent('onBeforeFirstRender');
        }

        this.doModuleEvent('onBeforeRender');

        const oldTree = this.domManager.renderedTree;

        const root = Renderer.renderDom(this,this.domManager.vdomTree,this.model);
        this.domManager.renderedTree = root;

        this.doModuleEvent('onRender');

        if(firstRender){
            this.doModuleEvent('onFirstRender');    
        }
        

        if(!this.domManager.renderedTree){
            this.unmount();
            return;
        }

        if(this.state === EModuleState.MOUNTED){
            if(oldTree && this.model){

                const changeDoms = DiffTool.compare(this.domManager.renderedTree,oldTree);

                if(changeDoms.length>0){

                    this.doModuleEvent('onBeforeUpdate');
                    Renderer.handleChangedDoms(this,changeDoms);

                    this.doModuleEvent('onUpdate');
                }
            }
        }else { 
            this.mount();
        }
    }

    
    public addChild(module: Module) {
        if (!this.children.includes(module)) {
            this.children.push(module);
            module.parentId = this.id;
        }
    }

    
    public removeChild(module: Module) {
        const ind=this.children.indexOf(module);
        if (ind !== -1) {
            module.unmount();
            this.children.splice(ind,1);
        }
    }

    
    public active() {
        if(this.state === EModuleState.UNMOUNTED){
            this.state = EModuleState.INIT;
        }
        Renderer.add(this);
    }

    
    public mount(){

        if(this !== ModuleFactory.getMain() && !this.srcDom?.node?.parentElement){
            return;
        }

        this.doModuleEvent('onBeforeMount');

        const rootEl = new DocumentFragment();
        const el = Renderer.renderToHtml(this,this.domManager.renderedTree,rootEl);

        if(this === ModuleFactory.getMain()){
            Renderer.getRootEl().appendChild(el);
        }else if(this.srcDom?.node?.parentElement){ 
            Util.insertAfter(el,this.srcDom.node);
        }
        

        this.doModuleEvent('onMount');
        this.state = EModuleState.MOUNTED;
    }

    
    public unmount(passive?:boolean){

        if (this.state !== EModuleState.MOUNTED || ModuleFactory.getMain() === this) {
            return;
        }

        Renderer.remove(this);

        this.doModuleEvent('onBeforeUnMount');

        this.eventFactory.clear();

        this.domManager.renderedTree = null;
        

        if(passive){
            this.state = EModuleState.INIT;
        }else{
            this.state = EModuleState.UNMOUNTED;
        }

        for(const m of this.children){
            m.unmount(true);
        }

        if(this.srcDom.node?.parentElement){

            if(this.srcDom.node.nextSibling && !(this.srcDom.node.nextSibling instanceof Comment)){
                this.srcDom.node.parentElement.removeChild(this.srcDom.node.nextSibling);
            }

            if(passive){
                this.srcDom.node.parentElement.removeChild(this.srcDom.node);
            }
        }

        this.doModuleEvent('onUnMount');
    }

    
    public destroy(){
        Renderer.remove(this);
        this.unmount(true);
        for(const m of this.children){
            m.destroy();
        }
        this.eventFactory.clear();
        if(this.domManager?.renderedTree?.node?.parentElement){
            this.domManager.renderedTree.node.parentElement.removeChild(this.domManager.renderedTree.node);
        }
        this.domManager.renderedTree = null;
        this.clearCompositionCleanups();

        CssManager.clearModuleRules(this);

        this.objectManager.clearAllDomParams();

        ModuleFactory.remove(this.id);
    } 

    
    public captureSetupState(): Record<string, unknown> {
        const snapshot: Record<string, unknown> = {};
        if(!this.setupState){
            return snapshot;
        }
        for(const key of Object.keys(this.setupState)){
            const binding = this.setupState[key];
            if(typeof binding === 'function' || isComputed(binding)){
                continue;
            }
            if(isRef(binding)){
                snapshot[key] = cloneStateValue(binding.value);
            }else if(isReactive(binding)){
                snapshot[key] = cloneStateValue(toRaw(binding));
            }else{
                snapshot[key] = cloneStateValue(binding);
            }
        }
        return snapshot;
    }

    
    public captureHotSnapshot(): ModuleHotSnapshot {
        return {
            children: this.children.map(item => item.captureHotSnapshot()),
            hotId: this.getHotId(),
            state: this.captureSetupState()
        };
    }

    
    public applyHotSnapshot(snapshot: ModuleHotSnapshot): void {
        if(!snapshot || snapshot.hotId !== this.getHotId()){
            return;
        }
        this.applySetupState(snapshot.state);
        const childQueues = new Map<string, ModuleHotSnapshot[]>();
        for(const childSnapshot of snapshot.children || []){
            const arr = childQueues.get(childSnapshot.hotId) || [];
            arr.push(childSnapshot);
            childQueues.set(childSnapshot.hotId, arr);
        }
        for(const child of this.children){
            const queue = childQueues.get(child.getHotId());
            const nextSnapshot = queue?.shift();
            if(nextSnapshot){
                child.applyHotSnapshot(nextSnapshot);
            }
        }
    }

    
    public getParent(): Module {
        if (this.parentId) {
            return ModuleFactory.get(this.parentId);
        }
    }

    
    public doModuleEvent(eventName: string):boolean{
        const foo = this[eventName];
        let result:boolean;
        if(foo && typeof foo==='function'){
            result = foo.apply(this,[this.model]);
        }
        this.runCompositionHooks(eventName);
        return result;
    }

    
    public setProps(props:object,dom:RenderedDom){
        if(!props){
            return;
        }
        const dataObj = props['$data'];
        delete props['$data'];

        if(dataObj){
            for(const d of Object.keys(dataObj)){
                this.model[d] = dataObj[d];

            }
        }

        this.srcDom = dom;

        let change:boolean = false;
        if(!this.props){
            change = true;
        }else{
            for(const k of Object.keys(props)){
                if(props[k] !== this.props[k]){
                    change = true;
                }
            }
        }

        if(change && this.state === EModuleState.MOUNTED){
            Renderer.add(this);
        }

        this.props = props;
    }

    
    private compile(templateStr:string){
        this.children = [];

        CssManager.clearModuleRules(this);

        this.objectManager.clearAllDomParams();
        
        this.eventFactory.clear();
        this.domManager.vdomTree = new Compiler(this).compile(templateStr);
        if(!this.domManager.vdomTree){
            return;
        }

        const root = this.domManager.vdomTree;
        if(this.srcDom?.events){
            if(root.events){
                root.events = root.events.concat(this.srcDom.events);
            }else{
                root.events = this.srcDom.events;
            }
        }

        this.doModuleEvent('onCompile');
    }

    
    public setExcludeProps(props:string[]){
        this.excludedProps = props;
    }

    
    public getModule(name:string,attrs?:object,deep?:boolean):Module{
        if(!this.children){
            return;
        }
        const cls = ModuleFactory.getClass(name);
        if(!cls){
            return;
        }
        return find(this);
        
        function find(mdl){
            for(const m of mdl.children){
                if(m.constructor === cls){
                    if(attrs){  

                        let matched:boolean = true;
                        for(const k of Object.keys(attrs)){
                            if(!m.props || m.props[k] !== attrs[k]){
                                matched = false;
                                break;
                            }
                        }
                        if(matched){
                            return m;
                        }
                    }else{
                        return m;
                    }
                }

                if(deep){
                    const r = find(m);
                    if(r){
                        return r;
                    }
                }
            }
        }
        
    }

    
     public getModules(className:string,attrs?:object,deep?:boolean):Module[]{
        if(!this.children){
            return;
        }
        const arr = [];
        find(this);
        return arr;

        
        function find(module:Module){
            if(!module.children){
                return;
            }
            for(const m of module.children){
                if(attrs){  

                    let matched:boolean = true;
                    for(const k of Object.keys(attrs)){
                        if(!m.props || m.props[k] !== attrs[k]){
                            matched = false;
                            break;
                        }
                    }
                    if(matched){
                        arr.push(m);
                    }
                }else{
                    arr.push(m);
                }

                if(deep){
                    find(m);
                }
            }   
        }
    }

    
    public watch(model:Model|string|string[],key:string|string[]|((m,k,ov,nv)=>void),func?:((m,k,ov,nv)=>void)){
        const tp = typeof model;
        if(tp === 'string' || Array.isArray(model)){  
            return Watcher.watch(this,this.model,<string>model,<Function>key);
        }else if(tp === 'object'){ 
            return Watcher.watch(this,model,key,func);
        }else if(tp === 'function'){ 
            return Watcher.watch(this,this.model,<Function>model);
        }
    }

    
    public set(model:Model|string,key:unknown,value?:unknown){
        if (typeof model === 'object') {
            ModelManager.set(model,<string>key,value);
        }else{
            ModelManager.set(this.model,<string>model,key);
        }
    }

    
    public get(model:Model|string, key?:string):unknown {
        if (typeof model === 'object') {
            return ModelManager.get(model,key);
        }else{
            return ModelManager.get(this.model,<string>model);
        }
    }

    
    public invokeMethod(methodName:string,...args){
        if(typeof this[methodName] === 'function'){
            return this[methodName](...args);
        }
    }

    
    public getRenderedDom(params):RenderedDom{
        return this.domManager.getRenderedDom(params);
    }
    
    
    public getNode(params):Node{
        return this.domManager.getRenderedDom(params)?.node;
    }

    
    public addCompositionHook(name:string, hook:UnknownMethod): void {
        if(typeof hook !== 'function'){
            return;
        }
        const hooks = this.compositionHooks.get(name) || [];
        hooks.push(hook);
        this.compositionHooks.set(name, hooks);
    }

    
    public provide<T>(key:InjectionKey<T>, value:T): void {
        this.provides ||= new Map();
        this.provides.set(key, value);
    }

    
    public inject<T>(key:InjectionKey<T>, defaultValue?:T): T | undefined {
        if(this.provides?.has(key)){
            return this.provides.get(key) as T;
        }
        let parent = this.getParent();
        while(parent){
            if(parent.provides?.has(key)){
                return parent.provides.get(key) as T;
            }
            parent = parent.getParent();
        }
        if(this.appContext?.provides.has(key)){
            return this.appContext.provides.get(key) as T;
        }
        return defaultValue;
    }

    
    public addCompositionCleanup(cleanup: () => void): void {
        if(typeof cleanup === 'function'){
            this.compositionCleanups.push(cleanup);
        }
    }

    
    private initSetupState(): void {
        const result = withCurrentScope(this,()=>this.setup());
        if(!result || typeof result !== 'object'){
            return;
        }
        this.setupState = result;
        for(const key of Object.keys(result)){
            const value = result[key];
            if(typeof value === 'function'){
                (<Record<string, unknown>><unknown>this)[key] = value.bind(this);
            }else{
                (<Record<string, unknown>><unknown>this.model)[key] = value;
            }
        }
        this.restoreSetupState();
    }

    
    private applyGlobalProperties(): void {
        const globalProperties = this.appContext?.config.globalProperties;
        if(!globalProperties){
            return;
        }
        for(const key of Object.keys(globalProperties)){
            if(key in this){
                continue;
            }
            (<Record<string, unknown>><unknown>this)[key] = globalProperties[key];
        }
    }

    
    private runCompositionHooks(eventName:string): void {
        const hooks = this.compositionHooks.get(eventName);
        if(!hooks || hooks.length === 0){
            return;
        }
        for(const hook of hooks){
            hook.apply(this, [this.model]);
        }
    }

    
    private clearCompositionCleanups(): void {
        if(this.compositionCleanups.length === 0){
            return;
        }
        for(const cleanup of this.compositionCleanups.splice(0)){
            cleanup();
        }
    }

    
    private restoreSetupState(): void {
        const ctor = <Record<string, unknown>><unknown>this.constructor;
        const hotState = <Record<string, unknown>>ctor['__nodomHotState'];
        if(!hotState || !this.setupState){
            return;
        }
        this.applySetupState(hotState);
        delete ctor['__nodomHotState'];
    }

    
    private applySetupState(hotState?: Record<string, unknown>): void {
        if(!hotState || !this.setupState){
            return;
        }
        for(const key of Object.keys(hotState)){
            if(!Object.prototype.hasOwnProperty.call(this.setupState, key)){
                continue;
            }
            const binding = this.setupState[key];
            const nextValue = cloneStateValue(hotState[key]);
            if(isRef(binding)){
                binding.value = nextValue;
            }else if(isReactive(binding) && nextValue && typeof nextValue === 'object'){
                syncReactiveState(binding, nextValue);
            }else if(!isComputed(binding) && typeof binding !== 'function'){
                (<Record<string, unknown>><unknown>this.model)[key] = nextValue;
            }
        }
    }

    
    public getHotId(): string {
        const hotId = (<Record<string, unknown>><unknown>this)['__ndFile'] as string
            || (<Record<string, unknown>><unknown>this.constructor)['__ndFile'] as string
            || this.constructor.name;
        return normalizeHotId(hotId);
    }
}

function syncReactiveState(target: object, nextValue: object): void {
    const rawTarget = <object><unknown>toRaw(target);
    for(const key of Reflect.ownKeys(rawTarget)){
        if(!Object.prototype.hasOwnProperty.call(nextValue, key)){
            Reflect.deleteProperty(rawTarget, key);
        }
    }
    for(const key of Reflect.ownKeys(nextValue)){
        Reflect.set(rawTarget, key, cloneStateValue(Reflect.get(nextValue, key)));
    }
}

function normalizeHotId(hotId?: string): string {
    return typeof hotId === 'string' ? hotId.replace(/\\/g, '/') : '';
}
