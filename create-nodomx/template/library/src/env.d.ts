declare module "*.nd" {
  import type { UnknownClass } from "nodomx";
  const component: UnknownClass;
  export default component;
}

declare module "vite-plugin-nodomx" {
  import type { Plugin } from "vite";
  export function nodomx(options?: Record<string, unknown>): Plugin;
}

declare module "vite-plugin-nodomx/runtime" {
  export function bootstrapNodomxViteApp(options: {
    nodom: unknown;
    hot?: unknown;
    deps?: string[];
    load: () => Promise<unknown>;
    selector?: string;
  }): Promise<unknown>;
}
