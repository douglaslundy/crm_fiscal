export const metadata = { title: "Política de privacidade" };

// Modelo generico (LGPD): revisar com assessoria juridica antes de operar comercialmente.
export default function PrivacidadePage() {
  return (
    <main className="container" style={{ maxWidth: 760 }}>
      <h1>Política de privacidade da plataforma</h1>
      <p className="muted">Última atualização: 21/10/2026</p>
      <h2>Dados que tratamos</h2>
      <p>Dos lojistas: nome, e-mail, senha (armazenada apenas como hash) e dados da loja e da assinatura. Dos clientes das lojas, a plataforma atua como operadora: os dados (cadastro, endereço, pedidos) pertencem à loja, que é a controladora.</p>
      <h2>Finalidades</h2>
      <p>Prestar o serviço, processar pedidos e pagamentos, calcular frete, prevenir fraudes e cumprir obrigações legais.</p>
      <h2>Compartilhamento</h2>
      <p>Compartilhamos dados apenas com provedores necessários à operação (pagamento, frete, hospedagem). Não vendemos dados pessoais.</p>
      <h2>Seus direitos (LGPD)</h2>
      <p>Você pode solicitar acesso, correção, portabilidade e exclusão dos seus dados, e revogar consentimentos. Clientes de uma loja devem dirigir o pedido à própria loja.</p>
      <h2>Segurança e retenção</h2>
      <p>Adotamos medidas técnicas como senhas com hash, credenciais criptografadas e isolamento de dados por loja. Mantemos os dados enquanto a conta existir e pelo prazo exigido em lei.</p>
    </main>
  );
}
