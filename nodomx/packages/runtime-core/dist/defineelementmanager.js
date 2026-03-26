/**
 * 自定义元素管理器
 *
 * @remarks
 * 所有自定义元素需要添加到管理器才能使用
 */
export class DefineElementManager {
    /**
     * 添加自定义元素
     * @param clazz -   自定义元素类或类数组
     */
    static add(clazz) {
        if (Array.isArray(clazz)) {
            for (const c of clazz) {
                this.elements.set(c.name.toUpperCase(), c);
            }
        }
        else {
            this.elements.set(clazz.name.toUpperCase(), clazz);
        }
    }
    /**
     * 获取自定义元素类
     * @param tagName - 元素名
     * @returns         自定义元素类
     */
    static get(tagName) {
        return this.elements.get(tagName.toUpperCase());
    }
    /**
     * 是否存在自定义元素
     * @param tagName - 元素名
     * @returns         存在或不存在
     */
    static has(tagName) {
        return this.elements.has(tagName.toUpperCase());
    }
}
/**
 * 自定义元素集合
 */
DefineElementManager.elements = new Map();
//# sourceMappingURL=defineelementmanager.js.map