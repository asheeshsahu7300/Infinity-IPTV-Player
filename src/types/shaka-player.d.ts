// src/types/shaka-player.d.ts
declare module "shaka-player" {
  export const polyfill: {
    installAll: () => void;
  };

  export class Player {
    constructor(mediaElement?: HTMLMediaElement | null);
    static isBrowserSupported(): boolean;
    load(assetUri: string, startTime?: number, mimeType?: string): Promise<void>;
    destroy(): Promise<void>;
    configure(config: any): boolean;
    getConfiguration(): any;
    getVariantTracks(): any[];
    selectVariantTrack(track: any, clearBuffer?: boolean): void;
    getTextTracks(): any[];
    selectTextTrack(track: any): void;
    setTextTrackVisibility(isVisible: boolean): Promise<void>;
    isTextTrackVisible(): boolean;
    getAudioLanguages(): string[];
    selectAudioLanguage(language: string, role?: string): void;
    getTextLanguages(): string[];
    selectTextLanguage(language: string, role?: string): void;
    addTextTrackAsync(uri: string, language: string, kind: string, mimeType?: string): Promise<any>;
    retry(): boolean;
    getMediaElement(): HTMLMediaElement | null;
    addEventListener(type: string, listener: (event: any) => void): void;
    removeEventListener(type: string, listener: (event: any) => void): void;
  }

  const shaka: {
    Player: typeof Player;
    polyfill: typeof polyfill;
  };

  export default shaka;
}
