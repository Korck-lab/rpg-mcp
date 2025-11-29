import seedrandom from 'seedrandom';
import { DiceExpression, CalculationResult } from './schemas';

export class DiceEngine {
    private rng: seedrandom.PRNG;
    private seed: string;

    constructor(seed?: string) {
        this.seed = seed || new Date().toISOString();
        this.rng = seedrandom(this.seed);
    }

    // Parse string "2d6+4" into DiceExpression object
    parse(expression: string): DiceExpression {
        // Simple regex parse
        // Supports: NdX, NdX+M, NdX-M, NdX!
        const match = expression.match(/^(\d+)d(\d+)(?:([+-]\d+))?(!)?$/);
        if (!match) {
            throw new Error(`Invalid dice expression: ${expression}`);
        }

        const count = parseInt(match[1], 10);
        const sides = parseInt(match[2], 10);
        const modifier = match[3] ? parseInt(match[3], 10) : 0;
        const explode = !!match[4];

        return {
            count,
            sides,
            modifier,
            explode
        };
    }

    roll(expression: string | DiceExpression): CalculationResult {
        const expr = typeof expression === 'string' ? this.parse(expression) : expression;
        const rolls: number[] = [];
        const steps: string[] = [];

        let total = 0;

        // Advantage/Disadvantage logic would typically be handled by rolling twice
        // but here we just implement standard rolling.
        // If advantage is requested, the caller should probably call roll twice or we extend this.
        // The schema has advantage/disadvantage flags, so let's support them if passed in object.

        if (expr.advantage || expr.disadvantage) {
            // Roll two sets
            const set1 = this.rollSet(expr);
            const set2 = this.rollSet(expr);

            steps.push(`Roll 1: [${set1.rolls.join(', ')}] = ${set1.sum}`);
            steps.push(`Roll 2: [${set2.rolls.join(', ')}] = ${set2.sum}`);

            let chosenSet;
            if (expr.advantage) {
                chosenSet = set1.sum >= set2.sum ? set1 : set2;
                steps.push(`Advantage: Taken ${chosenSet.sum}`);
            } else {
                chosenSet = set1.sum <= set2.sum ? set1 : set2;
                steps.push(`Disadvantage: Taken ${chosenSet.sum}`);
            }

            total = chosenSet.sum + expr.modifier;
            steps.push(`Total: ${chosenSet.sum} + ${expr.modifier} = ${total}`);
            rolls.push(...chosenSet.rolls); // This is ambiguous, maybe we should store structure
        } else {
            const set = this.rollSet(expr);
            rolls.push(...set.rolls);
            total = set.sum + expr.modifier;
            steps.push(`Rolled ${expr.count}d${expr.sides}: [${set.rolls.join(', ')}]`);
            if (expr.modifier !== 0) {
                steps.push(`Modifier: ${expr.modifier}`);
                steps.push(`Total: ${set.sum} + ${expr.modifier} = ${total}`);
            } else {
                steps.push(`Total: ${total}`);
            }
        }

        return {
            input: typeof expression === 'string' ? expression : `${expr.count}d${expr.sides}${expr.modifier >= 0 ? '+' : ''}${expr.modifier}`,
            result: total,
            steps,
            timestamp: new Date().toISOString(),
            seed: this.seed,
            metadata: { rolls }
        };
    }

    private rollSet(expr: DiceExpression): { rolls: number[], sum: number } {
        const rolls: number[] = [];
        let sum = 0;

        for (let i = 0; i < expr.count; i++) {
            let roll = Math.floor(this.rng() * expr.sides) + 1;
            rolls.push(roll);
            sum += roll;

            if (expr.explode && roll === expr.sides) {
                // Explode!
                let exploded = roll;
                while (exploded === expr.sides) {
                    exploded = Math.floor(this.rng() * expr.sides) + 1;
                    rolls.push(exploded);
                    sum += exploded;
                }
            }
        }
        return { rolls, sum };
    }
}
