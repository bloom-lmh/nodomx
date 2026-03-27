import { defineConfig } from "vitepress";

const docsBase = normalizeBase(process.env.DOCS_BASE || "/");

export default defineConfig({
    lang: "zh-CN",
    title: "NodomX",
    description:
        "NodomX 官方文档，覆盖模块系统、模板语法、组合式 API、.nd 单文件组件、路由、性能优化与工具链。",
    base: docsBase,
    cleanUrls: false,
    head: [
        [
            "script",
            {},
            `(function(){if(typeof window==='undefined'){return;}window.addEventListener('click',function(event){if(event.defaultPrevented||!(event.target instanceof Element)||event.button!==0||event.ctrlKey||event.shiftKey||event.altKey||event.metaKey){return;}var anchor=event.target.closest('a');if(!anchor||anchor.closest('.vp-raw')||anchor.hasAttribute('download')||anchor.hasAttribute('target')){return;}var href=anchor.getAttribute('href')||anchor.getAttribute('xlink:href');if(!href){return;}var url=new URL(href,anchor.baseURI);var current=new URL(window.location.href);var base=(window.__VP_SITE_DATA__&&window.__VP_SITE_DATA__.base)||'/';if(url.origin!==current.origin||!url.pathname.startsWith(base)||url.pathname===current.pathname&&url.search===current.search){return;}event.preventDefault();event.stopImmediatePropagation();window.location.assign(url.pathname+url.search+url.hash);},true);})();`,
        ],
    ],
    lastUpdated: true,
    themeConfig: {
        logo: "/logo.svg",
        search: {
            provider: "local",
        },
        nav: [
            { text: "指南", link: "/guide/introduction" },
            { text: "核心", link: "/guide/module-system" },
            { text: "工具链", link: "/guide/tooling-deploy" },
            { text: "生态", link: "/ecosystem/vite" },
            { text: "发布", link: "/guide/release-ci" },
        ],
        sidebar: {
            "/guide/": [
                {
                    text: "开始",
                    items: [
                        { text: "介绍", link: "/guide/introduction" },
                        { text: "快速开始", link: "/guide/getting-started" },
                        { text: "应用与插件", link: "/guide/app-and-plugin" },
                    ],
                },
                {
                    text: "核心",
                    items: [
                        { text: "模块系统", link: "/guide/module-system" },
                        { text: "模板语法", link: "/guide/template-syntax" },
                        { text: "指令", link: "/guide/directives" },
                        { text: "事件与方法", link: "/guide/events-and-methods" },
                    ],
                },
                {
                    text: "状态",
                    items: [
                        { text: "响应式", link: "/guide/reactivity" },
                        { text: "组合式 API", link: "/guide/composition-api" },
                        { text: ".nd 与 script setup", link: "/guide/nd-sfc" },
                    ],
                },
                {
                    text: "运行时",
                    items: [
                        { text: "Router", link: "/guide/router" },
                        { text: "渲染与性能", link: "/guide/rendering-performance" },
                        { text: "扩展 API", link: "/guide/extension-api" },
                    ],
                },
                {
                    text: "工程化",
                    items: [
                        { text: "工具与部署", link: "/guide/tooling-deploy" },
                        { text: "发布与 CI", link: "/guide/release-ci" },
                    ],
                },
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
                        { text: "VSCode 扩展", link: "/ecosystem/vscode" },
                    ],
                },
            ],
        },
        outline: {
            level: [2, 3],
            label: "本页目录",
        },
        docFooter: {
            prev: "上一页",
            next: "下一页",
        },
        sidebarMenuLabel: "目录",
        returnToTopLabel: "回到顶部",
        darkModeSwitchLabel: "切换主题",
        lightModeSwitchTitle: "切换到浅色模式",
        darkModeSwitchTitle: "切换到深色模式",
        editLink: {
            pattern: "https://github.com/bloom-lmh/nodomx/edit/main/docs/:path",
            text: "在 GitHub 上编辑此页",
        },
        footer: {
            message: "Built with VitePress for the NodomX monorepo.",
            copyright: "Copyright (c) 2026 NodomX",
        },
        socialLinks: [
            { icon: "github", link: "https://github.com/bloom-lmh/nodomx" },
        ],
    },
});

function normalizeBase(basePath: string) {
    if (!basePath || basePath === "/") {
        return "/";
    }
    const withLeading = basePath.startsWith("/") ? basePath : `/${basePath}`;
    return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}
