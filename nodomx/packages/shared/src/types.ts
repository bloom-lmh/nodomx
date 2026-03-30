export type UnknownMethod = (...args: unknown[]) => unknown;

export enum PatchFlags {
    NONE = 0,
    TEXT = 1,
    CLASS = 1 << 1,
    STYLE = 1 << 2,
    PROPS = 1 << 3,
    ASSETS = 1 << 4,
    EVENTS = 1 << 5,
    DIRECTIVES = 1 << 6,
    KEYED_FRAGMENT = 1 << 7,
    UNKEYED_FRAGMENT = 1 << 8,
    BAIL = 1 << 9
}

export enum StructureFlags {
    NONE = 0,
    CONDITIONAL = 1,
    SLOT = 1 << 1,
    MODULE = 1 << 2,
    ROUTE_LINK = 1 << 3,
    ROUTE_VIEW = 1 << 4,
    RECURSIVE = 1 << 5,
    LIST = 1 << 6
}

export interface ModelLike extends Record<string | symbol, any> {
    __module?: ModuleLike;
    __parent?: ModelLike;
    __name?: string;
}

export interface EventLike extends Record<string | symbol, any> {
    id?: number | string;
    name: string;
    module?: ModuleLike;
    handler?: string | UnknownMethod;
    delg?: boolean;
    nopopo?: boolean;
    once?: boolean;
    capture?: boolean;
}

export interface VirtualDomLike extends Record<string | symbol, any> {
    key: string | number;
    tagName?: string;
    children?: VirtualDomLike[];
    parent?: VirtualDomLike;
    moduleId?: number;
    slotModuleId?: number;
    staticNum?: number;
    patchFlag?: PatchFlags;
    dynamicProps?: string[];
    hoisted?: boolean;
    blockTree?: boolean;
    blockRoot?: boolean;
    dynamicChildIndexes?: number[];
    childrenPatchFlag?: PatchFlags;
    structureFlags?: StructureFlags;
    childrenStructureFlags?: StructureFlags;
    directives?: unknown[];
    props?: Map<string, unknown>;
    events?: EventLike[];
    teleportTarget?: unknown;
    teleportDisabled?: boolean;
    transition?: TransitionConfig;
    add?(dom: VirtualDomLike, index?: number): void;
    getDirective?(name: string): unknown;
}

export type TransitionConfig = {
    name?: string;
    duration?: number;
    enterDuration?: number;
    leaveDuration?: number;
    moveDuration?: number;
    enterFromClass?: string;
    enterActiveClass?: string;
    enterToClass?: string;
    group?: boolean;
    leaveFromClass?: string;
    leaveActiveClass?: string;
    leaveToClass?: string;
    moveClass?: string;
};

export type KeepAliveMatchPattern = string | string[] | RegExp;

export type KeepAliveConfig = {
    scopeKey?: string | number;
    disabled?: boolean;
    include?: KeepAliveMatchPattern;
    exclude?: KeepAliveMatchPattern;
    max?: number;
};

export interface ModuleLike extends Record<string | symbol, any> {
    id: number;
    model?: ModelLike;
    props?: Record<string, unknown>;
    srcDom?: RenderedDom;
    cssRules?: string[];
    objectManager: {
        setDomParam(key: string | number, name: string, value: unknown): void;
        getDomParam(key: string | number, name: string): unknown;
        removeDomParam(key: string | number, name: string): void;
        clearDomParams?(key: string | number): void;
        setEventParam(eventId: string | number, domKey: string | number, name: string, value: unknown): void;
        getEventParam(eventId: string | number, domKey: string | number, name: string): unknown;
        removeEventParam(eventId: string | number, domKey: string | number, name: string): unknown;
        clearEventParams(eventId: string | number, domKey: string | number): void;
    };
    eventFactory?: {
        handleDomEvent(dom: RenderedDom, oldDom?: RenderedDom): void;
        clear(): void;
    };
    domManager?: {
        renderedTree?: RenderedDom | null;
        vdomTree?: VirtualDomLike;
        getRenderedDom(params: unknown): RenderedDom | undefined;
        freeNode(dom: RenderedDom, removeNode?: boolean): void;
    };
    invokeMethod(methodName: string, ...args: unknown[]): unknown;
    init?(): void;
    render?(): boolean | void;
    active?(): void;
    unmount?(passive?: boolean): void;
    destroy?(): void;
    addChild?(module: ModuleLike): void;
    markDirty?(path?: string): void;
    getRenderedDom?(params: unknown): RenderedDom | undefined;
}

export type RouteMeta = Record<string, unknown>;
export type RouteQueryValue = string | string[];
export type RouteQuery = Record<string, RouteQueryValue>;

export type RouteMatch = {
    path: string;
    fullPath: string;
    name?: string;
    meta: RouteMeta;
    route?: unknown;
};

export type RouteLocation = {
    path: string;
    fullPath: string;
    hash: string;
    name?: string;
    meta: RouteMeta;
    query: RouteQuery;
    params: Record<string, unknown>;
    data: Record<string, unknown>;
    matched: RouteMatch[];
};

export type RouteGuardResult = boolean | void | string;
export type RouteGuard = (to: RouteLocation, from?: RouteLocation) => RouteGuardResult | Promise<RouteGuardResult>;
export type RouteRedirect = string | ((to: RouteLocation) => string);
export type RouteLoaderResult = ModuleLike | UnknownClass | string | { default: ModuleLike | UnknownClass | string };
export type RouteLoader = () => Promise<RouteLoaderResult>;
export type RoutePreload = boolean | ((to: RouteLocation, from?: RouteLocation) => boolean | Promise<boolean>);

export type RouteCfg = {
    path?: string;
    name?: string;
    meta?: RouteMeta;
    redirect?: RouteRedirect;
    beforeEnter?: RouteGuard;
    module?: ModuleLike | UnknownClass | string;
    component?: ModuleLike | UnknownClass | string;
    loader?: RouteLoader;
    load?: RouteLoader;
    preload?: RoutePreload;
    modulePath?: string;
    routes?: Array<RouteCfg>;
    children?: Array<RouteCfg>;
    onEnter?: (module: ModuleLike, path: string) => void;
    onLeave?: (module: ModuleLike, path: string) => void;
    parent?: unknown;
};

export enum EModuleState {
    INIT = 1,
    UNMOUNTED = 2,
    MOUNTED = 3
}

export type RenderedDom = {
    tagName?: string;
    key: string | number;
    model?: ModelLike;
    assets?: Record<string, unknown>;
    props?: Record<string, unknown>;
    events?: EventLike[];
    textContent?: string;
    children?: Array<RenderedDom>;
    locMap?: Map<number | string, number>;
    parent?: RenderedDom;
    staticNum?: number;
    patchFlag?: PatchFlags;
    dynamicProps?: string[];
    hoisted?: boolean;
    blockRoot?: boolean;
    structureFlags?: StructureFlags;
    moduleId?: number;
    slotModuleId?: number;
    childModuleId?: number;
    keepAlive?: boolean | KeepAliveConfig;
    teleportTarget?: unknown;
    teleportDisabled?: boolean;
    transition?: TransitionConfig;
    vdom?: VirtualDomLike;
    isSvg?: boolean;
    node?: Node;
    __skipDiff?: boolean;
    __used?: boolean;
    dynamicChildKeys?: Array<string | number>;
    childrenPatchFlag?: PatchFlags;
    childrenStructureFlags?: StructureFlags;
};

export type UnknownClass = new (...args: unknown[]) => object;
export type DefineElementClass = new (dom: VirtualDomLike, module: ModuleLike) => object;
export type EventMethod = (model: unknown, dom: RenderedDom, evobj: unknown, event: Event) => void;
export type DirectiveMethod = (module: ModuleLike, dom: RenderedDom) => boolean;
export type ExpressionMethod = (model: ModelLike) => unknown;
export type ChangedDom = [number, RenderedDom, RenderedDom?, RenderedDom?, number?, number?];
