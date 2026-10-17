// src/types/mpegts.d.ts
declare module "mpegts.js" {
  export interface FeatureList {
    msePlayback: boolean;
    mseLivePlayback: boolean;
    networkStream: boolean;
    networkLoaderName: string;
  }

  export interface MediaSegment {
    duration: number;
    filesize?: number;
    url: string;
  }

  export interface MediaDataSource {
    type: string;
    isLive?: boolean;
    cors?: boolean;
    withCredentials?: boolean;
    hasAudio?: boolean;
    hasVideo?: boolean;
    duration?: number;
    filesize?: number;
    url?: string;
    segments?: MediaSegment[];
  }

  export interface Config {
    enableWorker?: boolean;
    enableStashBuffer?: boolean;
    stashInitialSize?: number;
    isLive?: boolean;
    lazyLoad?: boolean;
    lazyLoadMaxDuration?: number;
    lazyLoadRecoverDuration?: number;
    deferLoadAfterSourceOpen?: boolean;
    autoCleanupSourceBuffer?: boolean;
    autoCleanupMaxBackwardDuration?: number;
    autoCleanupMinBackwardDuration?: number;
    statisticsInfoReportInterval?: number;
    fixAudioTimestampGap?: boolean;
    accurateSeek?: boolean;
    seekType?: string;
    seekParamStart?: string;
    seekParamEnd?: string;
    rangeLoadZeroStart?: boolean;
    customLoader?: any;
    reuseRedirectedURL?: boolean;
    referrerPolicy?: string;
    headers?: Record<string, string>;
    liveBufferLatencyChasing?: boolean;
    liveBufferLatencyMaxLatency?: number;
    liveBufferLatencyMinRemain?: number;
  }

  export class Player {
    constructor();
    destroy(): void;
    on(event: string, listener: (...args: any[]) => void): void;
    off(event: string, listener: (...args: any[]) => void): void;
    attachMediaElement(mediaElement: HTMLMediaElement): void;
    detachMediaElement(): void;
    load(): void;
    unload(): void;
    play(): Promise<void> | void;
    pause(): void;
    type: string;
    buffered: TimeRanges;
    duration: number;
    volume: number;
    muted: boolean;
    currentTime: number;
    mediaInfo: any;
    statisticsInfo: any;
  }

  export namespace Events {
    export const ERROR: string;
    export const LOADING_COMPLETE: string;
    export const RECOVERED_EARLY_EOF: string;
    export const MEDIA_INFO: string;
    export const METADATA_ARRIVED: string;
    export const SCRIPTDATA_ARRIVED: string;
    export const STATISTICS_INFO: string;
  }

  export namespace ErrorTypes {
    export const NETWORK_ERROR: string;
    export const MEDIA_ERROR: string;
    export const OTHER_ERROR: string;
  }

  export namespace ErrorDetails {
    export const NETWORK_EXCEPTION: string;
    export const NETWORK_STATUS_CODE_INVALID: string;
    export const NETWORK_TIMEOUT: string;
    export const NETWORK_UNRECOVERABLE_EARLY_EOF: string;
    export const MEDIA_MSE_ERROR: string;
    export const MEDIA_FORMAT_ERROR: string;
    export const MEDIA_FORMAT_UNSUPPORTED: string;
    export const MEDIA_CODEC_UNSUPPORTED: string;
  }

  export function isSupported(): boolean;
  export function getFeatureList(): FeatureList;
  export function createPlayer(mediaDataSource: MediaDataSource, config?: Config): Player;

  const mpegts: {
    isSupported: typeof isSupported;
    getFeatureList: typeof getFeatureList;
    createPlayer: typeof createPlayer;
    Events: typeof Events;
    ErrorTypes: typeof ErrorTypes;
    ErrorDetails: typeof ErrorDetails;
  };

  export default mpegts;
}
