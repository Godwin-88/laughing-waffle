import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "Takwimu Data School",
  description:
    "Takwimu Data School — practical AI & data education for Africa: AWS certifications, AI engineering, and data careers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <Header />
          <main className="min-h-[calc(100dvh-120px)]">{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}