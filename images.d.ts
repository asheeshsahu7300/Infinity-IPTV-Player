// Type declarations for static image imports.
//
// Metro bundles `import x from "...png/jpg"` as an asset, but this Expo
// version's `expo/types` only declares CSS modules — so image imports have no
// type and TypeScript reports "Cannot find module '....jpg'". These ambient
// declarations cover the common image extensions used by the app.
declare module '*.png';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.gif';
declare module '*.webp';
declare module '*.bmp';
