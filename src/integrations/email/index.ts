import nodemailer from "nodemailer";

export type Mail = { to: string; subject: string; text: string };
export interface EmailSender {
  send(mail: Mail): Promise<void>;
}

/** SMTP generico (Resend, SES, Brevo, Gmail...): SMTP_URL=smtps://usuario:senha@host:465 e MAIL_FROM="Loja <no-reply@dominio>". */
export class SmtpSender implements EmailSender {
  private transport;
  constructor(url: string, private from: string) {
    this.transport = nodemailer.createTransport(url);
  }
  async send(mail: Mail) {
    await this.transport.sendMail({ from: this.from, ...mail });
  }
}

/** Guarda em memoria (testes e dev); em dev tambem escreve no console. */
export class FakeSender implements EmailSender {
  sent: Mail[] = [];
  constructor(private log = false) {}
  async send(mail: Mail) {
    this.sent.push(mail);
    if (this.log) console.log(`[e-mail] para ${mail.to}: ${mail.subject}\n${mail.text}`);
  }
}

/** Descarta com aviso: producao sem SMTP configurado nao derruba pedido nem cadastro. */
class UnconfiguredSender implements EmailSender {
  async send(mail: Mail) {
    console.warn(`[e-mail] SMTP_URL ausente: mensagem para ${mail.to} (${mail.subject}) nao enviada`);
  }
}

export const fakeSender = new FakeSender(process.env.NODE_ENV === "development");

export function getEmailSender(env: Record<string, string | undefined> = process.env): EmailSender {
  if (env.SMTP_URL) return new SmtpSender(env.SMTP_URL, env.MAIL_FROM ?? "no-reply@localhost");
  return env.NODE_ENV === "production" ? new UnconfiguredSender() : fakeSender;
}

/** Envio que nunca lanca: e-mail e efeito colateral e nao pode desfazer pagamento, cadastro ou convite. */
export async function sendMail(mail: Mail, sender: EmailSender = getEmailSender()): Promise<void> {
  try {
    await sender.send(mail);
  } catch (e) {
    console.error("[e-mail] falha ao enviar", mail.subject, e instanceof Error ? e.message : e);
  }
}
