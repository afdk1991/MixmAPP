import {
  createHash,
  randomBytes,
  randomInt,
  scrypt as scryptCb,
  timingSafeEqual,
  sign as cryptoSign,
  verify as cryptoVerify,
  createPublicKey,
  createPrivateKey,
  generateKeyPairSync,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

/** 口令散列：scrypt（Node 内置，无需原生编译），格式自带参数便于后续升级。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltHex, keyHex] = parts as [string, string, string, string, string, string];
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(expected, actual);
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

export function randomDigits(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String(randomInt(0, 10));
  return out;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** RSA-SHA256 签名（微信支付 v3 / 支付宝 RSA2 共用）。 */
export function rsaSign(content: string, privateKeyPem: string): string {
  return cryptoSign('sha256', Buffer.from(content), createPrivateKey(privateKeyPem)).toString(
    'base64',
  );
}

export function rsaVerify(content: string, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    return cryptoVerify(
      'sha256',
      Buffer.from(content),
      createPublicKey(publicKeyPem),
      Buffer.from(signatureBase64, 'base64'),
    );
  } catch {
    return false;
  }
}

/** 生成测试用 RSA 密钥对（仅测试与本地联调使用）。 */
export function generateRsaKeyPair(): { publicKey: string; privateKey: string } {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey: pair.publicKey as string, privateKey: pair.privateKey as string };
}
