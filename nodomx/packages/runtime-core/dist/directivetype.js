/**
 * 指令类型
 */
export class DirectiveType {
    /**
     * 构造方法
     * @param name -    指令类型名
     * @param handle -  渲染时执行方法
     * @param prio -    类型优先级
     */
    constructor(name, handler, prio) {
        this.name = name;
        this.prio = prio >= 0 ? prio : 10;
        this.handler = handler;
    }
}
//# sourceMappingURL=directivetype.js.map