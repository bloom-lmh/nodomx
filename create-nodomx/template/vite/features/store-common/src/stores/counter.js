import { defineStore } from "@nodomx/store";

export const useCounterStore = defineStore("counter", {
  state: () => ({
    count: 1,
    title: "NodomX Starter Store"
  }),
  getters: {
    doubleCount(store) {
      return store.count * 2;
    }
  },
  actions: {
    increment() {
      this.count += 1;
    },
    reset() {
      this.$reset();
    }
  }
});
