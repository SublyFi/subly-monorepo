import rawServices from "@/lib/data/subscription-services.json"
import type { SubscriptionServiceEntry } from "@/lib/subly"

export const SERVICE_CATALOG: SubscriptionServiceEntry[] = rawServices.map(
  (service, index) => ({
    id: index,
    name: service.name,
    monthlyPrice: Number(service.monthlyPriceUsd),
    details: service.details,
    logoUrl: service.logoUrl,
    provider: service.provider,
  }),
)
