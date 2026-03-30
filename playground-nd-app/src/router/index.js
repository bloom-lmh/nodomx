import { Nodom } from "nodomx";
import HomeView from "../views/HomeView.nd";
import GuideView from "../views/GuideView.nd";
import AboutView from "../views/AboutView.nd";

export function registerRoutes() {
  Nodom.createRoute([
    {
      path: "/home",
      name: "home",
      module: HomeView
    },
    {
      path: "/guide",
      name: "guide",
      module: GuideView
    },
    {
      path: "/about",
      name: "about",
      module: AboutView
    }
  ]);
}
