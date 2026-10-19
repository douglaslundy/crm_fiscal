// Puro (sem banco): usado pelo middleware (edge). A vitrine mora em src/app/vitrine porque "/" e da home da plataforma.
const PUBLIC = /^\/(?:|buscar|carrinho|checkout|conta|conta\/enderecos|(?:[cp]|colecao|pedido|conta\/pedidos)\/[^/]+)$/;

/** Caminho interno da vitrine para um caminho publico de loja; null = nao reescrever. */
export const storefrontPath = (pathname: string): string | null =>
  PUBLIC.test(pathname) ? (pathname === "/" ? "/vitrine" : `/vitrine${pathname}`) : null;
