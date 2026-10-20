// Squarified treemap layout (Bruls, Huizing, van Wijk). Pure math, no DOM:
// the renderer behind app.js consumes plain rects, so a Canvas renderer can
// replace the SVG one later without touching this file.

// Lay out a row of entries along the shorter side of `rect`. Returns the
// placed rects and the remaining free rect.
const layoutRow = (row, rect) => {
  const rowArea = row.reduce((sum, entry) => sum + entry.area, 0);
  const horizontal = rect.w < rect.h; // Row runs along the shorter side.
  const side = horizontal ? rect.w : rect.h;
  const thickness = rowArea / side;
  const { placed } = row.reduce(
    ({ offset, placed: accumulated }, entry) => {
      const length = entry.area / thickness;
      const rectangle = horizontal
        ? { x: rect.x + offset, y: rect.y, w: length, h: thickness, item: entry.item }
        : { x: rect.x, y: rect.y + offset, w: thickness, h: length, item: entry.item };
      return { offset: offset + length, placed: [...accumulated, rectangle] };
    },
    { offset: 0, placed: [] }
  );
  const remaining = horizontal
    ? { x: rect.x, y: rect.y + thickness, w: rect.w, h: rect.h - thickness }
    : { x: rect.x + thickness, y: rect.y, w: rect.w - thickness, h: rect.h };
  return { rects: placed, rect: remaining };
};

// Worst aspect ratio of a candidate row laid out against the free `rect`.
const worst = (candidate, rect) => {
  const areas = candidate.map((entry) => entry.area);
  const sum = areas.reduce((accumulator, area) => accumulator + area, 0);
  const side = Math.min(rect.w, rect.h);
  const sumSquared = sum * sum;
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  return Math.max((side * side * max) / sumSquared, sumSquared / (side * side * min));
};

/**
 * Lay out items inside (x, y, w, h). Items must have a positive `value`.
 * Returns [{x, y, w, h, item}] in the same order the algorithm placed them.
 */
export function squarify(items, x, y, w, h) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0 || w <= 0 || h <= 0) {
    return [];
  }
  // Work on a copy sorted descending — squarify's quality guarantee needs it.
  const sorted = items.slice().sort((a, b) => b.value - a.value);
  const scale = (w * h) / total;
  const scaled = sorted.map((item) => ({ item, area: item.value * scale }));

  const state = scaled.reduce(
    (current, entry) => {
      if (entry.area <= 0) {
        return current;
      }
      if (current.row.length === 0) {
        return { ...current, row: [entry] };
      }
      const extended = [...current.row, entry];
      if (worst(extended, current.rect) <= worst(current.row, current.rect)) {
        return { ...current, row: extended };
      }
      const laid = layoutRow(current.row, current.rect);
      return { rects: [...current.rects, ...laid.rects], row: [entry], rect: laid.rect };
    },
    { rects: [], row: [], rect: { x, y, w, h } }
  );

  if (state.row.length > 0) {
    return [...state.rects, ...layoutRow(state.row, state.rect).rects];
  }
  return state.rects;
}

/**
 * Split a rect into a "packed" region and a "free" region along its longer
 * side. freeFrac is the share of the area that is free. Returns
 * { packed: rect, free: rect | null }.
 */
export function splitFree(x, y, w, h, freeFrac) {
  if (freeFrac <= 0.005) {
    return { packed: { x, y, w, h }, free: null };
  }
  if (freeFrac >= 0.995) {
    return { packed: null, free: { x, y, w, h } };
  }
  if (w >= h) {
    const pw = w * (1 - freeFrac);
    return {
      packed: { x, y, w: pw, h },
      free: { x: x + pw, y, w: w - pw, h },
    };
  }
  const ph = h * (1 - freeFrac);
  return {
    packed: { x, y, w, h: ph },
    free: { x, y: y + ph, w, h: h - ph },
  };
}
