import { CalculationResult, ExportFormat } from './schemas.js';
import nerdamer from 'nerdamer';

export class ExportEngine {

    export(result: CalculationResult, format: ExportFormat): string {
        switch (format) {
            case 'latex':
                return this.toLatex(result);
            case 'mathml':
                return this.toMathML(result);
            case 'plaintext':
                return this.toPlaintext(result);
            case 'steps':
                return this.toSteps(result);
            case 'json':
                return JSON.stringify(result);
            default:
                throw new Error(`Unsupported export format: ${format}`);
        }
    }

    private toLatex(result: CalculationResult): string {
        // If result is algebraic string, try to convert to latex using nerdamer
        if (typeof result.result === 'string' && !result.result.startsWith('{')) {
            try {
                return nerdamer(result.result).toTeX();
            } catch {
                return result.result;
            }
        }
        return String(result.result);
    }

    private toMathML(result: CalculationResult): string {
        // Basic MathML wrapper or use nerdamer if possible (nerdamer doesn't do MathML natively easily without plugin?)
        // Actually nerdamer doesn't have toMathML.
        // Let's do a very basic wrapper or just return plaintext in math tags for now.
        // Or we can assume it's simple.
        return `<math xmlns="http://www.w3.org/1998/Math/MathML"><mtext>${result.result}</mtext></math>`;
    }

    private toPlaintext(result: CalculationResult): string {
        return String(result.result);
    }

    private toSteps(result: CalculationResult): string {
        const header = `Input: ${result.input}\nResult: ${result.result}\n\nSteps:\n`;
        const steps = result.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
        return header + steps;
    }
}
