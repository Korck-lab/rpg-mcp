/**
 * Canonical JSON Serialization Utility
 *
 * Provides deterministic JSON serialization for hash computation.
 * Critical for hash chain integrity - the same object must always
 * produce the same JSON string regardless of property insertion order.
 *
 * @module canonical-json
 */

/**
 * Recursively sorts object keys and converts special types to their
 * canonical representations.
 *
 * @param value - The value to canonicalize
 * @returns A new value with sorted keys and canonical type representations
 */
function canonicalize(value: unknown): unknown {
    // Handle null explicitly (typeof null === 'object')
    if (value === null) {
        return null;
    }

    // Handle undefined - will be omitted from objects by JSON.stringify
    if (value === undefined) {
        return undefined;
    }

    // Handle primitives directly
    if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
        return value;
    }

    // Handle BigInt - convert to string representation
    if (typeof value === 'bigint') {
        return value.toString();
    }

    // Handle Date - convert to ISO string
    if (value instanceof Date) {
        return value.toISOString();
    }

    // Handle Arrays - maintain order but canonicalize elements
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }

    // Handle plain objects - sort keys alphabetically
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const sortedKeys = Object.keys(obj).sort();
        const result: Record<string, unknown> = {};

        for (const key of sortedKeys) {
            const canonicalValue = canonicalize(obj[key]);
            // Omit undefined values from objects
            if (canonicalValue !== undefined) {
                result[key] = canonicalValue;
            }
        }

        return result;
    }

    // Handle functions and symbols by returning undefined (will be omitted)
    return undefined;
}

/**
 * Serializes a value to a canonical JSON string with deterministic output.
 *
 * The canonical form guarantees that:
 * - Object keys are sorted alphabetically (recursive)
 * - No whitespace between elements
 * - Arrays maintain their original order (elements are not sorted)
 * - Primitives (null, boolean, number, string) are serialized normally
 * - undefined values are omitted from objects
 * - Date objects are converted to ISO 8601 strings
 * - BigInt values are converted to string representations
 * - Nested objects and arrays are processed recursively
 *
 * This is critical for hash chain integrity - the same logical object
 * must always produce the same JSON string regardless of how the object
 * was constructed or property insertion order.
 *
 * @param obj - The value to serialize
 * @returns A canonical JSON string
 *
 * @example
 * ```typescript
 * // Object keys are sorted alphabetically
 * canonicalStringify({ z: 1, a: 2, m: { c: 3, b: 4 } })
 * // Returns: '{"a":2,"m":{"b":4,"c":3},"z":1}'
 *
 * // Arrays maintain order
 * canonicalStringify({ items: [3, 1, 2] })
 * // Returns: '{"items":[3,1,2]}'
 *
 * // undefined values are omitted
 * canonicalStringify({ a: 1, b: undefined, c: 3 })
 * // Returns: '{"a":1,"c":3}'
 *
 * // Date objects become ISO strings
 * canonicalStringify({ created: new Date('2024-01-15T12:00:00Z') })
 * // Returns: '{"created":"2024-01-15T12:00:00.000Z"}'
 *
 * // BigInt becomes string
 * canonicalStringify({ big: BigInt(9007199254740993) })
 * // Returns: '{"big":"9007199254740993"}'
 * ```
 */
export function canonicalStringify(obj: unknown): string {
    const canonicalized = canonicalize(obj);
    return JSON.stringify(canonicalized);
}

/**
 * Parses a JSON string into a JavaScript value.
 *
 * This is a standard JSON.parse wrapper provided for API symmetry
 * with canonicalStringify. Note that parsing canonical JSON will
 * produce a regular JavaScript object - the canonical ordering
 * is not preserved in the parsed object (JavaScript object property
 * order is implementation-dependent for string keys).
 *
 * @param json - The JSON string to parse
 * @returns The parsed JavaScript value
 * @throws {SyntaxError} If the JSON string is invalid
 *
 * @example
 * ```typescript
 * const obj = canonicalParse('{"a":1,"b":2}');
 * // Returns: { a: 1, b: 2 }
 *
 * const arr = canonicalParse('[1,2,3]');
 * // Returns: [1, 2, 3]
 * ```
 */
export function canonicalParse(json: string): unknown {
    return JSON.parse(json);
}

/**
 * Computes whether two values are canonically equal.
 *
 * Two values are canonically equal if their canonical JSON
 * representations are identical strings.
 *
 * @param a - First value to compare
 * @param b - Second value to compare
 * @returns true if the values have identical canonical representations
 *
 * @example
 * ```typescript
 * // Order doesn't matter for objects
 * canonicalEquals({ a: 1, b: 2 }, { b: 2, a: 1 })
 * // Returns: true
 *
 * // Order matters for arrays
 * canonicalEquals([1, 2], [2, 1])
 * // Returns: false
 * ```
 */
export function canonicalEquals(a: unknown, b: unknown): boolean {
    return canonicalStringify(a) === canonicalStringify(b);
}
