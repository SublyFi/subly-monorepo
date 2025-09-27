import type React from "react"

import "./globals.css"

import { Inter, Geist as V0_Font_Geist, Geist_Mono as V0_Font_Geist_Mono, Source_Serif_4 as V0_Font_Source_Serif_4 } from 'next/font/google'

// Initialize fonts
V0_Font_Geist({ weight: ["100","200","300","400","500","600","700","800","900"] })
V0_Font_Geist_Mono({ weight: ["100","200","300","400","500","600","700","800","900"] })
V0_Font_Source_Serif_4({ weight: ["200","300","400","500","600","700","800","900"] })

const inter = Inter({ subsets: ["latin"] })

export const metadata = {
  title: "Subly - Subscribe Now, Pay Never",
  description: "PayFi protocol for subscription management with DeFi yield",
    generator: 'v0.app'
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.className} antialiased`}>
      <body className="min-h-screen bg-background text-foreground">{children}</body>
    </html>
  )
}
