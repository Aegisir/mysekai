declare module 'gifenc' {
  export type GifPalette = readonly (readonly number[])[];

  export interface GifEncoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options: {
        readonly palette?: GifPalette;
        readonly delay?: number;
        readonly repeat?: number;
        readonly transparent?: boolean;
        readonly transparentIndex?: number;
      },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  }

  export function GIFEncoder(options?: { readonly initialCapacity?: number; readonly auto?: boolean }): GifEncoder;
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { readonly format?: 'rgb565' | 'rgb444' | 'rgba4444'; readonly oneBitAlpha?: boolean | number },
  ): GifPalette;
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: 'rgb565' | 'rgb444' | 'rgba4444',
  ): Uint8Array;
}
