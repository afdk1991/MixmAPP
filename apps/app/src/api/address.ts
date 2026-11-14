import type {
  AddressCheckInput,
  AddressCheckResult,
  AddressCreateInput,
  AddressDto,
  AddressUpdateInput,
  DeliveryMethodDto,
} from '@mixmapp/contracts';
import { apiRequest } from './client';

/**
 * 结算必填项接口（0014 / 0015）：
 * - 地址簿增删改查、设默认；
 * - 下单前可达性校验（源站口径，不可达返回原因，前端据此拦住提交）；
 * - 配送方式与按方式给出的可选时间段。
 */
export const addressApi = {
  /** 配送方式与时间段：公开只读，结算页打开时拉取 */
  deliveryOptions: () => apiRequest<DeliveryMethodDto[]>('/mall/delivery-options', { auth: false }),
  list: () => apiRequest<AddressDto[]>('/mall/addresses'),
  create: (input: AddressCreateInput) =>
    apiRequest<AddressDto>('/mall/addresses', { method: 'POST', data: input }),
  update: (id: string, input: AddressUpdateInput) =>
    apiRequest<AddressDto>(`/mall/addresses/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      data: input,
    }),
  remove: (id: string) =>
    apiRequest<{ ok: boolean }>(`/mall/addresses/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  setDefault: (id: string) =>
    apiRequest<AddressDto>(`/mall/addresses/${encodeURIComponent(id)}/default`, { method: 'POST' }),
  /** 可达性校验：不可达时返回 reason，结算页直接展示并禁用提交 */
  check: (input: AddressCheckInput) =>
    apiRequest<AddressCheckResult>('/mall/addresses/check', { method: 'POST', data: input }),
};
