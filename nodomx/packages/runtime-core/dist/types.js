/**
 * 模块状态类型
 */
export var EModuleState;
(function (EModuleState) {
    /**
     * 已初始化
     */
    EModuleState[EModuleState["INIT"] = 1] = "INIT";
    /**
     * 取消挂载
     */
    EModuleState[EModuleState["UNMOUNTED"] = 2] = "UNMOUNTED";
    /**
     * 已挂载到dom树
     */
    EModuleState[EModuleState["MOUNTED"] = 3] = "MOUNTED";
})(EModuleState || (EModuleState = {}));
//# sourceMappingURL=types.js.map