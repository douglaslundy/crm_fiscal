import type { MetadataRoute } from "next";
import { platformOrigin } from "@/lib/urls";

/** Sitemap da plataforma (host sem loja): so as paginas publicas fixas. */
export const dynamic = "force-dynamic"; // a origem vem de NEXTAUTH_URL em runtime, nao do build

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/cadastro", "/termos", "/privacidade"].map((p) => ({ url: platformOrigin() + p }));
}
