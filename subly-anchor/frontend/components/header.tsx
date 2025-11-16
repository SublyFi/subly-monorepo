"use client";

import { useCallback, useMemo, useState } from "react";

import { AddressType } from "@phantom/browser-sdk";
import { useAccounts, useConnect, useDisconnect } from "@phantom/react-sdk";
import { Button } from "@/components/ui/button";
import { useSolanaName } from "@/hooks/use-solana-name";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExternalLink, Loader2, LogOut, Menu, Wallet, X } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";

interface HeaderProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function Header({ activeTab, onTabChange }: HeaderProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isWalletMenuOpen, setIsWalletMenuOpen] = useState(false);

  const { connect, isConnecting } = useConnect();
  const { disconnect, isDisconnecting } = useDisconnect();
  const addresses = useAccounts();
  const solanaAddress = useMemo(() => {
    return (
      addresses?.find((addr) => addr.addressType === AddressType.solana)
        ?.address ?? null
    );
  }, [addresses]);
  const walletConnected = Boolean(solanaAddress);

  const walletAddress = solanaAddress;
  const accountLabel = walletAddress;
  const { name: solanaName, isLoading: isNameLoading } =
    useSolanaName(walletAddress);
  const walletExplorerUrl = walletAddress
    ? `https://explorer.solana.com/address/${walletAddress}?cluster=devnet`
    : undefined;

  const walletLabel = useMemo(() => {
    if (!walletAddress) {
      return "Connect";
    }
    const displayName = solanaName ?? accountLabel;
    if (displayName && displayName !== walletAddress) {
      return displayName;
    }
    return `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;
  }, [accountLabel, solanaName, walletAddress]);

  const handleConnectWallet = useCallback(async () => {
    if (walletConnected) {
      setIsWalletMenuOpen(true);
      return;
    }

    if (isConnecting || isDisconnecting) {
      return;
    }

    try {
      await connect({ provider: "injected" });
    } catch (error) {
      console.error("Failed to connect wallet", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to connect wallet. Please try again."
      );
    }
  }, [connect, isConnecting, isDisconnecting, walletConnected]);

  const handleDisconnectWallet = useCallback(async () => {
    if (!walletConnected || !walletAddress) {
      return;
    }

    try {
      await disconnect();
      setIsWalletMenuOpen(false);
    } catch (error) {
      console.error("Failed to disconnect wallet", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to disconnect wallet. Please try again."
      );
    }
  }, [disconnect, walletAddress, walletConnected]);

  const handleViewOnExplorer = useCallback(() => {
    if (!walletExplorerUrl) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    window.open(walletExplorerUrl, "_blank", "noopener,noreferrer");
  }, [walletExplorerUrl]);

  const tabs = [
    { id: "stake", label: "Stake", active: true },
    { id: "subscription", label: "Subscription", active: true },
    { id: "profile", label: "Profile", active: true },
  ];

  const handleTabChange = (tabId: string) => {
    onTabChange(tabId);
    setIsMobileMenuOpen(false);
  };

  return (
    <header className="border-b border-border bg-card shadow-sm">
      <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 sm:space-x-3">
            <Image
              src="/subly-logo-color.svg"
              alt="Subly logo"
              width={42}
              height={42}
              className="h-[2.6rem] w-[2.6rem] sm:h-11 sm:w-11"
              priority
            />
            <span className="text-xl sm:text-2xl font-semibold tracking-tight text-[#31a4ab]">
              Subly
            </span>
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
            {walletConnected ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center space-x-1 sm:space-x-2 px-3 sm:px-6 py-2 sm:py-2.5 font-medium text-xs sm:text-sm bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-md border border-input">
                  {isDisconnecting || isNameLoading ? (
                    <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 animate-spin" />
                  ) : (
                    <Wallet className="w-3 h-3 sm:w-4 sm:h-4" />
                  )}
                  <span className="hidden sm:inline">{walletLabel}</span>
                  <span className="sm:hidden">{walletLabel}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={handleViewOnExplorer}>
                    <ExternalLink className="w-4 h-4" />
                    View on Explorer
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={handleDisconnectWallet}
                    disabled={isDisconnecting}
                    variant="destructive"
                  >
                    {isDisconnecting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <LogOut className="w-4 h-4" />
                    )}
                    Disconnect
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                onClick={handleConnectWallet}
                variant="default"
                className="flex items-center space-x-1 sm:space-x-2 px-3 sm:px-6 py-2 sm:py-2.5 font-medium text-xs sm:text-sm"
                size="sm"
                disabled={isConnecting || isDisconnecting}
              >
                {isConnecting || isDisconnecting ? (
                  <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 animate-spin" />
                ) : (
                  <Wallet className="w-3 h-3 sm:w-4 sm:h-4" />
                )}
                <span className="hidden sm:inline">
                  {isConnecting ? "Connecting" : "Connect"}
                </span>
                <span className="sm:hidden">
                  {isConnecting ? "..." : "Connect"}
                </span>
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="md:hidden p-2"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
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
  );
}
