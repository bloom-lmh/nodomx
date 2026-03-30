import { VirtualDom } from "@nodomx/runtime-template";
import { ChangedDom, RenderedDom } from "@nodomx/shared";
import type { ModelLike, ModuleLike } from "@nodomx/shared";
export declare class Renderer {
    private static rootEl;
    private static waitList;
    private static waitSet;
    static setRootEl(rootEl: HTMLElement): void;
    static getRootEl(): HTMLElement;
    static add(module: ModuleLike): void;
    static remove(module: ModuleLike): void;
    static render(): void;
    static flush(maxRounds?: number): void;
    static renderDom(module: ModuleLike, src: VirtualDom, model: ModelLike, parent?: RenderedDom, key?: number | string, notRenderChild?: boolean, previousDom?: RenderedDom, dirtyPaths?: string[]): RenderedDom;
    private static handleDirectives;
    private static handleProps;
    private static renderChildren;
    static updateToHtml(module: ModuleLike, dom: RenderedDom, oldDom: RenderedDom): Node;
    static renderToHtml(module: ModuleLike, src: RenderedDom, parentEl: Node | null): Node;
    static syncTeleports(dom?: RenderedDom): void;
    static runLeaveTransition(module: ModuleLike, dom: RenderedDom, removeNode: () => void): boolean;
    static handleChangedDoms(module: ModuleLike, changeDoms: ChangedDom[]): void;
    private static replace;
}
