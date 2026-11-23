import { setCoursePublication, validateCourse } from './rules.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function need(condition, message) {
    if (!condition)
        throw new TypeError(`Invalid course document: ${message}`);
}
function object(value) {
    need(value !== null && typeof value === 'object' && !Array.isArray(value), 'object required');
}
function uuid(value) { need(typeof value === 'string' && UUID.test(value), 'bare UUID required'); }
function integer(value, minimum = 1) { need(Number.isSafeInteger(value) && value >= minimum, 'integer required'); }
function text(value, maximum, empty = false) {
    need(typeof value === 'string' && value.length <= maximum && (empty || value.trim().length > 0), 'text length');
}
function status(value) { need(['draft', 'published', 'archived'].includes(value), 'publication status'); }
function boolean(value) { need(typeof value === 'boolean', 'boolean required'); }
function optionalTime(value) { need(value === undefined || typeof value === 'number' && Number.isFinite(value), 'finite time required'); }
function array(value) { need(Array.isArray(value), 'array required'); }
/** Validate untrusted input once when preparing/publishing a write, without resolving authority. */
export function validateCourseDocument(value) {
    object(value);
    need(value.contractVersion === 'course-document/v1', 'contract version');
    integer(value.revision);
    const course = value.course;
    object(course);
    uuid(course.tenantId);
    uuid(course.courseId);
    uuid(course.creatorId);
    text(course.title, 180);
    text(course.description, 30000, true);
    status(course.status);
    optionalTime(course.closesAt);
    object(course.opening);
    need(course.opening.kind === 'immediate' || course.opening.kind === 'minimum-enrollment', 'opening kind');
    if (course.opening.kind === 'minimum-enrollment') {
        integer(course.opening.minimumLearners);
        optionalTime(course.opening.openedAt);
    }
    array(course.chapters);
    array(course.lessons);
    array(course.assignments);
    for (const chapter of course.chapters) {
        object(chapter);
        uuid(chapter.id);
        text(chapter.title, 180);
        integer(chapter.order);
    }
    for (const lesson of course.lessons) {
        object(lesson);
        uuid(lesson.id);
        uuid(lesson.chapterId);
        text(lesson.title, 180);
        integer(lesson.order);
        need(['video', 'material', 'exercise', 'live'].includes(lesson.kind), 'lesson kind');
        status(lesson.status);
        boolean(lesson.required);
        boolean(lesson.requirePrevious);
        integer(lesson.delayDays, 0);
        optionalTime(lesson.releaseAt);
        array(lesson.materials);
        for (const material of lesson.materials) {
            object(material);
            uuid(material.id);
            text(material.revision, 160);
        }
    }
    for (const assignment of course.assignments) {
        object(assignment);
        uuid(assignment.id);
        uuid(assignment.lessonId);
        text(assignment.title, 180);
        boolean(assignment.required);
        array(assignment.accepts);
        need(assignment.accepts.every(kind => ['file', 'link', 'text'].includes(kind)), 'submission kind');
    }
    const document = value;
    validateCourse(document.course);
    // Reuse publication rules after decoding, without treating its creator ID as authenticated authority.
    if (document.course.status === 'published')
        setCoursePublication(document.course, { tenantId: document.course.tenantId, userId: document.course.creatorId }, 'published');
    array(value.lessonBodies);
    const bodies = new Map();
    for (const body of value.lessonBodies) {
        object(body);
        uuid(body.lessonId);
        text(body.markdown, 250000, true);
        need(!bodies.has(body.lessonId), 'duplicate lesson body');
        need(document.course.lessons.some(lesson => lesson.id === body.lessonId), 'unknown lesson body');
        bodies.set(body.lessonId, body.markdown);
    }
    for (const lesson of document.course.lessons)
        if (lesson.status === 'published') {
            need((bodies.get(lesson.id)?.trim().length ?? 0) > 0, 'published lesson body required');
        }
    return document;
}
