import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import { fileURLToPath } from "url";
import path from "path";
import nodomNd from "@nodomx/rollup-plugin-nd";
import ts from "rollup-plugin-typescript2";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const commonOpt = {
	name: "nodom",
	sourcemap: true
};

const pluginOpt = {
	...commonOpt,
	plugins: [terser({
		keep_classnames: true
	})]
};

export default {
	input: path.join(__dirname, "/index.ts"),
	output: [
		{
			file: resolve("nodom.esm.js"),
			format: "esm",
			...commonOpt
		},
		{
			file: resolve("nodom.esm.min.js"),
			format: "esm",
			...pluginOpt
		}
	],
	plugins: [
		nodomNd(),
		nodeResolve({
			extensions: [".js", ".ts", ".nd"]
		}),
		ts(),
		commonjs()
	]
};

function resolve(name) {
	return path.resolve(`dist/${name}`);
}
