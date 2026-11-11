import { SignJWT, jwtVerify } from 'jose';
import type { Config } from '../config.js';
import { AppError } from './errors.js';

const ISSUER = 'mixmapp-api';

export type AccessClaims = {
  sub: string;
  acc: string;
  typ: 'access';
};

function keyOf(config: Config): Uint8Array {
  return new TextEncoder().encode(config.jwt.secret);
}

export async function signAccessToken(
  config: Config,
  input: { userId: string; accountNo: string },
): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = config.jwt.accessTtlSec;
  const token = await new SignJWT({ acc: input.accountNo, typ: 'access' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setSubject(input.userId)
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(keyOf(config));
  return { token, expiresIn };
}

export async function verifyAccessToken(config: Config, token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, keyOf(config), { issuer: ISSUER });
    if (payload['typ'] !== 'access' || typeof payload.sub !== 'string') {
      throw AppError.unauthorized('令牌类型不正确');
    }
    return { sub: payload.sub, acc: String(payload['acc'] ?? ''), typ: 'access' };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw AppError.unauthorized('登录已失效，请重新登录');
  }
}
