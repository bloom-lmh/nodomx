---
layout: home

hero:
  name: NodomX
  text: 用 .nd 写模块，用 setup sugar 写状态
  tagline: 面向单页应用的 MVVM 框架，内置响应式、模块系统、路由、.nd 单文件组件、语言服务器与开发工具链。
  image:
    src: /logo.svg
    alt: NodomX
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: Tooling 部署
      link: /guide/tooling

features:
  - title: 保留模板语法
    details: 继续使用 Nodom 风格模板、事件和指令，不需要为了组合式 API 重写整套语法。
  - title: .nd 单文件组件
    details: 支持 template、script、script setup、style scoped，并能接入 Rollup、Vite 与 VSCode。
  - title: 结构型块优化
    details: 列表、条件、插槽、模块和路由节点带有编译期块信息，运行时能做更稳的复用和靶向更新。
  - title: 生态链齐备
    details: 提供 create-nodomx、Rollup dev server、vite-plugin-nodomx、VSCode 语言服务器与 npm 发布脚本。
---

## 为什么是 NodomX

NodomX 的目标不是照搬 Vue 3，而是在保留自身模块化和模板指令风格的前提下，把现代前端开发里真正高频的体验补齐：

- 组合式状态
- `<script setup>`
- `.nd` 单文件组件
- 插件与依赖注入
- 路由懒加载与预加载
- 工具链和编辑器支持

如果你已经有旧模块代码，可以继续写 `template() + data()`；如果你想直接进入新的开发体验，也可以从 `.nd` 开始。
