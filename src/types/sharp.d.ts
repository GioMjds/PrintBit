declare module 'sharp' {
  interface SharpMetadata {
    width?: number;
    height?: number;
  }

  interface SharpBufferResult {
    data: Buffer;
    info: Required<SharpMetadata>;
  }

  interface SharpPipeline {
    ensureAlpha(): SharpPipeline;
    grayscale(): SharpPipeline;
    metadata(): Promise<SharpMetadata>;
    png(options?: Record<string, unknown>): SharpPipeline;
    raw(): SharpPipeline;
    rotate(degrees?: number): SharpPipeline;
    toBuffer(options: { resolveWithObject: true }): Promise<SharpBufferResult>;
    toFile(outputPath: string): Promise<unknown>;
  }

  const sharp: (input: string) => SharpPipeline;
  export default sharp;
}
