// The committed provider photos (WebP), so the backend can serve them to every client.

export interface ProviderPhotoFiles {
  /** The photo's bytes, or undefined when no such photo exists. */
  read(file: string): Promise<Uint8Array<ArrayBuffer> | undefined>;
}
