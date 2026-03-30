import { Nodom } from "nodomx";
import { readSsrPayload, resumeFromSsrPayload } from "@nodomx/ssr";
import App from "./App.nd";

const payload = typeof window !== "undefined" ? readSsrPayload(window) : null;

if (payload) {
  await resumeFromSsrPayload(App, {
    payload,
    selector: "#app"
  });
} else {
  Nodom.app(App, "#app");
}
