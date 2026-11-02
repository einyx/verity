import { array, number, object, string } from 'zod/v3';

import { safeParseJson } from '#src/utils/json.js';

import { readBoundedResponse } from './bounded-response.js';

const prices = new Map<string, { usd: number; at: number }>();
const snapshotSchema = object({
  nodes: array(
    object({
      name: string(),
      instanceType: string().optional(),
      hourlyUSD: number().optional(),
    }).passthrough()
  ).optional(),
}).passthrough();
const priceSchema = object({
  Items: array(
    object({ retailPrice: number(), productName: string(), meterName: string() })
  ).optional(),
});

const hourlyUsd = async (sku: string) => {
  const cached = prices.get(sku);
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) {
    return cached.usd;
  }
  const url = new URL('https://prices.azure.com/api/retail/prices');
  url.searchParams.set(
    '$filter',
    `serviceName eq 'Virtual Machines' and armSkuName eq '${sku}' and armRegionName eq '${process.env.KUBO_COST_AZURE_REGION ?? 'uaenorth'}' and priceType eq 'Consumption'`
  );
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    await response.body?.cancel();
    return;
  }
  const body = priceSchema.parse(
    safeParseJson(await readBoundedResponse(response, { maxBytes: 5 * 1024 * 1024 }))
  );
  const item = body.Items?.find(
    ({ productName, meterName }) =>
      !productName.includes('Windows') &&
      !meterName.includes('Spot') &&
      !meterName.includes('Low Priority')
  );
  if (item) {
    prices.set(sku, { usd: item.retailPrice, at: Date.now() });
  }
  return item?.retailPrice;
};

/** Operator-only capacity response enrichment; never receives a caller credential. */
export const priceKuboCapacity = async (value: unknown) => {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) {
    return value;
  }
  const nodes = await Promise.all(
    (parsed.data.nodes ?? []).map(async (node) => {
      const usd = node.instanceType
        ? await hourlyUsd(node.instanceType).catch((): undefined => undefined)
        : undefined;
      return usd === undefined ? node : { ...node, hourlyUSD: usd };
    })
  );
  return { ...parsed.data, nodes };
};
