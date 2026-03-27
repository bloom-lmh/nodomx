# `.nd` 与 `<script setup>`

`.nd` 是 NodomX 的单文件组件格式，适合把模板、逻辑和样式放在一个文件里。

## 支持的区块

- `<template>`
- `<script>`
- `<script setup>`
- `<style>`
- `<style scoped>`

## 示例

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

<style scoped>
.counter {
  padding: 16px;
}
</style>
```

## setup sugar

`<script setup>` 下的顶层绑定会自动暴露给模板，不需要再手写 `setup()` 返回对象。

常用 API：

- `useState`
- `useReactive`
- `useComputed`
- `useWatch`
- `useWatchEffect`
- `defineProps`
- `withDefaults`
- `defineOptions`
- `provide`
- `inject`
- `useRoute`
- `useRouter`

## 结构型节点与性能建议

推荐给列表写稳定 `key`：

```html
<li x-repeat={{todos}} key={{id}}>
  {{title}}
</li>
```

条件、插槽、模块、路由视图这些结构型节点现在也会形成稳定 block 边界，能减少无关子树的重复 diff。
