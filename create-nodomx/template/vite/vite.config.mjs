import { defineConfig } from "vite";
import { nodomx } from "vite-plugin-nodomx";

export default defineConfig({
  plugins: [nodomx()]
});
