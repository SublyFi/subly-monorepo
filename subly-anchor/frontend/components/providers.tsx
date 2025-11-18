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
  return (
    <PhantomProvider
      config={{
        providerType: "embedded", // or "injected" for browser extension
        addressTypes: [AddressType.solana],
        appId: process.env.NEXT_PUBLIC_PHANTOM_APP_ID || "",
        authOptions: {
          authUrl: "https://connect.phantom.app/login",
          redirectUrl: process.env.NEXT_PUBLIC_PHANTOM_REDIRECT_URL || "", // Must be an existing page in your app and whitelisted in Phantom Portal
        },
      }}
    >
      {children}
    </PhantomProvider>
  );
}
