# 快速开始

## 方式一：只安装框架

```bash
npm install nodomx
```

最小入口可以直接从经典模块开始：

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

## 方式二：使用组合式 API

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

模板语法保持不变，只是状态组织方式变成了组合式。

## 方式三：直接使用 `.nd`

```html
<template>
  <section class="counter">
    <p>{{count}}</p>
    <p>{{doubleCount}}</p>
    <button e-click="inc">+1</button>
  </section>
</template>

<script setup>
import { useComputed, useState } from "nodomx";

const count = useState(1);
const doubleCount = useComputed(() => count.value * 2);

const inc = () => {
  count.value++;
};
</script>
```

## 推荐的新项目方式

```bash
npm create nodomx@latest my-app
cd my-app
npm run dev
```

## 常见安装组合

- 只想用框架本体：`npm install nodomx`
- 想单独编译 `.nd`：`npm install -D @nodomx/nd-compiler`
- 想走 Rollup：`npm install -D @nodomx/rollup-plugin-nd @nodomx/rollup-plugin-dev-server`
- 想走 Vite：`npm install -D vite vite-plugin-nodomx`
- 想获得编辑器支持：安装 `nodomx-nd-vscode`
