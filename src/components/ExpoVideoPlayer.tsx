/**
 * ExpoVideoPlayer.tsx
 *
 * Re-exports the unified InfinityVideoPlayer powered by
 * https://github.com/asheeshsahu7300/infinity-media-player
 *
 * This replaces expo-video with the resilient Android Media3 engine featuring
 * Qualcomm ACDB audio safety mitigation, NVC-Live neural frame concealment,
 * PTS subtitle sync, and low-latency live streaming.
 */

export * from "./InfinityVideoPlayer";
export { InfinityVideoPlayer as default } from "./InfinityVideoPlayer";
