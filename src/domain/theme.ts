import { z } from "zod";
import { dbForStore } from "@/lib/db-store";
import { SettingsError } from "./storeSettings";

// Aparencia da vitrine: so cor principal e logo (sem CSS livre, nada que vire script/estilo injetado).
const KEYS = { primaryColor: "theme.primaryColor", logoUrl: "theme.logoUrl" } as const;
export const DEFAULT_PRIMARY = "#111111";

export type Theme = { primaryColor: string | null; logoUrl: string | null };

const color = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).transform((c) => c.toLowerCase());
const logo = z.string().trim().max(500).refine((u) => {
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
});
// "" ou null = voltar ao padrao
export const ThemeBody = z.object({
  primaryColor: z.union([color, z.literal(""), z.null()]).optional(),
  logoUrl: z.union([logo, z.literal(""), z.null()]).optional(),
});

export async function getTheme(storeId: string): Promise<Theme> {
  const rows = await dbForStore(storeId).storeSetting.findMany({ where: { key: { in: Object.values(KEYS) } } });
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { primaryColor: v[KEYS.primaryColor] ?? null, logoUrl: v[KEYS.logoUrl] ?? null };
}

export async function updateTheme(storeId: string, input: z.infer<typeof ThemeBody>): Promise<void> {
  const parsed = ThemeBody.safeParse(input);
  if (!parsed.success) throw new SettingsError(400, "THEME_INVALID");
  await dbForStore(storeId).$transaction(async (tx) => {
    for (const f of ["primaryColor", "logoUrl"] as const) {
      const value = parsed.data[f];
      if (value === undefined) continue;
      if (!value) await tx.storeSetting.deleteMany({ where: { key: KEYS[f] } });
      else await tx.storeSetting.upsert({ where: { storeId_key: { storeId, key: KEYS[f] } }, create: { storeId, key: KEYS[f], value }, update: { value } });
    }
  });
}

/** Texto branco ou preto sobre a cor principal (luminancia relativa). */
export function textOn(hex: string): "#ffffff" | "#000000" {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#000000" : "#ffffff";
}
