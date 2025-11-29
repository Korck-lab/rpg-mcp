import { CalculationResult } from './schemas';

export class PhysicsEngine {

    // Projectile motion
    // Returns array of points {x, y, t}
    projectile(v0: number, angleDeg: number, gravity: number = 9.81, steps: number = 10, initialHeight: number = 0): CalculationResult {
        const angleRad = angleDeg * (Math.PI / 180);
        const vx = v0 * Math.cos(angleRad);
        const vy = v0 * Math.sin(angleRad);

        // Time of flight: solve 0 = h + vy*t - 0.5*g*t^2
        // 0.5*g*t^2 - vy*t - h = 0
        // t = (vy + sqrt(vy^2 - 4(0.5g)(-h))) / (2*0.5g)
        // t = (vy + sqrt(vy^2 + 2gh)) / g
        const totalTime = (vy + Math.sqrt(vy * vy + 2 * gravity * initialHeight)) / gravity;

        const points: { t: number, x: number, y: number }[] = [];
        const dt = totalTime / steps;

        for (let i = 0; i <= steps; i++) {
            const t = i * dt;
            const x = vx * t;
            const y = initialHeight + vy * t - 0.5 * gravity * t * t;
            points.push({ t: Number(t.toFixed(2)), x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) });
        }

        const maxHeight = initialHeight + (vy * vy) / (2 * gravity);
        const range = vx * totalTime;

        return {
            input: `projectile(v0=${v0}, angle=${angleDeg}, g=${gravity}, h=${initialHeight})`,
            result: JSON.stringify(points),
            steps: [
                `Initial Velocity: ${v0} m/s`,
                `Angle: ${angleDeg} deg`,
                `Initial Height: ${initialHeight} m`,
                `Total Time: ${totalTime.toFixed(2)} s`,
                `Max Height: ${maxHeight.toFixed(2)} m`,
                `Range: ${range.toFixed(2)} m`
            ],
            timestamp: new Date().toISOString(),
            metadata: { points, maxHeight, range, flightTime: totalTime }
        };
    }

    // Kinematics (SUVAT)
    // s = ut + 0.5at^2
    // v = u + at
    // v^2 = u^2 + 2as
    // s = 0.5(u+v)t
    // s = vt - 0.5at^2
    // Params: u (initial velocity), v (final velocity), a (acceleration), t (time), s (displacement)
    // Pass object with knowns, solves for unknowns if possible.
    kinematics(params: { u?: number, v?: number, a?: number, t?: number, s?: number }): CalculationResult {
        const { u, v, a, t, s } = params;
        const results: any = { ...params };
        const steps: string[] = [];

        // Iterative solving (simple pass)
        // We need at least 3 knowns to solve for the other 2.

        // 1. v = u + at
        if (v === undefined && u !== undefined && a !== undefined && t !== undefined) {
            results.v = u + a * t;
            steps.push(`v = u + at => ${u} + ${a}*${t} = ${results.v}`);
        }
        if (u === undefined && v !== undefined && a !== undefined && t !== undefined) {
            results.u = v - a * t;
            steps.push(`u = v - at => ${v} - ${a}*${t} = ${results.u}`);
        }
        if (t === undefined && v !== undefined && u !== undefined && a !== undefined && a !== 0) {
            results.t = (v - u) / a;
            steps.push(`t = (v - u) / a => (${v} - ${u}) / ${a} = ${results.t}`);
        }
        if (a === undefined && v !== undefined && u !== undefined && t !== undefined && t !== 0) {
            results.a = (v - u) / t;
            steps.push(`a = (v - u) / t => (${v} - ${u}) / ${t} = ${results.a}`);
        }

        // 2. s = ut + 0.5at^2
        if (s === undefined && u !== undefined && t !== undefined && a !== undefined) {
            results.s = u * t + 0.5 * a * t * t;
            steps.push(`s = ut + 0.5at^2 => ${u}*${t} + 0.5*${a}*${t}^2 = ${results.s}`);
        }

        // 3. v^2 = u^2 + 2as
        if (v === undefined && u !== undefined && a !== undefined && s !== undefined) {
            const v2 = u * u + 2 * a * s;
            results.v = Math.sqrt(v2);
            steps.push(`v^2 = u^2 + 2as => ${u}^2 + 2*${a}*${s} = ${v2} => v = ${results.v}`);
        }

        return {
            input: `kinematics(${JSON.stringify(params)})`,
            result: JSON.stringify(results),
            steps,
            timestamp: new Date().toISOString()
        };
    }
}
