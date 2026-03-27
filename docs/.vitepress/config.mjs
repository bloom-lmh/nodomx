export default {
    base: process.env.DOCS_BASE || "/",
    title: "NodomX",
    description: "NodomX official docs for modules, directives, composition API, .nd SFC, router, performance, and ecosystem tooling.",
    cleanUrls: true,
    lastUpdated: true,
    themeConfig: {
        logo: "/logo.svg",
        search: {
            provider: "local"
        },
        nav: [
            { text: "指南", link: "/guide/introduction" },
            { text: "核心", link: "/guide/module-system" },
            { text: "工具链", link: "/guide/tooling-deploy" },
            { text: "生态", link: "/ecosystem/vite" },
            { text: "发布", link: "/guide/release-ci" }
        ],
        sidebar: {
            "/guide/": [
                {
                    text: "开始",
                    items: [
                        { text: "介绍", link: "/guide/introduction" },
                        { text: "快速开始", link: "/guide/getting-started" },
                        { text: "应用与插件", link: "/guide/app-and-plugin" }
                    ]
                },
                {
                    text: "核心",
                    items: [
                        { text: "模块系统", link: "/guide/module-system" },
                        { text: "模板语法", link: "/guide/template-syntax" },
                        { text: "指令", link: "/guide/directives" },
                        { text: "事件与方法", link: "/guide/events-and-methods" }
                    ]
                },
                {
                    text: "状态",
                    items: [
                        { text: "响应式", link: "/guide/reactivity" },
                        { text: "组合式 API", link: "/guide/composition-api" },
                        { text: ".nd 与 script setup", link: "/guide/nd-sfc" }
                    ]
                },
                {
                    text: "运行时",
                    items: [
                        { text: "Router", link: "/guide/router" },
                        { text: "渲染与性能", link: "/guide/rendering-performance" },
                        { text: "扩展 API", link: "/guide/extension-api" }
                    ]
                },
                {
                    text: "工具链",
                    items: [
                        { text: "工具与部署", link: "/guide/tooling-deploy" },
                        { text: "发布与 CI", link: "/guide/release-ci" }
                    ]
                }
            ],
            "/ecosystem/": [
                {
                    text: "生态工具",
                    items: [
                        { text: "ND Compiler", link: "/ecosystem/nd-compiler" },
                        { text: "Rollup 插件", link: "/ecosystem/rollup" },
                        { text: "开发服务器", link: "/ecosystem/dev-server" },
                        { text: "Vite 插件", link: "/ecosystem/vite" },
                        { text: "脚手架", link: "/ecosystem/create-nodomx" },
                        { text: "VSCode 扩展", link: "/ecosystem/vscode" }
                    ]
                }
            ]
        },
        outline: {
            label: "本页内容"
        },
        docFooter: {
            prev: "上一页",
            next: "下一页"
        },
        sidebarMenuLabel: "目录",
        returnToTopLabel: "回到顶部",
        footer: {
            message: "Built with VitePress for the NodomX monorepo.",
            copyright: "Copyright (c) 2026 NodomX"
        },
        socialLinks: [
            { icon: "github", link: "https://github.com/bloom-lmh/nodomx" }
        ]
    }
};
