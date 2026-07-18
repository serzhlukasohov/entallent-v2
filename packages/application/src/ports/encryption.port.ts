/**
 * Abstraction over field-level encryption.
 * Current impl: AES-256-GCM with a local key (packages/crypto-utils).
 * Future impl: AWS KMS or GCP Cloud KMS — swap without touching domain code.
 */
export interface EncryptionPort {
  encrypt(plaintext: string, context?: { tenantId?: string }): Promise<string>;
  decrypt(ciphertext: string, context?: { tenantId?: string }): Promise<string>;
}
