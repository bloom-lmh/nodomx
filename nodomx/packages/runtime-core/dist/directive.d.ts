import { DirectiveType } from "./directivetype";
import { Module } from "./module";
import { Expression } from "./expression";
import { RenderedDom } from "./types";
/**
 * 指令类
 */
export declare class Directive {
    /**
     * 指令id
     */
    id: number;
    /**
     * 指令类型
     */
    type: DirectiveType;
    /**
     * 指令值
     */
    value: unknown;
    /**
     * 表达式
     */
    expression: Expression;
    /**
     * 禁用指令
     */
    disabled: boolean;
    /**
     * 构造方法
     * @param type -  	    类型名
     * @param value - 	    指令值
     */
    constructor(type?: string, value?: string | Expression);
    /**
     * 执行指令
     * @param module -  模块
     * @param dom -     渲染目标节点对象
     * @returns         是否继续渲染
     */
    exec(module: Module, dom: RenderedDom): boolean;
    /**
     * 克隆
     * @returns     新克隆的指令
     */
    clone(): Directive;
}
