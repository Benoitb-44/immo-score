import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Immo Score — Score d'attractivité immobilière par commune",
    template: "%s | Immo Score",
  },
  description:
    "Découvrez le score d'attractivité immobilière de chaque commune de France. Basé sur les prix DVF, le DPE, les équipements, les risques et la fiscalité.",
  metadataBase: new URL("https://immoscore.fr"),
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body>{children}</body>
    </html>
  );
}
