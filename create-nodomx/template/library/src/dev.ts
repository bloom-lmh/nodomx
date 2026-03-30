import { Nodom } from "nodomx";
import { bootstrapNodomxViteApp } from "vite-plugin-nodomx/runtime";
import DemoApp from "./DemoApp.nd";

await bootstrapNodomxViteApp({
  nodom: Nodom,
  hot: import.meta.hot,
  deps: ["./DemoApp.nd"],
  load: async () => ({ default: DemoApp }),
  selector: "#app"
});
