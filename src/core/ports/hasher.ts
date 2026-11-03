/** A cryptographic digest, so core can fingerprint a proposal without importing Node. */
export interface Hasher {
  /** SHA-256 of the UTF-8 text, as 64 lowercase hex characters. */
  sha256Hex(text: string): string;
}
