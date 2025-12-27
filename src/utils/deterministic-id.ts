/**
 * Deterministic ID generation utilities using HMAC-SHA256.
 * Provides reproducible IDs based on seed and context.
 */

/**
 * Generate a deterministic encounter ID using HMAC-SHA256.
 * This ensures that the same seed + context always produces the same ID.
 */
export async function generateDeterministicEncounterId(seed: string, context: string): Promise<string> {
    // Create HMAC key from seed
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(seed),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    // Sign the context to get deterministic bytes
    const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(context)
    );

    // Convert first 8 bytes to a number for the suffix
    const bytes = new Uint8Array(signature.slice(0, 8));
    let suffix = 0;
    for (let i = 0; i < 8; i++) {
        suffix = (suffix * 256) + bytes[i];
    }

    // Ensure it's positive and format as string
    suffix = Math.abs(suffix);

    return `encounter-${seed}-${suffix}`;
}

/**
 * Generate a deterministic random number between 0 and 1 using HMAC-SHA256.
 * This ensures the same seed + context always produces the same result.
 */
export async function deterministicRandom(seed: string, context: string): Promise<number> {
    // Create HMAC key from seed
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(seed),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    // Sign the context to get deterministic bytes
    const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(context)
    );

    // Use first 4 bytes as a uint32, then normalize to [0, 1)
    const bytes = new Uint8Array(signature.slice(0, 4));
    let value = 0;
    for (let i = 0; i < 4; i++) {
        value = (value << 8) + bytes[i];
    }

    // Normalize to [0, 1) range
    return value / 0x100000000;
}