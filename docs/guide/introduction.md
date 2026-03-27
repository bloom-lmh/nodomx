# 介绍

NodomX 是一个面向单页应用的 MVVM 前端框架。它延续了 Nodom 系列“模块 + 模板 + 指令”的核心思路，同时补齐了现代前端开发里最需要工程化支持的能力：

- 组合式响应式状态
- `.nd` 单文件组件
- `<script setup>` 语法糖
- 应用级插件与 `provide` / `inject`
- 路由懒加载与预加载
- 更细粒度的渲染优化
- Rollup / Vite / VSCode 工具链

## NodomX 不是什么

NodomX 不是 Vue 3 的兼容实现，也不是刻意模仿其 API 的外壳。它保留了自己的模板语法、指令体系和模块系统。

这意味着：

- 你可以继续写传统 `Module + template() + data()`
- 也可以使用 `setup()` 或 `.nd + <script setup>`
- 模板里仍然是 `{{count}}`、`e-click="inc"`、`x-repeat={{list}}`

## 当前官方能力

框架本体已具备：

- 模块系统
- 模板编译
- 指令与事件
- 响应式系统
- 组合式 API
- Router
- patch flag 与 block tree
- 列表 keyed diff
- 静态提升与结构块分层

工具链已具备：

- `@nodomx/nd-compiler`
- `@nodomx/rollup-plugin-nd`
- `@nodomx/rollup-plugin-dev-server`
- `vite-plugin-nodomx`
- `create-nodomx`
- `nodomx-nd-vscode`

## 推荐使用方式

新项目建议：

1. 组件格式优先使用 `.nd`
2. 状态写法优先使用 `<script setup>`
3. 构建层优先使用 `vite-plugin-nodomx` 或官方 Rollup dev server
4. 模板中的列表尽量提供稳定 `key`
5. 在 VSCode 中安装官方扩展以获得 `.nd` 语言服务

## 官方站点

- 国际站：[https://nodomx-docs.vercel.app/](https://nodomx-docs.vercel.app/)
- 中文站：[https://nodomx-e83lc0sk.maozi.io/](https://nodomx-e83lc0sk.maozi.io/)
