export default {
    title: "NodomX",
    description: "NodomX official docs for .nd, composition API, tooling, and ecosystem packages.",
    cleanUrls: true,
    lastUpdated: true,
    themeConfig: {
        logo: "/logo.svg",
        nav: [
            { text: "Guide", link: "/guide/getting-started" },
            { text: "Tooling", link: "/guide/tooling" },
            { text: "Ecosystem", link: "/ecosystem/vite" },
            { text: "Release", link: "/npm-release-checklist" }
        ],
        sidebar: {
            "/guide/": [
                {
                    text: "Guide",
                    items: [
                        { text: "Getting Started", link: "/guide/getting-started" },
                        { text: ".nd And Script Setup", link: "/guide/nd-sfc" },
                        { text: "Tooling And Deployment", link: "/guide/tooling" },
                        { text: "Router And App", link: "/guide/router" }
                    ]
                }
            ],
            "/ecosystem/": [
                {
                    text: "Ecosystem",
                    items: [
                        { text: "Vite Plugin", link: "/ecosystem/vite" },
                        { text: "VSCode Extension", link: "/ecosystem/vscode" }
                    ]
                }
            ]
        },
        socialLinks: [
            { icon: "github", link: "https://github.com/nodomjs/nodomx" }
        ],
        footer: {
            message: "Built with VitePress for the NodomX monorepo.",
            copyright: "Copyright © 2026 NodomX"
        }
    }
};
