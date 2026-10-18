import { z } from "zod";

// Tamanho/formato do nome e do slug sao validados no dominio (trim antes de contar); aqui so o formato do JSON.
// Campo vazio do formulario: slug "" = automatico/inalterado, parentId "" = sem pai (raiz).
export const CategoryBody = z.object({
  name: z.string(),
  slug: z.string().optional().transform((v) => v || undefined),
  parentId: z.string().nullable().optional().transform((v) => (v === "" ? null : v)),
});
