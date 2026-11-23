import type { Actor, CompletionDecision, CompletionRecord, Course, Enrollment, EntitlementSource, Feedback, LearnerContext, Lesson, LiveSession, Progress, PublicationStatus, QuestionThread, Scope, Submission, SubmissionContent, SubmissionVisibility } from './types.js';
export declare class CourseError extends Error {
    readonly code: string;
    constructor(code: string);
}
/** Validate curriculum at the host boundary; keep it immutable once enrollment begins. */
export declare function validateCourse(course: Course): void;
export declare function setCoursePublication(course: Course, actor: Actor, status: PublicationStatus): Course;
export declare function hasCourseAccess(course: Course, enrollment: Enrollment, now: number): boolean;
export declare function createEnrollment(course: Course, input: {
    readonly id: string;
    readonly learnerId: string;
    readonly source: EntitlementSource;
    readonly startsAt: number;
    readonly expiresAt?: number;
}, now: number): Enrollment;
/** Trusted sales adapter entry; a revoked enrollment cannot be revived by a late callback. */
export declare function grantEntitlement(course: Course, enrollment: Enrollment, now: number): Enrollment;
export declare function revokeEntitlement(enrollment: Enrollment, now: number): Enrollment;
export declare function evaluateOpening(course: Course, enrollments: readonly Enrollment[], now: number): {
    readonly ready: boolean;
    readonly learnerCount: number;
    readonly minimumLearners: number;
};
export declare function openCourse(course: Course, actor: Actor, enrollments: readonly Enrollment[], now: number): Course;
export declare function lessonAvailableAt(lesson: Lesson, enrollment: Enrollment): number;
export declare function canAccessLesson(context: LearnerContext, lessonId: string): boolean;
export declare function recordProgress(context: LearnerContext, lessonId: string, input: {
    readonly completed: boolean;
    readonly positionSeconds: number;
}): Progress;
export declare function submitAssignment(context: LearnerContext, input: {
    readonly id: string;
    readonly assignmentId: string;
    readonly content: SubmissionContent;
    readonly visibility: SubmissionVisibility;
}, previous?: Submission): Submission;
export declare function reviewSubmission(course: Course, actor: Actor, submission: Submission, input: Pick<Feedback, 'text' | 'outcome'>, now: number): Submission;
export declare function setSubmissionVisibility(context: LearnerContext, submission: Submission, visibility: SubmissionVisibility): Submission;
export declare function canViewSubmission(course: Course, submission: Submission, actor: Actor, now: number, viewerEnrollment?: Enrollment): boolean;
export declare function askQuestion(context: LearnerContext, input: {
    readonly id: string;
    readonly postId: string;
    readonly lessonId: string;
    readonly text: string;
}): QuestionThread;
export declare function answerQuestion(course: Course, actor: Actor, thread: QuestionThread, input: {
    readonly id: string;
    readonly text: string;
}, now: number): QuestionThread;
export declare function followUpQuestion(context: LearnerContext, thread: QuestionThread, input: {
    readonly id: string;
    readonly text: string;
}): QuestionThread;
export declare function createLiveSession(course: Course, actor: Actor, input: Omit<LiveSession, keyof Scope | 'participants'>): LiveSession;
export declare function reserveLiveSeat(context: LearnerContext, session: LiveSession): LiveSession;
export declare function cancelLiveSeat(context: LearnerContext, session: LiveSession): LiveSession;
export declare function recordAttendance(course: Course, actor: Actor, session: LiveSession, enrollment: Enrollment, now: number): LiveSession;
export declare function evaluateCompletion(context: LearnerContext, submissions: readonly Submission[]): CompletionDecision;
export declare function issueCompletion(context: LearnerContext, submissions: readonly Submission[], id: string, previous?: CompletionRecord): CompletionRecord;
