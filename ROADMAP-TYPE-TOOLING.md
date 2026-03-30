# NodomX Type System And Tooling Roadmap

This roadmap is the next milestone after the original P0/P1/P2 product roadmap.
Its focus is narrower:

- push NodomX from "feature-complete enough" to "type-safe and tool-mature"
- delay the final full regression pass until the type/tooling work is substantially complete
- keep intermediate validation targeted so development speed stays high without letting regressions drift too far

## Scope

This roadmap only covers:

- `.nd` type system depth
- TypeScript workflow maturity
- Vite / VSCode / starter / compiler maturity
- final regression and release gating for the above

It does **not** cover:

- new large runtime primitives unless they unblock typing/tooling
- devtools expansion as the main milestone
- unrelated product polish

## Current baseline

NodomX already has:

- `.nd` with `<script setup>` and `lang="ts"`
- generated declaration output for component surfaces
- first-pass template type checking
- cross-component contract checking for props / emits / slots
- a Vite plugin, Rollup path, starter matrix, SSR/SSG starter, official store, test-utils, VSCode plugin, and devtools

What is still missing is mostly **depth**, **stability**, and **industrial-grade typing/tooling ergonomics**.

## Delivery strategy

- During `P0`, `P1`, and `P2`, prefer targeted smoke and package-level checks instead of running the full matrix every time.
- Treat `P3` as the formal hardening phase: full regression, compatibility, release-gate validation, and documentation signoff.
- Each phase should finish with a clear checklist and measurable exit criteria.

## P0: Type Surface Foundations

Goal: make `.nd` type generation and local template checking trustworthy enough to build more advanced tooling on top.

- Strengthen generated declaration output
  - Preserve more literal types and unions in generated component surfaces
  - Preserve optional vs required props more accurately
  - Preserve event payload signatures more accurately
  - Preserve slot prop signatures more accurately
- Deepen local template analysis
  - Distinguish root scope, loop scope, slot scope, and model scope more precisely
  - Reduce false positives in `x-repeat`, `x-model`, `<for>`, `slot`, and nested control-flow
  - Improve diagnostics for missing bindings, handler names, and invalid local references
- Add a dedicated typing entrypoint
  - Introduce an `nd-tsc`-style CLI for type-only checks across workspaces
  - Support "check only", "emit declarations", and "watch" modes
  - Make failures readable enough for CI and editor reuse
- Strengthen cross-file type surface caching
  - Build a stable component-surface cache keyed by real source files
  - Avoid stale contract reads during watch/HMR flows

Exit criteria:

- `.nd` declarations are usable as the canonical component contract
- template type diagnostics are stable on official starters
- a dedicated type-check CLI exists and can run against example projects

Recommended validation during P0:

- compiler smoke
- starter matrix smoke on affected templates
- focused Vite integration smoke

## P1: Type-Driven Editor And Bundler Tooling

Goal: make the editor and bundler consume the same type/contract model instead of relying mostly on structural heuristics.

- VSCode plugin: move toward type-driven understanding
  - Reuse compiler/component-surface data rather than re-deriving everything separately
  - Improve hover with real prop / event / slot signatures
  - Improve rename and references using contract-aware symbol ownership
  - Add stronger quick fixes based on typed contracts instead of text heuristics
  - Add more accurate code actions for parent/child sync flows
- VSCode plugin: richer diagnostics and navigation
  - Distinguish unknown prop vs wrong value type vs missing required prop
  - Distinguish unknown event vs known event with wrong handler signature
  - Distinguish unknown slot vs slot props mismatch
  - Improve document symbols and block-level navigation for large `.nd` files
- Vite plugin: type-aware diagnostics
  - Surface template-type failures with better source ranges and code frames
  - Surface cross-component contract failures with clearer recovery guidance
  - Keep serving last good output safely while still reporting type failures
  - Tighten HMR status reporting so users know when they are on preserved output
- Starter maturity
  - Ensure every official starter has a clean type-check path
  - Make generated `env.d.ts`, workspace typing, and starter templates consistent
  - Reduce starter-side ambient shims over time by improving real public type exports

Exit criteria:

- the VSCode extension can explain most contract failures directly in-editor
- Vite overlay and editor diagnostics tell the same story for typed `.nd` failures
- official starters type-check cleanly without ad-hoc local patching

Recommended validation during P1:

- VSCode language-service smoke
- Vite plugin smoke
- starter type-check smoke
- affected package builds

## P2: Mature Type Workflow And Public API Stability

Goal: make NodomX feel safe for teams adopting it as a typed framework, not just a capable runtime.

- Public API type cleanup
  - Strengthen real root exports for `nodomx`, router, store, SSR, and starter-facing APIs
  - Reduce the need for starter-generated ambient compatibility shims
  - Make package boundaries explicit and type-safe across workspaces
- Typed higher-level ecosystem flows
  - Typed route payload/query helpers
  - Stronger store typings and helper types
  - Stronger SSR payload typings and resume helpers
  - More reliable typed async-component and `Suspense` boundaries
- Tool maturity and resilience
  - Better watcher invalidation and cache consistency in compiler/Vite/editor flows
  - More resilient sourcemap and error-recovery behavior for large `.nd` files
  - Clearer starter upgrade paths and release notes for type-level changes
- Documentation maturity
  - TypeScript-first docs for `.nd`
  - Contract-oriented docs for props / emits / slots / model
  - Tooling docs for `nd-tsc`, Vite overlays, and editor diagnostics

Exit criteria:

- root public type exports are strong enough that starter shims become minimal
- typed router/store/SSR flows are documented and validated
- type-driven workflows are stable enough for team adoption

Recommended validation during P2:

- targeted package tests
- starter matrix build/type-check validation
- SSR/store/router smoke on affected flows

## P3: Full Regression, Compatibility, And Release Gate

Goal: after the type/tooling work is mature, run the full hardening pass before the next major outward push.

- Full regression
  - `npm run test:all`
  - `npm run build:all`
  - `npm run release:check`
- Starter matrix gate
  - create each official starter
  - install or link dependencies
  - build
  - type-check
  - run starter-specific smoke where available
- Tooling gate
  - compiler declaration and type-check validation
  - Vite plugin error overlay and HMR recovery validation
  - VSCode extension packaging and contract-diagnostic smoke
  - SSR/SSG smoke
- Compatibility gate
  - Node version matrix
  - Windows/macOS/Linux path sensitivity checks where possible
  - npm pack / VSIX pack validation
- Documentation and release signoff
  - docs reflect the current public typed workflow
  - release notes call out any type-contract breaking changes
  - publish checklist is green

Exit criteria:

- full matrix is green
- public docs match shipped behavior
- release can proceed without known type/tooling regressions

## Suggested execution order

1. `P0` first: make the type surface solid enough to trust.
2. `P1` second: make editor and Vite tooling consume that model.
3. `P2` third: harden public typed APIs and reduce ecosystem rough edges.
4. `P3` last: run the exhaustive test and release gate only after the first three phases settle.

## What success looks like

At the end of this roadmap:

- `.nd` is not just TypeScript-compatible, but TypeScript-first
- Vite and the VSCode plugin tell a consistent story about errors
- official starters work without fragile type shims
- teams can adopt NodomX with much more confidence in contracts, tooling, and upgrades
