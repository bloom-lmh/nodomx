# `@nodomx/devtools`

`@nodomx/devtools` is the official runtime debugging panel for NodomX.

## Features

- Discover mounted NodomX apps automatically
- Browse the module tree and inspect the selected module
- Inspect `setup`, `state`, `props`, `route`, `exposed`, and official store state
- Record runtime timeline events including `Transition`, `KeepAlive`, and `Suspense`
- Highlight the selected module's real DOM
- Pick a live DOM element and jump back to the owning module
- Patch module `setup` / `state` directly from the panel
- Patch official store state directly from the panel
- Export snapshots and inspect data in the browser console
- Open or close the panel with `Ctrl + Shift + D`

## Install

```bash
npm install -D @nodomx/devtools
```

## Usage

```js
import { createDevtools } from "@nodomx/devtools";
import { Nodom } from "nodomx";
import App from "./App.nd";

const app = Nodom.createApp(App, "#app");
app.use(createDevtools());
app.mount("#app");
```

## Panel areas

- `App tabs`: switch between mounted apps
- `Module tree`: browse modules, search by name or hot id, and change selection
- `Timeline`: review lifecycle, render, and suspense-related events
- `Events`: inspect the selected timeline event payload in detail
- `Inspector`: inspect and patch the selected module or store
- `Pick element`: hover the page and click a real DOM element to focus its owning module

## Runtime API

```js
import {
  createDevtools,
  getDevtoolsHook,
  installDevtoolsHook,
  notifyDevtoolsUpdate
} from "@nodomx/devtools";
```

Common hook methods:

- `installDevtoolsHook(options?)`
- `getDevtoolsHook()`
- `notifyDevtoolsUpdate(app, reason, details?)`
- `hook.getSnapshot(appId?)`
- `hook.getTimeline(appId?)`
- `hook.exportSnapshot(appId?)`
- `hook.inspectSelection(appId?, moduleId?)`
- `hook.highlightSelection(appId?, moduleId?)`
- `hook.pickElement(target, appId?)`
- `hook.applyModulePatch(appId?, moduleId?, "setup" | "state", payload)`
- `hook.applyStorePatch(appId?, storeId, payload)`

## Notes

This is an embedded runtime panel, so it works without a separate browser extension. It can later evolve into a dedicated standalone DevTools experience.
