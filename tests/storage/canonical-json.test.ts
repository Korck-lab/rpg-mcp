import { describe, it, expect } from 'vitest';
import {
    canonicalStringify,
    canonicalParse,
    canonicalEquals
} from '../../src/storage/utils/canonical-json.js';

describe('canonicalStringify', () => {
    describe('primitive values', () => {
        it('should serialize null', () => {
            expect(canonicalStringify(null)).toBe('null');
        });

        it('should serialize booleans', () => {
            expect(canonicalStringify(true)).toBe('true');
            expect(canonicalStringify(false)).toBe('false');
        });

        it('should serialize numbers', () => {
            expect(canonicalStringify(42)).toBe('42');
            expect(canonicalStringify(3.14)).toBe('3.14');
            expect(canonicalStringify(-100)).toBe('-100');
            expect(canonicalStringify(0)).toBe('0');
        });

        it('should serialize strings', () => {
            expect(canonicalStringify('hello')).toBe('"hello"');
            expect(canonicalStringify('')).toBe('""');
            expect(canonicalStringify('with "quotes"')).toBe('"with \\"quotes\\""');
        });
    });

    describe('object key sorting', () => {
        it('should sort object keys alphabetically', () => {
            const obj = { z: 1, a: 2, m: 3 };
            expect(canonicalStringify(obj)).toBe('{"a":2,"m":3,"z":1}');
        });

        it('should sort nested object keys', () => {
            const obj = { z: 1, a: 2, m: { c: 3, b: 4 } };
            expect(canonicalStringify(obj)).toBe('{"a":2,"m":{"b":4,"c":3},"z":1}');
        });

        it('should handle deeply nested objects', () => {
            const obj = {
                z: {
                    y: {
                        x: 1,
                        a: 2
                    },
                    b: 3
                },
                a: 4
            };
            expect(canonicalStringify(obj)).toBe('{"a":4,"z":{"b":3,"y":{"a":2,"x":1}}}');
        });

        it('should produce same output regardless of insertion order', () => {
            const obj1: Record<string, number> = {};
            obj1.z = 1;
            obj1.a = 2;
            obj1.m = 3;

            const obj2: Record<string, number> = {};
            obj2.a = 2;
            obj2.m = 3;
            obj2.z = 1;

            const obj3: Record<string, number> = {};
            obj3.m = 3;
            obj3.z = 1;
            obj3.a = 2;

            const result1 = canonicalStringify(obj1);
            const result2 = canonicalStringify(obj2);
            const result3 = canonicalStringify(obj3);

            expect(result1).toBe(result2);
            expect(result2).toBe(result3);
            expect(result1).toBe('{"a":2,"m":3,"z":1}');
        });
    });

    describe('arrays', () => {
        it('should maintain array order (not sort elements)', () => {
            expect(canonicalStringify([3, 1, 2])).toBe('[3,1,2]');
            expect(canonicalStringify(['c', 'a', 'b'])).toBe('["c","a","b"]');
        });

        it('should handle nested arrays', () => {
            expect(canonicalStringify([[3, 2], [1, 0]])).toBe('[[3,2],[1,0]]');
        });

        it('should handle empty arrays', () => {
            expect(canonicalStringify([])).toBe('[]');
        });

        it('should sort keys in objects within arrays', () => {
            const arr = [{ z: 1, a: 2 }, { y: 3, b: 4 }];
            expect(canonicalStringify(arr)).toBe('[{"a":2,"z":1},{"b":4,"y":3}]');
        });
    });

    describe('undefined handling', () => {
        it('should omit undefined values from objects', () => {
            const obj = { a: 1, b: undefined, c: 3 };
            expect(canonicalStringify(obj)).toBe('{"a":1,"c":3}');
        });

        it('should convert undefined to null in arrays', () => {
            // JSON.stringify converts undefined array elements to null
            expect(canonicalStringify([1, undefined, 3])).toBe('[1,null,3]');
        });

        it('should handle nested undefined values', () => {
            const obj = { a: { b: undefined, c: 1 }, d: 2 };
            expect(canonicalStringify(obj)).toBe('{"a":{"c":1},"d":2}');
        });
    });

    describe('special types', () => {
        it('should convert Date to ISO string', () => {
            const date = new Date('2024-01-15T12:00:00.000Z');
            const result = canonicalStringify({ created: date });
            expect(result).toBe('{"created":"2024-01-15T12:00:00.000Z"}');
        });

        it('should convert BigInt to string', () => {
            const big = BigInt('9007199254740993');
            const result = canonicalStringify({ big });
            expect(result).toBe('{"big":"9007199254740993"}');
        });

        it('should handle BigInt in arrays', () => {
            const result = canonicalStringify([BigInt(1), BigInt(2)]);
            expect(result).toBe('["1","2"]');
        });
    });

    describe('no whitespace', () => {
        it('should produce compact JSON with no extra whitespace', () => {
            const obj = { a: [1, 2, 3], b: { c: 4 } };
            const result = canonicalStringify(obj);
            expect(result).not.toContain(' ');
            expect(result).not.toContain('\n');
            expect(result).not.toContain('\t');
            expect(result).toBe('{"a":[1,2,3],"b":{"c":4}}');
        });
    });

    describe('complex objects', () => {
        it('should handle mixed nested structures', () => {
            const obj = {
                users: [
                    { name: 'Alice', id: 2 },
                    { name: 'Bob', id: 1 }
                ],
                meta: {
                    version: 1,
                    active: true
                }
            };
            expect(canonicalStringify(obj)).toBe(
                '{"meta":{"active":true,"version":1},"users":[{"id":2,"name":"Alice"},{"id":1,"name":"Bob"}]}'
            );
        });

        it('should handle empty objects', () => {
            expect(canonicalStringify({})).toBe('{}');
        });
    });

    describe('hash chain integrity', () => {
        it('should produce deterministic output for event payloads', () => {
            // Simulate a game event payload
            const event = {
                type: 'DAMAGE_DEALT',
                timestamp: '2024-01-15T12:00:00.000Z',
                source: { id: 'char_001', name: 'Fighter' },
                target: { id: 'mob_001', name: 'Goblin' },
                damage: { amount: 8, type: 'slashing' }
            };

            // Create same event with different property order
            const eventReordered = {
                damage: { type: 'slashing', amount: 8 },
                target: { name: 'Goblin', id: 'mob_001' },
                source: { name: 'Fighter', id: 'char_001' },
                timestamp: '2024-01-15T12:00:00.000Z',
                type: 'DAMAGE_DEALT'
            };

            expect(canonicalStringify(event)).toBe(canonicalStringify(eventReordered));
        });

        it('should produce consistent output for audit logs', () => {
            const log1 = {
                action: 'CREATE_CHARACTER',
                actorId: 'player_001',
                targetId: 'char_001',
                details: { class: 'fighter', level: 1 },
                timestamp: '2024-01-15T12:00:00.000Z'
            };

            const log2 = {
                timestamp: '2024-01-15T12:00:00.000Z',
                details: { level: 1, class: 'fighter' },
                targetId: 'char_001',
                actorId: 'player_001',
                action: 'CREATE_CHARACTER'
            };

            expect(canonicalStringify(log1)).toBe(canonicalStringify(log2));
        });
    });
});

describe('canonicalParse', () => {
    it('should parse valid JSON', () => {
        expect(canonicalParse('{"a":1,"b":2}')).toEqual({ a: 1, b: 2 });
        expect(canonicalParse('[1,2,3]')).toEqual([1, 2, 3]);
        expect(canonicalParse('null')).toBeNull();
        expect(canonicalParse('true')).toBe(true);
        expect(canonicalParse('"hello"')).toBe('hello');
    });

    it('should throw on invalid JSON', () => {
        expect(() => canonicalParse('{')).toThrow(SyntaxError);
        expect(() => canonicalParse('undefined')).toThrow(SyntaxError);
    });

    it('should round-trip with canonicalStringify', () => {
        const obj = { z: 1, a: 2, nested: { c: 3, b: 4 } };
        const json = canonicalStringify(obj);
        const parsed = canonicalParse(json);
        expect(parsed).toEqual({ a: 2, z: 1, nested: { b: 4, c: 3 } });
    });
});

describe('canonicalEquals', () => {
    it('should return true for canonically equal objects', () => {
        expect(canonicalEquals({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
        expect(canonicalEquals(
            { nested: { z: 1, a: 2 } },
            { nested: { a: 2, z: 1 } }
        )).toBe(true);
    });

    it('should return false for different objects', () => {
        expect(canonicalEquals({ a: 1 }, { a: 2 })).toBe(false);
        expect(canonicalEquals({ a: 1 }, { b: 1 })).toBe(false);
    });

    it('should return false for arrays with different order', () => {
        expect(canonicalEquals([1, 2], [2, 1])).toBe(false);
    });

    it('should return true for identical arrays', () => {
        expect(canonicalEquals([1, 2, 3], [1, 2, 3])).toBe(true);
    });

    it('should return true for primitives', () => {
        expect(canonicalEquals(42, 42)).toBe(true);
        expect(canonicalEquals('hello', 'hello')).toBe(true);
        expect(canonicalEquals(null, null)).toBe(true);
    });
});
