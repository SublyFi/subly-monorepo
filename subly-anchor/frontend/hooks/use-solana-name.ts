"use client"

import { useEffect, useMemo, useState } from "react"

import { getDomainKeysWithReverses } from "@bonfida/spl-name-service"
import { Connection, PublicKey } from "@solana/web3.js"

const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC_ENDPOINT ?? "https://api.devnet.solana.com"

export function useSolanaName(address?: string | null) {
  const [name, setName] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const connection = useMemo(() => new Connection(RPC_ENDPOINT), [])

  useEffect(() => {
    if (!address) {
      setName(null)
      setIsLoading(false)
      return
    }

    let isCancelled = false

    const lookup = async () => {
      setIsLoading(true)
      try {
        const owner = new PublicKey(address)
        const results = await getDomainKeysWithReverses(connection, owner)
        if (isCancelled) {
          return
        }
        const firstDomain = results.find((entry) => entry.domain)?.domain ?? null
        setName(firstDomain)
      } catch (error) {
        console.error("Failed to resolve Solana name", error)
        if (!isCancelled) {
          setName(null)
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    void lookup()

    return () => {
      isCancelled = true
    }
  }, [address, connection])

  return { name, isLoading }
}
