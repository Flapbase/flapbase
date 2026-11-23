import type { Course } from './types.js';
/** Plain Markdown, never trusted HTML. Rendering and sanitization belong to the host. */
export type CourseLessonBody = Readonly<{
    lessonId: string;
    markdown: string;
}>;
export type CourseDocument = Readonly<{
    contractVersion: 'course-document/v1';
    revision: number;
    course: Course;
    lessonBodies: readonly CourseLessonBody[];
}>;
/** Validate untrusted input once when preparing/publishing a write, without resolving authority. */
export declare function validateCourseDocument(value: unknown): CourseDocument;
