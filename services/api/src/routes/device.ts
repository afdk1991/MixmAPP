import type { FastifyInstance } from 'fastify';
import { deviceContextSchema } from '@mixmapp/contracts';
import { parse } from '../lib/validate.js';
import { clientIpOf, maskDeviceId, maskIp } from '../lib/device-context.js';

/**
 * 设备与网络快照接口（契约 docs/39 §3.2）。
 * 两个方法都要求登录；IP 与采集时间只由服务端产生，客户端上报的同名字段会被 schema 剥离。
 */
export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.post('/device/context', { preHandler: app.requireAuth }, async (request) => {
    const body = parse(deviceContextSchema, request.body);
    const ip = clientIpOf(request);
    const record = await app.deviceContext.record(request.userId as string, body, ip);
    // 日志只打脱敏后的设备号与 IP，原始值不落日志。
    request.log.info(
      { deviceId: maskDeviceId(record.deviceId), ip: maskIp(ip) },
      '设备快照已上报',
    );
    return { data: app.deviceContext.toDto(record) };
  });

  app.get('/device/context', { preHandler: app.requireAuth }, async (request) => {
    const query = (request.query ?? {}) as { deviceId?: string };
    const record = await app.deviceContext.latest(request.userId as string, query.deviceId);
    // 无记录返回 data.device = null，不报 404，避免前端分支出错。
    return { data: { device: record ? app.deviceContext.toDto(record) : null } };
  });
}
