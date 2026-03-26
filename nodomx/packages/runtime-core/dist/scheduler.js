import { NError } from "./error";
import { Util } from "./util";
/**
 * 调度器
 * @remarks
 * 管理所有需调度的任务并进行循环调度，默认采用requestAnimationFrame方式进行循环
 */
export class Scheduler {
    /**
     * 执行任务
     */
    static dispatch() {
        Scheduler.tasks.forEach((item) => {
            if (Util.isFunction(item['func'])) {
                if (item['thiser']) {
                    item['func'].call(item['thiser']);
                }
                else {
                    item['func']();
                }
            }
        });
    }
    /**
     * 启动调度器
     * @param scheduleTick - 	渲染间隔（ms），默认50ms
     */
    static start(scheduleTick) {
        if (Scheduler.started) {
            return;
        }
        Scheduler.started = true;
        const tick = () => {
            Scheduler.dispatch();
            if (window.requestAnimationFrame) {
                window.requestAnimationFrame(tick);
            }
            else {
                window.setTimeout(tick, scheduleTick || 50);
            }
        };
        tick();
    }
    /**
     * 添加任务
     * @param foo - 	待执行任务函数
     * @param thiser - 	this指向
     */
    static addTask(foo, thiser) {
        if (!Util.isFunction(foo)) {
            throw new NError("invoke", "Scheduler.addTask", "0", "function");
        }
        if (Scheduler.tasks.some(item => item.func === foo && item.thiser === thiser)) {
            return;
        }
        Scheduler.tasks.push({ func: foo, thiser: thiser });
    }
    /**
     * 移除任务
     * @param foo - 	任务函数
     */
    static removeTask(foo, thiser) {
        if (!Util.isFunction(foo)) {
            throw new NError("invoke", "Scheduler.removeTask", "0", "function");
        }
        const ind = Scheduler.tasks.findIndex(item => item.func === foo && (thiser === undefined || item.thiser === thiser));
        if (ind !== -1) {
            Scheduler.tasks.splice(ind, 1);
        }
    }
}
/**
 * 待执行任务列表
 */
Scheduler.tasks = [];
/**
 * 调度器是否已经启动
 */
Scheduler.started = false;
//# sourceMappingURL=scheduler.js.map