"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";

import { AddressType } from "@phantom/browser-sdk";
import type { PhantomDebugConfig, PhantomSDKConfig } from "@phantom/react-sdk";
import { DebugLevel, PhantomProvider } from "@phantom/react-sdk";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const phantomDebugEnabled =
    process.env.NEXT_PUBLIC_PHANTOM_DEBUG === "true";

  const phantomConfig = useMemo<PhantomSDKConfig>(() => {
    return {
      providerType: "injected",
      addressTypes: [AddressType.solana],
    };
  }, []);

  const phantomDebugConfig = useMemo<PhantomDebugConfig | undefined>(() => {
    if (!phantomDebugEnabled) {
      return undefined;
    }

    return {
      enabled: true,
      level: DebugLevel.DEBUG,
      callback: (entry) => {
        console.debug(
          `[Phantom][${entry.category}] ${entry.message}`,
          entry.data ?? entry
        );
      },
    };
  }, [phantomDebugEnabled]);

  return (
    <PhantomProvider config={phantomConfig} debugConfig={phantomDebugConfig}>
      {children}
    </PhantomProvider>
  );
}
