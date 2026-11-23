import { type Progress } from './index.js';
import type { CourseDocument } from './document.js';
export declare class LearnerError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(code: string, status: number);
}
export type LearnerProgress = Readonly<{
    version: number;
    progress: readonly Progress[];
    lastMutation?: {
        key: string;
        lessonId: string;
        completed: boolean;
    };
}>;
export type LearningAccess = Readonly<{
    id: string;
    learnerId: string;
    workspaceId: string;
    grantedAt: number;
    document: CourseDocument;
    digest: string;
}>;
export interface LearningAccessRepository<T extends LearningAccess = LearningAccess> {
    access(id: string, principalId: string): Promise<T | null>;
    progress(access: T): Promise<LearnerProgress>;
    save(access: T, prior: LearnerProgress, next: LearnerProgress): Promise<boolean>;
}
export type LearningCommand = {
    kind: 'read';
} | {
    kind: 'progress';
    lessonId: string;
    completed: boolean;
    expectedVersion: number;
    key: string;
};
/** The access lookup proves current eligibility and resolves the immutable course pin. */
export declare function executeLearningAccess<T extends LearningAccess>(repository: LearningAccessRepository<T>, principalId: string, id: string, command: LearningCommand, now: number): Promise<{
    pin: {
        artifactRef: string;
        revision: number;
        digest: string;
    };
    document: {
        lessonBodies: Readonly<{
            lessonId: string;
            markdown: string;
        }>[];
        contractVersion: "course-document/v1";
        revision: number;
        course: import("./types.js").Course;
    };
    availableLessonIds: string[];
    completedLessonIds: string[];
    version: number;
}>;
