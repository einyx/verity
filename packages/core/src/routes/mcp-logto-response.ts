import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { projectModelToolResult } from './mcp-model-projections.js';

/** A tool result carrying one text part. */
const textResult = (text: string, isError: boolean): CallToolResult => ({
  content: [{ type: 'text', text }],
  isError,
});

/** Safe JSON parse for tool bodies: a body that is not JSON reads as undefined. */
const tryParseJson = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Merges the collection size into a list response, or returns undefined when the body is not one. */
const mergeTotalCount = (body: string, totalCount: number): string | undefined => {
  const parsed = tryParseJson(body);

  if (Array.isArray(parsed)) {
    return JSON.stringify({ items: parsed, totalCount });
  }

  return isRecord(parsed) ? JSON.stringify({ ...parsed, totalCount }) : undefined;
};

/**
 * The tool result for one Management API response: refusal, projection, page totals, or raw body.
 * List endpoints page their results, so the model cannot count them from one page; the API sends
 * the collection size in the `x-total-count` header, and it travels with the page as `totalCount`.
 */
export const toolResultFor = (
  tool: {
    readonly name: string;
  },
  response: Response,
  body: string
): CallToolResult => {
  if (!response.ok) {
    return textResult(`The request failed (HTTP ${response.status}).`, true);
  }

  // Projection is mandatory, even for legacy tools and writes. No raw-body fallback exists.
  try {
    const projected = JSON.stringify(projectModelToolResult(tool.name, JSON.parse(body)));
    const totalCountHeader = response.headers.get('x-total-count');
    const totalCount = totalCountHeader === null ? Number.NaN : Number(totalCountHeader);
    return textResult(
      Number.isSafeInteger(totalCount) && totalCount >= 0
        ? (mergeTotalCount(projected, totalCount) ?? projected)
        : projected,
      false
    );
  } catch {
    return textResult('The response could not be read.', true);
  }
};
