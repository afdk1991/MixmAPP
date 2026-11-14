-- 源站特价折扣 tejiaD2N2（采集补齐）。
-- 源站口径：tejiaD2N2 为特价折扣百分比，0 表示非特价；
-- 仅作采集落库与 DTO 透传，不参与 sale_price_li / price_fen 等价格派生，避免改变既有价格口径。
alter table products add column if not exists tejia_discount_pct numeric(6, 2);

comment on column products.tejia_discount_pct is '源站特价折扣 tejiaD2N2（百分比，0/缺失为 null 表示非特价）；仅采集透传，不参与价格派生';
