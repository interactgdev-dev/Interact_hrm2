import { getEmployeeMatchKeys } from "@/lib/biometric-employee";
import {
  assertClaimedIsGalleryWinner,
  assertUniqueIdentity,
  getMaxMatchDistance,
  getMinMatchingPhotos,
  getPresenceMaxMatchDistance,
  getPresenceMinMatchingPhotos,
  getSimilarityMin,
  isFaceVerificationEnabled,
  isValidDescriptor,
  matchProbeToDescriptors,
  rankGalleryByProbe,
} from "@/lib/face-matching";
import {
  RECOMMENDED_ENROLLMENT_MIN,
  type VerifyResult,
} from "@/lib/face-types";
import {
  countDescriptorsForEmployee,
  countEnrollmentForEmployee,
  getDescriptorsForEmployees,
  getOtherEmployeesDescriptorSamples,
} from "@/lib/face-enrollment-table";
import { resolveEmployeeDbId } from "@/lib/resolve-employee-id";

export { RECOMMENDED_ENROLLMENT_MIN, RECOMMENDED_ENROLLMENT_MAX } from "@/lib/face-types";
export type { BiometricAction, VerifyResult, VerifyFailCode } from "@/lib/face-types";
export { isFaceVerificationEnabled, getSimilarityMin } from "@/lib/face-matching";

export function defaultSubjectForEmployee(
  employeeId: string,
  employeeName?: string | null
): string {
  const id = String(employeeId || "").trim();
  const name = String(employeeName || "")
    .trim()
    .replace(/\s+/g, " ");
  if (name && id) return `${name} ID ${id}`;
  if (id) return `employee_${id}`;
  return "unknown_employee";
}

function employeeDisplayLabel(
  matchKeys: { dbIds: string[]; names: string[] },
  fallbackId: string
): string {
  const name = matchKeys.names[0];
  const id = matchKeys.dbIds[0] || fallbackId;
  if (name && id) return `${name} (ID ${id})`;
  if (name) return name;
  return `Employee ID ${id}`;
}

export async function getFaceVerificationStatus() {
  return {
    configured: isFaceVerificationEnabled(),
    reachable: true,
    engine: "local",
    maxDistance: getMaxMatchDistance(),
    similarityMin: getSimilarityMin(),
  };
}

type VerifyFail = Extract<VerifyResult, { verified: false }>;

function preferFail(a: VerifyFail | null, b: VerifyFail): VerifyFail {
  if (!a) return b;
  // Prefer identity failures over no_face for messaging.
  const rank = (r: VerifyFail) => {
    if (r.code === "wrong_person") return 3;
    if (r.code === "low_similarity") return 2;
    if (r.code === "not_enrolled") return 1;
    return 0;
  };
  if (rank(b) > rank(a)) return b;
  if (rank(b) < rank(a)) return a;
  const as = a.similarity ?? 0;
  const bs = b.similarity ?? 0;
  return bs >= as ? b : a;
}

/**
 * Verify one or more face probes from the same frame.
 * Multi-person OK: if ANY probe is a clear match to the claimed employee
 * (gallery winner + uniqueness gates), succeed. Wrong-only faces still fail.
 */
export async function verifyDescriptorsForEmployee(
  descriptors: number[][],
  employeeId: string,
  employeeName?: string | null,
  opts?: { purpose?: "action" | "presence" }
): Promise<VerifyResult> {
  const purpose = opts?.purpose === "presence" ? "presence" : "action";
  const rawId = String(employeeId || "").trim();
  if (!rawId) {
    return { verified: false, reason: "Employee session missing. Log in again.", code: "error" };
  }
  if (!isFaceVerificationEnabled()) {
    return { verified: false, reason: "Face verification is disabled.", code: "error" };
  }

  const probes = descriptors.filter(isValidDescriptor);
  if (!probes.length) {
    return {
      verified: false,
      reason: "No face detected. Center your face in the camera frame.",
      code: "no_face",
    };
  }

  const id = (await resolveEmployeeDbId(rawId)) || rawId;
  const matchKeys = await getEmployeeMatchKeys(id, employeeName);
  const label = employeeDisplayLabel(matchKeys, id);
  const idAliases = matchKeys.dbIds.length ? matchKeys.dbIds : [id];
  const enrollment = await getDescriptorsForEmployees(idAliases);
  const descriptorCount =
    enrollment.descriptorCount || (await countDescriptorsForEmployee(id));
  const photoCount = enrollment.count || (await countEnrollmentForEmployee(id));

  if (descriptorCount < RECOMMENDED_ENROLLMENT_MIN || !enrollment.descriptors.length) {
    if (photoCount >= RECOMMENDED_ENROLLMENT_MIN) {
      return {
        verified: false,
        reason: `Photos exist for ${label} but face profiles need refresh. HR: open Admin → Face Enrollment, select this employee — profiles will auto-update.`,
        code: "not_enrolled",
      };
    }
    return {
      verified: false,
      reason: `Face not enrolled for ${label}. Ask HR to add ${RECOMMENDED_ENROLLMENT_MIN}+ photos at Admin → Face Enrollment.`,
      code: "not_enrolled",
    };
  }

  const subject =
    enrollment.subject || defaultSubjectForEmployee(id, matchKeys.names[0] || employeeName);
  const maxDistance =
    purpose === "presence" ? getPresenceMaxMatchDistance() : getMaxMatchDistance();
  const minPhotos =
    purpose === "presence"
      ? getPresenceMinMatchingPhotos(enrollment.descriptors.length)
      : getMinMatchingPhotos(enrollment.descriptors.length);
  const needPct = Math.round((1 - maxDistance / 0.65) * 100);

  const rivals = await getOtherEmployeesDescriptorSamples(idAliases);
  const gallery = [
    { employeeId: id, descriptors: enrollment.descriptors },
    ...rivals,
  ];

  let bestFail: VerifyFail | null = null;

  for (const descriptor of probes) {
    const self = matchProbeToDescriptors(
      descriptor,
      enrollment.descriptors,
      maxDistance,
      minPhotos
    );

    if (!self.pass) {
      const simPct = Math.round(self.similarity * 100);
      bestFail = preferFail(bestFail, {
        verified: false,
        reason: `Face does not match ${label} (${simPct}% — need ~${needPct}%+ on ${minPhotos} enrolled photos).`,
        code: "low_similarity",
        similarity: self.similarity,
        subject,
        expectedSubject: subject,
      });
      continue;
    }

    const ranked = rankGalleryByProbe(descriptor, gallery, maxDistance, minPhotos);
    const winnerCheck = assertClaimedIsGalleryWinner(
      idAliases,
      ranked,
      maxDistance,
      purpose
    );
    if (!winnerCheck.ok) {
      bestFail = preferFail(bestFail, {
        verified: false,
        reason: winnerCheck.reason,
        code: winnerCheck.code,
        similarity: winnerCheck.similarity ?? self.similarity,
        subject,
        expectedSubject: subject,
      });
      continue;
    }

    const unique = assertUniqueIdentity(
      descriptor,
      self.bestDistance,
      enrollment.descriptors,
      rivals,
      maxDistance,
      purpose
    );
    if (!unique.ok) {
      bestFail = preferFail(bestFail, {
        verified: false,
        reason: unique.reason,
        code: "wrong_person",
        similarity: self.similarity,
        subject,
        expectedSubject: subject,
      });
      continue;
    }

    return {
      verified: true,
      similarity: self.similarity,
      subject,
    };
  }

  return (
    bestFail || {
      verified: false,
      reason: `Face does not match ${label}.`,
      code: "low_similarity",
      subject,
      expectedSubject: subject,
    }
  );
}

export async function verifyDescriptorForEmployee(
  descriptor: number[],
  employeeId: string,
  employeeName?: string | null,
  opts?: { purpose?: "action" | "presence" }
): Promise<VerifyResult> {
  return verifyDescriptorsForEmployee([descriptor], employeeId, employeeName, opts);
}
