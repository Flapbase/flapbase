import type { Application, JobDraft, OperatorApplication, PublishedJob, RecruitmentBinding, RecruitmentRelease, RecruitmentResult } from './shared.js'

type Tx = {
  (strings: TemplateStringsArray, ...parameters: never[]): unknown
  json(value: never): unknown
}
export type RecruitmentCandidatePin = Pick<RecruitmentRelease, 'candidateId' | 'digest'>
export function createRecruitmentPersistence(options: {
  sha256(value: unknown): `sha256:${string}`
  presetDigest: string
}): {
  initializeRecruitment(tx: Tx, binding: RecruitmentBinding): Promise<void>
  readRecruitmentDraft(tx: Tx, binding: RecruitmentBinding): Promise<JobDraft>
  saveRecruitmentDraft(tx: Tx, binding: RecruitmentBinding, input: { version: number; title: string; description: string }): Promise<JobDraft | null>
  lockRecruitmentDraft(tx: Tx, binding: RecruitmentBinding): Promise<JobDraft>
  activateRecruitmentCandidate(tx: Tx, binding: RecruitmentBinding, candidate: PublishedJob): Promise<JobDraft>
  submitRecruitmentApplication(tx: Tx, binding: RecruitmentBinding, subjectId: string, input: { requestId: string; publishedVersion: number; note: string }, snapshot: PublishedJob | null | undefined): Promise<Application | null>
  listOwnApplications(tx: Tx, binding: RecruitmentBinding, subjectId: string): Promise<Application[]>
  hasOwnApplication(tx: Tx, binding: RecruitmentBinding, subjectId: string): Promise<boolean>
  listRecruitmentApplications(tx: Tx, binding: RecruitmentBinding): Promise<OperatorApplication[]>
  listRecruitmentApplications(tx: Tx, binding: RecruitmentBinding, includeNote: false): Promise<Application[]>
  advanceRecruitmentApplication(tx: Tx, binding: RecruitmentBinding, input: { id: string; version: number }): Promise<Application | null>
  finalizeRecruitmentApplication(tx: Tx, binding: RecruitmentBinding, input: { id: string; version: number; outcome: RecruitmentResult }): Promise<Application | null>
  readRecruitmentRelease(tx: Tx, binding: RecruitmentBinding): Promise<RecruitmentRelease | null>
  verifyRecruitmentRelease(tx: Tx, binding: RecruitmentBinding, actor: string, version: number): Promise<RecruitmentRelease>
  approveRecruitmentRelease(tx: Tx, binding: RecruitmentBinding, approver: string, pin: RecruitmentCandidatePin): Promise<RecruitmentRelease>
  applyRecruitmentRelease(tx: Tx, binding: RecruitmentBinding, actor: string, pin: RecruitmentCandidatePin): Promise<{ draft: JobDraft; job: PublishedJob }>
}
