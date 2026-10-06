// ============================================================================
// RECOMPOSITION — PROGRESS METRICS (pure: no DOM, no Firebase)
// ----------------------------------------------------------------------------
// PROGRESS = objective evidence of what actually happened.
//
// Everything here is a plain measurement or a plain comparison of two
// measurements. There is deliberately NO overall / body / physique /
// recomposition / muscle "progress percentage" and no generic progress bar:
// none of those has a measurable endpoint.
//
//   - estimated 1RM   a training-PERFORMANCE estimate (Epley), not muscle growth
//   - volume          weight x reps (volume-load), a training-WORK comparison
//   - weight          change between weigh-ins, not a body-composition change
//   - measurements    previous -> current -> change per site
// ============================================================================

const toNumber = value => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
};


// ----------------------------------------------------------------------------
// STRENGTH
// ----------------------------------------------------------------------------

// Epley: weight x (1 + reps / 30)
export function estimateOneRepMax(weight, reps) {
  const w = toNumber(weight);
  const r = toNumber(reps);

  if (w === null || r === null || w <= 0 || r <= 0) {
    return null;
  }

  return w * (1 + r / 30);
}

// The strongest set = the HIGHEST ESTIMATED 1RM (not the highest weight x reps).
//   60 x 12 -> e1RM 84     (volume 720)
//   70 x  8 -> e1RM 88.7   (volume 560)   <- this is the strongest set
// A tie goes to the heavier set. Invalid sets (blank, 0, negative, text) are
// ignored; returns null when no valid set exists.
export function getBestSet(sets) {
  let best = null;

  for (const set of Array.isArray(sets) ? sets : []) {
    const weight = toNumber(set?.weight);
    const reps = toNumber(set?.reps);
    const estimatedOneRepMax = estimateOneRepMax(weight, reps);

    if (estimatedOneRepMax === null) {
      continue;
    }

    if (
      !best ||
      estimatedOneRepMax > best.estimatedOneRepMax ||
      (estimatedOneRepMax === best.estimatedOneRepMax && weight > best.weight)
    ) {
      best = {
        weight,
        reps,
        volume: weight * reps,
        estimatedOneRepMax
      };
    }
  }

  return best;
}

// Percentage change from `previous` to `current`; null when it is undefined.
export function percentChange(current, previous) {
  const c = toNumber(current);
  const p = toNumber(previous);

  if (c === null || p === null || p <= 0) {
    return null;
  }

  return ((c - p) / p) * 100;
}


// ----------------------------------------------------------------------------
// VOLUME
// ----------------------------------------------------------------------------

// Training-volume comparison: (current - previous) / previous x 100.
//   status "no-data"      neither period has any volume
//   status "no-previous"  previous period has none -> no percentage (never /0)
//   status "changed"      percent is a number (may be 0 or negative)
export function compareVolume(current, previous) {
  const c = Math.max(0, toNumber(current) ?? 0);
  const p = Math.max(0, toNumber(previous) ?? 0);

  if (c === 0 && p === 0) {
    return { status: "no-data", current: c, previous: p, difference: 0, percent: null };
  }

  if (p === 0) {
    return { status: "no-previous", current: c, previous: p, difference: c, percent: null };
  }

  return {
    status: "changed",
    current: c,
    previous: p,
    difference: c - p,
    percent: percentChange(c, p)
  };
}


// ----------------------------------------------------------------------------
// DATED COMPARISONS (body weight, measurements)
// ----------------------------------------------------------------------------

function timeOf(date) {
  if (date?.toDate) {
    return date.toDate().getTime();
  }

  const time = new Date(date).getTime();

  return Number.isNaN(time) ? null : time;
}

// Newest first. Entries with an unreadable date go last (never first).
function newestFirst(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => ({ entry, index, time: timeOf(entry?.date) }))
    .sort((a, b) => {
      if (a.time === null && b.time === null) return a.index - b.index;
      if (a.time === null) return 1;
      if (b.time === null) return -1;
      return b.time - a.time || a.index - b.index;
    })
    .map(item => item.entry);
}

// previous -> current -> change, from the two most recent entries that have a
// numeric value. `valueOf(entry)` picks the number.
// Returns { current, previous, change, currentDate, previousDate } where
// previous/change are null with a single entry, and everything is null with none.
export function compareLatest(entries, valueOf = entry => entry?.value) {
  const usable = newestFirst(entries)
    .map(entry => ({ entry, value: toNumber(valueOf(entry)) }))
    .filter(item => item.value !== null);

  const current = usable[0] ?? null;
  const previous = usable[1] ?? null;

  return {
    current: current ? current.value : null,
    previous: previous ? previous.value : null,
    change: current && previous ? current.value - previous.value : null,
    currentDate: current?.entry?.date ?? null,
    previousDate: previous?.entry?.date ?? null
  };
}

// Body weight from Weight History (the canonical source; stored in kg).
export function compareWeight(weightHistory) {
  return compareLatest(weightHistory, entry => entry?.weight);
}


// ----------------------------------------------------------------------------
// MEASUREMENTS
// ----------------------------------------------------------------------------

const mean = values => values.reduce((sum, v) => sum + v, 0) / values.length;

export const MEASUREMENT_SITES = Object.freeze([
  { key: "chest", label: "Chest", read: entry => toNumber(entry?.chest) },
  { key: "waist", label: "Waist", read: entry => toNumber(entry?.waist) },
  {
    key: "shoulders",
    label: "Shoulders",
    read: entry => toNumber(entry?.shoulders ?? entry?.shoulder)
  },
  {
    key: "arms",
    label: "Arms",
    // `arms`, or the mean of left/right when only those were saved.
    read: entry => {
      const direct = toNumber(entry?.arms);

      if (direct !== null) return direct;

      const sides = [toNumber(entry?.leftArm), toNumber(entry?.rightArm)]
        .filter(value => value !== null);

      return sides.length ? mean(sides) : null;
    }
  },
  {
    key: "thighs",
    label: "Thighs",
    read: entry => toNumber(entry?.thighs ?? entry?.thigh)
  },
  { key: "calves", label: "Calves", read: entry => toNumber(entry?.calves) },
  { key: "forearms", label: "Forearms", read: entry => toNumber(entry?.forearms) }
]);

// One row per site that has at least one value. Each site compares its own two
// latest values, so a site missing from the newest entry still compares.
export function compareMeasurements(measurements) {
  return MEASUREMENT_SITES
    .map(site => ({
      key: site.key,
      label: site.label,
      ...compareLatest(measurements, site.read)
    }))
    .filter(row => row.current !== null);
}
