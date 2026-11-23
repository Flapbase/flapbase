export const recruitmentAppKey: 'recruitment-preview'
export const recruitmentRevision: '1'
export type RecruitmentBinding = Readonly<{
  installId: string
  workspaceId: string
  projectId: string
}>

export type JobDraft = {
  version: number
  title: string
  description: string
  publishedVersion: number | null
}

export type PublishedJob = {
  title: string
  description: string
  version: number
}

export const recruitmentResults: readonly ['selected', 'not-selected']
export const recruitmentApplicationStatuses: readonly ['submitted', 'screening', ...typeof recruitmentResults]
export type RecruitmentResult = typeof recruitmentResults[number]

export type Application = {
  id: string
  jobTitle: string
  status: typeof recruitmentApplicationStatuses[number]
  version: number
}

export type OperatorApplication = Application & { note: string }

export type RecruitmentRelease = {
  candidateId: string
  digest: string
  draftVersion: number
  state: 'verified' | 'approved' | 'applied'
  verifiedAt: string
  approvedAt: string | null
  appliedAt: string | null
}

export type RecruitmentManagement = Pick<RecruitmentBinding, 'projectId' | 'workspaceId'> & {
  draft: JobDraft
  applications: OperatorApplication[]
  deliveryPending: boolean
  canApprove: boolean
  release: RecruitmentRelease | null
}
