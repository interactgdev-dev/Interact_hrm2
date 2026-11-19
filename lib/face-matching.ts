import { DESCRIPTOR_LENGTH } from "@/lib/face-types";

export function isFaceVerificationEnabled(): boolean {
  return process.env.FACE_VERIFICATION_ENABLED !== "false";
}

/**
 * Max euclidean distance for same person (lower = stricter).
 * Default 0.34 — clear same-person captures land ~0.18–0.32; different people
 * usually sit ≥0.38+. Tight band stops cross-employee "also matches".
 */
export function getMaxMatchDistance(): number {
  const raw = process.env.FACE_MATCH_MAX_DISTANCE;
  // 0.38: desk lighting / slight angle on Break-Clock-Prayer; look-alikes
  // usually still land ≥0.42+ and fail gallery/uniqueness gates.
  const parsed = raw ? parseFloat(raw) : 0.38;
  // Hard upper clamp 0.42 so misconfiguration cannot loosen past a safe band.
  return Number.isFinite(parsed) ? Math.min(0.42, Math.max(0.28, parsed)) : 0.38;
}

/**
 * Max distance for idle / Guard presence checks — a little looser than clock/break
 * so desk lighting and camera angle don't fail a genuine employee repeatedly.
 */
export function getPresenceMaxMatchDistance(): number {
  return Math.min(0.45, getMaxMatchDistance() + 0.05);
}

export function getMinMatchingPhotos(totalEnrolled: number): number {
  const raw = process.env.FACE_MIN_MATCH_PHOTOS;
  // Default 2: genuine captures often match 2 of 3 enrolled angles tightly;
  // gallery-winner + uniqueness gates still block wrong person.
  const configured = raw ? parseInt(raw, 10) : 2;
  const want = Number.isFinite(configured) && configured > 0 ? configured : 2;
  return Math.min(totalEnrolled, Math.max(1, want));
}

/** Idle presence needs fewer photo agreements — probe quality is noisier off-screen. */
export function getPresenceMinMatchingPhotos(totalEnrolled: number): number {
  return Math.min(totalEnrolled, Math.max(1, Math.min(2, getMinMatchingPhotos(totalEnrolled))));
}

/** Minimum similarity score stored on biometric token (derived from distance). */
export function getSimilarityMin(): number {
  const maxDist = getMaxMatchDistance();
  return Math.max(0.4, 1 - maxDist / 0.65);
}

export function isValidDescriptor(descriptor: unknown): descriptor is number[] {
  return (
    Array.isArray(descriptor) &&
    descriptor.length === DESCRIPTOR_LENGTH &&
    descriptor.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/** L2-normalize to unit length so the metric is identical for every descriptor:
 * raw enrolled photos, single-frame probes, and averaged multi-frame probes. */
function l2normalize(d: number[]): number[] {
  let norm = 0;
  for (let i = 0; i < DESCRIPTOR_LENGTH; i++) norm += d[i] * d[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Array<number>(DESCRIPTOR_LENGTH);
  for (let i = 0; i < DESCRIPTOR_LENGTH; i++) out[i] = d[i] / norm;
  return out;
}

export function euclideanDistance(a: number[], b: number[]): number {
  const na = l2normalize(a);
  const nb = l2normalize(b);
  let sum = 0;
  for (let i = 0; i < DESCRIPTOR_LENGTH; i++) {
    const d = na[i] - nb[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export function distanceToSimilarity(distance: number): number {
  const scale = 0.65;
  return Math.max(0, Math.min(1, 1 - distance / scale));
}

export type SelfMatchResult = {
  pass: boolean;
  bestDistance: number;
  avgDistance: number;
  matchCount: number;
  similarity: number;
};

export function matchProbeToDescriptors(
  probe: number[],
  enrolled: number[][],
  maxDistance: number,
  minMatchingPhotos: number
): SelfMatchResult {
  if (!enrolled.length) {
    return { pass: false, bestDistance: 99, avgDistance: 99, matchCount: 0, similarity: 0 };
  }

  const distances = enrolled.map((d) => euclideanDistance(probe, d));
  const sorted = [...distances].sort((a, b) => a - b);
  const bestDistance = sorted[0];
  const matchCount = distances.filter((d) => d <= maxDistance).length;
  // Average of the closest 2–3 enrolled photos — allow tiny slack so one
  // slightly different enroll angle does not fail a genuine desk capture.
  const k = Math.min(Math.max(2, minMatchingPhotos), sorted.length);
  const avgDistance = sorted.slice(0, k).reduce((a, b) => a + b, 0) / k;
  const avgSlack = 0.04;

  // Pass when closest photo is clear, closest-k average is near-band, and
  // enough enrolled photos individually match. Gallery/uniqueness still apply.
  const pass =
    bestDistance <= maxDistance &&
    avgDistance <= maxDistance + avgSlack &&
    matchCount >= minMatchingPhotos;

  return {
    pass,
    bestDistance,
    avgDistance,
    matchCount,
    similarity: distanceToSimilarity(bestDistance),
  };
}

/** How much closer claimed person must be than any OTHER enrolled person (clock/break). */
const RIVAL_SAFETY_MARGIN = 0.08;
/** Idle presence — still blocks clear look-alikes, admits genuine at desk. */
const RIVAL_SAFETY_MARGIN_PRESENCE = 0.06;

export type UniqueIdentityMode = "action" | "presence";

export type GalleryCandidate = {
  employeeId: string;
  descriptors: number[][];
};

export type GalleryRankHit = {
  employeeId: string;
  bestDistance: number;
  avgDistance: number;
  matchCount: number;
  similarity: number;
  pass: boolean;
};

/**
 * Score every enrolled identity against the probe (1:N identification).
 * Sorted closest-first — used to decide WHO is in front of the camera.
 */
export function rankGalleryByProbe(
  probe: number[],
  candidates: GalleryCandidate[],
  maxDistance: number,
  minMatchingPhotos: number
): GalleryRankHit[] {
  const hits: GalleryRankHit[] = [];
  for (const c of candidates) {
    if (!c.descriptors.length) continue;
    const m = matchProbeToDescriptors(
      probe,
      c.descriptors,
      maxDistance,
      Math.min(minMatchingPhotos, c.descriptors.length)
    );
    hits.push({
      employeeId: String(c.employeeId),
      bestDistance: m.bestDistance,
      avgDistance: m.avgDistance,
      matchCount: m.matchCount,
      similarity: m.similarity,
      pass: m.pass,
    });
  }
  hits.sort(
    (a, b) =>
      a.bestDistance - b.bestDistance ||
      a.avgDistance - b.avgDistance ||
      b.matchCount - a.matchCount
  );
  return hits;
}

function idAliasSet(ids: string[]): Set<string> {
  const set = new Set<string>();
  for (const raw of ids) {
    const id = String(raw || "").trim();
    if (!id) continue;
    set.add(id);
    if (/^\d+$/.test(id)) set.add(String(Number(id)));
  }
  return set;
}

/**
 * After self-match, require claimed employee to be the clear gallery winner.
 * Blocks accepting the wrong person when many employees are enrolled.
 */
export function assertClaimedIsGalleryWinner(
  claimedAliases: string[],
  ranked: GalleryRankHit[],
  maxDistance: number,
  mode: UniqueIdentityMode = "action"
):
  | { ok: true; winner: GalleryRankHit }
  | {
      ok: false;
      reason: string;
      code: "wrong_person" | "low_similarity";
      winnerId?: string;
      similarity?: number;
    } {
  const aliases = idAliasSet(claimedAliases);
  const margin =
    mode === "presence" ? RIVAL_SAFETY_MARGIN_PRESENCE : RIVAL_SAFETY_MARGIN;

  if (!ranked.length) {
    return {
      ok: false,
      code: "low_similarity",
      reason: "No enrolled faces available to compare.",
    };
  }

  const claimed = ranked.find((h) => aliases.has(h.employeeId));
  if (!claimed || !claimed.pass || claimed.bestDistance > maxDistance) {
    const simPct = claimed ? Math.round(claimed.similarity * 100) : 0;
    const needPct = Math.round((1 - maxDistance / 0.65) * 100);
    return {
      ok: false,
      code: "low_similarity",
      similarity: claimed?.similarity,
      reason: `Face does not match the logged-in employee closely enough (${simPct}% — need ~${needPct}%+).`,
    };
  }

  const winner = ranked[0];
  if (!aliases.has(winner.employeeId)) {
    const winPct = Math.round(winner.similarity * 100);
    const claimPct = Math.round(claimed.similarity * 100);
    return {
      ok: false,
      code: "wrong_person",
      winnerId: winner.employeeId,
      similarity: claimed.similarity,
      reason: `Camera face matches employee ID ${winner.employeeId} (${winPct}%) better than you (${claimPct}%). Wrong person blocked.`,
    };
  }

  const runnerUp = ranked.find((h) => !aliases.has(h.employeeId));
  if (runnerUp) {
    const gap = runnerUp.bestDistance - winner.bestDistance;
    // Clear separation from every other enrolled person.
    if (gap < margin) {
      return {
        ok: false,
        code: "wrong_person",
        winnerId: runnerUp.employeeId,
        similarity: winner.similarity,
        reason: `Face is too close to employee ID ${runnerUp.employeeId} as well — hold still in good light and look straight at the camera.`,
      };
    }
    // Another identity fully matches (multi-photo pass) → not unique.
    // Single lucky photo near the band is NOT enough to block a clear winner.
    if (runnerUp.pass) {
      return {
        ok: false,
        code: "wrong_person",
        winnerId: runnerUp.employeeId,
        similarity: winner.similarity,
        reason: `Face also matches employee ID ${runnerUp.employeeId}. Only a unique identity can proceed — recapture with face filling the oval, good light, looking straight.`,
      };
    }
  }

  return { ok: true, winner };
}

/**
 * Hard clarity cap — clock/break.
 * Must not be stricter than getMaxMatchDistance() or genuine matches
 * pass the first gate then get rejected here and FaceVerifyModal retries forever.
 */
const ABSOLUTE_BEST_CAP = 0.38;
/** Idle presence cap — desk lighting / angle need a little more room. */
const ABSOLUTE_BEST_CAP_PRESENCE = 0.44;

/**
 * Average of L2-normalized enrollment vectors. Look-alikes may luck one photo
 * but rarely sit near the whole enrollment set.
 */
export function enrollmentCentroid(descriptors: number[][]): number[] | null {
  if (!descriptors.length) return null;
  const acc = new Array<number>(DESCRIPTOR_LENGTH).fill(0);
  for (const d of descriptors) {
    const n = l2normalize(d);
    for (let i = 0; i < DESCRIPTOR_LENGTH; i++) acc[i] += n[i];
  }
  const inv = 1 / descriptors.length;
  for (let i = 0; i < DESCRIPTOR_LENGTH; i++) acc[i] *= inv;
  return l2normalize(acc);
}

export type RivalHit = { employeeId: string; distance: number };

/** Closest other enrolled employee (full gallery). */
export function findClosestRival(
  probe: number[],
  rivals: Array<{ employeeId: string; descriptors: number[][] }>,
  _selfBestDistance?: number,
  _maxDistance?: number
): RivalHit | null {
  let best: RivalHit | null = null;
  for (const rival of rivals) {
    if (!rival.descriptors.length) continue;
    const dist = Math.min(...rival.descriptors.map((d) => euclideanDistance(probe, d)));
    if (!best || dist < best.distance) {
      best = { employeeId: rival.employeeId, distance: dist };
    }
  }
  return best;
}

/**
 * After a self-match passes the distance threshold, confirm identity:
 * - probe near enrollment centroid (blocks one-photo luck)
 * - claimed person is nearest in the gallery
 * - clear gap vs next identity (blocks look-alikes)
 * - no other enrolled person within the accept / near-accept band
 */
export function assertUniqueIdentity(
  probe: number[],
  selfBestDistance: number,
  selfDescriptors: number[][],
  rivals: Array<{ employeeId: string; descriptors: number[][] }>,
  maxDistance: number,
  mode: UniqueIdentityMode = "action"
): { ok: true } | { ok: false; reason: string; employeeId?: string } {
  const rivalMargin =
    mode === "presence" ? RIVAL_SAFETY_MARGIN_PRESENCE : RIVAL_SAFETY_MARGIN;
  const absoluteCap =
    mode === "presence" ? ABSOLUTE_BEST_CAP_PRESENCE : ABSOLUTE_BEST_CAP;
  const centroidSlack = mode === "presence" ? 0.06 : 0.04;

  const centroid = enrollmentCentroid(selfDescriptors);
  if (centroid) {
    const toCentroid = euclideanDistance(probe, centroid);
    if (toCentroid > maxDistance + centroidSlack) {
      return {
        ok: false,
        reason:
          "Face does not match your enrolled photo set closely enough (look-alike rejected).",
      };
    }
  }

  // Absolute clarity: best hit must be clearly the enrolled person
  if (selfBestDistance > Math.min(maxDistance, absoluteCap)) {
    return {
      ok: false,
      reason: "Face match is too weak — only a clear match to enrolled photos is allowed.",
    };
  }

  // Median distance — action mode only (presence desk angles vary more)
  if (mode === "action" && selfDescriptors.length >= 3) {
    const all = selfDescriptors
      .map((d) => euclideanDistance(probe, d))
      .sort((a, b) => a - b);
    const mid = all[Math.floor(all.length / 2)];
    if (mid > maxDistance + 0.08) {
      return {
        ok: false,
        reason:
          "Face only partially matches enrollment photos — look-alike or poor capture rejected.",
      };
    }
  }

  const rival = findClosestRival(probe, rivals);
  if (!rival) return { ok: true };

  if (rival.distance <= selfBestDistance) {
    return {
      ok: false,
      employeeId: rival.employeeId,
      reason: `Face is closer to employee ID ${rival.employeeId} than to your enrollment.`,
    };
  }

  if (rival.distance - selfBestDistance < rivalMargin) {
    return {
      ok: false,
      employeeId: rival.employeeId,
      reason: `Face is too similar to employee ID ${rival.employeeId} — only a unique match can proceed.`,
    };
  }

  // Reject only when another person is clearly inside the accept band
  // (not a near-miss single photo that inflated distance noise).
  if (rival.distance <= maxDistance) {
    return {
      ok: false,
      employeeId: rival.employeeId,
      reason: `Face also matches employee ID ${rival.employeeId}. Hold still, face the camera, and recapture in good light.`,
    };
  }

  return { ok: true };
}
