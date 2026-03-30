import assert from "node:assert/strict";
import { computed, useState } from "nodomx";
import { createStore, defineStore, getActiveStore, setActiveStore, storeToRefs } from "../src/index.js";

const appStore = createStore();
const fakeApp = {
    config: {
        globalProperties: {}
    },
    provided: new Map(),
    provide(key, value) {
        this.provided.set(key, value);
        return this;
    }
};

appStore.install(fakeApp);
assert.equal(getActiveStore(), appStore);
assert.equal(fakeApp.config.globalProperties.$store, appStore);

const useCounterStore = defineStore("counter", {
    state: () => ({
        count: 1,
        title: "NodomX Store"
    }),
    getters: {
        doubleCount(store) {
            return store.count * 2;
        }
    },
    actions: {
        increment() {
            this.count += 1;
        }
    }
});

const counter = useCounterStore();
assert.equal(counter.$id, "counter");
assert.equal(counter.count, 1);
assert.equal(counter.doubleCount, 2);
counter.increment();
assert.equal(counter.count, 2);
assert.equal(counter.doubleCount, 4);
counter.$patch({
    count: 4
});
assert.equal(counter.doubleCount, 8);
counter.$reset();
assert.equal(counter.count, 1);

let subscriptionCalls = 0;
const stopSubscription = counter.$subscribe((mutation, state, oldState) => {
    subscriptionCalls += 1;
    assert.equal(mutation.storeId, "counter");
    assert.ok(typeof state.count === "number");
    assert.ok(oldState === undefined || typeof oldState.count === "number");
});
counter.count += 1;
stopSubscription();
assert.ok(subscriptionCalls >= 1);

const counterRefs = storeToRefs(counter);
counterRefs.count.value = 8;
assert.equal(counter.count, 8);

const explicitStore = createStore();
const useExplicitStore = defineStore("explicit", {
    state: () => ({
        ready: true
    })
});
assert.equal(useExplicitStore(explicitStore).ready, true);

const useSetupStore = defineStore("setup", () => {
    const count = useState(2);
    const doubleCount = computed(() => count.value * 2);
    return {
        count,
        doubleCount,
        increment() {
            count.value += 1;
        }
    };
});
const setupStore = useSetupStore(appStore);
assert.equal(setupStore.count, 2);
assert.equal(setupStore.doubleCount, 4);
setupStore.count = 5;
assert.equal(setupStore.doubleCount, 10);
setupStore.increment();
assert.equal(setupStore.count, 6);

setActiveStore(appStore);
assert.equal(getActiveStore(), appStore);

console.log("@nodomx/store smoke test passed");
