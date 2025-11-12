"use client";

import { useCallback, useMemo } from "react";

import type { AuthOptions } from "@phantom/browser-sdk";
import { AddressType } from "@phantom/browser-sdk";
import {
  useAccounts,
  useConnect,
  useDisconnect,
  useIsPhantomLoginAvailable,
  useSolana,
} from "@phantom/react-sdk";

export function usePhantomWallet() {
  const addresses = useAccounts();
  const { solana } = useSolana();
  const { isAvailable: isPhantomLoginAvailable } = useIsPhantomLoginAvailable();

  const {
    connect,
    isConnecting,
    error: connectError,
    currentProviderType,
  } = useConnect();
  const {
    disconnect,
    isDisconnecting,
    error: disconnectError,
  } = useDisconnect();

  const solanaAddress = useMemo(() => {
    return (
      addresses?.find((addr) => addr.addressType === AddressType.solana)
        ?.address ?? null
    );
  }, [addresses]);

  const connectWithPreferredProvider = useCallback(
    async (providerOverride?: AuthOptions["provider"]) => {
      const provider =
        providerOverride ?? (isPhantomLoginAvailable ? "phantom" : "google");
      await connect({ provider });
    },
    [connect, isPhantomLoginAvailable]
  );

  return {
    solana,
    solanaAddress,
    addresses,
    isConnected: Boolean(solanaAddress),
    connect: connectWithPreferredProvider,
    isConnecting,
    connectError,
    disconnect,
    isDisconnecting,
    disconnectError,
    currentProviderType,
    isPhantomLoginAvailable,
  };
}
