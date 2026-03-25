# NodomX ND VSCode Extension

Local VSCode support for `.nd` single-file components.

Features:

- registers the `.nd` language
- highlights `<template>`, `<script>`, `<style>`
- highlights `{{ ... }}` expressions inside template blocks
- starts a language server for completions, diagnostics and go-to-definition
- provides the `NodomX: Compile Current .nd File` command
- supports compile-on-save to sibling generated modules

The compile command writes a sibling file such as:

```text
App.nd -> App.nd.gen.mjs
```

Settings:

- `nodomx.nd.compileOnSave`
- `nodomx.nd.enableLanguageServer`
- `nodomx.nd.importSource`
- `nodomx.nd.outputSuffix`
