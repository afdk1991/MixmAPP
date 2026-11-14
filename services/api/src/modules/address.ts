import type {
  AddressCheckInput,
  AddressCheckResult,
  AddressCreateInput,
  AddressDto,
  AddressUpdateInput,
  DeliveryMethodDto,
} from '@mixmapp/contracts';
import { IdFactory } from '@mixmapp/ids';
import type { AddressRecord, Store } from '../db/types.js';
import type { Config } from '../config.js';
import { AppError } from '../lib/errors.js';

/** 单用户地址上限：与源站地址管理一致，避免地址列表无限堆积。 */
export const MAX_ADDRESSES = 20;

/**
 * 源站常规快递覆盖省份（华东 / 华南 / 华北 / 华中 / 西南 / 东北 / 西北主干线）。
 * 源站口径：这些省份的地址可以直接下单走快递配送。
 */
const EXPRESS_PROVINCES = new Set([
  '上海',
  '江苏',
  '浙江',
  '安徽',
  '福建',
  '江西',
  '山东',
  '北京',
  '天津',
  '河北',
  '山西',
  '河南',
  '湖北',
  '湖南',
  '广东',
  '广西',
  '重庆',
  '四川',
  '贵州',
  '云南',
  '陕西',
  '辽宁',
  '吉林',
  '黑龙江',
]);

/** 源站偏远地区：常规快递不覆盖，需线下走物流询价，结算页不可直接下单。 */
const REMOTE_PROVINCES = new Set(['新疆', '西藏', '青海', '甘肃', '宁夏', '海南', '内蒙古']);

/** 港澳台与海外：源站不支持配送。 */
const OVERSEAS_PROVINCES = new Set(['香港', '澳门', '台湾']);

/**
 * 配送方式与可选时间段（源站口径）。
 * 快递配送按「上午 / 下午 / 全天」三段给时段；门店自提按门店营业时间两段，且仅上海门店。
 */
export const DELIVERY_METHODS: readonly DeliveryMethodDto[] = [
  {
    code: 'express',
    name: '快递配送',
    slots: [
      { code: 'am', label: '上午 09:00-12:00' },
      { code: 'pm', label: '下午 13:00-18:00' },
      { code: 'allday', label: '全天 09:00-18:00' },
    ],
  },
  {
    code: 'pickup',
    name: '门店自提',
    slots: [
      { code: 'am', label: '上午 09:00-12:00' },
      { code: 'pm', label: '下午 13:00-17:00' },
    ],
  },
];

/** 门店自提仅限上海门店（源站自提点在上海）。 */
const PICKUP_PROVINCE = '上海';

/** 省份归一：去掉「省 / 市 / 自治区 / 特别行政区」等后缀，便于与配置表比对。 */
function normalizeProvince(input: string): string {
  return input
    .replace(/特别行政区$/, '')
    .replace(/(壮族|回族|维吾尔)?自治区$/, '')
    .replace(/[省市]$/, '')
    .trim();
}

/**
 * 可达性校验（源站口径）：
 * 1. 省 / 市 / 区三级必填（源站收货地址为三级联动，缺一级无法下单）；
 * 2. 港澳台与海外不配送；
 * 3. 偏远地区常规快递不覆盖，需物流询价；
 * 4. 门店自提仅支持上海门店。
 * 返回的 reason 直接展示在结算页，让用户知道为什么不能提交。
 */
export function checkReachability(input: AddressCheckInput & { deliveryMethod?: string }): AddressCheckResult {
  const province = normalizeProvince(input.province ?? '');
  const city = (input.city ?? '').trim();
  const district = (input.district ?? '').trim();
  if (!province || !city || district.length < 2) {
    return { reachable: false, region: '地址不完整', reason: '请选择完整的省 / 市 / 区，再填写详细地址' };
  }
  if (OVERSEAS_PROVINCES.has(province)) {
    return {
      reachable: false,
      region: '港澳台/海外',
      reason: '源站不支持港澳台及海外配送，请联系客服改走线下',
    };
  }
  if (REMOTE_PROVINCES.has(province)) {
    return {
      reachable: false,
      region: '偏远地区',
      reason: '该地区常规快递不覆盖（源站需走物流询价），请先联系询价后再下单',
    };
  }
  if (!EXPRESS_PROVINCES.has(province)) {
    return {
      reachable: false,
      region: '配送范围外',
      reason: '该收货地址不在源站配送范围内，请核对省份或联系询价',
    };
  }
  if (input.deliveryMethod === 'pickup' && province !== PICKUP_PROVINCE) {
    return {
      reachable: false,
      region: '自提点范围外',
      reason: '门店自提仅支持上海门店，请改选快递配送或更换地址',
    };
  }
  return { reachable: true, region: input.deliveryMethod === 'pickup' ? '上海自提点' : '常规配送区' };
}

/** 地址下发口径：fullAddress 为省市区 + 详细地址的快照，前端直接展示。 */
function toAddressDto(record: AddressRecord): AddressDto {
  return {
    id: record.id,
    receiverName: record.receiverName,
    receiverPhone: record.receiverPhone,
    province: record.province,
    city: record.city,
    district: record.district,
    detail: record.detail,
    fullAddress: `${record.province}${record.city}${record.district}${record.detail}`,
    isDefault: record.isDefault,
    createdAt: record.createdAt.toISOString(),
  };
}

/**
 * 地址簿服务（0014）：增删改查、设默认、可达性校验。
 * 下单时由 MallService 复用 checkReachability 做兜底拦截。
 */
export class AddressService {
  private readonly ids: IdFactory;

  constructor(
    config: Config,
    private readonly store: Store,
  ) {
    this.ids = new IdFactory({ workerId: config.ids.workerId });
  }

  async list(userId: string): Promise<AddressDto[]> {
    const rows = await this.store.mall.addresses.listByUser(userId);
    return rows.map(toAddressDto);
  }

  async create(userId: string, input: AddressCreateInput): Promise<AddressDto> {
    // 源站口径：地址簿允许保存任意完整地址；是否可达在下单前由 checkReachability 拦截，
    // 偏远/海外地址仍可保存，便于用户先留存再走线下询价。
    const existing = await this.store.mall.addresses.listByUser(userId);
    if (existing.length >= MAX_ADDRESSES) {
      throw new AppError('BAD_REQUEST', `最多保存 ${MAX_ADDRESSES} 个收货地址，请先删除不用的地址`);
    }
    const now = new Date();
    const record: AddressRecord = {
      id: this.ids.next().id,
      userId,
      receiverName: input.receiverName,
      receiverPhone: input.receiverPhone,
      province: input.province,
      city: input.city,
      district: input.district,
      detail: input.detail,
      // 第一条地址自动设为默认，避免新用户下单时没有可用地址
      isDefault: input.isDefault ?? existing.length === 0,
      createdAt: now,
      updatedAt: now,
    };
    const saved = await this.store.mall.addresses.insert(record);
    return toAddressDto(saved);
  }

  async update(userId: string, id: string, input: AddressUpdateInput): Promise<AddressDto> {
    const current = await this.store.mall.addresses.findById(userId, id);
    if (!current) throw AppError.notFound('地址不存在');
    // 可达性不在这里拦：地址簿允许保存完整但暂不可达的地址，下单前统一校验。
    const updated = await this.store.mall.addresses.update(userId, id, {
      ...input,
      updatedAt: new Date(),
    });
    if (!updated) throw AppError.notFound('地址不存在');
    return toAddressDto(updated);
  }

  async remove(userId: string, id: string): Promise<void> {
    const current = await this.store.mall.addresses.findById(userId, id);
    if (!current) throw AppError.notFound('地址不存在');
    await this.store.mall.addresses.remove(userId, id);
    // 删掉默认地址后，把最近创建的一条补为默认，保证下单页始终有默认可选
    if (current.isDefault) {
      const rest = await this.store.mall.addresses.listByUser(userId);
      const next = rest[0];
      if (next) await this.store.mall.addresses.setDefault(userId, next.id);
    }
  }

  async setDefault(userId: string, id: string): Promise<AddressDto> {
    const updated = await this.store.mall.addresses.setDefault(userId, id);
    if (!updated) throw AppError.notFound('地址不存在');
    return toAddressDto(updated);
  }

  /** 下单前可达性预校验：不可达直接返回原因，前端展示后阻止提交。 */
  check(input: AddressCheckInput & { deliveryMethod?: string }): AddressCheckResult {
    return checkReachability(input);
  }

  /** 配送方式与可选时间段。 */
  deliveryOptions(): DeliveryMethodDto[] {
    return DELIVERY_METHODS.map((method) => ({ ...method, slots: method.slots.map((s) => ({ ...s })) }));
  }
}

/** 校验配送方式 + 时间段组合是否属于源站可选集合；下单时兜底调用。 */
export function assertDeliverySelection(method: string, slot: string): void {
  const found = DELIVERY_METHODS.find((item) => item.code === method);
  if (!found) throw new AppError('BAD_REQUEST', '配送方式不正确，请重新选择');
  if (!found.slots.some((item) => item.code === slot)) {
    throw new AppError('BAD_REQUEST', '配送时间不在该配送方式的可选范围内，请重新选择');
  }
}
