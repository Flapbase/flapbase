import { canAccessLesson, recordProgress, CourseError } from './index.js';
export class LearnerError extends Error {
    code;
    status;
    constructor(code, status) {
        super(code);
        this.code = code;
        this.status = status;
    }
}
function context(access, principalId, state, now) {
    const enrollment = { tenantId: access.workspaceId, courseId: access.document.course.courseId, id: access.id, learnerId: principalId,
        source: { offering: 'digital', timing: 'now', reference: access.id }, status: 'active', enrolledAt: access.grantedAt, startsAt: access.grantedAt, grantedAt: access.grantedAt };
    return { course: access.document.course, enrollment, actor: { tenantId: access.workspaceId, userId: principalId }, progress: state.progress, now };
}
/** The access lookup proves current eligibility and resolves the immutable course pin. */
export async function executeLearningAccess(repository, principalId, id, command, now) {
    const access = await repository.access(id, principalId);
    if (!access || access.learnerId !== principalId || access.document.course.tenantId !== access.workspaceId || access.document.course.status !== 'published')
        throw new LearnerError('course_not_found', 404);
    let state = await repository.progress(access);
    let learner = context(access, principalId, state, now);
    if (command.kind === 'progress') {
        if (state.lastMutation?.key === command.key) {
            if (state.lastMutation.lessonId !== command.lessonId || state.lastMutation.completed !== command.completed)
                throw new LearnerError('progress_conflict', 409);
        }
        else {
            if (command.expectedVersion !== state.version)
                throw new LearnerError('progress_conflict', 409);
            let progress;
            try {
                progress = recordProgress(learner, command.lessonId, { completed: command.completed, positionSeconds: 0 });
            }
            catch (error) {
                if (error instanceof CourseError)
                    throw new LearnerError(error.code === 'time_reversed' ? 'progress_conflict' : 'lesson_unavailable', error.code === 'time_reversed' ? 409 : 403);
                throw error;
            }
            const next = { version: state.version + 1, progress: [...state.progress.filter(item => item.lessonId !== command.lessonId), progress], lastMutation: { key: command.key, lessonId: command.lessonId, completed: command.completed } };
            if (!await repository.save(access, state, next))
                throw new LearnerError('progress_conflict', 409);
            state = next;
            learner = context(access, principalId, state, now);
        }
    }
    const availableLessonIds = access.document.course.lessons.filter(lesson => canAccessLesson(learner, lesson.id)).map(lesson => lesson.id);
    return { pin: { artifactRef: access.document.course.courseId, revision: access.document.revision, digest: access.digest },
        document: { ...access.document, lessonBodies: access.document.lessonBodies.filter(body => availableLessonIds.includes(body.lessonId)) },
        availableLessonIds, completedLessonIds: state.progress.filter(item => item.completed).map(item => item.lessonId), version: state.version };
}
