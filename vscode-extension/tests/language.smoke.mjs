import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
    analyzeNdDocument,
    formatNdDocument,
    getNdCodeActions,
    getNdCompletions,
    getNdDefinition,
    getNdDocumentLinks,
    getNdDocumentSymbols,
    getNdFoldingRanges,
    getNdHover,
    getNdReferences,
    getNdRenameEdit,
    getNdSemanticTokens,
    getNdSelectionRanges
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

const hover = getNdHover(document, document.positionAt(countOffset));
assert.ok(hover);
assert.match(hover.contents.value, /count/);
assert.match(hover.contents.value, /setup\(\) local binding/);

const references = getNdReferences(document, document.positionAt(countOffset));
assert.ok(references.length >= 2);
assert.ok(references.some(item => item.range.start.line === definition.range.start.line));
assert.ok(references.some(item => item.range.start.line !== definition.range.start.line));

const renameEdit = getNdRenameEdit(document, document.positionAt(countOffset), "total");
assert.ok(renameEdit);
assert.equal(renameEdit.changes["file:///Counter.nd"].length, references.length);
assert.ok(renameEdit.changes["file:///Counter.nd"].every(item => item.newText === "total"));

const completions = getNdCompletions(document, document.positionAt(countOffset));
assert.ok(completions.some(item => item.label === "count"));
assert.ok(completions.some(item => item.label === "e-click"));

const tagOffset = source.indexOf("<div") + 1;
const tagCompletions = getNdCompletions(document, document.positionAt(tagOffset));
assert.ok(tagCompletions.some(item => item.label === "div"));
assert.ok(tagCompletions.some(item => item.label === "button"));

const attrOffset = source.indexOf('class="counter"') + 2;
const attrCompletions = getNdCompletions(document, document.positionAt(attrOffset));
assert.ok(attrCompletions.some(item => item.label === "class"));
assert.ok(attrCompletions.some(item => item.label === "x-if"));

const invalidDocument = TextDocument.create("file:///Broken.nd", "nd", 1, source.replace("{{count}}", "{{missingValue}}"));
const invalidAnalysis = analyzeNdDocument(invalidDocument);
assert.ok(invalidAnalysis.diagnostics.some(item => /Unknown template symbol/.test(item.message)));

const setupSource = `
<template>
  <div class="counter">
    <Suspense fallback="Loading child..." error="Child failed." timeout="80" retry-key={{retryToken}}>
      <AsyncChild />
    </Suspense>
    <Transition name="fade">
      <p x-if={{count}}>{{count}}</p>
    </Transition>
    <Teleport to="#modal-root">
      <AsyncChild />
    </Teleport>
    <p>{{count}}</p>
    <button e-click="add">+1</button>
  </div>
</template>

<script setup>
import { defineAsyncComponent, useState } from "nodomx";

defineOptions({
  modules: [AsyncChild]
});

const AsyncChild = defineAsyncComponent(() => import("./AsyncChild.nd"));
const count = useState(1);
const retryToken = useState(0);
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
assert.ok(setupAnalysis.scriptAnalysis.templateComponents.has("AsyncChild"));

const apiHoverOffset = setupSource.indexOf("defineOptions") + 2;
const apiHover = getNdHover(setupDocument, setupDocument.positionAt(apiHoverOffset));
assert.ok(apiHover);
assert.match(apiHover.contents.value, /defineOptions/);

const teleportOffset = setupSource.indexOf("<Teleport") + 1;
const teleportCompletions = getNdCompletions(setupDocument, setupDocument.positionAt(teleportOffset));
assert.ok(teleportCompletions.some(item => item.label === "Teleport"));
assert.ok(teleportCompletions.some(item => item.label === "Suspense"));
assert.ok(teleportCompletions.some(item => item.label === "Transition"));
assert.ok(teleportCompletions.some(item => item.label === "TransitionGroup"));

const teleportAttrOffset = setupSource.indexOf('to="#modal-root"') + 1;
const teleportAttrCompletions = getNdCompletions(setupDocument, setupDocument.positionAt(teleportAttrOffset));
assert.ok(teleportAttrCompletions.some(item => item.label === "to"));
assert.ok(teleportAttrCompletions.some(item => item.label === "disabled"));

const transitionAttrOffset = setupSource.indexOf('name="fade"') + 1;
const transitionAttrCompletions = getNdCompletions(setupDocument, setupDocument.positionAt(transitionAttrOffset));
assert.ok(transitionAttrCompletions.some(item => item.label === "name"));
assert.ok(transitionAttrCompletions.some(item => item.label === "duration"));

const suspenseAttrOffset = setupSource.indexOf('fallback="Loading child..."') + 1;
const suspenseAttrCompletions = getNdCompletions(setupDocument, setupDocument.positionAt(suspenseAttrOffset));
assert.ok(suspenseAttrCompletions.some(item => item.label === "fallback"));
assert.ok(suspenseAttrCompletions.some(item => item.label === "error"));
assert.ok(suspenseAttrCompletions.some(item => item.label === "timeout"));
assert.ok(suspenseAttrCompletions.some(item => item.label === "retry-key"));

const componentTagOffset = setupSource.indexOf("<AsyncChild") + 2;
const componentDefinition = getNdDefinition(setupDocument, setupDocument.positionAt(componentTagOffset));
assert.ok(componentDefinition);
const componentReferences = getNdReferences(setupDocument, setupDocument.positionAt(componentTagOffset));
assert.ok(componentReferences.length >= 2);
const componentRename = getNdRenameEdit(setupDocument, setupDocument.positionAt(componentTagOffset), "LazyChild");
assert.ok(componentRename);
assert.ok(componentRename.changes["file:///SetupCounter.nd"].some(item => item.newText === "LazyChild"));

const teleportHover = getNdHover(setupDocument, setupDocument.positionAt(teleportOffset + 2));
assert.ok(teleportHover);
assert.match(teleportHover.contents.value, /Teleport/);
const transitionOffset = setupSource.indexOf("<Transition") + 2;
const transitionHover = getNdHover(setupDocument, setupDocument.positionAt(transitionOffset));
assert.ok(transitionHover);
assert.match(transitionHover.contents.value, /Transition/);
const suspenseOffset = setupSource.indexOf("<Suspense") + 2;
const suspenseHover = getNdHover(setupDocument, setupDocument.positionAt(suspenseOffset));
assert.ok(suspenseHover);
assert.match(suspenseHover.contents.value, /Suspense/);
assert.match(suspenseHover.contents.value, /error/);
assert.match(suspenseHover.contents.value, /transition/);

const scriptCompletions = getNdCompletions(setupDocument, setupDocument.positionAt(setupSource.indexOf("const count")));
assert.ok(scriptCompletions.some(item => item.label === "onSuspensePending"));
assert.ok(scriptCompletions.some(item => item.label === "onSuspenseError"));
assert.ok(scriptCompletions.some(item => item.label === "onSuspenseRetry"));
assert.ok(scriptCompletions.some(item => item.label === "onActivated"));
assert.ok(scriptCompletions.some(item => item.label === "onDeactivated"));

const setupSymbols = getNdDocumentSymbols(setupDocument);
assert.ok(setupSymbols.some(item => item.name === "template"));
assert.ok(setupSymbols.some(item => item.name === "script setup"));
assert.ok(setupSymbols.find(item => item.name === "template")?.children?.some(item => item.name.startsWith("Suspense")));
assert.ok(setupSymbols.find(item => item.name === "template")?.children?.some(item => item.name.startsWith("Teleport")));
assert.ok(setupSymbols.find(item => item.name === "template")?.children?.some(item => item.name.startsWith("Transition")));
assert.ok(setupSymbols.find(item => item.name === "script setup")?.children?.some(item => item.name === "count"));
const templateSymbols = setupSymbols.find(item => item.name === "template")?.children || [];
const suspenseSymbol = templateSymbols.find(item => item.name.startsWith("Suspense"));
assert.ok(suspenseSymbol?.children?.some(item => item.name === "AsyncChild"));
assert.match(suspenseSymbol?.name || "", /timeout=80/);
assert.match(suspenseSymbol?.name || "", /retry-key=/);
const transitionSymbol = templateSymbols.find(item => item.name.startsWith("Transition"));
assert.ok(transitionSymbol?.children?.some(item => item.name.startsWith("p (x-if")));
const teleportSymbol = templateSymbols.find(item => item.name.startsWith("Teleport"));
assert.ok(teleportSymbol?.children?.some(item => item.name === "AsyncChild"));
const setupFoldingRanges = getNdFoldingRanges(setupDocument);
assert.ok(setupFoldingRanges.some(item => item.kind === "template"));
assert.ok(setupFoldingRanges.some(item => item.kind === "script"));
const setupSelectionRanges = getNdSelectionRanges(setupDocument, [setupDocument.positionAt(setupSource.indexOf("count.value"))]);
assert.ok(setupSelectionRanges[0]?.parent);
assert.ok(setupSelectionRanges[0]?.parent?.parent);

const semanticTokens = getNdSemanticTokens(setupDocument);
assert.ok(semanticTokens.some(item => item.tokenType === "class"));
assert.ok(semanticTokens.some(item => item.tokenType === "function"));
assert.ok(semanticTokens.some(item => item.tokenType === "property"));
assert.ok(semanticTokens.some(item => item.tokenType === "string"));
assert.ok(semanticTokens.some(item => item.tokenType === "number"));
assert.ok(semanticTokens.some(item => item.modifiers?.includes("defaultLibrary")));

const renameMiss = getNdRenameEdit(setupDocument, setupDocument.positionAt(apiHoverOffset), "1bad");
assert.equal(renameMiss, null);

const unknownComponentSource = `
<template>
  <MissingPanel />
</template>

<script setup>
const count = 1;
</script>
`;
const unknownDocument = TextDocument.create("file:///Unknown.nd", "nd", 1, unknownComponentSource);
const unknownAnalysis = analyzeNdDocument(unknownDocument);
assert.ok(unknownAnalysis.diagnostics.some(item => /Unknown component/.test(item.message)));

const importedOnlySource = `
<template>
  <AsyncPanel />
</template>

<script setup>
import AsyncPanel from "./AsyncPanel.nd";
</script>
`;
const importedOnlyDocument = TextDocument.create("file:///ImportedOnly.nd", "nd", 1, importedOnlySource);
const importedOnlyAnalysis = analyzeNdDocument(importedOnlyDocument);
assert.ok(importedOnlyAnalysis.diagnostics.some(item => /not registered in defineOptions/.test(item.message)));
const importedOnlyActions = getNdCodeActions(importedOnlyDocument, { diagnostics: importedOnlyAnalysis.diagnostics });
assert.ok(importedOnlyActions.some(item => /Register `AsyncPanel` in modules/.test(item.title)));

const importedOnlyOffset = importedOnlySource.indexOf("<AsyncPanel") + 2;
const importedOnlyDefinition = getNdDefinition(importedOnlyDocument, importedOnlyDocument.positionAt(importedOnlyOffset));
assert.ok(importedOnlyDefinition);
const importedOnlyReferences = getNdReferences(importedOnlyDocument, importedOnlyDocument.positionAt(importedOnlyOffset));
assert.ok(importedOnlyReferences.length >= 2);

const contractTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nd-language-contract-"));
const childContractFile = path.join(contractTmpDir, "ContractChild.nd");
const parentContractFile = path.join(contractTmpDir, "ContractParent.nd");
await fs.writeFile(childContractFile, `
<template>
  <article class="contract-child">
    <slot name="header"></slot>
    <slot name="footer"></slot>
    <slot></slot>
  </article>
</template>

<script setup>
const props = withDefaults(defineProps(), {});
defineEmits(["submit", "refresh", "update:modelValue"]);
defineSlots({
  aside: true
});
defineModel();

const title = props.title;
const tone = props.tone;
</script>
`, "utf8");
await fs.writeFile(parentContractFile, `
<template>
  <ContractChild
    title={{title}}
    tone="info"
    model-value={{modelValue}}
    extra="oops"
    on-submit={{handleSubmit}}
    on-cancel={{handleSubmit}}
  >
    <slot name="header">
      <h2>{{title}}</h2>
    </slot>
    <slot name="aside">
      <p>aside</p>
    </slot>
    <slot name="mystery">
      <p>bad slot</p>
    </slot>
  </ContractChild>
</template>

<script setup>
import ContractChild from "./ContractChild.nd";

defineOptions({
  modules: [ContractChild]
});

const title = "hello";
const modelValue = "bound";
const handleSubmit = () => {};
</script>
`, "utf8");

const contractDocument = TextDocument.create(pathToFileURL(parentContractFile).href, "nd", 1, await fs.readFile(parentContractFile, "utf8"));
const contractAnalysis = analyzeNdDocument(contractDocument);
assert.ok(contractAnalysis.diagnostics.some(item => /Unknown prop `extra`/.test(item.message)));
assert.ok(contractAnalysis.diagnostics.some(item => /Unknown emitted event handler `on-cancel`/.test(item.message)));
assert.ok(contractAnalysis.diagnostics.some(item => /Unknown named slot `mystery`/.test(item.message)));
assert.ok(!contractAnalysis.diagnostics.some(item => /Unknown prop `title`/.test(item.message)));
assert.ok(!contractAnalysis.diagnostics.some(item => /Unknown prop `tone`/.test(item.message)));
assert.ok(!contractAnalysis.diagnostics.some(item => /Unknown prop `model-value`/.test(item.message)));
assert.ok(!contractAnalysis.diagnostics.some(item => /Unknown named slot `header`/.test(item.message)));
assert.ok(!contractAnalysis.diagnostics.some(item => /Unknown named slot `aside`/.test(item.message)));

const contractAttrOffset = contractDocument.getText().indexOf('title={{title}}') + 2;
const contractAttrCompletions = getNdCompletions(contractDocument, contractDocument.positionAt(contractAttrOffset));
assert.ok(contractAttrCompletions.some(item => item.label === "title"));
assert.ok(contractAttrCompletions.some(item => item.label === "tone"));
assert.ok(contractAttrCompletions.some(item => item.label === "model-value"));
assert.ok(contractAttrCompletions.some(item => item.label === "on-submit"));
assert.ok(contractAttrCompletions.some(item => item.label === "on-refresh"));
assert.ok(contractAttrCompletions.some(item => item.label === "on:update:model-value"));

const contractHoverOffset = contractDocument.getText().indexOf("<ContractChild") + 2;
const contractHover = getNdHover(contractDocument, contractDocument.positionAt(contractHoverOffset));
assert.ok(contractHover);
assert.match(contractHover.contents.value, /\*\*Props\*\*/);
assert.match(contractHover.contents.value, /`title`/);
assert.match(contractHover.contents.value, /`tone`/);
assert.match(contractHover.contents.value, /`modelValue`/);
assert.match(contractHover.contents.value, /\*\*Emits\*\*/);
assert.match(contractHover.contents.value, /`submit`/);
assert.match(contractHover.contents.value, /`refresh`/);
assert.match(contractHover.contents.value, /`update:modelValue`/);
assert.match(contractHover.contents.value, /\*\*Slots\*\*/);
assert.match(contractHover.contents.value, /`header`/);
assert.match(contractHover.contents.value, /`footer`/);
assert.match(contractHover.contents.value, /`aside`/);

const contractPropDefinition = getNdDefinition(
    contractDocument,
    contractDocument.positionAt(contractDocument.getText().indexOf('title={{title}}') + 2)
);
assert.ok(contractPropDefinition);
assert.equal(contractPropDefinition.uri, pathToFileURL(childContractFile).href);

const contractPropReferences = getNdReferences(
    contractDocument,
    contractDocument.positionAt(contractDocument.getText().indexOf('title={{title}}') + 2)
);
assert.ok(contractPropReferences.some(item => item.uri === pathToFileURL(childContractFile).href));
assert.ok(contractPropReferences.some(item => item.uri === contractDocument.uri));

const contractEventDefinition = getNdDefinition(
    contractDocument,
    contractDocument.positionAt(contractDocument.getText().indexOf('on-submit={{handleSubmit}}') + 3)
);
assert.ok(contractEventDefinition);
assert.equal(contractEventDefinition.uri, pathToFileURL(childContractFile).href);

const contractEventReferences = getNdReferences(
    contractDocument,
    contractDocument.positionAt(contractDocument.getText().indexOf('on-submit={{handleSubmit}}') + 3)
);
assert.ok(contractEventReferences.some(item => item.uri === pathToFileURL(childContractFile).href));
assert.ok(contractEventReferences.some(item => item.uri === contractDocument.uri));

const contractSlotDefinition = getNdDefinition(
    contractDocument,
    contractDocument.positionAt(contractDocument.getText().indexOf('name="header"') + 7)
);
assert.ok(contractSlotDefinition);
assert.equal(contractSlotDefinition.uri, pathToFileURL(childContractFile).href);

const contractSlotReferences = getNdReferences(
    contractDocument,
    contractDocument.positionAt(contractDocument.getText().indexOf('name="header"') + 7)
);
assert.ok(contractSlotReferences.some(item => item.uri === pathToFileURL(childContractFile).href));
assert.ok(contractSlotReferences.some(item => item.uri === contractDocument.uri));

const contractPropHover = getNdHover(
    contractDocument,
    contractDocument.positionAt(contractDocument.getText().indexOf('title={{title}}') + 2)
);
assert.ok(contractPropHover);
assert.match(contractPropHover.contents.value, /Prop `title`/);
assert.match(contractPropHover.contents.value, /ContractChild/);

const contractEventHover = getNdHover(
    contractDocument,
    contractDocument.positionAt(contractDocument.getText().indexOf('on-submit={{handleSubmit}}') + 3)
);
assert.ok(contractEventHover);
assert.match(contractEventHover.contents.value, /Event `submit`/);
assert.match(contractEventHover.contents.value, /ContractChild/);

const contractSlotHover = getNdHover(
    contractDocument,
    contractDocument.positionAt(contractDocument.getText().indexOf('name="header"') + 7)
);
assert.ok(contractSlotHover);
assert.match(contractSlotHover.contents.value, /Slot `header`/);
assert.match(contractSlotHover.contents.value, /ContractChild/);

const contractPropRename = getNdRenameEdit(
    contractDocument,
    contractDocument.positionAt(contractDocument.getText().indexOf('title={{title}}') + 2),
    "headline"
);
assert.ok(contractPropRename);
assert.ok(contractPropRename.changes[contractDocument.uri]?.some(item => item.newText === "headline"));
assert.ok(contractPropRename.changes[pathToFileURL(childContractFile).href]?.some(item => item.newText === "headline"));

const contractEventRename = getNdRenameEdit(
    contractDocument,
    contractDocument.positionAt(contractDocument.getText().indexOf('on-submit={{handleSubmit}}') + 3),
    "confirm"
);
assert.ok(contractEventRename);
assert.ok(contractEventRename.changes[contractDocument.uri]?.some(item => item.newText === "on-confirm"));
assert.ok(contractEventRename.changes[pathToFileURL(childContractFile).href]?.some(item => item.newText.includes("confirm")));

const contractSlotRename = getNdRenameEdit(
    contractDocument,
    contractDocument.positionAt(contractDocument.getText().indexOf('name="header"') + 7),
    "lead"
);
assert.ok(contractSlotRename);
assert.ok(contractSlotRename.changes[contractDocument.uri]?.some(item => item.newText === "lead"));
assert.ok(contractSlotRename.changes[pathToFileURL(childContractFile).href]?.some(item => /lead/.test(item.newText)));

const typoParentContractFile = path.join(contractTmpDir, "ContractTypoParent.nd");
await fs.writeFile(typoParentContractFile, `
<template>
  <ContractChild
    titel={{title}}
    on-submt={{handleSubmit}}
  >
    <slot name="hedaer">
      <h2>{{title}}</h2>
    </slot>
  </ContractChild>
</template>

<script setup>
import ContractChild from "./ContractChild.nd";

defineOptions({
  modules: [ContractChild]
});

const title = "hello";
const handleSubmit = () => {};
</script>
`, "utf8");

const typoContractDocument = TextDocument.create(
    pathToFileURL(typoParentContractFile).href,
    "nd",
    1,
    await fs.readFile(typoParentContractFile, "utf8")
);
const typoContractAnalysis = analyzeNdDocument(typoContractDocument);
assert.ok(typoContractAnalysis.diagnostics.some(item => /Unknown prop `titel`/.test(item.message)));
assert.ok(typoContractAnalysis.diagnostics.some(item => /Unknown emitted event handler `on-submt`/.test(item.message)));
assert.ok(typoContractAnalysis.diagnostics.some(item => /Unknown named slot `hedaer`/.test(item.message)));
const typoContractActions = getNdCodeActions(typoContractDocument, { diagnostics: typoContractAnalysis.diagnostics });
assert.ok(typoContractActions.some(item => /Rename prop to `title`/.test(item.title)));
assert.ok(typoContractActions.some(item => /Rename event handler to `on-submit`/.test(item.title)));
assert.ok(typoContractActions.some(item => /Rename slot to `header`/.test(item.title)));

const contractDeclareActions = getNdCodeActions(contractDocument, { diagnostics: contractAnalysis.diagnostics });
assert.ok(contractDeclareActions.some(item => /Declare event `cancel` in `ContractChild`/.test(item.title)));
assert.ok(contractDeclareActions.some(item => /Declare slot `mystery` in `ContractChild`/.test(item.title)));
assert.ok(contractDeclareActions.some(item => /Remove unknown prop `extra` from component usage/.test(item.title)));
assert.ok(contractDeclareActions.some(item => /Remove unknown event handler `on-cancel` from component usage/.test(item.title)));
assert.ok(contractDeclareActions.some(item => /Remove unknown named slot `mystery` from component usage/.test(item.title)));
const declareAllContractAction = contractDeclareActions.find(item => /Declare all current unknown contract entries in `ContractChild`/.test(item.title));
assert.ok(declareAllContractAction);
const declareAllContractEdits = declareAllContractAction.edit?.documentChanges?.find(item => item.textDocument?.uri === pathToFileURL(childContractFile).href)?.edits || [];
assert.ok(declareAllContractEdits.some(edit => /extra: null/.test(edit.newText)));
assert.ok(declareAllContractEdits.some(edit => /"cancel"/.test(edit.newText)));
assert.ok(declareAllContractEdits.some(edit => /mystery: true/.test(edit.newText)));
const removeAllUnknownUsageAction = contractDeclareActions.find(item => /Remove all unknown usage from `ContractChild`/.test(item.title));
assert.ok(removeAllUnknownUsageAction);
const removeAllUnknownUsageEdits = removeAllUnknownUsageAction.edit?.changes?.[contractDocument.uri] || [];
assert.ok(removeAllUnknownUsageEdits.some(edit => /extra="oops"/.test(contractDocument.getText(edit.range))));
assert.ok(removeAllUnknownUsageEdits.some(edit => /on-cancel=\{\{handleSubmit\}\}/.test(contractDocument.getText(edit.range))));
assert.ok(removeAllUnknownUsageEdits.some(edit => /<slot name="mystery">/.test(contractDocument.getText(edit.range))));
const contractNodeRange = {
    start: contractDocument.positionAt(contractDocument.getText().indexOf("<ContractChild") + 2),
    end: contractDocument.positionAt(contractDocument.getText().indexOf("<ContractChild") + 2)
};
const contractNodeActions = getNdCodeActions(contractDocument, {}, contractNodeRange);
const syncChildContractAction = contractNodeActions.find(item => /Sync `ContractChild` child contract from current usage/.test(item.title));
assert.ok(syncChildContractAction);
const syncChildContractEdits = syncChildContractAction.edit?.documentChanges?.find(item => item.textDocument?.uri === pathToFileURL(childContractFile).href)?.edits || [];
assert.ok(syncChildContractEdits.some(edit => /extra: null/.test(edit.newText)));
assert.ok(syncChildContractEdits.some(edit => /"cancel"/.test(edit.newText)));
assert.ok(syncChildContractEdits.some(edit => /mystery: true/.test(edit.newText)));
const syncChildPropsAction = contractNodeActions.find(item => /Sync `ContractChild` child props from current usage/.test(item.title));
assert.ok(syncChildPropsAction);
const syncChildPropsEdits = syncChildPropsAction.edit?.documentChanges?.find(item => item.textDocument?.uri === pathToFileURL(childContractFile).href)?.edits || [];
assert.ok(syncChildPropsEdits.some(edit => /extra: null/.test(edit.newText)));
assert.ok(syncChildPropsEdits.every(edit => !/"cancel"/.test(edit.newText)));
const syncChildEventsAction = contractNodeActions.find(item => /Sync `ContractChild` child emits from current usage/.test(item.title));
assert.ok(syncChildEventsAction);
const syncChildEventsEdits = syncChildEventsAction.edit?.documentChanges?.find(item => item.textDocument?.uri === pathToFileURL(childContractFile).href)?.edits || [];
assert.ok(syncChildEventsEdits.some(edit => /"cancel"/.test(edit.newText)));
assert.ok(syncChildEventsEdits.every(edit => !/mystery: true/.test(edit.newText)));
const syncChildSlotsAction = contractNodeActions.find(item => /Sync `ContractChild` child slots from current usage/.test(item.title));
assert.ok(syncChildSlotsAction);
const syncChildSlotsEdits = syncChildSlotsAction.edit?.documentChanges?.find(item => item.textDocument?.uri === pathToFileURL(childContractFile).href)?.edits || [];
assert.ok(syncChildSlotsEdits.some(edit => /mystery: true/.test(edit.newText)));
assert.ok(syncChildSlotsEdits.every(edit => !/extra: null/.test(edit.newText)));
const pruneContractAction = contractNodeActions.find(item => /Prune `ContractChild` usage to component contract/.test(item.title));
assert.ok(pruneContractAction);
const pruneContractEdits = pruneContractAction.edit?.changes?.[contractDocument.uri] || [];
assert.ok(pruneContractEdits.some(edit => /extra="oops"/.test(contractDocument.getText(edit.range))));
assert.ok(pruneContractEdits.some(edit => /on-cancel=\{\{handleSubmit\}\}/.test(contractDocument.getText(edit.range))));
assert.ok(pruneContractEdits.some(edit => /<slot name="mystery">/.test(contractDocument.getText(edit.range))));
const normalizeContractAction = contractNodeActions.find(item => /Normalize `ContractChild` usage against component contract/.test(item.title));
assert.ok(normalizeContractAction);
const normalizeContractEdits = normalizeContractAction.edit?.changes?.[contractDocument.uri] || [];
assert.ok(normalizeContractEdits.some(edit => /footer content/.test(edit.newText)));
assert.ok(normalizeContractEdits.some(edit => /extra="oops"/.test(contractDocument.getText(edit.range))));

const propContractChildFile = path.join(contractTmpDir, "PropContractChild.nd");
const propContractParentFile = path.join(contractTmpDir, "PropContractParent.nd");
await fs.writeFile(propContractChildFile, `
<template>
  <section>{{props.title}}</section>
</template>

<script setup>
const props = defineProps({
  title: null
});
</script>
`, "utf8");
await fs.writeFile(propContractParentFile, `
<template>
  <PropContractChild title={{title}} extra-flag={{flag}} />
</template>

<script setup>
import PropContractChild from "./PropContractChild.nd";

defineOptions({
  modules: [PropContractChild]
});

const title = "hello";
const flag = true;
</script>
`, "utf8");

const propContractDocument = TextDocument.create(
    pathToFileURL(propContractParentFile).href,
    "nd",
    1,
    await fs.readFile(propContractParentFile, "utf8")
);
const propContractAnalysis = analyzeNdDocument(propContractDocument);
assert.ok(propContractAnalysis.diagnostics.some(item => /Unknown prop `extra-flag`/.test(item.message)));
const propContractActions = getNdCodeActions(propContractDocument, { diagnostics: propContractAnalysis.diagnostics });
assert.ok(propContractActions.some(item => /Declare prop `extra-flag` in `PropContractChild`/.test(item.title)));

const malformedTemplateSource = `
<template>
  <div class="hero" class="hero-again">
    <section>
  </div>
</template>

<script setup>
const ready = true;
</script>
`;
const malformedTemplateDocument = TextDocument.create("file:///Malformed.nd", "nd", 1, malformedTemplateSource);
const malformedTemplateAnalysis = analyzeNdDocument(malformedTemplateDocument);
assert.ok(malformedTemplateAnalysis.diagnostics.some(item => /Duplicate attribute/.test(item.message)));
assert.ok(malformedTemplateAnalysis.diagnostics.some(item => /does not match the currently open tag/.test(item.message)));
assert.ok(malformedTemplateAnalysis.diagnostics.some(item => /is not closed/.test(item.message)));
const malformedActions = getNdCodeActions(malformedTemplateDocument, { diagnostics: malformedTemplateAnalysis.diagnostics });
assert.ok(malformedActions.some(item => /Remove duplicate attribute/.test(item.title)));
assert.ok(malformedActions.some(item => /Change closing tag to/.test(item.title)));
assert.ok(malformedActions.some(item => /Insert closing tag `<\/section>`/.test(item.title)));

const repeatWithoutKeySource = `
<template>
  <ul>
    <li x-repeat={{items}}>{{items}}</li>
  </ul>
</template>

<script setup>
const items = [];
</script>
`;
const repeatWithoutKeyDocument = TextDocument.create("file:///RepeatWithoutKey.nd", "nd", 1, repeatWithoutKeySource);
const repeatWithoutKeyAnalysis = analyzeNdDocument(repeatWithoutKeyDocument);
assert.ok(repeatWithoutKeyAnalysis.diagnostics.some(item => /stable `key=\{\{...\}\}` attribute/.test(item.message)));
const repeatWithoutKeyActions = getNdCodeActions(repeatWithoutKeyDocument, { diagnostics: repeatWithoutKeyAnalysis.diagnostics });
assert.ok(repeatWithoutKeyActions.some(item => /Add stable repeat key `key=\{\{id\}\}`/.test(item.title)));

const transitionMultiRootSource = `
<template>
  <Transition>
    <p>one</p>
    <p>two</p>
  </Transition>
</template>

<script setup>
const ready = true;
</script>
`;
const transitionMultiRootDocument = TextDocument.create("file:///TransitionMultiRoot.nd", "nd", 1, transitionMultiRootSource);
const transitionMultiRootAnalysis = analyzeNdDocument(transitionMultiRootDocument);
assert.ok(transitionMultiRootAnalysis.diagnostics.some(item => /should wrap exactly one direct child/.test(item.message)));
const transitionMultiRootActions = getNdCodeActions(transitionMultiRootDocument, { diagnostics: transitionMultiRootAnalysis.diagnostics });
assert.ok(transitionMultiRootActions.some(item => /Wrap `<Transition>` content in a single root <div>/.test(item.title)));
assert.ok(transitionMultiRootActions.some(item => /Convert `<Transition>` to `<TransitionGroup>`/.test(item.title)));

const transitionGroupSource = `
<template>
  <TransitionGroup name="fade">
    <li x-repeat={{items}}>{{items}}</li>
  </TransitionGroup>
</template>

<script setup>
const items = [];
</script>
`;
const transitionGroupDocument = TextDocument.create("file:///TransitionGroup.nd", "nd", 1, transitionGroupSource);
const transitionGroupAnalysis = analyzeNdDocument(transitionGroupDocument);
assert.ok(transitionGroupAnalysis.diagnostics.some(item => /stable `key=\{\{...\}\}` attribute/.test(item.message)));
assert.ok(transitionGroupAnalysis.diagnostics.some(item => /`<TransitionGroup>` direct children should declare a stable `key` attribute/.test(item.message)));
const transitionGroupActions = getNdCodeActions(transitionGroupDocument, { diagnostics: transitionGroupAnalysis.diagnostics });
assert.ok(transitionGroupActions.some(item => /Add stable repeat key `key=\{\{id\}\}`/.test(item.title)));
assert.ok(transitionGroupActions.some(item => /Add stable child key `key=\{\{id\}\}`/.test(item.title)));
const transitionGroupSymbols = getNdDocumentSymbols(transitionGroupDocument);
const transitionGroupTemplate = transitionGroupSymbols.find(item => item.name === "template")?.children || [];
const transitionGroupSymbol = transitionGroupTemplate.find(item => item.name.startsWith("TransitionGroup"));
assert.ok(transitionGroupSymbol?.children?.some(item => item.name.startsWith("li (x-repeat=")));
const transitionGroupHoverOffset = transitionGroupSource.indexOf("<TransitionGroup") + 2;
const transitionGroupHover = getNdHover(transitionGroupDocument, transitionGroupDocument.positionAt(transitionGroupHoverOffset));
assert.ok(transitionGroupHover);
assert.match(transitionGroupHover.contents.value, /TransitionGroup/);
const transitionGroupSelection = getNdSelectionRanges(transitionGroupDocument, [transitionGroupDocument.positionAt(transitionGroupSource.indexOf("x-repeat"))]);
assert.ok(transitionGroupSelection[0]?.parent);
assert.ok(transitionGroupSelection[0]?.parent?.parent);

const keepAliveSource = `
<template>
  <KeepAlive include="PanelA,PanelB" exclude="PanelC" max="fast">
    <PanelA x-if={{showA}} />
    <PanelB x-if={{!showA}} />
  </KeepAlive>
</template>

<script setup>
import PanelA from "./PanelA.nd";
import PanelB from "./PanelB.nd";

defineOptions({
  modules: [PanelA, PanelB]
});

const showA = true;
</script>
`;
const keepAliveDocument = TextDocument.create("file:///KeepAlive.nd", "nd", 1, keepAliveSource);
const keepAliveAnalysis = analyzeNdDocument(keepAliveDocument);
assert.ok(keepAliveAnalysis.diagnostics.some(item => /`<KeepAlive>` `max` should be a non-negative number/.test(item.message)));
assert.ok(!keepAliveAnalysis.diagnostics.some(item => /wrap exactly one direct child/.test(item.message)));
const keepAliveOffset = keepAliveSource.indexOf("<KeepAlive") + 2;
const keepAliveHover = getNdHover(keepAliveDocument, keepAliveDocument.positionAt(keepAliveOffset));
assert.ok(keepAliveHover);
assert.match(keepAliveHover.contents.value, /include/);
assert.match(keepAliveHover.contents.value, /exclude/);
const keepAliveAttrOffset = keepAliveSource.indexOf('include="PanelA,PanelB"') + 1;
const keepAliveAttrCompletions = getNdCompletions(keepAliveDocument, keepAliveDocument.positionAt(keepAliveAttrOffset));
assert.ok(keepAliveAttrCompletions.some(item => item.label === "include"));
assert.ok(keepAliveAttrCompletions.some(item => item.label === "exclude"));
assert.ok(keepAliveAttrCompletions.some(item => item.label === "max"));
const keepAliveActions = getNdCodeActions(keepAliveDocument, { diagnostics: keepAliveAnalysis.diagnostics });
assert.ok(keepAliveActions.some(item => /Normalize KeepAlive max to `1`/.test(item.title)));

const suspenseSource = `
<template>
  <Suspense timeout="later" error="Load failed.">
    <AsyncPanel />
  </Suspense>
</template>

<script setup>
import AsyncPanel from "./AsyncPanel.nd";

defineOptions({
  modules: [AsyncPanel]
});
</script>
`;
const suspenseDocument = TextDocument.create("file:///Suspense.nd", "nd", 1, suspenseSource);
const suspenseAnalysis = analyzeNdDocument(suspenseDocument);
assert.ok(suspenseAnalysis.diagnostics.some(item => /`<Suspense>` `timeout` should be a non-negative number/.test(item.message)));
assert.ok(suspenseAnalysis.diagnostics.some(item => /`<Suspense>` should provide a `fallback` attribute/.test(item.message)));
assert.ok(suspenseAnalysis.diagnostics.some(item => /`<Suspense>` error states can recover more explicitly when `retry-key`/.test(item.message)));
const suspenseActions = getNdCodeActions(suspenseDocument, { diagnostics: suspenseAnalysis.diagnostics });
assert.ok(suspenseActions.some(item => /Normalize Suspense timeout to `0`/.test(item.title)));
assert.ok(suspenseActions.some(item => /Add Suspense fallback `fallback="Loading\.\.\."`/.test(item.title)));
assert.ok(suspenseActions.some(item => /Add Suspense fallback slot block/.test(item.title)));
assert.ok(suspenseActions.some(item => /Add Suspense retry binding `retry-key=\{\{retryToken\}\}`/.test(item.title)));

const suspenseTransitionSource = `
<template>
  <Suspense branch-transition transition-duration="later" transition-name="fade">
    <AsyncPanel />
  </Suspense>
</template>

<script setup>
import AsyncPanel from "./AsyncPanel.nd";

defineOptions({
  modules: [AsyncPanel]
});
</script>
`;
const suspenseTransitionDocument = TextDocument.create("file:///SuspenseTransition.nd", "nd", 1, suspenseTransitionSource);
const suspenseTransitionAnalysis = analyzeNdDocument(suspenseTransitionDocument);
assert.ok(suspenseTransitionAnalysis.diagnostics.some(item => /`<Suspense>` `transition-duration` should be a non-negative number/.test(item.message)));
const suspenseTransitionActions = getNdCodeActions(suspenseTransitionDocument, { diagnostics: suspenseTransitionAnalysis.diagnostics });
assert.ok(suspenseTransitionActions.some(item => /Normalize Suspense transition-duration to `180`/.test(item.title)));
const suspenseTransitionAttrOffset = suspenseTransitionSource.indexOf('transition-duration="later"') + 1;
const suspenseTransitionAttrCompletions = getNdCompletions(suspenseTransitionDocument, suspenseTransitionDocument.positionAt(suspenseTransitionAttrOffset));
assert.ok(suspenseTransitionAttrCompletions.some(item => item.label === "branch-transition"));
assert.ok(suspenseTransitionAttrCompletions.some(item => item.label === "transition-name"));
assert.ok(suspenseTransitionAttrCompletions.some(item => item.label === "transition-duration"));

const suspenseMissingErrorSource = `
<template>
  <Suspense timeout="0">
    <AsyncPanel />
  </Suspense>
</template>

<script setup>
import AsyncPanel from "./AsyncPanel.nd";

defineOptions({
  modules: [AsyncPanel]
});
</script>
`;
const suspenseMissingErrorDocument = TextDocument.create("file:///SuspenseMissingError.nd", "nd", 1, suspenseMissingErrorSource);
const suspenseMissingErrorAnalysis = analyzeNdDocument(suspenseMissingErrorDocument);
assert.ok(suspenseMissingErrorAnalysis.diagnostics.some(item => /`<Suspense>` should provide an `error` attribute/.test(item.message)));
const suspenseMissingErrorActions = getNdCodeActions(suspenseMissingErrorDocument, { diagnostics: suspenseMissingErrorAnalysis.diagnostics });
assert.ok(suspenseMissingErrorActions.some(item => /Add Suspense error `error="Load failed\."`/.test(item.title)));
assert.ok(suspenseMissingErrorActions.some(item => /Add Suspense error slot block/.test(item.title)));

const suspenseSlotSource = `
<template>
  <Suspense fallback="Loading..." error="Failed.">
    <AsyncPanel />
    <slot name="fallback">
      <p>loading slot</p>
    </slot>
    <slot name="error">
      <p>error slot</p>
    </slot>
  </Suspense>
</template>

<script setup>
import AsyncPanel from "./AsyncPanel.nd";

defineOptions({
  modules: [AsyncPanel]
});
</script>
`;
const suspenseSlotDocument = TextDocument.create("file:///SuspenseSlots.nd", "nd", 1, suspenseSlotSource);
const suspenseSlotSymbols = getNdDocumentSymbols(suspenseSlotDocument);
const suspenseSlotTemplate = suspenseSlotSymbols.find(item => item.name === "template")?.children || [];
const suspenseSlotSymbol = suspenseSlotTemplate.find(item => item.name.startsWith("Suspense"));
assert.ok(suspenseSlotSymbol?.children?.some(item => item.name === "slot (fallback)"));
assert.ok(suspenseSlotSymbol?.children?.some(item => item.name === "slot (error)"));
const suspenseFallbackSlotOffset = suspenseSlotSource.indexOf('name="fallback"') + 'name="'.length;
const suspenseFallbackSlotDefinition = getNdDefinition(
    suspenseSlotDocument,
    suspenseSlotDocument.positionAt(suspenseFallbackSlotOffset)
);
assert.ok(suspenseFallbackSlotDefinition);
assert.match(
    suspenseSlotSource.split(/\r?\n/)[suspenseFallbackSlotDefinition.range.start.line],
    /fallback="Loading\.\.\."/
);
const suspenseFallbackAttrOffset = suspenseSlotSource.indexOf('fallback="Loading..."') + 2;
const suspenseFallbackAttrDefinition = getNdDefinition(
    suspenseSlotDocument,
    suspenseSlotDocument.positionAt(suspenseFallbackAttrOffset)
);
assert.ok(suspenseFallbackAttrDefinition);
assert.match(
    suspenseSlotSource.split(/\r?\n/)[suspenseFallbackAttrDefinition.range.start.line],
    /slot name="fallback"/
);
const suspenseFallbackReferences = getNdReferences(
    suspenseSlotDocument,
    suspenseSlotDocument.positionAt(suspenseFallbackSlotOffset)
);
assert.ok(suspenseFallbackReferences.some(item => item.range.start.line === suspenseFallbackSlotDefinition.range.start.line));
assert.ok(suspenseFallbackReferences.some(item => item.range.start.line === suspenseFallbackAttrDefinition.range.start.line));

const suspenseScopedSlotSource = `
<template>
  <Suspense retry-key={{retryToken}}>
    <AsyncPanel />
    <slot name="fallback">
      <p>{{phase}} {{pendingCount}} {{prefix}}</p>
    </slot>
    <slot name="error">
      <p>{{errorMessage}} {{retryKey}} {{prefix}}</p>
    </slot>
  </Suspense>
</template>

<script setup>
import AsyncPanel from "./AsyncPanel.nd";

defineOptions({
  modules: [AsyncPanel]
});

const prefix = "parent";
const retryToken = 0;
</script>
`;
const suspenseScopedSlotDocument = TextDocument.create("file:///workspace/SuspenseScope.nd", "nd", 1, suspenseScopedSlotSource);
const suspenseScopedSlotAnalysis = analyzeNdDocument(suspenseScopedSlotDocument);
assert.ok(!suspenseScopedSlotAnalysis.diagnostics.some(item => /Unknown template symbol `phase`/.test(item.message)));
assert.ok(!suspenseScopedSlotAnalysis.diagnostics.some(item => /Unknown template symbol `pendingCount`/.test(item.message)));
assert.ok(!suspenseScopedSlotAnalysis.diagnostics.some(item => /Unknown template symbol `errorMessage`/.test(item.message)));
assert.ok(!suspenseScopedSlotAnalysis.diagnostics.some(item => /Unknown template symbol `retryKey`/.test(item.message)));
const suspenseScopedCompletionOffset = suspenseScopedSlotSource.indexOf("{{phase") + 2;
const suspenseScopedCompletions = getNdCompletions(suspenseScopedSlotDocument, suspenseScopedSlotDocument.positionAt(suspenseScopedCompletionOffset));
assert.ok(suspenseScopedCompletions.some(item => item.label === "phase"));
assert.ok(suspenseScopedCompletions.some(item => item.label === "pendingCount"));
assert.ok(suspenseScopedCompletions.some(item => item.label === "errorMessage"));
const suspenseScopedHover = getNdHover(suspenseScopedSlotDocument, suspenseScopedSlotDocument.positionAt(suspenseScopedSlotSource.indexOf("pendingCount") + 2));
assert.ok(suspenseScopedHover);
assert.match(suspenseScopedHover.contents.value, /Suspense slot scope/);

const contextualRefactorSource = `
<template>
  <section class="panel-list">
    <PanelCard />
    <Suspense fallback="Loading..." error="Load failed.">
      <AsyncPanel />
    </Suspense>
  </section>
</template>

<script setup>
import AsyncPanel from "./AsyncPanel.nd";
import PanelCard from "./PanelCard.nd";

defineOptions({
  modules: [AsyncPanel, PanelCard]
});
</script>
`;
const contextualRefactorDocument = TextDocument.create("file:///ContextualRefactor.nd", "nd", 1, contextualRefactorSource);
const panelCursorOffset = contextualRefactorSource.indexOf("<PanelCard") + 2;
const panelRange = {
    start: contextualRefactorDocument.positionAt(panelCursorOffset),
    end: contextualRefactorDocument.positionAt(panelCursorOffset)
};
const panelRefactors = getNdCodeActions(contextualRefactorDocument, {}, panelRange);
assert.ok(panelRefactors.some(item => /Wrap current node with `<Transition>`/.test(item.title)));
assert.ok(panelRefactors.some(item => /Wrap current node with `<KeepAlive>`/.test(item.title)));
assert.ok(panelRefactors.some(item => /Wrap current node with `<Suspense>`/.test(item.title)));
assert.ok(panelRefactors.some(item => /Wrap current node with `<Teleport>`/.test(item.title)));
const extractNamedSlotAction = panelRefactors.find(item => /Extract current node to named slot block `panel-card-slot`/.test(item.title));
assert.ok(extractNamedSlotAction);
assert.equal(extractNamedSlotAction.kind, "refactor.extract");
assert.ok(extractNamedSlotAction.edit?.changes?.["file:///ContextualRefactor.nd"]?.some(edit => /<slot name="panel-card-slot">[\s\S]*<PanelCard \/>[\s\S]*<\/slot>/.test(edit.newText)));
const suspenseCursorOffset = contextualRefactorSource.indexOf("<Suspense") + 2;
const suspenseRange = {
    start: contextualRefactorDocument.positionAt(suspenseCursorOffset),
    end: contextualRefactorDocument.positionAt(suspenseCursorOffset)
};
const suspenseRefactors = getNdCodeActions(contextualRefactorDocument, {}, suspenseRange);
assert.ok(suspenseRefactors.some(item => /Convert Suspense fallback attribute to slot block/.test(item.title)));
assert.ok(suspenseRefactors.some(item => /Convert Suspense error attribute to slot block/.test(item.title)));
const fallbackSlotRefactor = suspenseRefactors.find(item => /Convert Suspense fallback attribute to slot block/.test(item.title));
assert.ok(fallbackSlotRefactor?.edit?.changes["file:///ContextualRefactor.nd"].some(edit => /<slot name="fallback">/.test(edit.newText)));
const errorSlotRefactor = suspenseRefactors.find(item => /Convert Suspense error attribute to slot block/.test(item.title));
assert.ok(errorSlotRefactor?.edit?.changes["file:///ContextualRefactor.nd"].some(edit => /<slot name="error">/.test(edit.newText)));
const suspenseDefaultChildRange = {
    start: contextualRefactorDocument.positionAt(contextualRefactorSource.indexOf("<AsyncPanel") + 2),
    end: contextualRefactorDocument.positionAt(contextualRefactorSource.indexOf("<AsyncPanel") + 2)
};
const suspenseDefaultChildRefactors = getNdCodeActions(contextualRefactorDocument, {}, suspenseDefaultChildRange);
const extractFallbackSlotAction = suspenseDefaultChildRefactors.find(item => /Extract current node to Suspense fallback slot block/.test(item.title));
assert.ok(extractFallbackSlotAction);
assert.equal(extractFallbackSlotAction.kind, "refactor.extract");
assert.ok(extractFallbackSlotAction.edit?.changes?.["file:///ContextualRefactor.nd"]?.some(edit => /<slot name="fallback">[\s\S]*<AsyncPanel \/>[\s\S]*<\/slot>/.test(edit.newText)));
const extractErrorSlotAction = suspenseDefaultChildRefactors.find(item => /Extract current node to Suspense error slot block/.test(item.title));
assert.ok(extractErrorSlotAction);
assert.ok(extractErrorSlotAction.edit?.changes?.["file:///ContextualRefactor.nd"]?.some(edit => /<slot name="error">[\s\S]*<AsyncPanel \/>[\s\S]*<\/slot>/.test(edit.newText)));
const suspenseSlotCursorOffset = suspenseScopedSlotSource.indexOf('<slot name="fallback"') + 2;
const suspenseSlotRange = {
    start: suspenseScopedSlotDocument.positionAt(suspenseSlotCursorOffset),
    end: suspenseScopedSlotDocument.positionAt(suspenseSlotCursorOffset)
};
const suspenseSlotRefactors = getNdCodeActions(suspenseScopedSlotDocument, {}, suspenseSlotRange);
assert.ok(suspenseSlotRefactors.some(item => /Convert Suspense fallback slot block to fallback attribute/.test(item.title)));
assert.ok(!suspenseSlotRefactors.some(item => /Convert Suspense error slot block to error attribute/.test(item.title)));
const suspenseNodeCursorOffset = suspenseScopedSlotSource.indexOf("<Suspense") + 2;
const suspenseNodeRange = {
    start: suspenseScopedSlotDocument.positionAt(suspenseNodeCursorOffset),
    end: suspenseScopedSlotDocument.positionAt(suspenseNodeCursorOffset)
};
const suspenseNodeRefactors = getNdCodeActions(suspenseScopedSlotDocument, {}, suspenseNodeRange);
assert.ok(suspenseNodeRefactors.some(item => /Convert Suspense fallback slot block to fallback attribute/.test(item.title)));
assert.ok(suspenseNodeRefactors.some(item => /Convert Suspense error slot block to error attribute/.test(item.title)));
const fallbackAttrRefactor = suspenseNodeRefactors.find(item => /Convert Suspense fallback slot block to fallback attribute/.test(item.title));
assert.ok(fallbackAttrRefactor?.edit?.changes["file:///workspace/SuspenseScope.nd"].some(edit => /fallback=/.test(edit.newText)));

const namedSlotSource = `
<template>
  <section class="hero-shell">
    <slot name="hero-slot">
      <p>hero</p>
    </slot>
  </section>
</template>

<script setup>
const ready = true;
</script>
`;
const namedSlotDocument = TextDocument.create("file:///NamedSlot.nd", "nd", 1, namedSlotSource);
const namedSlotCursorOffset = namedSlotSource.indexOf('<slot name="hero-slot"') + 2;
const namedSlotRange = {
    start: namedSlotDocument.positionAt(namedSlotCursorOffset),
    end: namedSlotDocument.positionAt(namedSlotCursorOffset)
};
const namedSlotActions = getNdCodeActions(namedSlotDocument, {}, namedSlotRange);
const inlineNamedSlotAction = namedSlotActions.find(item => /Inline named slot block `hero-slot`/.test(item.title));
assert.ok(inlineNamedSlotAction);
assert.equal(inlineNamedSlotAction.kind, "refactor.inline");
assert.ok(inlineNamedSlotAction.edit?.changes?.["file:///NamedSlot.nd"]?.some(edit => /<p>hero<\/p>/.test(edit.newText)));

const extractComponentSource = `
<template>
  <section class="hero-card">
    <AsyncPanel />
    <p>{{title}}</p>
    <button e-click="submit">go</button>
  </section>
</template>

<script setup>
import AsyncPanel from "./AsyncPanel.nd";

defineOptions({
  modules: [AsyncPanel]
});

const title = "hello";
const submit = () => {};
</script>
`;
const extractComponentDocument = TextDocument.create("file:///workspace/ExtractComponent.nd", "nd", 1, extractComponentSource);
const extractComponentRange = {
    start: extractComponentDocument.positionAt(extractComponentSource.indexOf("<section") + 2),
    end: extractComponentDocument.positionAt(extractComponentSource.indexOf("<section") + 2)
};
const extractComponentActions = getNdCodeActions(extractComponentDocument, {}, extractComponentRange);
const extractComponentAction = extractComponentActions.find(item => /Extract current node to local component `HeroCardSection\.nd`/.test(item.title));
assert.ok(extractComponentAction);
assert.equal(extractComponentAction.kind, "refactor.extract");
assert.ok(Array.isArray(extractComponentAction.edit.documentChanges));
assert.ok(extractComponentAction.edit.documentChanges.some(change => change.kind === "create" && /\/HeroCardSection\.nd$/i.test(change.uri)));
const extractMainDocumentEdit = extractComponentAction.edit.documentChanges.find(change => change.textDocument?.uri === "file:///workspace/ExtractComponent.nd");
assert.ok(extractMainDocumentEdit);
assert.ok(extractMainDocumentEdit.edits.some(edit => /<HeroCardSection title=\{\{title\}\} submit=\{\{submit\}\} \/>/.test(edit.newText)));
assert.ok(extractMainDocumentEdit.edits.some(edit => /import HeroCardSection from "\.\/HeroCardSection\.nd";/.test(edit.newText)));
assert.ok(extractMainDocumentEdit.edits.some(edit => /HeroCardSection/.test(edit.newText)));
const extractChildDocumentEdit = extractComponentAction.edit.documentChanges.find(change => /\/HeroCardSection\.nd$/i.test(change.textDocument?.uri || ""));
assert.ok(extractChildDocumentEdit);
const extractedChildText = extractChildDocumentEdit.edits[0].newText;
assert.match(extractedChildText, /<template>/);
assert.match(extractedChildText, /<AsyncPanel \/>/);
assert.match(extractedChildText, /import AsyncPanel from "\.\/AsyncPanel\.nd";/);
assert.match(extractedChildText, /import \{ useComputed \} from "nodomx";/);
assert.match(extractedChildText, /modules: \[AsyncPanel\]/);
assert.match(extractedChildText, /const props = defineProps\(\);/);
assert.match(extractedChildText, /const title = useComputed\(\(\) => props\.title\);/);
assert.match(extractedChildText, /const submit = \(\.\.\.args\) => props\.submit\?\.\(\.\.\.args\);/);

const routeModuleSource = `
<template>
  <div>
    <route></route>
    <module></module>
  </div>
</template>

<script setup>
const ready = true;
</script>
`;
const routeModuleDocument = TextDocument.create("file:///RouteModule.nd", "nd", 1, routeModuleSource);
const routeModuleAnalysis = analyzeNdDocument(routeModuleDocument);
assert.ok(routeModuleAnalysis.diagnostics.some(item => /`<route>` should declare a `path` attribute/.test(item.message)));
assert.ok(routeModuleAnalysis.diagnostics.some(item => /`<module>` should declare a `name` attribute/.test(item.message)));
const routeModuleActions = getNdCodeActions(routeModuleDocument, { diagnostics: routeModuleAnalysis.diagnostics });
assert.ok(routeModuleActions.some(item => /Add route path `path="\/"`/.test(item.title)));
assert.ok(routeModuleActions.some(item => /Add module name `name="ChildModule"`/.test(item.title)));

const unexpectedClosingSource = `
<template>
  <div>
    </aside>
  </div>
</template>

<script setup>
const ready = true;
</script>
`;
const unexpectedClosingDocument = TextDocument.create("file:///UnexpectedClosing.nd", "nd", 1, unexpectedClosingSource);
const unexpectedClosingAnalysis = analyzeNdDocument(unexpectedClosingDocument);
assert.ok(unexpectedClosingAnalysis.diagnostics.some(item => /Unexpected closing tag/.test(item.message)));
const unexpectedClosingActions = getNdCodeActions(unexpectedClosingDocument, { diagnostics: unexpectedClosingAnalysis.diagnostics });
assert.ok(unexpectedClosingActions.some(item => /Remove unexpected closing tag `<\/aside>`/.test(item.title)));

const teleportDisabledSource = `
<template>
  <Teleport disabled>
    <p>inline</p>
  </Teleport>
</template>

<script setup>
const ready = true;
</script>
`;
const teleportDisabledDocument = TextDocument.create("file:///TeleportDisabled.nd", "nd", 1, teleportDisabledSource);
const teleportDisabledAnalysis = analyzeNdDocument(teleportDisabledDocument);
assert.ok(!teleportDisabledAnalysis.diagnostics.some(item => /should declare a `to`\/`target` attribute/.test(item.message)));

const teleportMissingTargetSource = `
<template>
  <Teleport>
    <p>portal</p>
  </Teleport>
</template>

<script setup>
const ready = true;
</script>
`;
const teleportMissingTargetDocument = TextDocument.create("file:///TeleportMissing.nd", "nd", 1, teleportMissingTargetSource);
const teleportMissingTargetAnalysis = analyzeNdDocument(teleportMissingTargetDocument);
assert.ok(teleportMissingTargetAnalysis.diagnostics.some(item => /should declare a `to`\/`target` attribute/.test(item.message)));
const teleportActions = getNdCodeActions(teleportMissingTargetDocument, { diagnostics: teleportMissingTargetAnalysis.diagnostics });
assert.ok(teleportActions.some(item => /Render Teleport in place with `disabled`/.test(item.title)));
assert.ok(teleportActions.some(item => /Add Teleport target `to="#modal-root"`/.test(item.title)));

const exposeSource = `
<template>
  <div>{{count}}</div>
</template>

<script>
export default {
  setup() {
    const count = 1;
    return {};
  }
}
</script>
`;
const exposeDocument = TextDocument.create("file:///Expose.nd", "nd", 1, exposeSource);
const exposeAnalysis = analyzeNdDocument(exposeDocument);
assert.ok(exposeAnalysis.diagnostics.some(item => /Unknown template symbol/.test(item.message)));
const exposeActions = getNdCodeActions(exposeDocument, { diagnostics: exposeAnalysis.diagnostics });
assert.ok(exposeActions.some(item => /Expose `count` from setup\(\)/.test(item.title)));

const documentLinksSource = `
<template>
  <AsyncPanel />
</template>

<script setup>
import AsyncPanel from "./AsyncPanel.nd";

defineOptions({
  modules: [AsyncPanel]
});
</script>
`;
const documentLinksDocument = TextDocument.create("file:///workspace/DocumentLinks.nd", "nd", 1, documentLinksSource);
const documentLinks = getNdDocumentLinks(documentLinksDocument);
assert.ok(documentLinks.some(item => /\/AsyncPanel\.nd$/i.test(item.target)));
assert.ok(documentLinks.some(item => item.range.start.line === 2));

const contractWorkspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "nd-contract-nav-"));
const contractChildFile = path.join(contractWorkspaceDir, "ContractChild.nd");
const contractParentFile = path.join(contractWorkspaceDir, "ContractParent.nd");
const contractMissingHandlerFile = path.join(contractWorkspaceDir, "ContractParentMissingHandler.nd");
await fs.writeFile(contractChildFile, `
<template>
  <section class="card">
    <slot name="header"></slot>
    <p>{{title}}</p>
  </section>
</template>

<script setup>
defineProps({
  title: null
});

defineEmits(["save"]);
defineSlots({
  header: true
});
</script>
`, "utf8");
await fs.writeFile(contractParentFile, `
<template>
  <ContractChild title={{pageTitle}} on-save={{handleSave}}>
    <slot name="header">
      <strong>{{headline}}</strong>
    </slot>
  </ContractChild>
</template>

<script setup>
import ContractChild from "./ContractChild.nd";

defineOptions({
  modules: [ContractChild]
});

const pageTitle = "Hello";
const headline = "World";
const handleSave = () => {};
</script>
`, "utf8");
await fs.writeFile(contractMissingHandlerFile, `
<template>
  <ContractChild title={{pageTitle}} on-save={{handleSave}} />
</template>

<script setup>
import ContractChild from "./ContractChild.nd";

defineOptions({
  modules: [ContractChild]
});

const pageTitle = "Hello";
</script>
`, "utf8");

const contractChildUri = pathToFileURL(contractChildFile).href;
const contractParentUri = pathToFileURL(contractParentFile).href;
const contractMissingHandlerUri = pathToFileURL(contractMissingHandlerFile).href;
const contractChildSource = await fs.readFile(contractChildFile, "utf8");
const contractParentSource = await fs.readFile(contractParentFile, "utf8");
const contractMissingHandlerSource = await fs.readFile(contractMissingHandlerFile, "utf8");
const contractChildDocument = TextDocument.create(contractChildUri, "nd", 1, contractChildSource);
const contractParentDocument = TextDocument.create(contractParentUri, "nd", 1, contractParentSource);
const contractMissingHandlerDocument = TextDocument.create(contractMissingHandlerUri, "nd", 1, contractMissingHandlerSource);

const childPropOffset = contractChildSource.indexOf("title: null") + 2;
const childPropReferences = getNdReferences(contractChildDocument, contractChildDocument.positionAt(childPropOffset));
assert.ok(childPropReferences.some(item => item.uri === contractChildUri));
assert.ok(childPropReferences.some(item => item.uri === contractParentUri));
const childPropRename = getNdRenameEdit(contractChildDocument, contractChildDocument.positionAt(childPropOffset), "heading");
assert.ok(childPropRename?.changes?.[contractChildUri]?.some(edit => edit.newText === "heading"));
assert.ok(childPropRename?.changes?.[contractParentUri]?.some(edit => edit.newText === "heading"));

const childEventOffset = contractChildSource.indexOf('"save"') + 2;
const childEventReferences = getNdReferences(contractChildDocument, contractChildDocument.positionAt(childEventOffset));
assert.ok(childEventReferences.some(item => item.uri === contractParentUri));
const childEventRename = getNdRenameEdit(contractChildDocument, contractChildDocument.positionAt(childEventOffset), "confirm");
assert.ok(childEventRename?.changes?.[contractChildUri]?.some(edit => edit.newText === "confirm"));
assert.ok(childEventRename?.changes?.[contractParentUri]?.some(edit => edit.newText === "on-confirm"));

const childSlotOffset = contractChildSource.indexOf("header: true") + 2;
const childSlotReferences = getNdReferences(contractChildDocument, contractChildDocument.positionAt(childSlotOffset));
assert.ok(childSlotReferences.some(item => item.uri === contractParentUri));
const childSlotRename = getNdRenameEdit(contractChildDocument, contractChildDocument.positionAt(childSlotOffset), "hero");
assert.ok(childSlotRename?.changes?.[contractChildUri]?.some(edit => /hero/.test(edit.newText)));
assert.ok(childSlotRename?.changes?.[contractParentUri]?.some(edit => edit.newText === "hero"));

const contractParentAnalysis = analyzeNdDocument(contractParentDocument);
assert.equal(contractParentAnalysis.diagnostics.length, 0);

const contractMissingHandlerAnalysis = analyzeNdDocument(contractMissingHandlerDocument);
assert.ok(contractMissingHandlerAnalysis.diagnostics.some(item => /Unknown template symbol/.test(item.message)));
const contractMissingHandlerActions = getNdCodeActions(contractMissingHandlerDocument, { diagnostics: contractMissingHandlerAnalysis.diagnostics });
const createHandlerAction = contractMissingHandlerActions.find(item => /Create handler `handleSave` for `save`/.test(item.title));
assert.ok(createHandlerAction);
assert.ok(createHandlerAction.edit?.changes?.[contractMissingHandlerUri]?.some(edit => /const handleSave = \(\.\.\.args\) => \{/.test(edit.newText)));

const contractBareParentFile = path.join(contractWorkspaceDir, "ContractBareParent.nd");
const contractBareParentSource = `
<template>
  <ContractChild />
</template>

<script setup>
import ContractChild from "./ContractChild.nd";

defineOptions({
  modules: [ContractChild]
});
</script>
`;
await fs.writeFile(contractBareParentFile, contractBareParentSource, "utf8");
const contractBareParentUri = pathToFileURL(contractBareParentFile).href;
const contractBareParentDocument = TextDocument.create(contractBareParentUri, "nd", 1, contractBareParentSource);
const contractBareParentRange = {
    start: contractBareParentDocument.positionAt(contractBareParentSource.indexOf("<ContractChild") + 2),
    end: contractBareParentDocument.positionAt(contractBareParentSource.indexOf("<ContractChild") + 2)
};
const contractBareParentActions = getNdCodeActions(contractBareParentDocument, {}, contractBareParentRange);
const syncContractAction = contractBareParentActions.find(item => /Sync `ContractChild` with component contract/.test(item.title));
assert.ok(syncContractAction);
assert.ok(syncContractAction.edit?.changes?.[contractBareParentUri]?.some(edit => /title=\{\{title\}\} on-save=\{\{handleSave\}\}/.test(edit.newText)));
assert.ok(syncContractAction.edit?.changes?.[contractBareParentUri]?.some(edit => /const title = "";/i.test(edit.newText)));
assert.ok(syncContractAction.edit?.changes?.[contractBareParentUri]?.some(edit => /const handleSave = \(\.\.\.args\) => \{/.test(edit.newText)));
assert.ok(syncContractAction.edit?.changes?.[contractBareParentUri]?.some(edit => /<slot name="header">/.test(edit.newText)));
const propContractAction = contractBareParentActions.find(item => /Insert missing props from `ContractChild` contract/.test(item.title));
assert.ok(propContractAction);
assert.ok(propContractAction.edit?.changes?.[contractBareParentUri]?.some(edit => /title=\{\{title\}\}/.test(edit.newText)));
assert.ok(propContractAction.edit?.changes?.[contractBareParentUri]?.some(edit => /const title = "";/i.test(edit.newText)));
const eventContractAction = contractBareParentActions.find(item => /Insert missing event handlers from `ContractChild` contract/.test(item.title));
assert.ok(eventContractAction);
assert.ok(eventContractAction.edit?.changes?.[contractBareParentUri]?.some(edit => /on-save=\{\{handleSave\}\}/.test(edit.newText)));
assert.ok(eventContractAction.edit?.changes?.[contractBareParentUri]?.some(edit => /const handleSave = \(\.\.\.args\) => \{/.test(edit.newText)));
const slotContractAction = contractBareParentActions.find(item => /Insert missing named slots from `ContractChild` contract/.test(item.title));
assert.ok(slotContractAction);
assert.ok(slotContractAction.edit?.changes?.[contractBareParentUri]?.some(edit => /<slot name="header">/.test(edit.newText)));

const unformattedSource = `<template>\n<div>\n<span>{{count}}</span>\n</div>\n</template>\n<script setup>\nconst count=1;\n</script>`;
const unformattedDocument = TextDocument.create("file:///Format.nd", "nd", 1, unformattedSource);
const formatEdits = formatNdDocument(unformattedDocument);
assert.equal(formatEdits.length, 1);
assert.match(formatEdits[0].newText, /<template>\n  <div>\n    <span>\{\{count\}\}<\/span>\n  <\/div>\n<\/template>/);
assert.match(formatEdits[0].newText, /<script setup>\n  const count=1;\n<\/script>/);

console.log("language service smoke test passed");
