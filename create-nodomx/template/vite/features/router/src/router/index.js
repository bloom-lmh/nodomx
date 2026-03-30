import { Nodom, Router } from "nodomx";
import { routes } from "./routes";

export function installAppRouter() {
  Nodom.use(Router);
  Nodom.createRoute(routes);
}
