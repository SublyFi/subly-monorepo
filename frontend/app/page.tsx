"use client"

import { useEffect, useState } from "react"
import { Header } from "@/components/header"
import { StakeInterface } from "@/components/stake-interface"
import { SubscriptionInterface } from "@/components/subscription-interface"
import { ProfileInterface } from "@/components/profile-interface"

export default function Home() {
  const [activeTab, setActiveTab] = useState("stake")

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: string }>).detail
      if (detail?.tab) {
        setActiveTab(detail.tab)
      }
    }

    document.addEventListener("subly:navigate-tab", handler as EventListener)
    return () => {
      document.removeEventListener("subly:navigate-tab", handler as EventListener)
    }
  }, [])

  const renderContent = () => {
    switch (activeTab) {
      case "stake":
        return <StakeInterface />
      case "subscription":
        return <SubscriptionInterface />
      case "profile":
        return <ProfileInterface />
      default:
        return <StakeInterface />
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
        <div className="container mx-auto">
          <p className="text-center text-sm text-amber-800 font-medium">
            🚧 Currently running on Devnet - Test Phase Only
          </p>
        </div>
      </div>
      <main className="container mx-auto px-4 py-8">{renderContent()}</main>
    </div>
  )
}
