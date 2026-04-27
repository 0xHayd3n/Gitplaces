// electron/services/signals/categorySignal.ts

interface CategoryCandidate {
  type_bucket: string | null
  type_sub: string | null
  language: string | null
}

interface CategoryProfile {
  bucketDistribution: Map<string, number>
  subTypeDistribution: Map<string, number>
  languageWeights: Map<string, number>
}

export interface CategoryScore {
  bucket: number
  subType: number
  language: number
}

export function scoreCategory(
  candidate: CategoryCandidate,
  profile: CategoryProfile,
): CategoryScore {
  return {
    bucket:   candidate.type_bucket ? (profile.bucketDistribution.get(candidate.type_bucket) ?? 0) : 0,
    subType:  candidate.type_sub    ? (profile.subTypeDistribution.get(candidate.type_sub) ?? 0)   : 0,
    language: candidate.language    ? (profile.languageWeights.get(candidate.language) ?? 0)        : 0,
  }
}

const BUCKET_MISMATCH_PENALTY = 0.15
const SUBTYPE_MISMATCH_PENALTY = 0.10

/**
 * Penalty applied when the candidate is classified into a bucket/subType the
 * user has zero stars in. `scoreCategory` is non-negative, so an off-bucket
 * candidate scores 0 on the bucket axis but can still rank highly via topic +
 * scale + freshness. This function provides the negative signal: subtract from
 * the composite score so off-bucket candidates need stronger topic match to
 * compete. Candidates with no classification (null bucket/subType) are not
 * penalized — we can't penalize what we don't know. Gated on the user having
 * *some* bucket/subType signal in their profile, so we don't asymmetrically
 * penalize classified candidates over unclassified ones when the user's data
 * is empty.
 */
export function categoryMismatchPenalty(
  candidate: CategoryCandidate,
  profile: CategoryProfile,
): number {
  let penalty = 0
  if (
    candidate.type_bucket &&
    profile.bucketDistribution.size > 0 &&
    (profile.bucketDistribution.get(candidate.type_bucket) ?? 0) === 0
  ) {
    penalty += BUCKET_MISMATCH_PENALTY
  }
  if (
    candidate.type_sub &&
    profile.subTypeDistribution.size > 0 &&
    (profile.subTypeDistribution.get(candidate.type_sub) ?? 0) === 0
  ) {
    penalty += SUBTYPE_MISMATCH_PENALTY
  }
  return penalty
}
