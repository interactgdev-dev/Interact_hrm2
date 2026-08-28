export type BiometricAction =
  | "clock_in"
  | "clock_out"
  | "break_start"
  | "break_end"
  | "prayer_start"
  | "prayer_end"
  | "refreshment_start"
  | "refreshment_end"
  | "meeting_start"
  | "meeting_end";

export type VerifyFailCode =
  | "no_face"
  | "not_enrolled"
  | "wrong_person"
  | "low_similarity"
  | "error";

export type VerifyResult =
  | { verified: true; similarity: number; subject: string }
  | {
      verified: false;
      reason: string;
      code: VerifyFailCode;
      similarity?: number;
      subject?: string;
      expectedSubject?: string;
    };

export const DESCRIPTOR_LENGTH = 128;
export const RECOMMENDED_ENROLLMENT_MIN = 3;
export const RECOMMENDED_ENROLLMENT_MAX = 5;
