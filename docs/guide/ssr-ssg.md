# SSR / SSG

`NodomX` 现在提供官方的 [`@nodomx/ssr`](/ecosystem/create-nodomx) 能力，用来做三件事：

- 服务端渲染组件到 HTML
- 在客户端按服务端 payload 恢复状态
- 批量生成静态页面，用于文档站、内容站和落地页

## 官方能力

`@nodomx/ssr` 当前提供：

- `renderToString(component, options)`
- `createSsrPayload(instance, options)`
- `serializeSsrPayload(payload, options)`
- `readSsrPayload(window, options)`
- `mountFromSsrPayload(component, options)`
- `resumeFromSsrPayload(component, options)`
- `generateStaticSite(entries, options)`

这套能力目前更准确地说是：

- `SSR render`
- `client state resume`
- `static generation`

还不是完整的“无损 DOM hydration”。也就是说，客户端会按服务端 payload 恢复状态再重新挂载，而不是逐节点复用原始 DOM。

## 最小示例

```js
import fs from "node:fs/promises";
import { renderToString } from "@nodomx/ssr";
import App from "./App.nd.gen.mjs";

const result = await renderToString(App, {
  selector: "#app"
});

await fs.writeFile("./dist-ssr/index.html", result.html, "utf8");
```

如果页面里已经带了服务端 payload，客户端可以直接恢复：

```js
import { readSsrPayload, resumeFromSsrPayload } from "@nodomx/ssr";
import App from "./App.nd";

const payload = readSsrPayload(window);

if (payload) {
  await resumeFromSsrPayload(App, {
    payload,
    selector: "#app"
  });
}
```

## 静态生成

```js
import { generateStaticSite } from "@nodomx/ssr";
import HomePage from "./HomePage.nd.gen.mjs";
import AboutPage from "./AboutPage.nd.gen.mjs";

await generateStaticSite([
  { path: "/", component: HomePage },
  { path: "/about", component: AboutPage }
], {
  outDir: "./dist-ssr"
});
```

默认会生成：

- `/ -> dist-ssr/index.html`
- `/about -> dist-ssr/about/index.html`

## 官方脚手架

现在可以直接生成官方 SSR starter：

```bash
npm create nodomx@latest my-ssr-app -- --template ssr
```

生成后的常用命令：

```bash
npm run dev
npm run build
npm run ssr:render
npm run ssg
```

其中：

- `npm run dev`：本地 Vite 开发
- `npm run build`：构建客户端产物并生成静态页面
- `npm run ssr:render`：渲染单页 SSR HTML 到 `dist-ssr/index.html`
- `npm run ssg`：执行静态站点生成

## 部署建议

### Vercel

如果你部署的是静态生成结果：

- Build Command: `npm run build`
- Output Directory: `dist-ssr`

如果你部署的是纯客户端开发站点：

- Build Command: `npm run build`
- Output Directory: `dist`

### 国内静态托管

帽子云、对象存储静态站、普通 CDN 托管都推荐直接上传：

- `dist-ssr`

因为 `dist-ssr` 已经是纯 HTML 文件，不依赖 Node 运行时。

## 当前边界

这一版已经足够支撑：

- 官方文档站
- 落地页
- 小型内容站
- 需要首屏 HTML 的内部系统

但如果你要继续往上走，后续最值得补的是：

- 更完整的 hydration
- 服务端路由匹配
- 数据预取协议
- stream SSR
