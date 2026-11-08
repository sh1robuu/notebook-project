import { createRoot, hydrateRoot } from "react-dom/client";
import { SiteRouter } from "./site/SiteRouter.tsx";
import { isPublicPath } from "./site/content.ts";
import "./site/site.css";
const root = document.getElementById("root")!;
const path = location.pathname.replace(/\/$/, "") || "/";
if (isPublicPath(path) && root.dataset.prerenderPath === path)
  hydrateRoot(root, <SiteRouter />);
else createRoot(root).render(<SiteRouter />);
