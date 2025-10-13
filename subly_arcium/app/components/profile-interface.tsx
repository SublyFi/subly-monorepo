"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { usePrivy } from "@privy-io/react-auth"
import { useSignAndSendTransaction, useWallets } from "@privy-io/react-auth/solana"
import { Connection, PublicKey, type BlockhashWithExpiryBlockHeight, Transaction } from "@solana/web3.js"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CheckCircle, Edit, Loader2, Mail, XCircle } from "lucide-react"

import {
  decodeSignature,
  fetchPayPalRecipient,
  prepareRegisterPayPalRecipientTransaction,
  shortenSignature,
  type SendAndConfirmFn,
  type PayPalRecipientDetails,
  type RegisterPayPalArgs,
} from "@/lib/subly"

type PayPalUiType = "email" | "paypal_id" | "phone" | "user_handle"

interface PayPalInfo {
  type: PayPalUiType
  value: string
  isVerified: boolean
}

const DEVNET_ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC_ENDPOINT ?? "https://api.devnet.solana.com"

const PROGRAM_TO_UI: Record<NonNullable<PayPalRecipientDetails["recipientType"]>, PayPalUiType> = {
  EMAIL: "email",
  PAYPAL_ID: "paypal_id",
  PHONE: "phone",
  USER_HANDLE: "user_handle",
}

const UI_TO_PROGRAM: Record<PayPalUiType, RegisterPayPalArgs["recipientType"]> = {
  email: "EMAIL",
  paypal_id: "PAYPAL_ID",
  phone: "PHONE",
  user_handle: "USER_HANDLE",
}

const RECIPIENT_CACHE_KEY = "subly:paypal-recipient-cache"

type RecipientCacheEntry = {
  value: string
  type: PayPalUiType
}

function loadRecipientCache(): Record<string, RecipientCacheEntry> {
  if (typeof window === "undefined") {
    return {}
  }
  try {
    const raw = window.localStorage.getItem(RECIPIENT_CACHE_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as Record<string, RecipientCacheEntry>
    if (!parsed || typeof parsed !== "object") {
      return {}
    }
    return parsed
  } catch {
    return {}
  }
}

function saveRecipientCache(cache: Record<string, RecipientCacheEntry>): void {
  if (typeof window === "undefined") {
    return
  }
  try {
    window.localStorage.setItem(RECIPIENT_CACHE_KEY, JSON.stringify(cache))
  } catch (error) {
    console.warn("Failed to persist PayPal recipient cache", error)
  }
}

function cacheKeyFromHashes(low: bigint, high: bigint): string {
  return `${low.toString(10)}:${high.toString(10)}`
}

function findCachedRecipient(details: PayPalRecipientDetails): RecipientCacheEntry | null {
  if (!details.receiverHashLow || !details.receiverHashHigh) {
    return null
  }
  const cache = loadRecipientCache()
  const key = cacheKeyFromHashes(details.receiverHashLow, details.receiverHashHigh)
  return cache[key] ?? null
}

async function computeRecipientHash(value: string): Promise<{
  low: bigint
  high: bigint
  key: string
}> {
  if (!(typeof globalThis.crypto !== "undefined" && globalThis.crypto.subtle)) {
    throw new Error("Secure hashing is unavailable in this environment")
  }
  const encoder = new TextEncoder()
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value))
  const bytes = new Uint8Array(digest)
  const lowBytes = bytes.slice(0, 16)
  const highBytes = bytes.slice(16)

  const toBigIntLE = (arr: Uint8Array): bigint => {
    let result = 0n
    for (let i = 0; i < arr.length; i++) {
      result |= BigInt(arr[i]) << BigInt(8 * i)
    }
    return result
  }

  const low = toBigIntLE(lowBytes)
  const high = toBigIntLE(highBytes)
  return { low, high, key: cacheKeyFromHashes(low, high) }
}

function getPayPalTypeLabel(type: PayPalUiType) {
  switch (type) {
    case "email":
      return "Email Address"
    case "paypal_id":
      return "PayPal ID"
    case "phone":
      return "Phone Number"
    case "user_handle":
      return "User Handle"
    default:
      return "Email Address"
  }
}

function getPlaceholder(type: PayPalUiType) {
  switch (type) {
    case "email":
      return "your-email@example.com"
    case "paypal_id":
      return "your-paypal-id"
    case "phone":
      return "+1234567890"
    case "user_handle":
      return "@username"
    default:
      return "your-email@example.com"
  }
}

export function ProfileInterface() {
  const [paypalInfo, setPaypalInfo] = useState<PayPalInfo | null>(null)
  const [isEditingPaypal, setIsEditingPaypal] = useState(false)
  const [paypalType, setPaypalType] = useState<PayPalUiType>("email")
  const [paypalValue, setPaypalValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const { ready, authenticated } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()
  const { signAndSendTransaction } = useSignAndSendTransaction()

  const activeWallet = wallets[0]
  const walletConnected =
    ready && authenticated && walletsReady && Boolean(activeWallet?.address)

  const connection = useMemo(
    () => new Connection(DEVNET_ENDPOINT, "confirmed"),
    [],
  )

  const sendComputation = useCallback<SendAndConfirmFn>(
    async (transaction: Transaction, blockhash: BlockhashWithExpiryBlockHeight) => {
      if (!activeWallet) {
        throw new Error("No active wallet connected")
      }

      const serialized = transaction.serialize({ requireAllSignatures: false })
      const { signature } = await signAndSendTransaction({
        transaction: serialized,
        wallet: activeWallet,
        chain: "solana:devnet",
      })

      const signatureString = decodeSignature(signature)
      await connection.confirmTransaction(
        {
          signature: signatureString,
          blockhash: blockhash.blockhash,
          lastValidBlockHeight: blockhash.lastValidBlockHeight,
        },
        "confirmed",
      )

      return { signature: signatureString }
    },
    [activeWallet, connection, signAndSendTransaction],
  )

  const mapRecipientDetailsToInfo = useCallback((details: PayPalRecipientDetails) => {
    const defaultType = details.recipientType ? PROGRAM_TO_UI[details.recipientType] ?? "email" : "email"
    const cached = findCachedRecipient(details)

    return {
      type: cached?.type ?? defaultType,
      value: cached?.value ?? "",
      isVerified: details.configured,
    } satisfies PayPalInfo
  }, [])

  const loadPayPalInfo = useCallback(async () => {
    if (!walletConnected || !activeWallet?.address) {
      setPaypalInfo(null)
      return
    }

    try {
      setIsLoading(true)
      const userPk = new PublicKey(activeWallet.address)
      const { details } = await fetchPayPalRecipient(connection, userPk, sendComputation)

      if (!details || !details.configured) {
        setPaypalInfo(null)
        return
      }

      setPaypalInfo(mapRecipientDetailsToInfo(details))
    } catch (error) {
      console.error("Failed to fetch PayPal recipient", error)
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load PayPal payout information.",
      )
    } finally {
      setIsLoading(false)
    }
  }, [
    activeWallet,
    connection,
    mapRecipientDetailsToInfo,
    sendComputation,
    walletConnected,
  ])

  useEffect(() => {
    void loadPayPalInfo()
  }, [loadPayPalInfo])

  const handleBeginEdit = () => {
    if (!walletConnected) {
      toast.error("Connect your wallet to manage PayPal payouts")
      return
    }

    setPaypalType(paypalInfo?.type ?? "email")
    setPaypalValue(paypalInfo?.value ?? "")
    setIsEditingPaypal(true)
  }

  const handleCancelEdit = () => {
    setPaypalValue(paypalInfo?.value ?? "")
    setPaypalType(paypalInfo?.type ?? "email")
    setIsEditingPaypal(false)
  }

  const handleSavePaypal = useCallback(async () => {
    if (!walletConnected || !activeWallet?.address) {
      toast.error("Connect your wallet before saving PayPal information")
      return
    }

    const trimmedValue = paypalValue.trim()
    if (!trimmedValue) {
      toast.error("Enter valid PayPal recipient information")
      return
    }

    try {
      setIsSaving(true)

      const userPk = new PublicKey(activeWallet.address)
      const prepared = await prepareRegisterPayPalRecipientTransaction(
        connection,
        userPk,
        {
          recipientType: UI_TO_PROGRAM[paypalType],
          receiver: trimmedValue,
        },
      )

      const { signature: signatureString } = await sendComputation(
        prepared.transaction,
        prepared.blockhash,
      )

      const { key } = await computeRecipientHash(trimmedValue)
      const cache = loadRecipientCache()
      cache[key] = { value: trimmedValue, type: paypalType }
      saveRecipientCache(cache)

      toast.success("PayPal payout information saved", {
        description: shortenSignature(signatureString),
        action: {
          label: "Explorer",
          onClick: () =>
            window.open(
              `https://explorer.solana.com/tx/${signatureString}?cluster=devnet`,
              "_blank",
              "noopener,noreferrer",
            ),
        },
      })

      setIsEditingPaypal(false)
      await loadPayPalInfo()
    } catch (error) {
      console.error("Failed to save PayPal info", error)
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save PayPal information. Please try again.",
      )
    } finally {
      setIsSaving(false)
    }
  }, [
    activeWallet,
    connection,
    loadPayPalInfo,
    paypalType,
    paypalValue,
    sendComputation,
    walletConnected,
  ])

  return (
    <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 px-4 sm:px-6 py-6 sm:py-8">
      <Card>
        <CardHeader className="px-4 sm:px-6">
          <CardTitle className="text-xl sm:text-2xl">Profile Settings</CardTitle>
          <p className="text-sm sm:text-base text-muted-foreground">Manage your PayPal payout information</p>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0">
            <CardTitle className="text-lg sm:text-xl">PayPal Payouts</CardTitle>
            {paypalInfo && !isEditingPaypal && (
              <Button variant="outline" size="sm" onClick={handleBeginEdit} disabled={!walletConnected}>
                <Edit className="w-4 h-4 mr-2" />
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-4 sm:px-6">
          {isLoading ? (
            <div className="text-center py-6 sm:py-8">
              <Loader2 className="w-10 h-10 sm:w-12 sm:h-12 text-muted-foreground mx-auto mb-3 animate-spin" />
              <p className="text-sm sm:text-base text-muted-foreground">Loading payout information…</p>
            </div>
          ) : !paypalInfo && !isEditingPaypal ? (
            <div className="text-center py-6 sm:py-8">
              <Mail className="w-10 h-10 sm:w-12 sm:h-12 text-muted-foreground mx-auto mb-3 sm:mb-4" />
              <p className="text-sm sm:text-base text-muted-foreground mb-3 sm:mb-4">
                No PayPal payout method configured
              </p>
              <p className="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6 px-4">
                Add your PayPal information to receive subscription payments from your yield
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4 mb-4 sm:mb-6 mx-4 sm:mx-0">
                <p className="text-xs sm:text-sm text-blue-800 font-medium">
                  Use the PayPal Sandbox environment while testing. If you need credentials, use the test account
                  below.
                </p>
                <ul className="mt-2 text-xs sm:text-sm text-blue-800 space-y-1 list-disc pl-4 text-left">
                  <li>
                    <span className="font-semibold">Sandbox:</span>{" "}
                    <a
                      className="underline"
                      href="https://sandbox.paypal.com"
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      https://sandbox.paypal.com
                    </a>
                  </li>
                  <li>
                    <span className="font-semibold">Email:</span>{" "}
                    sb-sj6a446664523@personal.example.com
                  </li>
                  <li>
                    <span className="font-semibold">Password:</span>{" "}
                    1d[9mVM-
                  </li>
                </ul>
              </div>
              <Button onClick={handleBeginEdit} className="text-sm sm:text-base" disabled={!walletConnected}>
                Add PayPal Payout
              </Button>
              {!walletConnected && (
                <p className="text-xs sm:text-sm text-muted-foreground mt-3">
                  Connect your wallet to configure payout details.
                </p>
              )}
            </div>
          ) : isEditingPaypal ? (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4">
                <p className="text-xs sm:text-sm text-blue-800 font-medium">
                  Use the PayPal Sandbox environment while testing. If you need credentials, use the test account
                  below.
                </p>
                <ul className="mt-2 text-xs sm:text-sm text-blue-800 space-y-1 list-disc pl-4">
                  <li>
                    <span className="font-semibold">Sandbox:</span>{" "}
                    <a
                      className="underline"
                      href="https://sandbox.paypal.com"
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      https://sandbox.paypal.com
                    </a>
                  </li>
                  <li>
                    <span className="font-semibold">Email:</span>{" "}
                    sb-sj6a446664523@personal.example.com
                  </li>
                  <li>
                    <span className="font-semibold">Password:</span>{" "}
                    1d[9mVM-
                  </li>
                </ul>
              </div>
              <div>
                <label className="text-sm font-medium">Payout Method</label>
                <Select value={paypalType} onValueChange={(value: PayPalUiType) => setPaypalType(value)}>
                  <SelectTrigger className="mt-2">
                    <SelectValue placeholder="Select payout method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email Address</SelectItem>
                    <SelectItem value="paypal_id">PayPal ID</SelectItem>
                    <SelectItem value="phone">Phone Number</SelectItem>
                    <SelectItem value="user_handle">User Handle</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">{getPayPalTypeLabel(paypalType)}</label>
                <Input
                  type={paypalType === "email" ? "email" : paypalType === "phone" ? "tel" : "text"}
                  placeholder={getPlaceholder(paypalType)}
                  value={paypalValue}
                  onChange={(e) => setPaypalValue(e.target.value)}
                  className="mt-2"
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  onClick={handleSavePaypal}
                  disabled={!paypalValue.trim() || isSaving}
                  className="w-full sm:w-auto"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save PayPal Info"
                  )}
                </Button>
                <Button variant="outline" onClick={handleCancelEdit} className="w-full sm:w-auto bg-transparent">
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-muted/50 rounded-lg gap-3 sm:gap-0">
              <div className="flex items-center space-x-3">
                <Mail className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm sm:text-base truncate">
                    {paypalInfo.value ? paypalInfo.value : "Stored securely (value hidden)"}
                  </p>
                  <p className="text-xs sm:text-sm text-muted-foreground">{getPayPalTypeLabel(paypalInfo.type)}</p>
                  <div className="flex items-center space-x-2 mt-1">
                    {paypalInfo.isVerified ? (
                      <>
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span className="text-xs sm:text-sm text-green-600">Configured</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4 text-yellow-500" />
                        <span className="text-xs sm:text-sm text-yellow-600">Pending Verification</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
