export const metadata = { title: "Termos de uso" };

// Modelo generico: revisar com assessoria juridica antes de operar comercialmente.
export default function TermosPage() {
  return (
    <main className="container" style={{ maxWidth: 760 }}>
      <h1>Termos de uso da plataforma</h1>
      <p className="muted">Última atualização: 21/10/2026</p>
      <h2>1. Serviço</h2>
      <p>A plataforma oferece a lojistas uma loja virtual com vitrine, carrinho, pagamentos, cálculo de frete e painel de gestão, sob assinatura mensal conforme o plano contratado. Há 14 dias de teste gratuito, sem cartão.</p>
      <h2>2. Conta e responsabilidades</h2>
      <p>O lojista é responsável pelas informações da conta, pela guarda da senha, pelos produtos anunciados, preços, prazos, entrega, trocas e atendimento aos seus clientes, e pelo cumprimento da legislação aplicável, incluindo o Código de Defesa do Consumidor e a emissão de documentos fiscais.</p>
      <h2>3. Pagamentos e assinatura</h2>
      <p>Os pagamentos dos clientes finais são processados por provedores terceiros (como o Mercado Pago) com as credenciais do próprio lojista. A assinatura da plataforma é cobrada mensalmente; a falta de pagamento pode suspender a loja, que passa a ficar somente para leitura até a regularização.</p>
      <h2>4. Conteúdo proibido</h2>
      <p>É vedado vender produtos ilícitos, falsificados ou que violem direitos de terceiros. Lojas que descumprirem estes termos podem ser suspensas.</p>
      <h2>5. Disponibilidade e limitação</h2>
      <p>Buscamos manter o serviço disponível, sem garantia de funcionamento ininterrupto. A responsabilidade da plataforma limita-se ao valor pago nos últimos 12 meses.</p>
      <h2>6. Cancelamento</h2>
      <p>O lojista pode cancelar a assinatura a qualquer momento. Os dados da loja podem ser excluídos após o cancelamento.</p>
      <h2>7. Alterações</h2>
      <p>Estes termos podem ser atualizados; o uso continuado do serviço indica concordância com a versão vigente.</p>
    </main>
  );
}
