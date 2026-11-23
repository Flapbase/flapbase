export class CourseError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
        this.name = 'CourseError';
    }
}
function require(condition, code) {
    if (!condition)
        throw new CourseError(code);
}
function time(value) { require(Number.isFinite(value), 'invalid_time'); }
function integer(value, min = 0) { require(Number.isSafeInteger(value) && value >= min, 'invalid_number'); }
function text(value) { require(value.trim().length > 0, 'empty_text'); }
function sameScope(a, b) { return a.tenantId === b.tenantId && a.courseId === b.courseId; }
function scoped(a, b) { require(sameScope(a, b), 'scope_mismatch'); }
function creator(course, actor) {
    require(course.tenantId === actor.tenantId && course.creatorId === actor.userId, 'creator_required');
}
function own(context) {
    scoped(context.course, context.enrollment);
    require(context.actor.tenantId === context.course.tenantId && context.actor.userId === context.enrollment.learnerId, 'learner_required');
}
function scope(course) { return { tenantId: course.tenantId, courseId: course.courseId }; }
function unique(values) { require(new Set(values).size === values.length, 'duplicate_id'); }
function ordered(course) {
    return [...course.lessons].sort((a, b) => course.chapters.find(c => c.id === a.chapterId).order - course.chapters.find(c => c.id === b.chapterId).order || a.order - b.order);
}
function lessonOf(course, id) {
    const lesson = course.lessons.find(l => l.id === id);
    require(lesson, 'lesson_not_found');
    return lesson;
}
function progressFor(context, p) {
    return sameScope(context.course, p) && p.enrollmentId === context.enrollment.id && p.learnerId === context.enrollment.learnerId;
}
/** Validate curriculum at the host boundary; keep it immutable once enrollment begins. */
export function validateCourse(course) {
    [course.tenantId, course.courseId, course.creatorId, course.title].forEach(text);
    if (course.closesAt !== undefined)
        time(course.closesAt);
    if (course.opening.kind === 'minimum-enrollment') {
        integer(course.opening.minimumLearners, 1);
        if (course.opening.openedAt !== undefined)
            time(course.opening.openedAt);
    }
    unique(course.chapters.map(c => c.id));
    unique(course.chapters.map(c => String(c.order)));
    unique(course.lessons.map(l => l.id));
    unique(course.assignments.map(a => a.id));
    for (const chapter of course.chapters) {
        text(chapter.id);
        integer(chapter.order, 1);
        unique(course.lessons.filter(l => l.chapterId === chapter.id).map(l => String(l.order)));
    }
    for (const lesson of course.lessons) {
        text(lesson.id);
        integer(lesson.order, 1);
        integer(lesson.delayDays);
        require(course.chapters.some(c => c.id === lesson.chapterId), 'chapter_not_found');
        if (lesson.releaseAt !== undefined)
            time(lesson.releaseAt);
        for (const material of lesson.materials) {
            text(material.id);
            text(material.revision);
        }
    }
    for (const assignment of course.assignments) {
        text(assignment.id);
        lessonOf(course, assignment.lessonId);
        require(assignment.accepts.length > 0, 'submission_kind_required');
    }
}
export function setCoursePublication(course, actor, status) {
    creator(course, actor);
    validateCourse(course);
    require(course.status !== 'archived' || status === 'archived', 'invalid_transition');
    if (status === 'published') {
        require(course.chapters.length > 0 && course.lessons.length > 0, 'curriculum_required');
        require(course.lessons.some(l => l.status === 'published'), 'published_lesson_required');
        require(course.lessons.filter(l => l.required || course.assignments.some(a => a.required && a.lessonId === l.id))
            .every(l => l.status === 'published'), 'required_lesson_unpublished');
    }
    return { ...course, status };
}
function withinWindow(course, enrollment, now) {
    return Number.isFinite(now) && Number.isFinite(enrollment.startsAt) && now >= enrollment.startsAt &&
        (enrollment.expiresAt === undefined || now < enrollment.expiresAt) &&
        (course.closesAt === undefined || now < course.closesAt);
}
export function hasCourseAccess(course, enrollment, now) {
    return sameScope(course, enrollment) && course.status === 'published' && enrollment.status === 'active' &&
        enrollment.grantedAt !== undefined && Number.isFinite(enrollment.grantedAt) && now >= enrollment.grantedAt &&
        withinWindow(course, enrollment, now) &&
        (course.opening.kind === 'immediate' || (course.opening.openedAt !== undefined && now >= course.opening.openedAt));
}
export function createEnrollment(course, input, now) {
    time(now);
    time(input.startsAt);
    text(input.id);
    text(input.learnerId);
    text(input.source.reference);
    require(course.status === 'published', 'course_unavailable');
    require(course.closesAt === undefined || now < course.closesAt, 'course_expired');
    if (input.expiresAt !== undefined) {
        time(input.expiresAt);
        require(input.expiresAt > Math.max(input.startsAt, now), 'invalid_expiry');
    }
    return { ...scope(course), ...input, source: { ...input.source }, status: 'pending', enrolledAt: now };
}
/** Trusted sales adapter entry; a revoked enrollment cannot be revived by a late callback. */
export function grantEntitlement(course, enrollment, now) {
    time(now);
    scoped(course, enrollment);
    require(enrollment.status !== 'revoked', 'entitlement_revoked');
    require(now >= enrollment.enrolledAt, 'time_reversed');
    require(course.status === 'published' && withinWindow(course, enrollment, now), 'course_unavailable');
    require(course.opening.kind === 'immediate' || (course.opening.openedAt !== undefined && now >= course.opening.openedAt), 'course_not_open');
    if (enrollment.status === 'active')
        return enrollment;
    return { ...enrollment, status: 'active', grantedAt: now };
}
export function revokeEntitlement(enrollment, now) {
    time(now);
    require(now >= (enrollment.grantedAt ?? enrollment.enrolledAt), 'time_reversed');
    if (enrollment.status === 'revoked')
        return enrollment;
    return { ...enrollment, status: 'revoked', revokedAt: now };
}
export function evaluateOpening(course, enrollments, now) {
    time(now);
    validateCourse(course);
    const eligible = enrollments.filter(e => sameScope(course, e) && e.source.timing === 'advance' &&
        e.status !== 'revoked' && e.enrolledAt <= now && (e.expiresAt === undefined || now < e.expiresAt));
    const learnerCount = new Set(eligible.map(e => e.learnerId)).size;
    const minimumLearners = course.opening.kind === 'minimum-enrollment' ? course.opening.minimumLearners : 0;
    return { ready: course.status === 'published' && (course.closesAt === undefined || now < course.closesAt) && learnerCount >= minimumLearners, learnerCount, minimumLearners };
}
export function openCourse(course, actor, enrollments, now) {
    creator(course, actor);
    time(now);
    if (course.opening.kind === 'immediate' || course.opening.openedAt !== undefined)
        return course;
    require(evaluateOpening(course, enrollments, now).ready, 'minimum_not_met');
    return { ...course, opening: { ...course.opening, openedAt: now } };
}
export function lessonAvailableAt(lesson, enrollment) {
    integer(lesson.delayDays);
    time(enrollment.enrolledAt);
    if (lesson.releaseAt !== undefined)
        time(lesson.releaseAt);
    const available = Math.max(enrollment.enrolledAt + lesson.delayDays * 86_400_000, lesson.releaseAt ?? enrollment.enrolledAt);
    time(available);
    return available;
}
export function canAccessLesson(context, lessonId) {
    const { course, enrollment, actor, now } = context;
    if (actor.tenantId !== course.tenantId || actor.userId !== enrollment.learnerId || !hasCourseAccess(course, enrollment, now))
        return false;
    const lesson = course.lessons.find(l => l.id === lessonId);
    if (!lesson || lesson.status !== 'published' || now < lessonAvailableAt(lesson, enrollment))
        return false;
    if (!lesson.requirePrevious)
        return true;
    const lessons = ordered(course);
    return lessons.slice(0, lessons.findIndex(l => l.id === lessonId)).every(l => context.progress.some(p => progressFor(context, p) && p.lessonId === l.id && p.completed));
}
function access(context, lessonId) {
    own(context);
    time(context.now);
    require(canAccessLesson(context, lessonId), 'lesson_access_denied');
}
export function recordProgress(context, lessonId, input) {
    access(context, lessonId);
    integer(input.positionSeconds);
    const previous = context.progress.find(p => progressFor(context, p) && p.lessonId === lessonId);
    require(!previous || context.now >= previous.updatedAt, 'time_reversed');
    return { ...scope(context.course), enrollmentId: context.enrollment.id, learnerId: context.enrollment.learnerId,
        lessonId, ...input, updatedAt: context.now,
        ...(input.completed ? { completedAt: previous?.completedAt ?? context.now } : {}) };
}
function assignmentOf(course, id) {
    const assignment = course.assignments.find(a => a.id === id);
    require(assignment, 'assignment_not_found');
    return assignment;
}
function validateContent(content) {
    if (content.kind === 'file')
        text(content.assetId);
    else if (content.kind === 'text')
        text(content.text);
    else
        require(/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(content.url), 'invalid_link');
}
function submissionOwner(context, submission) {
    scoped(context.course, submission);
    require(submission.enrollmentId === context.enrollment.id && submission.learnerId === context.actor.userId, 'submission_owner_required');
}
export function submitAssignment(context, input, previous) {
    const assignment = assignmentOf(context.course, input.assignmentId);
    access(context, assignment.lessonId);
    text(input.id);
    validateContent(input.content);
    require(assignment.accepts.includes(input.content.kind), 'submission_kind_denied');
    if (previous) {
        submissionOwner(context, previous);
        require(previous.id === input.id && previous.assignmentId === input.assignmentId, 'submission_mismatch');
        require(previous.status === 'changes-requested', 'invalid_transition');
        const last = previous.attempts.at(-1);
        require(last?.feedback && context.now >= last.feedback.reviewedAt, 'time_reversed');
    }
    return { ...scope(context.course), id: input.id, assignmentId: input.assignmentId,
        enrollmentId: context.enrollment.id, learnerId: context.enrollment.learnerId,
        visibility: input.visibility, status: 'submitted', attempts: [...(previous?.attempts ?? []),
            { number: (previous?.attempts.length ?? 0) + 1, content: { ...input.content }, submittedAt: context.now }] };
}
export function reviewSubmission(course, actor, submission, input, now) {
    creator(course, actor);
    scoped(course, submission);
    assignmentOf(course, submission.assignmentId);
    time(now);
    text(input.text);
    require(submission.status === 'submitted', 'invalid_transition');
    const last = submission.attempts.at(-1);
    require(last && now >= last.submittedAt, 'time_reversed');
    return { ...submission, status: input.outcome, attempts: [...submission.attempts.slice(0, -1),
            { ...last, feedback: { ...input, creatorId: actor.userId, reviewedAt: now } }] };
}
export function setSubmissionVisibility(context, submission, visibility) {
    access(context, assignmentOf(context.course, submission.assignmentId).lessonId);
    submissionOwner(context, submission);
    return { ...submission, visibility };
}
export function canViewSubmission(course, submission, actor, now, viewerEnrollment) {
    if (!sameScope(course, submission) || actor.tenantId !== course.tenantId)
        return false;
    if (actor.userId === course.creatorId || actor.userId === submission.learnerId)
        return true;
    return submission.visibility === 'course' && viewerEnrollment !== undefined && viewerEnrollment.learnerId === actor.userId &&
        hasCourseAccess(course, viewerEnrollment, now);
}
export function askQuestion(context, input) {
    access(context, input.lessonId);
    text(input.id);
    text(input.postId);
    text(input.text);
    return { ...scope(context.course), id: input.id, lessonId: input.lessonId, enrollmentId: context.enrollment.id,
        learnerId: context.enrollment.learnerId, status: 'open', posts: [
            { id: input.postId, authorId: context.actor.userId, role: 'learner', text: input.text, createdAt: context.now }
        ] };
}
export function answerQuestion(course, actor, thread, input, now) {
    creator(course, actor);
    scoped(course, thread);
    lessonOf(course, thread.lessonId);
    time(now);
    text(input.id);
    text(input.text);
    require(!thread.posts.some(p => p.id === input.id), 'duplicate_id');
    require(now >= (thread.posts.at(-1)?.createdAt ?? now), 'time_reversed');
    return { ...thread, status: 'answered', posts: [...thread.posts,
            { id: input.id, authorId: actor.userId, role: 'creator', text: input.text, createdAt: now }] };
}
export function followUpQuestion(context, thread, input) {
    access(context, thread.lessonId);
    scoped(context.course, thread);
    text(input.id);
    text(input.text);
    require(thread.enrollmentId === context.enrollment.id && thread.learnerId === context.actor.userId, 'thread_owner_required');
    require(!thread.posts.some(p => p.id === input.id), 'duplicate_id');
    require(context.now >= (thread.posts.at(-1)?.createdAt ?? context.now), 'time_reversed');
    return { ...thread, status: 'open', posts: [...thread.posts,
            { id: input.id, authorId: context.actor.userId, role: 'learner', text: input.text, createdAt: context.now }] };
}
function validateSession(course, session) {
    scoped(course, session);
    integer(session.capacity, 1);
    time(session.startsAt);
    time(session.endsAt);
    require(session.endsAt > session.startsAt, 'invalid_session_time');
    require(lessonOf(course, session.lessonId).kind === 'live', 'live_lesson_required');
    unique(session.participants.map(p => p.learnerId));
    unique(session.participants.map(p => p.enrollmentId));
    require(session.participants.length <= session.capacity, 'capacity_exceeded');
}
export function createLiveSession(course, actor, input) {
    creator(course, actor);
    text(input.id);
    const session = { ...scope(course), ...input, participants: [] };
    validateSession(course, session);
    return session;
}
export function reserveLiveSeat(context, session) {
    access(context, session.lessonId);
    validateSession(context.course, session);
    require(context.now < session.endsAt && session.startsAt >= lessonAvailableAt(lessonOf(context.course, session.lessonId), context.enrollment), 'session_unavailable');
    require((context.enrollment.expiresAt === undefined || session.endsAt <= context.enrollment.expiresAt) &&
        (context.course.closesAt === undefined || session.endsAt <= context.course.closesAt), 'session_outside_access');
    const existing = session.participants.find(p => p.learnerId === context.actor.userId);
    if (existing) {
        require(existing.enrollmentId === context.enrollment.id, 'enrollment_mismatch');
        return session;
    }
    require(session.participants.length < session.capacity, 'capacity_exceeded');
    return { ...session, participants: [...session.participants,
            { enrollmentId: context.enrollment.id, learnerId: context.actor.userId, reservedAt: context.now }] };
}
export function cancelLiveSeat(context, session) {
    own(context);
    scoped(context.course, session);
    time(context.now);
    require(context.now < session.startsAt, 'session_started');
    return { ...session, participants: session.participants.filter(p => !(p.enrollmentId === context.enrollment.id && p.learnerId === context.actor.userId)) };
}
export function recordAttendance(course, actor, session, enrollment, now) {
    creator(course, actor);
    validateSession(course, session);
    scoped(course, enrollment);
    time(now);
    require(now >= session.startsAt && now < session.endsAt, 'session_not_live');
    require(hasCourseAccess(course, enrollment, now), 'course_access_denied');
    const participant = session.participants.find(p => p.enrollmentId === enrollment.id && p.learnerId === enrollment.learnerId);
    require(participant, 'reservation_required');
    if (participant.attendedAt !== undefined)
        return session;
    return { ...session, participants: session.participants.map(p => p === participant ? { ...p, attendedAt: now } : p) };
}
export function evaluateCompletion(context, submissions) {
    const { course } = context;
    const missingLessonIds = course.lessons.filter(l => l.required && !context.progress.some(p => progressFor(context, p) && p.lessonId === l.id && p.completed)).map(l => l.id);
    const missingAssignmentIds = course.assignments.filter(a => a.required && !submissions.some(s => sameScope(course, s) && s.enrollmentId === context.enrollment.id && s.learnerId === context.enrollment.learnerId &&
        s.assignmentId === a.id && s.status === 'accepted' && s.attempts.at(-1)?.feedback?.outcome === 'accepted')).map(a => a.id);
    return { eligible: context.actor.tenantId === course.tenantId && context.actor.userId === context.enrollment.learnerId &&
            hasCourseAccess(course, context.enrollment, context.now) && course.lessons.length > 0 && missingLessonIds.length === 0 && missingAssignmentIds.length === 0,
        missingLessonIds, missingAssignmentIds };
}
export function issueCompletion(context, submissions, id, previous) {
    own(context);
    text(id);
    if (previous) {
        scoped(context.course, previous);
        require(previous.id === id && previous.enrollmentId === context.enrollment.id && previous.learnerId === context.actor.userId, 'completion_mismatch');
        return previous;
    }
    require(evaluateCompletion(context, submissions).eligible, 'completion_requirements_not_met');
    return { ...scope(context.course), id, enrollmentId: context.enrollment.id, learnerId: context.actor.userId,
        completedAt: context.now, requiredLessonIds: context.course.lessons.filter(l => l.required).map(l => l.id),
        requiredAssignmentIds: context.course.assignments.filter(a => a.required).map(a => a.id) };
}
