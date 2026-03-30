import HomeView from "../views/HomeView.nd";
import AboutView from "../views/AboutView.nd";

export const routes = [
  {
    path: "/",
    name: "home",
    module: HomeView
  },
  {
    path: "/about",
    name: "about",
    module: AboutView
  }
];
