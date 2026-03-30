import { Nodom } from "nodomx";
import { bootstrapNodomxViteApp } from "vite-plugin-nodomx/runtime";
import { installAppRouter } from "./router/index";
import { appStore } from "./stores/index";
import "./styles/main.css";

installAppRouter();
Nodom.use(appStore);

await bootstrapNodomxViteApp({
  nodom: Nodom,
  hot: import.meta.hot,
  deps: ["./App.nd"],
  load: () => import("./App.nd"),
  selector: "#app"
});
