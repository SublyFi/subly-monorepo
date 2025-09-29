"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { usePrivy } from "@privy-io/react-auth"
import { useWallets } from "@privy-io/react-auth/solana"
import { Connection, PublicKey } from "@solana/web3.js"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Sparkles, CheckCircle, XCircle, Loader2 } from "lucide-react"
import { PayPalSetupModal } from "./paypal-setup-modal"
import {
  fetchPayPalRecipient,
  fetchSublyConfig,
  fetchUserStakeEntries,
  fetchSubscriptionServices,
  formatUsdcFromSmallest,
  type PayPalRecipientDetails,
} from "@/lib/subly"

interface SubscriptionService {
  id: number
  name: string
  price: number
  description: string
  logoUrl: string
  provider: string
  isSubscribed?: boolean
}

const DEVNET_ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC_ENDPOINT ?? "https://api.devnet.solana.com"

export function SubscriptionInterface() {
  const [availableYield, setAvailableYield] = useState(0)
  const [totalStaked, setTotalStaked] = useState(0)
  const [isYieldLoading, setIsYieldLoading] = useState(false)
  const [servicesLoading, setServicesLoading] = useState(false)
  const [showPayPalModal, setShowPayPalModal] = useState(false)
  const [hasPayPal, setHasPayPal] = useState(false)
  const [availableServices, setAvailableServices] = useState<SubscriptionService[]>([])

  const { ready, authenticated } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()

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

  useEffect(() => {
    void loadYieldData()
  }, [loadYieldData])

  const loadServices = useCallback(async () => {
    try {
      setServicesLoading(true)
      const services = await fetchSubscriptionServices(connection)

      const mapped = services.map((service) => ({
        id: service.id,
        name: service.name,
        price: Number(formatUsdcFromSmallest(service.monthlyPrice)),
        description: service.details,
        logoUrl: service.logoUrl,
        provider: service.provider,
      }))

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

  useEffect(() => {
    void loadServices()
  }, [loadServices])

  const subscribedServices: SubscriptionService[] = []

  const handleSubscribe = (service: SubscriptionService) => {
    if (!hasPayPal) {
      setShowPayPalModal(true)
      return
    }

    // Handle subscription logic
    console.log("Subscribing to:", service.name)
  }

  const handlePayPalSave = (email: string) => {
    setHasPayPal(true)
    console.log("PayPal email saved:", email)
  }

  const handleUnsubscribe = (serviceId: number) => {
    console.log("Unsubscribing from:", serviceId)
  }

  const totalSubscriptionCost = subscribedServices.reduce((total, service) => total + service.price, 0)
  const remainingYield = Math.max(availableYield - totalSubscriptionCost, 0)
  const dataLoading = isYieldLoading || servicesLoading
  const canPurchaseWhileLoading = dataLoading || !walletConnected

  return (
    <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6 px-4 sm:px-6 py-6 sm:py-8">
      {/* Yield Balance Card */}
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
                    ${availableYield.toFixed(2)}
                  </p>
                  <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                    Total Staked: <span className="font-medium text-foreground">${totalStaked.toFixed(2)}</span>
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
              <p className="text-lg sm:text-xl font-semibold">${totalSubscriptionCost.toFixed(2)}</p>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Remaining: <span className="text-green-600 font-medium">${remainingYield.toFixed(2)}</span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Interface */}
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
                {availableServices.map((service) => {
                  const canAfford = !canPurchaseWhileLoading && remainingYield >= service.price

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
                            <div className="flex items-center justify-between">
                              <span className="text-lg sm:text-xl font-bold">
                                ${service.price.toFixed(2)}/mo
                              </span>
                              {!canAfford && !dataLoading && (
                                <Badge variant="destructive" className="text-xs">
                                  Insufficient Yield
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>

                        <Button
                          className="w-full mt-4 text-sm sm:text-base"
                          onClick={() => handleSubscribe(service)}
                          disabled={!canAfford}
                        >
                          {canAfford
                            ? "Subscribe"
                            : dataLoading
                            ? "Loading Data"
                            : "Need More Yield"}
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
              {subscribedServices.length > 0 ? (
                <div className="space-y-4">
                  {subscribedServices.map((service) => (
                    <Card key={service.id}>
                      <CardContent className="p-4 sm:p-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-0">
                          <div className="flex items-center space-x-3 sm:space-x-4 min-w-0 flex-1">
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
                            <div className="min-w-0 flex-1">
                              <h3 className="font-semibold text-base sm:text-lg truncate">{service.name}</h3>
                              <p className="text-xs sm:text-sm text-muted-foreground line-clamp-1">
                                {service.description}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end space-x-4">
                            <div className="text-left sm:text-right">
                              <p className="font-semibold text-sm sm:text-base">
                                ${service.price.toFixed(2)}/mo
                              </p>
                              <div className="flex items-center space-x-1">
                                <CheckCircle className="w-4 h-4 text-green-500" />
                                <span className="text-xs sm:text-sm text-green-600">Active</span>
                              </div>
                            </div>

                            <Button
                              variant="destructive"
                              onClick={() => handleUnsubscribe(service.id)}
                              size="sm"
                              className="text-xs sm:text-sm"
                            >
                              Unsubscribe
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
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

      {/* PayPal Setup Modal */}
      <PayPalSetupModal isOpen={showPayPalModal} onClose={() => setShowPayPalModal(false)} onSave={handlePayPalSave} />
    </div>
  )
}
