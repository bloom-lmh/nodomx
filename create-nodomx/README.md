# `create-nodomx`

Starter generator for NodomX applications.

Usage:

```bash
npm create nodomx@latest my-app
npx create-nodomx@latest my-app
create-nodomx my-app
create-nodomx my-app --install
create-nodomx my-app --package-mode local --install
create-nodomx my-app --template basic
create-nodomx my-app --template library
create-nodomx my-app --template docs
create-nodomx my-app --router --store
create-nodomx my-app --router --store --typescript
```

`registry` mode writes semver package ranges for publish-ready templates.
`local` mode writes `file:` dependencies so the template can be tested against this repository directly.

Templates:

- `vite` (default): modern Vite-based starter using `vite-plugin-nodomx`
- `basic`: legacy Rollup starter using `@nodomx/rollup-plugin-nd` and the built-in dev server
- `library`: Vite library preset for publishing reusable `.nd` components
- `docs`: VitePress documentation preset

Feature flags for the default `vite` template:

- `--router`: scaffold the official NodomX router entry with `src/router` and starter views
- `--store`: scaffold the official `@nodomx/store` setup in `src/stores`
- `--router --store`: wire both together so the starter home view demonstrates route + store usage
- `--typescript`: switch the Vite starter to `main.ts`, `vite.config.ts`, `tsconfig.json`, and typed `.nd` imports

Default Vite starter structure:

- `src/components`: reusable `.nd` presentation components
- `src/styles`: shared global CSS for Vite apps
- `src/layouts`: added automatically when `--router` is enabled
- `src/router/routes.js`: route table extracted from router installation
- `src/stores/index.js`: added automatically when `--store` is enabled and pre-wired with `@nodomx/store`
