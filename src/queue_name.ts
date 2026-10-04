export const MAX_QUEUE_NAME_LENGTH = 128;

export class InvalidQueueNameError extends Error {
    constructor(message: string = "Invalid queue name") {
        super(message);
        this.name = "InvalidQueueNameError";
    }
}

export class QueueNameTooLongError extends Error {
    constructor(message: string = "Queue name too long") {
        super(message);
        this.name = "QueueNameTooLongError";
    }
}

/**
 * Checks an already-decoded Queue name against the domain rules: it must be
 * non-empty and at most MAX_QUEUE_NAME_LENGTH Unicode code points long.
 */
export function validateQueueName(name: string): string {
    if (name === "") {
        throw new InvalidQueueNameError();
    }
    if (Array.from(name).length > MAX_QUEUE_NAME_LENGTH) {
        throw new QueueNameTooLongError();
    }
    return name;
}

/**
 * Percent-decodes a raw Queue name without applying the length rule.
 * Callers that decode with this must validate the name before use.
 */
export function decodeQueueName(raw: string | undefined): string {
    if (raw === undefined) {
        throw new InvalidQueueNameError();
    }
    try {
        return decodeURIComponent(raw);
    } catch (error) {
        if (error instanceof URIError) {
            throw new InvalidQueueNameError();
        }
        throw error;
    }
}

/**
 * Parses a raw, percent-encoded Queue name (e.g. a URL path segment) into a
 * validated Queue name.
 */
export function parseQueueName(raw: string | undefined): string {
    return validateQueueName(decodeQueueName(raw));
}
