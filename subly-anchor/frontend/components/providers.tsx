"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";

import { AddressType } from "@phantom/browser-sdk";
import type { PhantomSDKConfig } from "@phantom/react-sdk";
import { PhantomProvider } from "@phantom/react-sdk";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const phantomAppId = process.env.NEXT_PUBLIC_PHANTOM_APP_ID;
  const phantomRedirectUrl = process.env.NEXT_PUBLIC_PHANTOM_REDIRECT_URL;
  const phantomAuthUrl =
    process.env.NEXT_PUBLIC_PHANTOM_AUTH_URL ??
    "https://connect.phantom.app/login";

  const phantomConfig = useMemo<PhantomSDKConfig | null>(() => {
    if (!phantomAppId || !phantomRedirectUrl) {
      return null;
    }

    return {
      providerType: "embedded",
      addressTypes: [AddressType.solana],
      appId: phantomAppId,
      authOptions: {
        authUrl: phantomAuthUrl,
        redirectUrl: phantomRedirectUrl,
      },
      autoConnect: true,
    };
  }, [phantomAppId, phantomAuthUrl, phantomRedirectUrl]);

  if (!phantomConfig) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "PhantomProvider is not initialized. Set NEXT_PUBLIC_PHANTOM_APP_ID and NEXT_PUBLIC_PHANTOM_REDIRECT_URL."
      );
    }
    return <>{children}</>;
  }

  return <PhantomProvider config={phantomConfig}>{children}</PhantomProvider>;
}
