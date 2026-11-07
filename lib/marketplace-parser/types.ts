export type Platform = 'shopee' | 'tiktokshop' | 'lazada';
export type ProductRule = {
  id: string; account: string; sourceSku: string; name: string; variation: string;
  prefix: string; targetSku: string; family: string;
};
export type RouteRule = {
  id: string; account: string; family: string; business: string; store: string; warehouse: string;
};
export type CourierRule = { platform: Platform; source: string; courier: string; service: string };
export type ParserConfig = {
  schemaVersion: 2;
  accounts: { id: string; label: string }[];
  routes: RouteRule[];
  products: ProductRule[];
  couriers: CourierRule[];
};
export type Catalog = {
  businesses: { code: string; name: string }[];
  stores: { business: string; name: string }[];
  bundles: { business: string; sku: string; name: string }[];
  warehouses: string[];
};
export type SourceLine = {
  key: string; sheet: string; row: number; sku: string; name: string; variation: string;
  quantity: number | null; unitCents: number | null; totalCents: number | null;
  raw: Record<string, string>; errors: string[];
};
export type SourceOrder = {
  key: string; externalId: string; marketplaceOrderId: string; idKind: 'order' | 'booking' | 'order_item';
  platform: Platform; username: string; tracking: string; provider: string;
  lines: SourceLine[]; errors: string[]; warnings: string[];
};
export type ParsedFile = { filename: string; orders: SourceOrder[]; sheets: string[]; ignoredSheets: string[] };
export type LineEdit = { sku?: string; quantity?: string; price?: string; family?: string; reason?: string };
export type OrderEdit = { business?: string; store?: string; warehouse?: string; courier?: string; service?: string; username?: string; reason?: string };
export type Edits = { lines: Record<string, LineEdit>; orders: Record<string, OrderEdit> };
export const CSV_HEADERS = ['external_id','platform','id','timestamp','store','name','username','phone','email','address','subdistrict','city','payment_method','bank','account_holder','account_number','item_type','sku','price','quantity','shipping_cost','other_income','weight_bump','courier','courier_service','warehouse','shipment_receipt','notes'] as const;
export type CsvRow = Record<typeof CSV_HEADERS[number], string>;
export type PreviewLine = { source: SourceLine; sku: string; family: string; quantity: number | null; unitCents: number | null; totalCents: number | null; mappingRule: string; errors: string[]; reason: string };
export type PreviewOrder = {
  source: SourceOrder; business: string; store: string; warehouse: string; courier: string; service: string;
  lines: PreviewLine[]; errors: string[]; warnings: string[]; totalCents: number; routeIds: string[]; rows: CsvRow[];
};
export type Projection = { orders: PreviewOrder[]; date: string; account: string; configRevision: number; configSnapshot: ParserConfig; editsSnapshot: Edits };
