import type { ReactNode } from "react";

export const metadata = { title: "Plataforma de Lojas" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
