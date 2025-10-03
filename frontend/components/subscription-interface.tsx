"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { usePrivy } from "@privy-io/react-auth"
import { useSignAndSendTransaction, useWallets } from "@privy-io/react-auth/solana"
import { Connection, PublicKey } from "@solana/web3.js"
import bs58 from "bs58"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, Loader2, Sparkles, XCircle } from "lucide-react"
import {
  fetchPayPalRecipient,
  fetchSublyConfig,
  fetchSubscriptionServices,
  fetchUserStakeEntries,
  fetchUserSubscriptions,
  formatUsdcAmountDisplay,
  formatUsdcFromSmallest,
  prepareSubscribeServiceTransaction,
  prepareUnsubscribeServiceTransaction,
  type PayPalRecipientDetails,
  type SubscriptionServiceEntry,
  type UserSubscriptionEntry,
} from "@/lib/subly"

interface SubscriptionServiceCard {
  id: number
  name: string
  price: number
  description: string
  logoUrl: string
  provider: string
}

interface ResolvedSubscriptionCard extends SubscriptionServiceCard {
  subscriptionId: number
  status: "ACTIVE" | "PENDING_CANCELLATION" | "CANCELLED"
  nextBillingTs: number
  initialPaymentRecorded: boolean
}

const DEVNET_ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC_ENDPOINT ?? "https://api.devnet.solana.com"

const STATUS_LABELS: Record<ResolvedSubscriptionCard["status"], string> = {
  ACTIVE: "Active",
  PENDING_CANCELLATION: "Pending Cancellation",
  CANCELLED: "Cancelled",
}

function navigateToTab(tab: string) {
  if (typeof document === "undefined") {
    return
  }
  document.dispatchEvent(new CustomEvent("subly:navigate-tab", { detail: { tab } }))
}

export function SubscriptionInterface() {
  const [availableYield, setAvailableYield] = useState(0)
  const [totalStaked, setTotalStaked] = useState(0)
  const [isYieldLoading, setIsYieldLoading] = useState(false)
  const [servicesLoading, setServicesLoading] = useState(false)
  const [availableServices, setAvailableServices] = useState<SubscriptionServiceCard[]>([])
  const [userSubscriptions, setUserSubscriptions] = useState<UserSubscriptionEntry[]>([])
  const [hasPayPal, setHasPayPal] = useState(false)
  const [processingServiceId, setProcessingServiceId] = useState<number | null>(null)
  const [processingUnsubscribeId, setProcessingUnsubscribeId] = useState<number | null>(null)

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

  const updatePayPalState = useCallback((details: PayPalRecipientDetails | null) => {
    setHasPayPal(Boolean(details?.configured && details.receiver))
  }, [])

  const loadYieldData = useCallback(async () => {
    if (!walletConnected || !activeWallet?.address) {
      setAvailableYield(0)
      setTotalStaked(0)
      updatePayPalState(null)
      return
    }

    try {
      setIsYieldLoading(true)
      const userPk = new PublicKey(activeWallet.address)

      const [config, stakeEntries, payPalDetails] = await Promise.all([
        fetchSublyConfig(connection),
        fetchUserStakeEntries(connection, userPk),
        fetchPayPalRecipient(connection, userPk),
      ])

      updatePayPalState(payPalDetails)

      const totalPrincipal = stakeEntries.reduce((sum, entry) => sum + entry.principal, 0n)
      if (totalPrincipal === 0n) {
        setAvailableYield(0)
        setTotalStaked(0)
        return
      }

      const principalFormatted = Number(formatUsdcFromSmallest(totalPrincipal))
      setTotalStaked(Number.isFinite(principalFormatted) ? principalFormatted : 0)

      const annualYieldSmallest = (totalPrincipal * BigInt(config.apyBps)) / 10000n
      const monthlyYieldSmallest = annualYieldSmallest / 12n
      const monthlyYield = Number(monthlyYieldSmallest) / 1_000_000

      setAvailableYield(Number.isFinite(monthlyYield) ? monthlyYield : 0)
    } catch (error) {
      console.error("Failed to load yield data", error)
      toast.error(
        error instanceof Error ? error.message : "Unable to load staking yield information.",
      )
      setAvailableYield(0)
      setTotalStaked(0)
    } finally {
      setIsYieldLoading(false)
    }
  }, [activeWallet, connection, updatePayPalState, walletConnected])

  const loadServices = useCallback(async () => {
    try {
      setServicesLoading(true)
      const services = await fetchSubscriptionServices(connection)

      const mapped: SubscriptionServiceCard[] = services
        .map((service: SubscriptionServiceEntry) => ({
          id: service.id,
          name: service.name,
          price: Number(formatUsdcFromSmallest(service.monthlyPrice)),
          description: service.details,
          logoUrl: service.logoUrl,
          provider: service.provider,
        }))
        .sort((a, b) => a.id - b.id)

      setAvailableServices(mapped)
    } catch (error) {
      console.error("Failed to load subscription services", error)
      toast.error(
        error instanceof Error ? error.message : "Unable to load subscription services.",
      )
      setAvailableServices([])
    } finally {
      setServicesLoading(false)
    }
  }, [connection])

  const loadUserSubscriptions = useCallback(async () => {
    if (!walletConnected || !activeWallet?.address) {
      setUserSubscriptions([])
      return
    }

    try {
      const userPk = new PublicKey(activeWallet.address)
      const subscriptions = await fetchUserSubscriptions(connection, userPk)
      setUserSubscriptions(subscriptions)
    } catch (error) {
      console.error("Failed to load user subscriptions", error)
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to load your subscriptions.",
      )
      setUserSubscriptions([])
    }
  }, [activeWallet, connection, walletConnected])

  useEffect(() => {
    void loadYieldData()
  }, [loadYieldData])

  useEffect(() => {
    void loadServices()
  }, [loadServices])

  useEffect(() => {
    void loadUserSubscriptions()
  }, [loadUserSubscriptions])

  const resolvedSubscriptions = useMemo<ResolvedSubscriptionCard[]>(() => {
    if (!availableServices.length || !userSubscriptions.length) {
      return []
    }

    return userSubscriptions
      .map((subscription) => {
        const service = availableServices.find((s) => s.id === subscription.serviceId)
        if (!service) {
          return null
        }

        const priceNumber = Number(formatUsdcFromSmallest(subscription.monthlyPrice))

        return {
          subscriptionId: subscription.id,
          serviceId: subscription.serviceId,
          name: service.name,
          description: service.description,
          provider: service.provider,
          logoUrl: service.logoUrl,
          price: Number.isFinite(priceNumber) ? priceNumber : 0,
          status: subscription.status,
          nextBillingTs: subscription.nextBillingTs,
          initialPaymentRecorded: subscription.initialPaymentRecorded,
        }
      })
      .filter(Boolean) as ResolvedSubscriptionCard[]
  }, [availableServices, userSubscriptions])

  const subscribedServiceIds = useMemo(() => {
    return new Set(resolvedSubscriptions.map((subscription) => subscription.serviceId))
  }, [resolvedSubscriptions])

  const totalSubscriptionCost = resolvedSubscriptions.reduce(
    (total, subscription) => total + subscription.price,
    0,
  )
  const remainingYield = Math.max(availableYield - totalSubscriptionCost, 0)
  const dataLoading = isYieldLoading || servicesLoading

  const handleSubscribe = useCallback(
    async (service: SubscriptionServiceCard) => {
      if (!walletConnected || !activeWallet?.address) {
        toast.error("Connect a wallet before subscribing to a service.")
        return
      }

      if (!hasPayPal) {
        toast.error("Add your PayPal payout information in the Profile tab before subscribing.", {
          action: {
            label: "Go to Profile",
            onClick: () => navigateToTab("profile"),
          },
        })
        navigateToTab("profile")
        return
      }

      try {
        setProcessingServiceId(service.id)
        const userPk = new PublicKey(activeWallet.address)

        const { transaction, blockhash } = await prepareSubscribeServiceTransaction(
          connection,
          userPk,
          service.id,
        )

        const serialized = transaction.serialize({ requireAllSignatures: false })
        const { signature } = await signAndSendTransaction({
          transaction: serialized,
          wallet: activeWallet,
          chain: "solana:devnet",
        })

        const signatureString = bs58.encode(signature)

        await connection.confirmTransaction(
          {
            signature: signatureString,
            blockhash: blockhash.blockhash,
            lastValidBlockHeight: blockhash.lastValidBlockHeight,
          },
          "confirmed",
        )

        toast.success(`Subscribed to ${service.name}`, {
          description: `${signatureString.slice(0, 8)}…${signatureString.slice(-8)}`,
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

        await Promise.all([loadYieldData(), loadUserSubscriptions()])
      } catch (error) {
        console.error("Failed to subscribe to service", error)
        toast.error(
          error instanceof Error ? error.message : "Subscription failed. Please try again.",
        )
      } finally {
        setProcessingServiceId(null)
      }
    },
    [
      activeWallet,
      connection,
      hasPayPal,
      loadUserSubscriptions,
      loadYieldData,
      signAndSendTransaction,
      walletConnected,
    ],
  )

  const handleUnsubscribe = useCallback(
    async (subscription: ResolvedSubscriptionCard) => {
      if (!walletConnected || !activeWallet?.address) {
        toast.error("Connect a wallet before unsubscribing.")
        return
      }

      if (subscription.status !== "ACTIVE") {
        toast.info("This subscription is not currently active.")
        return
      }

      try {
        setProcessingUnsubscribeId(subscription.subscriptionId)
        const userPk = new PublicKey(activeWallet.address)

        const { transaction, blockhash } = await prepareUnsubscribeServiceTransaction(
          connection,
          userPk,
          subscription.subscriptionId,
        )

        const serialized = transaction.serialize({ requireAllSignatures: false })
        const { signature } = await signAndSendTransaction({
          transaction: serialized,
          wallet: activeWallet,
          chain: "solana:devnet",
        })

        const signatureString = bs58.encode(signature)

        await connection.confirmTransaction(
          {
            signature: signatureString,
            blockhash: blockhash.blockhash,
            lastValidBlockHeight: blockhash.lastValidBlockHeight,
          },
          "confirmed",
        )

        toast.success(`Unsubscribe requested for ${subscription.name}`, {
          description: `${signatureString.slice(0, 8)}…${signatureString.slice(-8)}`,
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

        await Promise.all([loadYieldData(), loadUserSubscriptions()])
      } catch (error) {
        console.error("Failed to unsubscribe", error)
        toast.error(
          error instanceof Error ? error.message : "Unsubscribe failed. Please try again.",
        )
      } finally {
        setProcessingUnsubscribeId(null)
      }
    },
    [
      activeWallet,
      connection,
      loadUserSubscriptions,
      loadYieldData,
      signAndSendTransaction,
      walletConnected,
    ],
  )

  return (
    <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6 px-4 sm:px-6 py-6 sm:py-8">
      <Card className="bg-gradient-to-r from-blue-50 to-green-50 dark:from-blue-900/20 dark:to-green-900/20">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-0">
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base sm:text-lg font-semibold">Monthly Yield Available</h3>
                {isYieldLoading && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />}
              </div>
              {walletConnected ? (
                <>
                  <p className="text-2xl sm:text-3xl font-bold text-green-600">
                    {formatUsdcAmountDisplay(availableYield)} USDC
                  </p>
                  <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                    Total Staked: <span className="font-medium text-foreground">{formatUsdcAmountDisplay(totalStaked)} USDC</span>
                  </p>
                </>
              ) : (
                <p className="text-sm sm:text-base text-muted-foreground">
                  Connect your wallet to view yield
                </p>
              )}
            </div>
            <div className="text-left sm:text-right">
              <p className="text-xs sm:text-sm text-muted-foreground">Current Subscriptions</p>
              <p className="text-lg sm:text-xl font-semibold">{formatUsdcAmountDisplay(totalSubscriptionCost)} USDC</p>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Remaining: <span className="text-green-600 font-medium">{formatUsdcAmountDisplay(remainingYield)} USDC</span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-4 sm:px-6">
          <CardTitle className="text-xl sm:text-2xl">Subscription Management</CardTitle>
          <p className="text-sm sm:text-base text-muted-foreground">Subscribe to services using your staking yield</p>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          <Tabs defaultValue="subscribe" className="w-full">
            <TabsList className="grid w-full grid-cols-2 h-10 sm:h-12">
              <TabsTrigger value="subscribe" className="text-sm sm:text-base">
                Subscribe
              </TabsTrigger>
              <TabsTrigger value="unsubscribe" className="text-sm sm:text-base">
                My Subscriptions
              </TabsTrigger>
            </TabsList>

            <TabsContent value="subscribe" className="space-y-4 sm:space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                {availableServices
                  .filter((service) => !subscribedServiceIds.has(service.id))
                  .map((service) => {
                    const busy = processingServiceId === service.id
                    const canAfford =
                      walletConnected && !dataLoading && remainingYield >= service.price && !busy
                    const disabled =
                      !walletConnected || dataLoading || remainingYield < service.price || busy

                  return (
                    <Card key={service.id} className={`relative ${!canAfford ? "opacity-60" : ""}`}>
                      <CardContent className="p-4 sm:p-6">
                        <div className="flex items-start space-x-3 sm:space-x-4">
                          {service.logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={service.logoUrl}
                              alt={`${service.name} logo`}
                              className="w-8 h-8 rounded object-cover flex-shrink-0"
                            />
                          ) : (
                            <Sparkles className="w-8 h-8 text-blue-600 flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-base sm:text-lg truncate">{service.name}</h3>
                            <p className="text-xs text-muted-foreground mb-1 truncate">{service.provider}</p>
                            <p className="text-xs sm:text-sm text-muted-foreground mb-2 line-clamp-2">
                              {service.description}
                            </p>
                            <div className="flex items-center">
                              <span className="text-lg sm:text-xl font-bold">
                                {formatUsdcAmountDisplay(service.price)} USDC/mo
                              </span>
                            </div>
                          </div>
                        </div>

                        <Button
                          className="w-full mt-4 text-sm sm:text-base"
                          onClick={() => handleSubscribe(service)}
                          disabled={disabled}
                        >
                          {busy
                            ? "Subscribing..."
                            : canAfford
                            ? "Subscribe"
                            : !walletConnected
                            ? "Connect Wallet"
                            : dataLoading
                            ? "Loading Data"
                            : "Insufficient Yield"}
                        </Button>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>

              {availableServices.length === 0 && !servicesLoading && (
                <div className="text-center py-8 sm:py-12">
                  <p className="text-sm sm:text-base text-muted-foreground">No services available at the moment.</p>
                </div>
              )}
              {servicesLoading && (
                <div className="flex items-center justify-center py-8 sm:py-12 space-x-2 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm sm:text-base">Loading subscription catalog…</span>
                </div>
              )}
            </TabsContent>

            <TabsContent value="unsubscribe" className="space-y-4 sm:space-y-6">
              {resolvedSubscriptions.length > 0 ? (
                <div className="space-y-4">
                  {resolvedSubscriptions.map((subscription) => {
                    const nextBillingLabel =
                      subscription.nextBillingTs > 0
                        ? new Date(subscription.nextBillingTs * 1000).toLocaleDateString()
                        : "Pending"

                    const canUnsubscribe = subscription.status === "ACTIVE"
                    const busy = processingUnsubscribeId === subscription.subscriptionId

                    return (
                      <Card key={subscription.subscriptionId}>
                        <CardContent className="p-4 sm:p-6">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-0">
                            <div className="flex items-center space-x-3 sm:space-x-4 min-w-0 flex-1">
                              {subscription.logoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={subscription.logoUrl}
                                  alt={`${subscription.name} logo`}
                                  className="w-8 h-8 rounded object-cover flex-shrink-0"
                                />
                              ) : (
                                <Sparkles className="w-8 h-8 text-blue-600 flex-shrink-0" />
                              )}
                              <div className="min-w-0 flex-1">
                                <h3 className="font-semibold text-base sm:text-lg truncate">
                                  {subscription.name}
                                </h3>
                                <p className="text-xs sm:text-sm text-muted-foreground line-clamp-1">
                                  {subscription.description}
                                </p>
                                <div className="flex items-center space-x-2 mt-1">
                                  <Badge variant="outline" className="text-[10px] sm:text-xs">
                                    {STATUS_LABELS[subscription.status]}
                                  </Badge>
                                  <span className="text-[10px] sm:text-xs text-muted-foreground">
                                    Next billing: {nextBillingLabel}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-between sm:justify-end space-x-4">
                             <div className="text-left sm:text-right">
                                <p className="font-semibold text-sm sm:text-base">
                                  {formatUsdcAmountDisplay(subscription.price)} USDC/mo
                                </p>
                                <div className="flex items-center space-x-1 justify-start sm:justify-end">
                                  <CheckCircle className="w-4 h-4 text-green-500" />
                                  <span className="text-xs sm:text-sm text-green-600">Active</span>
                                </div>
                              </div>

                              <Button
                                variant="destructive"
                                onClick={() => handleUnsubscribe(subscription)}
                                size="sm"
                                className="text-xs sm:text-sm"
                                disabled={!canUnsubscribe || busy}
                              >
                                {busy
                                  ? "Processing…"
                                  : canUnsubscribe
                                  ? "Unsubscribe"
                                  : subscription.status === "PENDING_CANCELLATION"
                                  ? "Pending"
                                  : "Cancelled"}
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              ) : (
                <div className="text-center py-8 sm:py-12">
                  <XCircle className="w-10 h-10 sm:w-12 sm:h-12 text-muted-foreground mx-auto mb-3 sm:mb-4" />
                  <p className="text-sm sm:text-base text-muted-foreground">No active subscriptions.</p>
                  <p className="text-xs sm:text-sm text-muted-foreground mt-2">
                    Subscribe to services to see them here.
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
