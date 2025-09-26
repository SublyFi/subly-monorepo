import { BN } from "@coral-xyz/anchor";
import { request as httpsRequest } from "https";
import { URL } from "url";

type PayPalConfig = {
  baseUrl: string;
  clientId?: string;
  clientSecret?: string;
};

type DueEntryPayload = {
  recipientType: string;
  receiver: string;
  monthlyPriceUsdc: BN;
  serviceName: string;
  subscriptionId: BN;
};

export class PayPalClient {
  private readonly baseUrl: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private accessToken: string | null = null;
  private accessTokenExpiry = 0;

  constructor(config: PayPalConfig) {
    this.baseUrl = config.baseUrl;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;

    if (!this.clientId || !this.clientSecret) {
      console.warn(
        "PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET not set. Payout calls will be skipped.",
      );
    }
  }

  public async createPayout(entry: DueEntryPayload): Promise<void> {
    if (!this.clientId || !this.clientSecret) {
      console.log(
        `  -> Skipping PayPal payout (credentials missing) for ${entry.recipientType}:${entry.receiver} ` +
          `amount ${formatUsdc(entry.monthlyPriceUsdc)} USDC`,
      );
      return;
    }

    const token = await this.ensureAccessToken();
    const batchId = `subly-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

    const body = {
      sender_batch_header: {
        sender_batch_id: batchId,
        email_subject: "You have received a payout",
        email_message: "Your Subly payout is on the way.",
      },
      items: [
        {
          recipient_type: entry.recipientType,
          amount: {
            value: usdcToUsdString(entry.monthlyPriceUsdc),
            currency: "USD",
          },
          note: `Subly payout for ${entry.serviceName}`,
          sender_item_id: `sub-${entry.subscriptionId.toString()}`,
          receiver: entry.receiver,
        },
      ],
    };

    const response = await httpRequest(`${this.baseUrl}/v1/payments/payouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `PayPal payout failed (status ${response.status}): ${response.body}`,
      );
    }

    const payoutResult = JSON.parse(response.body ?? "{}");
    console.log(
      `  -> PayPal payout accepted. Batch ID: ${
        payoutResult?.batch_header?.payout_batch_id ?? "unknown"
      }`,
    );
  }

  private async ensureAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiry) {
      return this.accessToken;
    }

    const credentials = `${this.clientId}:${this.clientSecret}`;
    const auth = Buffer.from(credentials).toString("base64");

    const response = await httpRequest(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `PayPal token request failed (status ${response.status}): ${response.body}`,
      );
    }

    const json = JSON.parse(response.body ?? "{}");
    this.accessToken = json.access_token;
    const expiresIn = Number(json.expires_in ?? 3000);
    this.accessTokenExpiry = Date.now() + (expiresIn - 60) * 1000;
    return this.accessToken;
  }
}

type HttpRequestOptions = {
  method: string;
  headers?: Record<string, string>;
  body?: string;
};

export async function httpRequest(
  url: string,
  options: HttpRequestOptions,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>
{
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method,
        headers: options.headers,
      },
      (res) => {
        const chunks: Uint8Array[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
          });
        });
      },
    );

    req.on("error", reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

export function formatUsdc(amount: BN): string {
  const whole = amount.div(new BN(1_000_000));
  const fractional = amount.mod(new BN(1_000_000)).toString().padStart(6, "0");
  return `${whole.toString()}.${fractional}`;
}

export function usdcToUsdString(amount: BN): string {
  const micro = BigInt(amount.toString());
  const cents = (micro + 5_000n) / 10_000n; // round to nearest cent
  const dollars = cents / 100n;
  const centsPart = cents % 100n;
  return `${dollars.toString()}.${centsPart.toString().padStart(2, "0")}`;
}

export type DueEntryPayloadInput = {
  recipientType: string;
  receiver: string;
  monthlyPriceUsdc: BN;
  serviceName: string;
  subscriptionId: BN;
};

export function buildDueEntryPayload(entry: DueEntryPayloadInput): DueEntryPayload {
  return {
    recipientType: entry.recipientType,
    receiver: entry.receiver,
    monthlyPriceUsdc: entry.monthlyPriceUsdc,
    serviceName: entry.serviceName,
    subscriptionId: entry.subscriptionId,
  };
}
