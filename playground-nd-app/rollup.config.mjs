import nodeResolve from "@rollup/plugin-node-resolve";
import { nodomDevServer } from "@nodomx/rollup-plugin-dev-server";
import { nodomNd } from "@nodomx/rollup-plugin-nd";

export default {
  input: "./src/main.js",
  preserveSymlinks: true,
  output: {
    file: "./dist/main.js",
    format: "esm",
    sourcemap: true
  },
  plugins: [
    nodomNd({
      importSource: "nodomx"
    }),
    nodeResolve({
      extensions: [".js", ".mjs", ".nd"]
    }),
    nodomDevServer({
      distDir: "./dist",
      open: false,
      port: 3000,
      rootDir: "./public"
    })
  ]
};
