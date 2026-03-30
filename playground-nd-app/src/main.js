import { Nodom, Router } from "nodomx";
import { bootstrapNodomApp } from "@nodomx/rollup-plugin-dev-server/runtime";
import App from "./App.nd";
import { registerRoutes } from "./router/index.js";

Nodom.use(Router);
registerRoutes();

await bootstrapNodomApp({
    entryUrl: import.meta.url,
    load: async () => ({ default: App }),
    nodom: Nodom,
    selector: "#app",
});
