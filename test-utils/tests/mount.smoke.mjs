import assert from "node:assert/strict";
import { Module, inject, useState } from "nodomx";
import { mount } from "../src/index.js";

class CounterHarnessModule extends Module {
    template() {
        return `
            <div class="counter-harness">
                <p id="provided">{{sharedLabel}}</p>
                <p id="count">{{count}}</p>
                <p id="formatted">{{$formatCount(count)}}</p>
                <button id="inc" e-click="increment">inc</button>
            </div>
        `;
    }

    setup() {
        const count = useState(1);
        const sharedLabel = inject("sharedLabel", "missing");

        return {
            count,
            sharedLabel,
            increment() {
                count.value += 1;
            }
        };
    }
}

const wrapper = await mount(CounterHarnessModule, {
    global: {
        provide: {
            sharedLabel: "ready"
        },
        config: {
            globalProperties: {
                $formatCount(value) {
                    return `count:${value}`;
                }
            }
        }
    }
});

assert.equal(wrapper.text("#provided"), "ready");
assert.equal(wrapper.text("#count"), "1");
assert.equal(wrapper.text("#formatted"), "count:1");
assert.equal(wrapper.exists("#inc"), true);

await wrapper.trigger("#inc", "click");

assert.equal(wrapper.text("#count"), "2");
assert.equal(wrapper.text("#formatted"), "count:2");
assert.match(wrapper.html(), /counter-harness/);

wrapper.destroy();

console.log("test-utils smoke test passed");
