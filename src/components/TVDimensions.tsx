// utils/tvScale.ts
import { Dimensions, PixelRatio } from "react-native";

const { width, height } = Dimensions.get("window");

// Baseline: 1080p TV
const BASE_WIDTH = 1920;
const BASE_HEIGHT = 1080;

// Raw scale
const scaleW = width / BASE_WIDTH;
const scaleH = height / BASE_HEIGHT;

// Clamp scale for 4K
const clamp = (value: number, min = 1.1, max = 1.5) =>
  Math.min(Math.max(value, min), max);

const SCALE = clamp(Math.min(scaleW, scaleH));

export const scale = (size: number) => Math.round(size * SCALE);

export const vScale = (size: number) => Math.round(size * SCALE);

export const mScale = (size: number, factor = 0.6) =>
  Math.round(size + (scale(size) - size) * factor);