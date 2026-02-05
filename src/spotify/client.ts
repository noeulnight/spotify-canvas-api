import axios from "axios";
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
const FALLBACK_VERSION = "19";
const FALLBACK_SECRET_DATA = [
  99, 111, 47, 88, 49, 56, 118, 65, 52, 67, 50, 104, 117, 101, 55, 94, 95, 75,
  94, 49, 69, 36, 85, 64, 74, 60,
];

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
        this.useFallbackSecret();
      }
    }
  }

  private async fetchSecretsFromGitHub(): Promise<SecretsDict> {
    try {
      const response = await axios.get<SecretsDict>(this.secretsUrl, {
        timeout: 10000,
        headers: { "User-Agent": USER_AGENT },
      });
      return response.data;
    } catch (error) {
      console.error(
        "Failed to fetch secrets from GitHub:",
        error instanceof Error ? error.message : error,
      );
      throw error;
    }
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

  private useFallbackSecret(): void {
    const totpSecret = this.createTotpSecret(FALLBACK_SECRET_DATA);

    this.currentTotp = new OTPAuth.TOTP({
      ...TOTP_CONFIG,
      secret: totpSecret,
    });

    this.currentTotpVersion = FALLBACK_VERSION;
    console.log("Using fallback TOTP secret");
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

    const response = await axios.get(url.toString(), {
      headers: this.createHeaders(),
    });

    const { accessToken, accessTokenExpirationTimestampMs } = response.data;
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

    return {
      reason,
      productType,
      totp: this.generateTOTP(localTime),
      totpVer: this.currentTotpVersion || FALLBACK_VERSION,
      totpServer: this.generateTOTP(Math.floor(serverTime / 30)),
    };
  }

  private async getServerTime(): Promise<number> {
    try {
      const { data } = await axios.get<{ serverTime: string }>(
        `${SPOTIFY_ORIGIN}/api/server-time`,
        { headers: this.createHeaders() },
      );

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
