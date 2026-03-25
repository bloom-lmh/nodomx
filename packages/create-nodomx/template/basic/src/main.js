import { Nodom } from "nodom3";
import { bootstrapNodomApp } from "@nodomx/rollup-plugin-dev-server/runtime";
import App from "./App.nd";

await bootstrapNodomApp({
  entryUrl: import.meta.url,
  load: async () => ({ default: App }),
  nodom: Nodom,
  selector: "#app"
});
