import { z } from 'zod';

export interface SessionContext {
    sessionId: string;
    userId?: string;
    worldId?: string;
}

// Create wrapper for tool handlers
export function withSession<T extends z.ZodType<any>>(
    schema: T,
    handler: (args: z.infer<T>, ctx: SessionContext) => Promise<any>
) {
    const sessionSchema = z.intersection(
        schema,
        z.object({
            sessionId: z.string().optional().default('default')
        })
    );

    return async (args: unknown) => {
        const parsed = sessionSchema.parse(args);
        // parsed is intersection of T and { sessionId }
        // We can extract sessionId safely
        const sessionId = (parsed as any).sessionId;

        const ctx: SessionContext = { sessionId };
        // We cast parsed back to T's inferred type. 
        // Since parsed is T & { sessionId }, it satisfies T.
        return handler(parsed, ctx);
    };
}
