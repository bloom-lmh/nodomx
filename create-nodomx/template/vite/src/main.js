import { Nodom } from "nodomx";
import { bootstrapNodomxViteApp } from "vite-plugin-nodomx/runtime";
import "./styles/main.css";

await bootstrapNodomxViteApp({
  nodom: Nodom,
  hot: import.meta.hot,
  deps: ["./App.nd"],
  load: () => import("./App.nd"),
  selector: "#app"
});
