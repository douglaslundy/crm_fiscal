import type { MetadataRoute } from "next";
import { platformOrigin } from "@/lib/urls";

/** Sitemap da plataforma (host sem loja): so as paginas publicas fixas. */
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/cadastro", "/termos", "/privacidade"].map((p) => ({ url: platformOrigin() + p }));
}
