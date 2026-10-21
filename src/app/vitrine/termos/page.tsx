import { getCurrentStore } from "@/lib/tenant";

// Modelo generico de termos de compra: a loja deve revisar e complementar (prazos e trocas proprios).
export default async function TermosLojaPage() {
  const store = await getCurrentStore();
  return (
    <main style={{ maxWidth: 760 }}>
      <h1>Termos de compra de {store.name}</h1>
      <h2>Pedidos e pagamento</h2>
      <p>O pedido é confirmado após a aprovação do pagamento. Pix e cartão são confirmados em instantes; boleto pode levar até 3 dias úteis para compensar. Pedidos sem pagamento dentro do prazo são cancelados e o estoque é liberado.</p>
      <h2>Entrega</h2>
      <p>Os prazos e valores do frete são calculados no carrinho a partir do CEP e contam a partir da confirmação do pagamento.</p>
      <h2>Trocas e devoluções</h2>
      <p>Você pode desistir da compra em até 7 dias corridos após o recebimento (art. 49 do Código de Defesa do Consumidor). Para trocas por defeito, tamanho ou cor, entre em contato com a loja.</p>
    </main>
  );
}
