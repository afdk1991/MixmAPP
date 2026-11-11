import { createHash, createHmac } from 'node:crypto';
import type { Config } from '../config.js';
import { AppError } from '../lib/errors.js';

export type StorageProvider = {
  readonly name: string;
  presignUpload(key: string, contentType?: string, expiresIn?: number): Promise<{
    url: string;
    method: 'PUT';
    headers: Record<string, string>;
    expiresAt: string;
  }>;
  publicUrl(key: string): string;
};

const enc = (v: string): string =>
  encodeURIComponent(v)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/**
 * S3 兼容对象存储（AWS S3 / Cloudflare R2 / 阿里云 OSS S3 兼容 / MinIO）
 * 使用 SigV4 query 预签名，前端可直接 PUT 上传。
 */
export class S3Storage implements StorageProvider {
  readonly name = 's3';

  constructor(private readonly config: Config['storage']) {}

  publicUrl(key: string): string {
    if (this.config.publicBaseUrl) {
      return `${this.config.publicBaseUrl.replace(/\/$/, '')}/${key}`;
    }
    return `${this.config.endpoint.replace(/\/$/, '')}/${this.config.bucket}/${key}`;
  }

  async presignUpload(key: string, contentType = 'application/octet-stream', expiresIn = 900) {
    const { endpoint, region, bucket, accessKeyId, secretAccessKey } = this.config;
    if (!accessKeyId || !secretAccessKey || !bucket) {
      throw new AppError('PROVIDER_DISABLED', '对象存储未配置');
    }
    const host = new URL(endpoint).host;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const canonicalUri = `/${bucket}/${key.replace(/^\/+/, '')}`;

    const signedHeaders = 'content-type;host';
    const query = [
      'X-Amz-Algorithm=AWS4-HMAC-SHA256',
      `X-Amz-Credential=${enc(`${accessKeyId}/${scope}`)}`,
      `X-Amz-Date=${amzDate}`,
      `X-Amz-Expires=${expiresIn}`,
      'X-Amz-SignedHeaders=' + enc(signedHeaders),
    ].join('&');

    const canonicalRequest = [
      'PUT',
      canonicalUri,
      query,
      `content-type:${contentType}`,
      `host:${host}`,
      '',
      signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    const url = `${endpoint.replace(/\/$/, '')}${canonicalUri}?${query}&X-Amz-Signature=${signature}`;
    return {
      url,
      method: 'PUT' as const,
      headers: { 'content-type': contentType },
      expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString(),
    };
  }
}

/** 开发态：返回一个明确标记的本地占位上传地址。 */
export class DevStorage implements StorageProvider {
  readonly name = 'dev';

  async presignUpload(key: string, contentType = 'application/octet-stream', expiresIn = 900) {
    return {
      url: `/dev-upload/${key}`,
      method: 'PUT' as const,
      headers: { 'content-type': contentType },
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  publicUrl(key: string): string {
    return `/dev-upload/${key}`;
  }
}

export function createStorageProvider(config: Config): StorageProvider {
  return config.storage.provider === 's3' ? new S3Storage(config.storage) : new DevStorage();
}
