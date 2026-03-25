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
```

API:

- `compileFile(file)`
- `compilePath(fileOrDirectory)`
- `collectNdFiles(directory)`
- `watchNd(fileOrDirectory)`

When you watch a directory, changed `.nd` files are recompiled automatically and deleted source files remove their sibling generated modules.
