import fs from "fs";
import path from "path";

export type ServiceCacheEntry = {
  id: number;
  name: string;
  monthlyPriceUsdc: string;
  monthlyPriceUsd?: number;
  provider?: string;
  details?: string;
  logoUrl?: string;
};

type ServiceCacheFile = {
  services: ServiceCacheEntry[];
};

const DEFAULT_CACHE_FILE = path.resolve(__dirname, "..", "service-registry-cache.json");

function resolveCachePath(customPath?: string): string {
  const fromEnv = process.env.SERVICE_CACHE_PATH;
  if (customPath) {
    return path.resolve(customPath);
  }
  if (fromEnv && fromEnv.trim().length > 0) {
    return path.resolve(fromEnv);
  }
  return DEFAULT_CACHE_FILE;
}

function readCacheFile(cachePath: string): ServiceCacheFile {
  if (!fs.existsSync(cachePath)) {
    return { services: [] };
  }

  try {
    const raw = fs.readFileSync(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.services)) {
      throw new Error("Invalid cache schema");
    }
    const services = (parsed.services as unknown[]).flatMap((entry) => {
      const value = entry as Partial<ServiceCacheEntry>;
      if (
        typeof value.id === "number" &&
        Number.isInteger(value.id) &&
        typeof value.name === "string" &&
        typeof value.monthlyPriceUsdc === "string"
      ) {
        return [
          {
            id: value.id,
            name: value.name,
            monthlyPriceUsdc: value.monthlyPriceUsdc,
            monthlyPriceUsd: typeof value.monthlyPriceUsd === "number" ? value.monthlyPriceUsd : undefined,
            provider: typeof value.provider === "string" ? value.provider : undefined,
            details: typeof value.details === "string" ? value.details : undefined,
            logoUrl: typeof value.logoUrl === "string" ? value.logoUrl : undefined,
          } satisfies ServiceCacheEntry,
        ];
      }
      return [];
    });
    return { services };
  } catch (err) {
    throw new Error(`Failed to read service cache '${cachePath}': ${String(err)}`);
  }
}

function writeCacheFile(cachePath: string, cache: ServiceCacheFile): void {
  const dir = path.dirname(cachePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

export function loadServiceCache(customPath?: string): ServiceCacheEntry[] {
  const cachePath = resolveCachePath(customPath);
  return readCacheFile(cachePath).services;
}

export function loadServiceMap(customPath?: string): Map<number, ServiceCacheEntry> {
  const entries = loadServiceCache(customPath);
  return new Map(entries.map((entry) => [entry.id, entry]));
}

export function upsertServiceEntry(entry: ServiceCacheEntry, customPath?: string): void {
  const cachePath = resolveCachePath(customPath);
  const cache = readCacheFile(cachePath);
  const existingIndex = cache.services.findIndex((svc) => svc.id === entry.id);
  if (existingIndex >= 0) {
    cache.services[existingIndex] = entry;
  } else {
    cache.services.push(entry);
    cache.services.sort((a, b) => a.id - b.id);
  }
  writeCacheFile(cachePath, cache);
}
