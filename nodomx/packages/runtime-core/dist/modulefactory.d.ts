import type { AppContext } from "./app";
import { Module } from "./module";
import { UnknownClass } from "./types";
/**
 * ģ�鹤��
 * @remarks
 * ��������ģ���ࡢģ��ʵ��
 */
export declare class ModuleFactory {
    private static modules;
    static classes: Map<string, UnknownClass>;
    static aliasMap: Map<string, string>;
    private static mainModule?;
    private static moduleId;
    private static appContext?;
    static add(item: Module): void;
    static get(name: number | string | UnknownClass): Module | undefined;
    static hasClass(clazzName: string): boolean;
    static addClass(clazz: unknown, alias?: string): void;
    static getClass(name: string): UnknownClass | undefined;
    static load(modulePath: string): Promise<UnknownClass | undefined>;
    static remove(id: number): void;
    static setMain(m?: Module): void;
    static getMain(): Module | undefined;
    static setAppContext(context?: AppContext): void;
    static getAppContext(): AppContext | undefined;
}
