# `@nodomx/nd-compiler`

Compiler utilities for NodomX `.nd` single-file components.

Supported blocks:

- `<template>`
- `<script>`
- `<style>`
- `<style scoped>`

CLI examples:

```bash
ndc ./src/App.nd --out ./src/App.nd.gen.mjs
ndc ./src --watch
nd-tsc ./src
nd-tsc ./src --declaration
```

API:

- `compileFile(file)`
- `compilePath(fileOrDirectory)`
- `collectNdFiles(directory)`
- `watchNd(fileOrDirectory)`
- `runNdTypeCheck(fileOrDirectory)`
- `watchNdTypes(fileOrDirectory)`

When you watch a directory, changed `.nd` files are recompiled automatically and deleted source files remove their sibling generated modules.

`nd-tsc` is the type-focused companion CLI. It validates typed `.nd` files, template bindings, and cross-component contracts without emitting JavaScript output. When used with `--declaration`, it can also write `.d.nd.ts` files during the same pass.
