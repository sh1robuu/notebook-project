import { createRoot, hydrateRoot } from "react-dom/client";
import { SiteRouter } from "./site/SiteRouter.tsx";
import "./site/site.css";
const root = document.getElementById("root")!;
if (location.pathname === "/" && root.dataset.prerender === "landing")
  hydrateRoot(root, <SiteRouter />);
else createRoot(root).render(<SiteRouter />);
