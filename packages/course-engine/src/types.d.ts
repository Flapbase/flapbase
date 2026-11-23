/** All times are finite Unix milliseconds, supplied by the caller. */
export type Instant = number;
export type PublicationStatus = 'draft' | 'published' | 'archived';
export interface Scope {
    readonly tenantId: string;
    readonly courseId: string;
}
export interface Actor {
    readonly tenantId: string;
    readonly userId: string;
}
export interface MaterialRef {
    readonly id: string;
    readonly revision: string;
}
export interface Chapter {
    readonly id: string;
    readonly title: string;
    readonly order: number;
}
export interface Lesson {
    readonly id: string;
    readonly chapterId: string;
    readonly title: string;
    readonly order: number;
    readonly kind: 'video' | 'material' | 'exercise' | 'live';
    readonly status: PublicationStatus;
    readonly materials: readonly MaterialRef[];
    readonly required: boolean;
    readonly delayDays: number;
    readonly releaseAt?: Instant;
    readonly requirePrevious: boolean;
}
export interface Assignment {
    readonly id: string;
    readonly lessonId: string;
    readonly title: string;
    readonly required: boolean;
    readonly accepts: readonly SubmissionContent['kind'][];
}
export type Opening = {
    readonly kind: 'immediate';
} | {
    readonly kind: 'minimum-enrollment';
    readonly minimumLearners: number;
    readonly openedAt?: Instant;
};
export interface Course extends Scope {
    readonly creatorId: string;
    readonly title: string;
    readonly description: string;
    readonly status: PublicationStatus;
    readonly closesAt?: Instant;
    readonly opening: Opening;
    readonly chapters: readonly Chapter[];
    readonly lessons: readonly Lesson[];
    readonly assignments: readonly Assignment[];
}
/** The two sales axes are independent; no prices, orders or payment processing. */
export interface EntitlementSource {
    readonly offering: 'digital' | 'membership';
    readonly timing: 'now' | 'advance' | 'recurring';
    readonly reference: string;
}
export interface Enrollment extends Scope {
    readonly id: string;
    readonly learnerId: string;
    readonly source: EntitlementSource;
    readonly status: 'pending' | 'active' | 'revoked';
    readonly enrolledAt: Instant;
    readonly startsAt: Instant;
    readonly expiresAt?: Instant;
    readonly grantedAt?: Instant;
    readonly revokedAt?: Instant;
}
export interface Progress extends Scope {
    readonly enrollmentId: string;
    readonly learnerId: string;
    readonly lessonId: string;
    readonly completed: boolean;
    readonly completedAt?: Instant;
    readonly positionSeconds: number;
    readonly updatedAt: Instant;
}
export interface LearnerContext {
    readonly course: Course;
    readonly enrollment: Enrollment;
    readonly actor: Actor;
    readonly progress: readonly Progress[];
    readonly now: Instant;
}
export type SubmissionVisibility = 'private' | 'course';
export type SubmissionContent = {
    readonly kind: 'file';
    readonly assetId: string;
} | {
    readonly kind: 'link';
    readonly url: string;
} | {
    readonly kind: 'text';
    readonly text: string;
};
export interface Feedback {
    readonly creatorId: string;
    readonly text: string;
    readonly outcome: 'accepted' | 'changes-requested';
    readonly reviewedAt: Instant;
}
export interface SubmissionAttempt {
    readonly number: number;
    readonly content: SubmissionContent;
    readonly submittedAt: Instant;
    readonly feedback?: Feedback;
}
export interface Submission extends Scope {
    readonly id: string;
    readonly enrollmentId: string;
    readonly learnerId: string;
    readonly assignmentId: string;
    readonly visibility: SubmissionVisibility;
    readonly status: 'submitted' | 'changes-requested' | 'accepted';
    readonly attempts: readonly SubmissionAttempt[];
}
export interface QuestionPost {
    readonly id: string;
    readonly authorId: string;
    readonly role: 'learner' | 'creator';
    readonly text: string;
    readonly createdAt: Instant;
}
export interface QuestionThread extends Scope {
    readonly id: string;
    readonly lessonId: string;
    readonly enrollmentId: string;
    readonly learnerId: string;
    readonly status: 'open' | 'answered';
    readonly posts: readonly QuestionPost[];
}
export interface LiveParticipant {
    readonly enrollmentId: string;
    readonly learnerId: string;
    readonly reservedAt: Instant;
    readonly attendedAt?: Instant;
}
export interface LiveSession extends Scope {
    readonly id: string;
    readonly lessonId: string;
    readonly startsAt: Instant;
    readonly endsAt: Instant;
    readonly capacity: number;
    readonly participants: readonly LiveParticipant[];
}
export interface CompletionDecision {
    readonly eligible: boolean;
    readonly missingLessonIds: readonly string[];
    readonly missingAssignmentIds: readonly string[];
}
export interface CompletionRecord extends Scope {
    readonly id: string;
    readonly enrollmentId: string;
    readonly learnerId: string;
    readonly completedAt: Instant;
    readonly requiredLessonIds: readonly string[];
    readonly requiredAssignmentIds: readonly string[];
}
/** Entry contract only. The adapter must enforce retrieval/citation against these exact refs. */
export interface PracticeRequest extends Scope {
    readonly enrollmentId: string;
    readonly lessonId: string;
    readonly prompt: string;
    readonly grounding: {
        readonly kind: 'course-materials-only';
        readonly materials: readonly [MaterialRef, ...MaterialRef[]];
        readonly allowExternalSources: false;
    };
}
export interface PracticePort {
    practice(request: PracticeRequest): Promise<{
        readonly text: string;
        readonly citations: readonly MaterialRef[];
    }>;
}
/** A host loads and atomically replaces a complete course aggregate with CAS.
 * Authorization, transport decoding, membership, asset access and durable storage belong to the host.
 * compareAndSwap must reject a stale version, including concurrent live reservations/opening.
 */
export interface CourseState {
    readonly course: Course;
    readonly enrollments: readonly Enrollment[];
    readonly progress: readonly Progress[];
    readonly submissions: readonly Submission[];
    readonly threads: readonly QuestionThread[];
    readonly liveSessions: readonly LiveSession[];
    readonly completions: readonly CompletionRecord[];
}
export interface CourseSnapshot {
    readonly version: number;
    readonly state: CourseState;
}
export interface CourseStorePort {
    load(scope: Scope): Promise<CourseSnapshot | undefined>;
    compareAndSwap(scope: Scope, expectedVersion: number | null, next: CourseState): Promise<boolean>;
}
