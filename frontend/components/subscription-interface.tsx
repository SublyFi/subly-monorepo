"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Music, Youtube, Sparkles, CheckCircle, XCircle } from "lucide-react"
import { PayPalSetupModal } from "./paypal-setup-modal"

interface SubscriptionService {
  id: string
  name: string
  price: number
  description: string
  logo: React.ReactNode
  isSubscribed?: boolean
}

export function SubscriptionInterface() {
  const [availableYield] = useState(30) // $30 monthly yield available
  const [showPayPalModal, setShowPayPalModal] = useState(false)
  const [hasPayPal, setHasPayPal] = useState(false) // Track PayPal setup status

  const availableServices: SubscriptionService[] = [
    {
      id: "netflix",
      name: "Netflix",
      price: 15.49,
      description: "Stream movies and TV shows",
      logo: <div className="w-8 h-8 bg-red-600 rounded flex items-center justify-center text-white font-bold">N</div>,
    },
    {
      id: "spotify",
      name: "Spotify",
      price: 9.99,
      description: "Music streaming service",
      logo: <Music className="w-8 h-8 text-green-500" />,
    },
    {
      id: "youtube",
      name: "YouTube Premium",
      price: 11.99,
      description: "Ad-free YouTube experience",
      logo: <Youtube className="w-8 h-8 text-red-500" />,
    },
    {
      id: "disney",
      name: "Disney+",
      price: 7.99,
      description: "Disney movies and shows",
      logo: <Sparkles className="w-8 h-8 text-blue-600" />,
    },
  ]

  const subscribedServices: SubscriptionService[] = [
    {
      id: "netflix",
      name: "Netflix",
      price: 15.49,
      description: "Stream movies and TV shows",
      logo: <div className="w-8 h-8 bg-red-600 rounded flex items-center justify-center text-white font-bold">N</div>,
      isSubscribed: true,
    },
  ]

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

  const handleUnsubscribe = (serviceId: string) => {
    console.log("Unsubscribing from:", serviceId)
  }

  const totalSubscriptionCost = subscribedServices.reduce((total, service) => total + service.price, 0)
  const remainingYield = availableYield - totalSubscriptionCost

  return (
    <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6 px-4 sm:px-6 py-6 sm:py-8">
      {/* Yield Balance Card */}
      <Card className="bg-gradient-to-r from-blue-50 to-green-50 dark:from-blue-900/20 dark:to-green-900/20">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-0">
            <div>
              <h3 className="text-base sm:text-lg font-semibold">Monthly Yield Available</h3>
              <p className="text-2xl sm:text-3xl font-bold text-green-600">${availableYield.toFixed(2)}</p>
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
                  const canAfford = remainingYield >= service.price

                  return (
                    <Card key={service.id} className={`relative ${!canAfford ? "opacity-60" : ""}`}>
                      <CardContent className="p-4 sm:p-6">
                        <div className="flex items-start space-x-3 sm:space-x-4">
                          {service.logo}
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-base sm:text-lg truncate">{service.name}</h3>
                            <p className="text-xs sm:text-sm text-muted-foreground mb-2 line-clamp-2">
                              {service.description}
                            </p>
                            <div className="flex items-center justify-between">
                              <span className="text-lg sm:text-xl font-bold">${service.price}/mo</span>
                              {!canAfford && (
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
                          {canAfford ? "Subscribe" : "Need More Yield"}
                        </Button>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>

              {availableServices.length === 0 && (
                <div className="text-center py-8 sm:py-12">
                  <p className="text-sm sm:text-base text-muted-foreground">No services available at the moment.</p>
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
                            {service.logo}
                            <div className="min-w-0 flex-1">
                              <h3 className="font-semibold text-base sm:text-lg truncate">{service.name}</h3>
                              <p className="text-xs sm:text-sm text-muted-foreground line-clamp-1">
                                {service.description}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end space-x-4">
                            <div className="text-left sm:text-right">
                              <p className="font-semibold text-sm sm:text-base">${service.price}/mo</p>
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
