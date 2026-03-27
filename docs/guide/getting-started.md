# 快速开始

## 安装框架

```bash
npm install nodomx
```

最小入口：

```ts
import { Module, Nodom } from "nodomx";

class HelloModule extends Module {
  template() {
    return `
      <div>Hello {{name}}</div>
    `;
  }

  data() {
    return {
      name: "NodomX"
    };
  }
}

Nodom.app(HelloModule, "#app");
```

## 组合式写法

```ts
import { Module, Nodom, useComputed, useState } from "nodomx";

class CounterModule extends Module {
  template() {
    return `
      <div>
        <p>{{count}}</p>
        <p>{{doubleCount}}</p>
        <button e-click="inc">+1</button>
      </div>
    `;
  }

  setup() {
    const count = useState(1);
    const doubleCount = useComputed(() => count.value * 2);

    const inc = () => {
      count.value++;
    };

    return {
      count,
      doubleCount,
      inc
    };
  }
}

Nodom.app(CounterModule, "#app");
```

## 推荐新项目方式

新项目建议直接用脚手架：

```bash
npm create nodomx@latest my-app
cd my-app
npm run dev
```

如果你更偏向 Vite 体系，可以直接看 [Vite Plugin](/ecosystem/vite)。
