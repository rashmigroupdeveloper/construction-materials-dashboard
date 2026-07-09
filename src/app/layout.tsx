import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Construction Materials Dashboard · Live Google Sheets",
  description:
    "Demand–supply intelligence dashboard fed live from Google Sheets (Appendix2 / DashData).",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="relative min-h-full font-sans">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
