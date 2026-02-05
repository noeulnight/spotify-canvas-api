import * as OTPAuth from "otpauth";
import dotenv from "dotenv";
import { redisCache } from "../cache/redis.js";

dotenv.config();


interface SecretsDict {
  [version: string]: number[];
}

interface TokenPayload {
  reason: string;
  productType: string;
  totp: string;
  totpVer: string;
  totpServer: string;
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
const SPOTIFY_ORIGIN = "https://open.spotify.com";
const TOTP_CONFIG = {
  period: 30,
  digits: 6,
  algorithm: "SHA1" as const,
};

export class SpotifyClient {
  private readonly spotifyToken: string;
  private readonly secretsUrl: string;
  private currentTotp: OTPAuth.TOTP | null = null;
  private currentTotpVersion: string | null = null;
  private updateInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.spotifyToken = process.env.SPOTIFY_TOKEN || "";
    this.secretsUrl =
      process.env.SPOTIFY_SECRETS_URL ||
      "https://raw.githubusercontent.com/xyloflake/spot-secrets-go/refs/heads/main/secrets/secretDict.json";

    if (!this.spotifyToken) {
      throw new Error("SPOTIFY_TOKEN environment variable is required");
    }

    this.updateTOTPSecrets();
    this.updateInterval = setInterval(
      () => this.updateTOTPSecrets(),
      60 * 60 * 1000,
    );
  }

  private async updateTOTPSecrets(): Promise<void> {
    try {
      console.log("Fetching updated TOTP secrets...");
      const secrets = await this.fetchSecretsFromGitHub();
      const newestVersion = this.findNewestVersion(secrets);

      if (newestVersion && newestVersion !== this.currentTotpVersion) {
        const secretData = secrets[newestVersion];
        if (!secretData) {
          throw new Error(`Secret data not found for version ${newestVersion}`);
        }
        const totpSecret = this.createTotpSecret(secretData);

        this.currentTotp = new OTPAuth.TOTP({
          ...TOTP_CONFIG,
          secret: totpSecret,
        });

        this.currentTotpVersion = newestVersion;
        console.log(`TOTP secrets updated to version ${newestVersion}`);
      } else {
        console.log(
          `No new TOTP secrets found, using version ${newestVersion}`,
        );
      }
    } catch (error) {
      console.error("Failed to update TOTP secrets:", error);

      if (!this.currentTotp) {
        throw new Error("Failed to update TOTP secrets");
      }
    }
  }

  private async fetchSecretsFromGitHub(): Promise<SecretsDict> {
    const maxRetries = 3;
    const retryDelay = 1000; // 1 second base delay

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(this.secretsUrl, {
          signal: controller.signal,
          headers: { "User-Agent": USER_AGENT },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json() as SecretsDict;
        return data;
      } catch (error) {
        const isLastAttempt = attempt === maxRetries;
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        console.error(
          `Failed to fetch secrets from GitHub (attempt ${attempt}/${maxRetries}):`,
          errorMessage,
        );

        if (isLastAttempt) {
          throw error;
        }

        // Wait before retrying with exponential backoff
        const waitTime = retryDelay * Math.pow(2, attempt - 1);
        console.log(`Retrying in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    // This should never be reached, but TypeScript needs it
    throw new Error("Failed to fetch secrets after all retries");
  }

  private findNewestVersion(secrets: SecretsDict): string {
    const versions = Object.keys(secrets).map(Number);
    return Math.max(...versions).toString();
  }

  private createTotpSecret(data: number[]): OTPAuth.Secret {
    const mappedData = data.map((value, index) => value ^ ((index % 33) + 9));
    const hexData = Buffer.from(mappedData.join(""), "utf8").toString("hex");
    return OTPAuth.Secret.fromHex(hexData);
  }

  public async getToken(
    reason: string = "init",
    productType: string = "mobile-web-player",
  ): Promise<string> {
    if (!this.currentTotp) {
      await this.updateTOTPSecrets();
    }

    // Check Redis cache
    const cacheKey = "access_token";
    const cachedToken = await redisCache.get(cacheKey);
    if (cachedToken) {
      console.log("Token cache hit");
      return cachedToken;
    }

    // Cache miss - fetch new token
    console.log("Token cache miss, fetching new token");
    const payload = await this.generateAuthPayload(reason, productType);

    const url = new URL(`${SPOTIFY_ORIGIN}/api/token`);
    Object.entries(payload).forEach(([key, value]) =>
      url.searchParams.append(key, value),
    );

    const response = await fetch(url.toString(), {
      headers: this.createHeaders(),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json() as { accessToken: string; accessTokenExpirationTimestampMs: number };
    const { accessToken, accessTokenExpirationTimestampMs } = data;
    if (!accessToken || !accessTokenExpirationTimestampMs) {
      throw new Error("Failed to retrieve access token");
    }

    // Calculate TTL in seconds
    const ttl = Math.floor(
      (accessTokenExpirationTimestampMs - Date.now()) / 1000,
    );

    // Store in Redis cache with TTL
    if (ttl > 0) {
      await redisCache.set(cacheKey, accessToken, ttl);
      console.log(`Token cached with TTL: ${ttl}s`);
    }

    return accessToken;
  }

  private async generateAuthPayload(
    reason: string,
    productType: string,
  ): Promise<TokenPayload> {
    const localTime = Date.now();
    const serverTime = await this.getServerTime();

    if (!this.currentTotpVersion) {
      throw new Error("TOTP version not initialized");
    }

    return {
      reason,
      productType,
      totp: this.generateTOTP(localTime),
      totpVer: this.currentTotpVersion,
      totpServer: this.generateTOTP(Math.floor(serverTime / 30)),
    };
  }

  private async getServerTime(): Promise<number> {
    try {
      const response = await fetch(
        `${SPOTIFY_ORIGIN}/api/server-time`,
        { headers: this.createHeaders() },
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json() as { serverTime: string };
      const time = Number(data.serverTime);
      if (isNaN(time)) throw new Error("Invalid server time");
      return time * 1000;
    } catch {
      return Date.now();
    }
  }

  private generateTOTP(timestamp: number): string {
    if (!this.currentTotp) {
      throw new Error("TOTP not initialized");
    }
    return this.currentTotp.generate({ timestamp });
  }

  private createHeaders(): Record<string, string> {
    return {
      "User-Agent": USER_AGENT,
      Origin: SPOTIFY_ORIGIN,
      Referer: `${SPOTIFY_ORIGIN}/`,
      Cookie: `sp_dc=${this.spotifyToken}`,
    };
  }

  public destroy(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
}
