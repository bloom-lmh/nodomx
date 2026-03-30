import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Module, useState } from "nodomx";
import {
    createSsrDom,
    generateStaticSite,
    mountFromSsrPayload,
    readSsrPayload,
    resumeFromSsrPayload,
    renderToString
} from "../src/index.js";

class HomePage extends Module {
    template() {
        return `
            <section class="home-page">
                <h1>{{title}}</h1>
                <p class="count">{{count}}</p>
                <p class="double">{{count * 2}}</p>
            </section>
        `;
    }

    setup() {
        const count = useState(2);
        const title = "SSR demo";
        return {
            count,
            title
        };
    }
}

class AboutPage extends Module {
    template() {
        return `
            <article class="about-page">
                <h1>{{title}}</h1>
                <p>{{summary}}</p>
            </article>
        `;
    }

    setup() {
        const title = "About";
        const summary = "Static generation works.";
        return {
            summary,
            title
        };
    }
}

const rendered = await renderToString(HomePage, {
    selector: "#app"
});

assert.match(rendered.appHtml, /SSR demo/);
assert.match(rendered.appHtml, /class="count">2</);
assert.match(rendered.appHtml, /class="double">4</);
assert.match(rendered.html, /<!DOCTYPE html>/);
assert.match(rendered.html, /type="application\/json"/);
assert.ok(rendered.payload);
assert.equal(rendered.payload.snapshot.state.count, 2);
assert.equal(rendered.payload.selector, "#app");

const ssrDom = createSsrDom({
    html: rendered.html
});
const payloadFromDocument = readSsrPayload(ssrDom.window);
assert.equal(payloadFromDocument.snapshot.state.count, 2);

const resumed = await mountFromSsrPayload(HomePage, {
    dom: ssrDom,
    payload: {
        ...rendered.payload,
        snapshot: {
            ...rendered.payload.snapshot,
            state: {
                ...rendered.payload.snapshot.state,
                count: 7
            }
        }
    },
    selector: "#app"
});

assert.match(ssrDom.document.querySelector("#app")?.textContent || "", /SSR demo/);
assert.match(ssrDom.document.querySelector("#app")?.textContent || "", /7/);
assert.match(ssrDom.document.querySelector("#app")?.textContent || "", /14/);
resumed.restore();

const browserLikeDom = createSsrDom({
    html: rendered.html
});
const resumedInBrowser = await resumeFromSsrPayload(HomePage, {
    payload: {
        ...rendered.payload,
        snapshot: {
            ...rendered.payload.snapshot,
            state: {
                ...rendered.payload.snapshot.state,
                count: 5
            }
        }
    },
    selector: "#app"
});
assert.match(browserLikeDom.document.querySelector("#app")?.textContent || "", /5/);
assert.match(browserLikeDom.document.querySelector("#app")?.textContent || "", /10/);
resumedInBrowser.app.unmount();
browserLikeDom.restore();

const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "nodomx-ssr-"));
const generatedFiles = await generateStaticSite([
    {
        component: HomePage,
        path: "/"
    },
    {
        component: AboutPage,
        path: "/about"
    }
], {
    outDir
});

assert.equal(generatedFiles.length, 2);
const homeHtml = await fs.readFile(path.join(outDir, "index.html"), "utf8");
const aboutHtml = await fs.readFile(path.join(outDir, "about", "index.html"), "utf8");
assert.match(homeHtml, /SSR demo/);
assert.match(aboutHtml, /Static generation works\./);

console.log("@nodomx/ssr smoke test passed");
