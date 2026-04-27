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
