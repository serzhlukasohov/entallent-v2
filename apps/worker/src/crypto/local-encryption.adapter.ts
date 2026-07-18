import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { encryptField, decryptField } from '@entalent/crypto-utils';
import type { EncryptionPort } from '@entalent/application';
import type { Env } from '@entalent/config';

/**
 * AES-256-GCM encryption using a local key from FIELD_ENCRYPTION_KEY env var.
 * Replace with a KMS adapter for enterprise deployments — the EncryptionPort
 * interface stays the same, only the binding changes.
 */
@Injectable()
export class LocalEncryptionAdapter implements EncryptionPort {
  private readonly key: string;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    this.key = config.get('FIELD_ENCRYPTION_KEY', { infer: true });
  }

  async encrypt(plaintext: string): Promise<string> {
    return encryptField(plaintext, this.key);
  }

  async decrypt(ciphertext: string): Promise<string> {
    return decryptField(ciphertext, this.key);
  }
}
