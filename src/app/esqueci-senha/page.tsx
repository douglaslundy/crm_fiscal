import { ForgotForm } from "@/components/forgot-form";

export const metadata = { title: "Esqueci minha senha" };

// Mesmo caminho nos dois mundos: host de loja -> cliente da loja; host da plataforma -> conta.
export default function EsqueciSenhaPage() {
  return (
    <main className="narrow">
      <h1>Esqueci minha senha</h1>
      <p className="muted">Informe seu e-mail e enviaremos um link para criar uma nova senha.</p>
      <ForgotForm />
    </main>
  );
}
