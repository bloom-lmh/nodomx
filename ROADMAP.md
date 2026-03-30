# NodomX Product Roadmap

This roadmap tracks the highest-leverage work needed to move NodomX closer to a modern Vue-class developer experience while preserving NodomX's own runtime and template model.

For the next milestone focused specifically on type-system depth and tooling maturity, see [ROADMAP-TYPE-TOOLING.md](/E:/dev_projects/nodomx/ROADMAP-TYPE-TOOLING.md).

## P0: Core developer experience

Goal: make NodomX pleasant and credible for day-to-day application development.

- `.nd` and `<script setup>` parity
  - Add `defineEmits`
  - Add `defineExpose`
  - Add `defineSlots`
  - Add smoke tests for emitted events and exposed component state
- Modern default scaffolding
  - Make `create-nodomx` default to a Vite starter
  - Keep the current Rollup template as an explicit legacy option
  - Ensure local and registry modes both work with the new template
- Vite workflow stability
  - Treat `vite-plugin-nodomx` as the primary app development path
  - Keep HMR wired to `.nd` boundaries
  - Add starter coverage for `vite.config` and runtime bootstrap
- Editor baseline
  - Expand `.nd` script macro completion
  - Keep HTML tag and attribute completion available out of the box
  - Continue closing gaps between `.nd` and Vue SFC ergonomics

## P1: Runtime capability and tooling depth

Goal: close the biggest feature gaps with Vue 3 runtime and official tooling.

- SFC/runtime features
  - Design and implement `defineModel`
  - Design and implement `defineExpose` consumer APIs for parents and tooling
  - Add async component helpers
  - Evaluate `KeepAlive`, `Teleport`, and `Transition` in NodomX terms
- Official testing and debugging
  - Create `@nodomx/test-utils`
  - Add component mount helpers and event/assertion utilities
  - Start a `nodomx-devtools` browser extension or panel
- VSCode plugin depth
  - Add hover
  - Add references
  - Add rename
  - Add richer diagnostics for props, emits, and slots
  - Start moving from regex-only analysis toward structured AST-based analysis
- Stronger Vite integration
  - Expose more plugin options
  - Improve error overlays and source-mapped `.nd` diagnostics
  - Support a cleaner path for asset URLs and preprocessors

## P2: Ecosystem maturity and scale

Goal: move from a usable framework to a full ecosystem.

- TypeScript-first workflow
  - Support `<script setup lang="ts">`
  - Add template type checking
  - Add generated type surfaces for props, emits, and slots
- Data and state ecosystem
  - Provide an official store solution or recommended package
  - Document large-app module boundaries and state patterns
- Rendering and deployment
  - Explore SSR and hydration
  - Explore static generation for documentation and content sites
  - Provide deployment recipes for Vite, Vercel, and domestic hosts
- Starter matrix
  - Add `vite + router`
  - Add `vite + router + store`
  - Add `vite + ts`
  - Add `library` and `docs` presets

## What is already in motion

- `defineEmits`, `defineExpose`, and `defineSlots` are being added as the first P0 macro batch.
- `create-nodomx` is being moved to a Vite-first default.
- The Rollup starter remains available as a compatibility template.
