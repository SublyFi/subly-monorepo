import type React from "react"

import "./globals.css"

import { Inter } from "next/font/google"

import { Providers } from "@/components/providers"
import { Toaster } from "@/components/ui/sonner"

const inter = Inter({ subsets: ["latin"] })

export const metadata = {
  title: "Subly - Subscribe Now, Pay Never",
  description: "PayFi protocol for subscription management with DeFi yield",
  generator: "v0.app",
  icons: {
    icon: "/subly-logo-color.svg",
    shortcut: "/subly-logo-color.svg",
    apple: "/subly-logo-color.svg",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.className} antialiased`}>
      <body className="min-h-screen bg-background text-foreground">
        <div className="bg-red-600 text-white text-center px-4 py-3 text-sm sm:text-base font-semibold">
          Connect with a dedicated test wallet only. Staking uses Solana Devnet USDC. Mint test USDC at
          {" "}
          <a
            href="https://faucet.circle.com/"
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            faucet.circle.com
          </a>
          .
        </div>
        <Providers>
          {children}
          <Toaster position="top-right" richColors closeButton />
        </Providers>
      </body>
    </html>
  )
}
