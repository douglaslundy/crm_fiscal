import { getCurrentStore } from "@/lib/tenant";

// Modelo generico (LGPD): a loja e a controladora dos dados dos seus clientes; deve revisar o texto.
export default async function PrivacidadeLojaPage() {
  const store = await getCurrentStore();
  return (
    <main style={{ maxWidth: 760 }}>
      <h1>Política de privacidade de {store.name}</h1>
      <h2>Dados coletados</h2>
      <p>Nome, e-mail, CPF, telefone e endereço de entrega, necessários para processar pedidos, calcular frete e emitir cobrança. Se você se inscrever na lista de novidades, guardamos seu e-mail com o seu consentimento.</p>
      <h2>Uso e compartilhamento</h2>
      <p>Usamos seus dados para entregar o pedido, atender você e cumprir obrigações legais. Compartilhamos apenas com quem participa da operação: processador de pagamento, transportadora e plataforma de hospedagem. Não vendemos seus dados.</p>
      <h2>Seus direitos</h2>
      <p>Você pode pedir acesso, correção ou exclusão dos seus dados e cancelar a inscrição em novidades a qualquer momento, entrando em contato com a loja.</p>
    </main>
  );
}
