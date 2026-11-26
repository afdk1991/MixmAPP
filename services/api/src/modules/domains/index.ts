import type { SuiteDomainId } from '@mixmapp/contracts';
import type { SuiteDomainModule } from '../suite/domain.js';
import { officeModule } from './office.js';
import { productivityModule } from './productivity.js';
import { productModule } from './product.js';
import { engineeringModule } from './engineering.js';
import { financeModule } from './finance.js';
import { taxpayModule } from './taxpay.js';
import { growthModule } from './growth.js';
import { ecommerceModule } from './ecommerce.js';
import { contentModule } from './content.js';
import { eduModule } from './edu.js';
import { healthModule } from './health.js';
import { legalModule } from './legal.js';
import { lifestyleModule } from './lifestyle.js';

/**
 * 领域模块表：id → 实现。
 *
 * 新增领域只需要三步：这里登记一项 + services/api/src/modules/domains/ 下加一个
 * 实现 SuiteDomainModule 的文件 + registry.ts 补一条元信息。
 * 服务端派发动作时按 id 查表，查不到一律 404（不静默返回空）。
 */
export const SUITE_MODULES: ReadonlyMap<SuiteDomainId, SuiteDomainModule> = new Map<
  SuiteDomainId,
  SuiteDomainModule
>([
  ['office', officeModule],
  ['productivity', productivityModule],
  ['product', productModule],
  ['engineering', engineeringModule],
  ['finance', financeModule],
  ['taxpay', taxpayModule],
  ['growth', growthModule],
  ['ecommerce', ecommerceModule],
  ['content', contentModule],
  ['edu', eduModule],
  ['health', healthModule],
  ['legal', legalModule],
  ['lifestyle', lifestyleModule],
]);

export {
  officeModule,
  productivityModule,
  productModule,
  engineeringModule,
  financeModule,
  taxpayModule,
  growthModule,
  ecommerceModule,
  contentModule,
  eduModule,
  healthModule,
  legalModule,
  lifestyleModule,
};
