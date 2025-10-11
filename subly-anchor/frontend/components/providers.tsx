"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";

const DEVNET_HTTP_ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC_ENDPOINT ??
  "https://api.devnet.solana.com";
const DEVNET_WS_ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC_WEBSOCKET ?? "wss://api.devnet.solana.com";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  const privyConfig = useMemo(() => {
    const rpc = createSolanaRpc(DEVNET_HTTP_ENDPOINT);
    const rpcSubscriptions = createSolanaRpcSubscriptions(DEVNET_WS_ENDPOINT);

    return {
      appearance: {
        walletChainType: "solana-only" as const,
        walletList: [
          "detected_solana_wallets",
          "phantom",
          "solflare",
          "backpack",
          "metamask",
        ],
      },
      solana: {
        rpcs: {
          "solana:devnet": {
            rpc,
            rpcSubscriptions,
            blockExplorerUrl: "https://explorer.solana.com?cluster=devnet",
          },
        },
      },
      externalWallets: {
        solana: { connectors: toSolanaWalletConnectors() },
      },
    };
  }, []);

  if (!privyAppId) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "NEXT_PUBLIC_PRIVY_APP_ID is not set. PrivyProvider will not be initialized."
      );
    }
    return <>{children}</>;
  }

  return (
    <PrivyProvider appId={privyAppId} config={privyConfig}>
      {children}
    </PrivyProvider>
  );
}
