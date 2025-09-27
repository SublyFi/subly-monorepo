"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Wallet, Menu, X } from "lucide-react"

interface HeaderProps {
  activeTab: string
  onTabChange: (tab: string) => void
}

export function Header({ activeTab, onTabChange }: HeaderProps) {
  const [isWalletConnected, setIsWalletConnected] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  const tabs = [
    { id: "stake", label: "Stake", active: true },
    { id: "subscription", label: "Subscription", active: true },
    { id: "profile", label: "Profile", active: true },
  ]

  const handleConnectWallet = () => {
    setIsWalletConnected(!isWalletConnected)
  }

  const handleTabChange = (tabId: string) => {
    onTabChange(tabId)
    setIsMobileMenuOpen(false)
  }

  return (
    <header className="border-b border-border bg-card shadow-sm">
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 sm:space-x-3">
            <div className="flex space-x-1">
              <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full border-2 border-primary bg-primary/10"></div>
              <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full border-2 border-primary bg-primary/10 -ml-3 sm:-ml-4"></div>
              <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full border-2 border-primary bg-primary/10 -ml-3 sm:-ml-4"></div>
            </div>
            <span className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Subly</span>
          </div>

          <nav className="hidden md:flex items-center space-x-8 lg:space-x-10">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => tab.active && onTabChange(tab.id)}
                className={`text-sm font-medium transition-all duration-200 relative ${
                  tab.active
                    ? activeTab === tab.id
                      ? "text-primary"
                      : "text-foreground hover:text-primary"
                    : "text-muted-foreground cursor-not-allowed opacity-50"
                }`}
                disabled={!tab.active}
              >
                {tab.label}
                {tab.active && activeTab === tab.id && (
                  <div className="absolute -bottom-5 left-0 right-0 h-0.5 bg-primary rounded-full" />
                )}
              </button>
            ))}
          </nav>

          <div className="flex items-center space-x-2 sm:space-x-4">
            <Button
              onClick={handleConnectWallet}
              variant={isWalletConnected ? "secondary" : "default"}
              className="flex items-center space-x-1 sm:space-x-2 px-3 sm:px-6 py-2 sm:py-2.5 font-medium text-xs sm:text-sm"
              size="sm"
            >
              <Wallet className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">{isWalletConnected ? "Connected" : "Connect"}</span>
              <span className="sm:hidden">{isWalletConnected ? "Connected" : "Connect"}</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="md:hidden p-2"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </div>

        {isMobileMenuOpen && (
          <nav className="md:hidden mt-4 pt-4 border-t border-border">
            <div className="flex flex-col space-y-3">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => tab.active && handleTabChange(tab.id)}
                  className={`text-left py-2 px-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                    tab.active
                      ? activeTab === tab.id
                        ? "text-primary bg-primary/10"
                        : "text-foreground hover:text-primary hover:bg-muted/50"
                      : "text-muted-foreground cursor-not-allowed opacity-50"
                  }`}
                  disabled={!tab.active}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </nav>
        )}
      </div>
    </header>
  )
}
