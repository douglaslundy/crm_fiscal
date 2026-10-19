// Cliente: chamadas JSON/multipart para /api/admin e mensagens de erro em portugues.
const MESSAGES: Record<string, string> = {
  PRODUCT_NOT_FOUND: "Produto não encontrado.",
  VARIANT_NOT_FOUND: "Variação não encontrada.",
  CATEGORY_INVALID: "Escolha uma categoria desta loja.",
  SLUG_INVALID: "O nome precisa ter letras ou números.",
  SLUG_TAKEN: "Já existe um produto com este nome.",
  SKU_TAKEN: "SKU repetido: cada variação precisa de um SKU único na loja.",
  VARIANT_EXISTS: "Já existe uma variação com esta cor e tamanho.",
  NO_ACTIVE_VARIANT: "Produto ativo precisa de pelo menos uma variação ativa.",
  LAST_ACTIVE_VARIANT: "Esta é a última variação ativa: desative o produto antes.",
  PRODUCT_HAS_ORDERS: "Produto com pedidos não pode ser excluído: desative-o.",
  IMAGE_URL_INVALID: "Imagem inválida: envie de novo.",
  IMAGE_COLOR_INVALID: "A cor da imagem precisa ser a cor de uma variação.",
  TOO_MANY_VARIANTS: "No máximo 100 variações por produto.",
  PLAN_LIMIT: "Limite de produtos do plano atingido. Faça upgrade para continuar.",
  FILE_TOO_LARGE: "Imagem maior que 5 MB.",
  UNSUPPORTED_TYPE: "Envie JPG, PNG, WEBP ou AVIF.",
  FILE_SIGNATURE_MISMATCH: "O arquivo não é uma imagem válida.",
  FILE_REQUIRED: "Escolha um arquivo.",
  STORE_SUSPENDED: "Loja suspensa: o painel está somente leitura.",
};

export type ApiResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export async function api<T = unknown>(url: string, method: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    const multipart = body instanceof FormData;
    res = await fetch(url, {
      method,
      headers: multipart || body === undefined ? undefined : { "content-type": "application/json" },
      body: multipart ? body : body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: "Falha de conexão. Tente novamente." };
  }
  const json = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, data: json as T };
  const msg = json.error === "PLAN_LIMIT" && json.message ? json.message : MESSAGES[json.error];
  return { ok: false, error: msg ?? (res.status === 401 || res.status === 403 ? "Sem permissão." : "Não foi possível concluir. Confira os dados.") };
}

/** "59,90" ou "59.90" -> 5990; invalido -> NaN (o servidor recusa). */
export const toCents = (s: string) => Math.round(Number(s.trim().replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")) * 100);
export const fromCents = (c: number) => (c / 100).toFixed(2).replace(".", ",");
