// src/services/StreamManager.ts
// JIT stream URL generation with silent retry - NEVER caches stream URLs

import { Portal, Channel, VODItem, Episode } from "../store/portalStore";
import { usePortalStore } from "../store/portalStore";
import { NetworkResilience } from "./NetworkResilience";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { safeStorage } from "./safeStorage";

export type StreamableContent = Channel | VODItem | Episode;

export interface StreamResult {
    url: string;
    success: boolean;
    error?: string;
}

export interface PlaybackPosition {
    contentId: string;
    position: number; // in milliseconds
    duration: number;
    timestamp: number;
}

class StreamManagerClass {
    private maxRetries = 3;
    private preloadedMetadata: Map<string, any> = new Map();

    /**
     * Get a fresh stream URL for content.
     * NEVER uses cached URLs - always generates fresh due to one-time play tokens.
     */
    async getStreamUrl(
        content: StreamableContent,
        portal: Portal,
        type: "itv" | "vod" = "itv",
        episodeNum?: number
    ): Promise<StreamResult> {
        try {
            // Import portalApi dynamically to avoid circular deps
            const { portalApi } = await import("./portalApi");

            // Get fresh stream URL (portalApi handles token refresh internally)
            const cmd = content.streamUrl || (content as Episode).cmd || "";

            if (!cmd) {
                return { url: "", success: false, error: "No stream command available" };
            }

            const latestPortal = usePortalStore.getState().activePortal ?? portal;
            const url = await portalApi.getStreamUrl(latestPortal, cmd, type, episodeNum);

            if (!url) {
                return { url: "", success: false, error: "Failed to generate stream URL" };
            }

            return { url, success: true };
        } catch (error: any) {
            console.error("❌ StreamManager.getStreamUrl failed:", error);
            return { url: "", success: false, error: error.message || "Stream URL generation failed" };
        }
    }

    /**
     * Retry stream playback - generates a COMPLETELY NEW URL.
     * Play tokens are one-time use, so we must regenerate on every retry.
     */
    async retryStream(
        content: StreamableContent,
        portal: Portal,
        type: "itv" | "vod" = "itv",
        retryCount: number = 0,
        episodeNum?: number
    ): Promise<StreamResult> {
        if (retryCount >= this.maxRetries) {
            return { url: "", success: false, error: `Failed after ${this.maxRetries} retries` };
        }

        try {
            // 1. Ensure we have network
            if (!NetworkResilience.connected) {
                await new Promise((resolve) => setTimeout(resolve, 2000));

                if (!NetworkResilience.connected) {
                    return this.retryStream(content, portal, type, retryCount + 1, episodeNum);
                }
            }

            // 2. Force token refresh before retry
            const { portalApi } = await import("./portalApi");

            // Get fresh portal with refreshed token
            let freshPortal = portal;
            if (portal.type === "mag") {
                try {
                    const auth = await portalApi.authenticate(portal);
                    freshPortal = {
                        ...portal,
                        config: {
                            ...portal.config,
                            token: auth.token,
                            expiry: auth.expiry,
                        },
                    };

                    // Update store with fresh token — config only. Going through
                    // setActivePortal here cleared every loaded list, so a single
                    // stream retry emptied the app behind the player.
                    usePortalStore.getState().persistPortalConfig(freshPortal);
                } catch (authError) {
                    console.warn("Token refresh failed during retry:", authError);
                }
            }

            // 3. Generate completely NEW stream URL
            const result = await this.getStreamUrl(content, freshPortal, type, episodeNum);

            if (result.success) {
                return result;
            }

            // 4. Recursive retry with incremented count
            await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
            return this.retryStream(content, freshPortal, type, retryCount + 1, episodeNum);
        } catch (error: any) {
            // Recursive retry
            await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
            return this.retryStream(content, portal, type, retryCount + 1, episodeNum);
        }
    }

    /**
     * Pre-warm channel metadata (NOT the stream URL).
     * This loads channel info into memory for faster switching.
     */
    preloadChannelMetadata(channel: Channel): void {
        // Store metadata for quick access
        this.preloadedMetadata.set(channel.id, {
            id: channel.id,
            name: channel.name,
            logo: channel.logo,
            category: channel.category,
            preloadedAt: Date.now(),
        });

        // Clean old entries (keep last 10)
        if (this.preloadedMetadata.size > 10) {
            const oldest = Array.from(this.preloadedMetadata.entries())
                .sort((a, b) => a[1].preloadedAt - b[1].preloadedAt)[0];
            this.preloadedMetadata.delete(oldest[0]);
        }
    }

    /**
     * Get preloaded metadata for a channel
     */
    getPreloadedMetadata(channelId: string): any | null {
        return this.preloadedMetadata.get(channelId) || null;
    }

    // =============================================
    // Resume Position Management
    // =============================================

    /**
     * Save playback position for resume functionality
     */
    async savePlaybackPosition(
        contentId: string,
        position: number,
        duration: number
    ): Promise<void> {
        // Don't save if near start or end
        if (position < 30000 || (duration > 0 && duration - position < 60000)) {
            return;
        }

        const key = `playback:${contentId}`;
        const data: PlaybackPosition = {
            contentId,
            position,
            duration,
            timestamp: Date.now(),
        };

        await safeStorage.setItem(key, JSON.stringify(data)).catch(console.warn);
    }

    /**
     * Get saved playback position for resume
     */
    async getPlaybackPosition(contentId: string): Promise<PlaybackPosition | null> {
        try {
            const key = `playback:${contentId}`;
            const data = await AsyncStorage.getItem(key);

            if (!data) return null;

            const position: PlaybackPosition = JSON.parse(data);

            // Expire after 30 days
            const EXPIRY = 30 * 24 * 60 * 60 * 1000;
            if (Date.now() - position.timestamp > EXPIRY) {
                await AsyncStorage.removeItem(key);
                return null;
            }

            return position;
        } catch {
            return null;
        }
    }

    /**
     * Clear saved position (e.g., after completing playback)
     */
    async clearPlaybackPosition(contentId: string): Promise<void> {
        await AsyncStorage.removeItem(`playback:${contentId}`).catch(console.warn);
    }

    // =============================================
    // Utility Methods
    // =============================================

    /**
     * Validate if a URL looks like a valid stream
     */
    isValidStreamUrl(url: string): boolean {
        if (!url) return false;

        return (
            url.startsWith("http://") ||
            url.startsWith("https://") ||
            url.startsWith("rtmp://") ||
            url.startsWith("rtsp://")
        );
    }

    /**
     * Clear all preloaded data
     */
    clearPreloadedData(): void {
        this.preloadedMetadata.clear();
    }
}

export const StreamManager = new StreamManagerClass();
