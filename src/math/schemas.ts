import { z } from 'zod';

// Phase 1.1: DiceExpression schema
// Regex for NdX+M or NdX-M or just NdX
// Also supports advantage/disadvantage flags if we want to parse them from string,
// but usually they are separate params. The task says "parse to {count, sides, modifier, advantage?}"
// so we might need a transform or just a structured object schema.
// The hint says: "Zod regex for NdX+M".
// Let's define a string schema that validates the format, and a transformer if needed.
// But for now, let's define the structured object that the string parses INTO.

export const DiceExpressionSchema = z.object({
    count: z.number().int().min(1),
    sides: z.number().int().min(1),
    modifier: z.number().int().default(0),
    advantage: z.boolean().optional(),
    disadvantage: z.boolean().optional(),
    explode: z.boolean().optional()
});

export type DiceExpression = z.infer<typeof DiceExpressionSchema>;

// Helper to validate string format "NdX+M"
export const DiceStringSchema = z.string().regex(/^(\d+)d(\d+)([+-]\d+)?(!)?$/, {
    message: "Invalid dice format. Expected format like '2d6', '1d20+5', '3d8-2', '2d6!'"
});

// Phase 1.2: CalculationResult schema
export const CalculationResultSchema = z.object({
    input: z.string(),
    result: z.union([z.number(), z.string()]), // Result can be a number or a string (e.g. algebraic)
    steps: z.array(z.string()).default([]),
    timestamp: z.string().datetime(),
    seed: z.string().optional(),
    metadata: z.record(z.unknown()).optional()
});

export type CalculationResult = z.infer<typeof CalculationResultSchema>;

// Phase 1.3: ProbabilityQuery schema
export const ProbabilityQuerySchema = z.object({
    expression: z.string(), // e.g. "1d20+5"
    target: z.number(),
    comparison: z.enum(['gte', 'lte', 'eq', 'gt', 'lt']).default('gte'),
    modifiers: z.array(z.number()).default([])
});

export type ProbabilityQuery = z.infer<typeof ProbabilityQuerySchema>;

// Phase 1.4: ExportFormat enum
export const ExportFormatSchema = z.enum(['latex', 'mathml', 'plaintext', 'steps']);

export type ExportFormat = z.infer<typeof ExportFormatSchema>;
