# `@nodomx/test-utils`

Official mount helpers for NodomX component tests.

## Usage

```js
import { mount } from "@nodomx/test-utils";
import CounterView from "./CounterView.nd";

const wrapper = await mount(CounterView);

await wrapper.trigger("#inc", "click");
console.log(wrapper.text("#count"));

wrapper.destroy();
```

## Helpers

- `mount(component, options)`
- `createTestDom(options)`
- `flush()`

`mount()` accepts a `global` option similar to Vue Test Utils:

```js
await mount(App, {
  global: {
    provide: {
      sharedLabel: "hello"
    },
    config: {
      globalProperties: {
        $format(value) {
          return `count:${value}`;
        }
      }
    }
  }
});
```
