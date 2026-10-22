import type { MetadataRoute } from "next";
import { platformOrigin } from "@/lib/urls";

/** robots.txt da plataforma (host sem loja); as lojas tem o proprio em src/app/vitrine/robots.txt. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/master", "/api", "/redefinir-senha", "/verificar-email"] }, sitemap: `${platformOrigin()}/sitemap.xml` };
}
