import { describe, expect, it, vi } from "vitest";
import { FakeSender, getEmailSender, sendMail, fakeSender } from ".";

describe("e-mail", () => {
  it("sem SMTP: teste/dev usa o falso compartilhado; producao descarta com aviso sem lancar", async () => {
    expect(getEmailSender({ NODE_ENV: "test" })).toBe(fakeSender);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await getEmailSender({ NODE_ENV: "production" }).send({ to: "a@t.local", subject: "x", text: "y" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it("com SMTP_URL monta o transporte SMTP", () => {
    expect(getEmailSender({ SMTP_URL: "smtp://u:p@localhost:2525", MAIL_FROM: "L <a@b.c>" }).constructor.name).toBe("SmtpSender");
  });
  it("sendMail nunca lanca, mesmo com o transporte falhando", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendMail({ to: "a@t.local", subject: "s", text: "t" }, { send: async () => { throw new Error("boom"); } })).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
  it("falso guarda as mensagens", async () => {
    const f = new FakeSender();
    await sendMail({ to: "a@t.local", subject: "s", text: "t" }, f);
    expect(f.sent).toEqual([{ to: "a@t.local", subject: "s", text: "t" }]);
  });
});
