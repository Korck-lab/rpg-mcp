import { z } from 'zod';
import { DiceEngine } from '../math/dice';
import { ProbabilityEngine } from '../math/probability';
import { AlgebraEngine } from '../math/algebra';
import { PhysicsEngine } from '../math/physics';
import { ExportEngine } from '../math/export';
import { CalculationRepository, StoredCalculation } from '../storage/repos/calculation.repo';
import { getDb } from '../storage';
import { ProbabilityQuerySchema, ExportFormatSchema, CalculationResult } from '../math/schemas';
import { randomUUID } from 'crypto';

function getRepo() {
    const db = getDb(process.env.NODE_ENV === 'test' ? ':memory:' : 'rpg.db');
    return { repo: new CalculationRepository(db), db };
}

function logCalculationEvent(db: any, calculationId: string, type: string, sessionId?: string) {
    db.prepare(`
        INSERT INTO event_logs (type, payload, timestamp)
        VALUES (?, ?, ?)
    `).run('calculation', JSON.stringify({
        calculationId,
        calculationType: type,
        sessionId
    }), new Date().toISOString());
}

// Tool Definitions
export const MathTools = {
    DICE_ROLL: {
        name: 'dice_roll',
        description: 'Roll dice using standard notation (e.g., "2d6+3", "1d20", "4d6dl1"). Supports advantage/disadvantage and exploding dice.',
        inputSchema: z.object({
            expression: z.string(),
            seed: z.string().optional(),
            exportFormat: ExportFormatSchema.optional().default('plaintext')
        })
    },
    PROBABILITY_CALCULATE: {
        name: 'probability_calculate',
        description: 'Calculate probabilities for dice rolls, including distributions and expected values.',
        inputSchema: ProbabilityQuerySchema.extend({
            exportFormat: ExportFormatSchema.optional().default('plaintext')
        })
    },
    ALGEBRA_SOLVE: {
        name: 'algebra_solve',
        description: 'Solve algebraic equations.',
        inputSchema: z.object({
            equation: z.string(),
            variable: z.string().optional(),
            exportFormat: ExportFormatSchema.optional().default('plaintext')
        })
    },
    ALGEBRA_SIMPLIFY: {
        name: 'algebra_simplify',
        description: 'Simplify algebraic expressions.',
        inputSchema: z.object({
            expression: z.string(),
            exportFormat: ExportFormatSchema.optional().default('plaintext')
        })
    },
    PHYSICS_PROJECTILE: {
        name: 'physics_projectile',
        description: 'Calculate projectile motion trajectory.',
        inputSchema: z.object({
            velocity: z.number(),
            angle: z.number(),
            height: z.number().optional().default(0),
            gravity: z.number().optional().default(9.81),
            exportFormat: ExportFormatSchema.optional().default('plaintext')
        })
    }
};

// Handlers

export async function handleDiceRoll(args: z.infer<typeof MathTools.DICE_ROLL.inputSchema> & { sessionId?: string }) {
    const { repo, db } = getRepo();
    const engine = new DiceEngine(args.seed);
    const exporter = new ExportEngine();

    const result = engine.roll(args.expression);

    const calculation: StoredCalculation = {
        id: randomUUID(),
        sessionId: args.sessionId,
        ...result,
        seed: args.seed || result.seed
    };

    repo.create(calculation);
    logCalculationEvent(db, calculation.id, 'dice_roll', args.sessionId);

    return {
        content: [
            {
                type: 'text',
                text: exporter.export(calculation, args.exportFormat)
            }
        ]
    };
}

export async function handleProbabilityCalculate(args: z.infer<typeof MathTools.PROBABILITY_CALCULATE.inputSchema> & { sessionId?: string }) {
    const { repo, db } = getRepo();
    const engine = new ProbabilityEngine();
    const exporter = new ExportEngine();

    // Calculate probability and EV
    const prob = engine.calculateProbability(args.expression, args.target, args.comparison);
    const ev = engine.expectedValue(args.expression);

    const result: CalculationResult = {
        input: JSON.stringify(args),
        result: prob,
        steps: [
            `Probability (${args.comparison} ${args.target}): ${(prob * 100).toFixed(2)}%`,
            `Expected Value: ${ev.toFixed(2)}`
        ],
        timestamp: new Date().toISOString(),
        metadata: { type: 'probability', probability: prob, expectedValue: ev }
    };

    const calculation: StoredCalculation = {
        id: randomUUID(),
        sessionId: args.sessionId,
        ...result
    };

    repo.create(calculation);
    logCalculationEvent(db, calculation.id, 'probability', args.sessionId);

    return {
        content: [
            {
                type: 'text',
                text: exporter.export(calculation, args.exportFormat)
            }
        ]
    };
}

export async function handleAlgebraSolve(args: z.infer<typeof MathTools.ALGEBRA_SOLVE.inputSchema> & { sessionId?: string }) {
    const { repo, db } = getRepo();
    const engine = new AlgebraEngine();
    const exporter = new ExportEngine();

    const result = engine.solve(args.equation, args.variable || 'x');

    const calculation: StoredCalculation = {
        id: randomUUID(),
        sessionId: args.sessionId,
        ...result
    };

    repo.create(calculation);
    logCalculationEvent(db, calculation.id, 'algebra_solve', args.sessionId);

    return {
        content: [
            {
                type: 'text',
                text: exporter.export(calculation, args.exportFormat)
            }
        ]
    };
}

export async function handleAlgebraSimplify(args: z.infer<typeof MathTools.ALGEBRA_SIMPLIFY.inputSchema> & { sessionId?: string }) {
    const { repo, db } = getRepo();
    const engine = new AlgebraEngine();
    const exporter = new ExportEngine();

    const result = engine.simplify(args.expression);

    const calculation: StoredCalculation = {
        id: randomUUID(),
        sessionId: args.sessionId,
        ...result
    };

    repo.create(calculation);
    logCalculationEvent(db, calculation.id, 'algebra_simplify', args.sessionId);

    return {
        content: [
            {
                type: 'text',
                text: exporter.export(calculation, args.exportFormat)
            }
        ]
    };
}

export async function handlePhysicsProjectile(args: z.infer<typeof MathTools.PHYSICS_PROJECTILE.inputSchema> & { sessionId?: string }) {
    const { repo, db } = getRepo();
    const engine = new PhysicsEngine();
    const exporter = new ExportEngine();

    const result = engine.projectile(args.velocity, args.angle, args.gravity, 10, args.height);

    const calculation: StoredCalculation = {
        id: randomUUID(),
        sessionId: args.sessionId,
        ...result
    };

    repo.create(calculation);
    logCalculationEvent(db, calculation.id, 'physics_projectile', args.sessionId);

    return {
        content: [
            {
                type: 'text',
                text: exporter.export(calculation, args.exportFormat)
            }
        ]
    };
}
