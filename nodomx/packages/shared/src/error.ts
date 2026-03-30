import { NodomMessage } from "./runtime";

/**
 * 异常处理类
 */
export class NError extends Error{
    constructor(errorName:string,...params){
        super(errorName);
        const msg:string = NodomMessage.ErrorMsgs[errorName];
        if(msg === undefined){
            this.message = "未知错误";
            return;
        }
        //编译提示信息
        this.message = compileMessage(msg,...params);
    }
}   

function compileMessage(src: string, ...params: unknown[]): string {
    if (!params || params.length === 0) {
        return src;
    }
    let output = src;
    for (let index = 0; index < params.length; index++) {
        if (output.indexOf(`{${index}}`) === -1) {
            break;
        }
        output = output.replace(new RegExp(`\\{${index}\\}`, "g"), String(params[index]));
    }
    return output;
}

