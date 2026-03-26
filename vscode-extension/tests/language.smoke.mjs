import assert from "node:assert/strict";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
    analyzeNdDocument,
    getNdCompletions,
    getNdDefinition
} from "../src/language-core.mjs";

const source = `
<template>
  <div class="counter">
    <p>{{count}}</p>
    <button e-click="add">+1</button>
  </div>
</template>

<script>
import { useState } from "nodomx";

export default {
  setup() {
    const count = useState(1);
    const add = () => {
      count.value++;
    };

    return {
      count,
      add
    };
  }
}
</script>
`;

const document = TextDocument.create("file:///Counter.nd", "nd", 1, source);
const analysis = analyzeNdDocument(document);
assert.equal(analysis.diagnostics.length, 0);
assert.ok(analysis.scriptAnalysis.exposedSymbols.has("count"));
assert.ok(analysis.scriptAnalysis.exposedSymbols.has("add"));

const countOffset = source.indexOf("{{count}}") + 3;
const definition = getNdDefinition(document, document.positionAt(countOffset));
assert.ok(definition);
const definitionLine = source.split(/\r?\n/)[definition.range.start.line];
assert.match(definitionLine, /const count = useState/);

const completions = getNdCompletions(document, document.positionAt(countOffset));
assert.ok(completions.some(item => item.label === "count"));
assert.ok(completions.some(item => item.label === "e-click"));

const invalidDocument = TextDocument.create("file:///Broken.nd", "nd", 1, source.replace("{{count}}", "{{missingValue}}"));
const invalidAnalysis = analyzeNdDocument(invalidDocument);
assert.ok(invalidAnalysis.diagnostics.some(item => /Unknown template symbol/.test(item.message)));

const setupSource = `
<template>
  <div class="counter">
    <p>{{count}}</p>
    <button e-click="add">+1</button>
  </div>
</template>

<script setup>
import { useState } from "nodomx";

defineOptions({
  modules: []
});

const count = useState(1);
const add = () => {
  count.value++;
};
</script>
`;

const setupDocument = TextDocument.create("file:///SetupCounter.nd", "nd", 1, setupSource);
const setupAnalysis = analyzeNdDocument(setupDocument);
assert.equal(setupAnalysis.diagnostics.length, 0);
assert.ok(setupAnalysis.scriptAnalysis.exposedSymbols.has("count"));
assert.ok(setupAnalysis.scriptAnalysis.exposedSymbols.has("add"));

console.log("language service smoke test passed");
