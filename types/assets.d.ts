// Image assets are resolved by Metro, which hands back a module id rather than
// the file contents. TypeScript knows nothing about that on its own, so without
// these declarations `import bg from './bg.jpeg'` is a "cannot find module"
// error and every asset has to be pulled in with an untyped `require()`.
//
// `number` is the honest type: it is the id Metro assigns, which is what
// react-native's `Image` and expo-image accept as a source.

declare module '*.png' {
  const asset: number;
  export default asset;
}

declare module '*.jpg' {
  const asset: number;
  export default asset;
}

declare module '*.jpeg' {
  const asset: number;
  export default asset;
}

declare module '*.webp' {
  const asset: number;
  export default asset;
}

declare module '*.gif' {
  const asset: number;
  export default asset;
}
