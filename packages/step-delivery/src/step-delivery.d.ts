/** Provider-neutral step delivery. Hosts own authorization, persistence and transport. */
export type DeliveryChannel = 'email' | 'line';
export type DeliveryScalar = string | number | boolean;
export type Condition = {
    type: 'all' | 'any';
    conditions: Condition[];
} | {
    field: 'stage' | 'source' | 'tag' | `attributes.${string}`;
    op: 'eq' | 'neq' | 'in' | 'contains' | 'gte' | 'lte';
    value: DeliveryScalar | DeliveryScalar[];
};
export type Segment = {
    id: string;
    name: string;
    condition: Condition;
};
export type Step = {
    id: string;
    waitDays: number;
    at?: string;
    channel: DeliveryChannel;
    subject: string;
    text: string;
    condition?: Condition;
};
export type Scenario = {
    id: string;
    workspaceId: string;
    name: string;
    version: number;
    state: 'draft' | 'active' | 'paused' | 'canceled';
    trigger: {
        kind: 'inquiry' | 'purchase' | 'tag' | 'form' | 'booking';
        value?: string;
    };
    segment?: Condition;
    steps: Step[];
    sender: {
        name: string;
        address: string;
        contact: string;
    };
    approvedBy?: string;
    approvedAt?: string;
    approvalId?: string;
    approvalRunId?: string;
    digest?: string;
};
export type Enrollment = {
    id: string;
    scenarioId: string;
    contactId: string;
    eventId: string;
    enrolledAt: string;
    state: 'active' | 'completed' | 'stopped';
    next: number;
};
export type DeliveryContact = {
    id: string;
    stage: string | null;
    source: string | null;
    tags: string[];
    attributes: Record<string, DeliveryScalar>;
    erased: boolean;
    channels: Partial<Record<DeliveryChannel, {
        to: string;
        consent: 'granted' | 'withdrawn';
        evidenceId: string;
    }>>;
};
export type DeliveryTrigger = {
    id: string;
    workspaceId: string;
    contactId: string;
    kind: Scenario['trigger']['kind'];
    value?: string;
    occurredAt: string;
};
export type StepJob = {
    id: string;
    workspaceId: string;
    scenarioId: string;
    enrollmentId: string;
    stepId: string;
    dueAt: string;
    scenarioDigest: string;
    stopTokenHash?: string;
    state: 'pending' | 'sending' | 'sent' | 'skipped' | 'uncertain' | 'canceled';
    token?: string;
    leaseUntil?: string;
    attemptedAt?: string;
    reason?: string;
};
export declare class StepDeliveryError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(code: string, status?: number);
}
export declare function requireStep(value: unknown, code?: string, status?: number): asserts value;
export declare const DELIVERY_UUID: RegExp;
export declare function requireDeliveryId(value: unknown): asserts value is string;
export declare function validateDeliveryCondition(input: unknown): Condition;
export declare function matchesDeliveryCondition(contact: DeliveryContact, condition: Condition): boolean;
/** Days are elapsed 24h; an optional clock time is the first JST occurrence at/after that offset. */
export declare function stepDueAt(previousAt: string, step: Pick<Step, 'waitDays' | 'at'>): string;
export declare function validateScenario(input: unknown): Scenario;
export declare function scenarioDigest(scenario: Scenario): Promise<string>;
export declare function eligibleForScenario(scenario: Scenario, event: DeliveryTrigger, contact: DeliveryContact): boolean;
export type StepDeliveryTransaction = {
    scenario(id: string): Promise<Scenario | null>;
    scenarios(): Promise<Scenario[]>;
    saveScenario(value: Scenario, expectedVersion: number | null): Promise<void>;
    enrollment(id: string): Promise<Enrollment | null>;
    findEnrollment(scenarioId: string, contactId: string): Promise<Enrollment | null>;
    saveEnrollment(value: Enrollment): Promise<void>;
    contact(id: string): Promise<DeliveryContact | null>;
    job(id: string): Promise<StepJob | null>;
    saveJob(value: StepJob): Promise<void>;
    due(now: string, limit: number): Promise<StepJob[]>;
};
export type StepDeliveryStore = {
    transaction<T>(workspaceId: string, fn: (tx: StepDeliveryTransaction) => Promise<T>): Promise<T>;
};
export type StepSend = {
    job: StepJob;
    scenario: Scenario;
    enrollment: Enrollment;
    step: Step;
    contact: DeliveryContact;
};
export type StepTransport = {
    send(input: StepSend): Promise<'accepted' | 'rejected' | 'uncertain'>;
};
/** All state mutations are serialized by the host. Network work is outside transactions. */
export declare class StepDeliveryEngine {
    private store;
    private transport;
    private now;
    constructor(store: StepDeliveryStore, transport: StepTransport, now?: () => string);
    saveDraft(scenario: Scenario): Promise<void>;
    activate(workspaceId: string, id: string, version: number, actorId: string): Promise<{
        state: "active";
        version: number;
        approvalId: string;
        approvalRunId: string;
        approvedBy: string;
        approvedAt: string;
        digest: string;
        id: string;
        workspaceId: string;
        name: string;
        trigger: {
            kind: "inquiry" | "purchase" | "tag" | "form" | "booking";
            value?: string;
        };
        segment?: Condition;
        steps: Step[];
        sender: {
            name: string;
            address: string;
            contact: string;
        };
    }>;
    pause(workspaceId: string, id: string, version: number): Promise<void>;
    enroll(event: DeliveryTrigger): Promise<number>;
    tick(workspaceId: string, limit?: number): Promise<{
        sent: number;
        skipped: number;
        uncertain: number;
        processed: number;
    }>;
    private advance;
}
