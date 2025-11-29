import nerdamer from 'nerdamer';
import 'nerdamer/Solve'; // Load solve plugin
import 'nerdamer/Algebra'; // Load algebra plugin
import 'nerdamer/Calculus'; // Load calculus plugin just in case
import { CalculationResult } from './schemas';

export class AlgebraEngine {

    solve(equation: string, variable: string): CalculationResult {
        try {
            const solution = (nerdamer as any).solve(equation, variable);
            return {
                input: `solve(${equation}, ${variable})`,
                result: solution.toString(),
                steps: [`Solved for ${variable}`],
                timestamp: new Date().toISOString()
            };
        } catch (error: any) {
            return {
                input: `solve(${equation}, ${variable})`,
                result: 'Error',
                steps: [`Failed to solve: ${error.message}`],
                timestamp: new Date().toISOString()
            };
        }
    }

    simplify(expression: string): CalculationResult {
        try {
            const simplified = nerdamer(expression).toString();
            return {
                input: `simplify(${expression})`,
                result: simplified,
                steps: ['Simplified expression'],
                timestamp: new Date().toISOString()
            };
        } catch (error: any) {
            return {
                input: `simplify(${expression})`,
                result: 'Error',
                steps: [`Failed to simplify: ${error.message}`],
                timestamp: new Date().toISOString()
            };
        }
    }

    substitute(expression: string, variables: Record<string, number | string>): CalculationResult {
        try {
            // Convert all values to strings for nerdamer
            const stringVars: Record<string, string> = {};
            for (const [k, v] of Object.entries(variables)) {
                stringVars[k] = String(v);
            }

            const evaluated = nerdamer(expression, stringVars).evaluate();
            return {
                input: `substitute(${expression}, ${JSON.stringify(variables)})`,
                result: evaluated.text(), // .text() returns string representation of result
                steps: [`Substituted variables: ${JSON.stringify(variables)}`],
                timestamp: new Date().toISOString()
            };
        } catch (error: any) {
            return {
                input: `substitute(${expression}, ${JSON.stringify(variables)})`,
                result: 'Error',
                steps: [`Failed to substitute: ${error.message}`],
                timestamp: new Date().toISOString()
            };
        }
    }

    differentiate(expression: string, variable: string = 'x'): CalculationResult {
        try {
            const result = nerdamer.diff(expression, variable);
            return {
                input: `diff(${expression}, ${variable})`,
                result: result.text(),
                steps: [`Differentiated with respect to ${variable}`],
                timestamp: new Date().toISOString()
            };
        } catch (error: any) {
            return {
                input: `diff(${expression}, ${variable})`,
                result: 'Error',
                steps: [`Failed to differentiate: ${error.message}`],
                timestamp: new Date().toISOString()
            };
        }
    }

    integrate(expression: string, variable: string = 'x'): CalculationResult {
        try {
            const result = nerdamer.integrate(expression, variable);
            return {
                input: `integrate(${expression}, ${variable})`,
                result: result.text(),
                steps: [`Integrate with respect to ${variable}`],
                timestamp: new Date().toISOString()
            };
        } catch (error: any) {
            return {
                input: `integrate(${expression}, ${variable})`,
                result: 'Error',
                steps: [`Failed to integrate: ${error.message}`],
                timestamp: new Date().toISOString()
            };
        }
    }
}
