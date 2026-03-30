import { defineConfig } from "vite";
import { nodomx } from "vite-plugin-nodomx";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [nodomx()],
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: "index"
    },
    rollupOptions: {
      external: ["nodomx"]
    }
  }
});
