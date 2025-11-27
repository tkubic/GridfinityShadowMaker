declare module 'opentype.js' {
  export interface Font {
    unitsPerEm?: number;
    ascender?: number;
    descender?: number;
    // other properties are intentionally left loose
    [key: string]: any;
  }

  export function load(url: string, callback: (err: Error | null, font?: Font) => void): void;
  export function parse(buffer: ArrayBuffer | Uint8Array): Font;

  const _default: {
    load: typeof load;
    parse: typeof parse;
  };

  export default _default;
}
