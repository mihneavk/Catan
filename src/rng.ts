/**
 * Deterministic pseudo-random number generator (mulberry32).
 *
 * The Catan board is generated from a single numeric seed so that every peer
 * in a multiplayer room builds the exact same terrain/number/port layout.
 */
export class SeededRandom {
    private state: number;

    constructor(seed: number) {
        // Ensure a non-zero 32-bit state.
        this.state = (seed >>> 0) || 0x9e3779b9;
    }

    /** Float in the range [0, 1). */
    next(): number {
        this.state = (this.state + 0x6d2b79f5) >>> 0;
        let t = this.state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** Integer in the range [min, max] inclusive. */
    between(min: number, max: number): number {
        return min + Math.floor(this.next() * (max - min + 1));
    }

    /** Fisher-Yates shuffle that consumes this generator (deterministic). */
    shuffle<T>(array: T[]): T[] {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            const tmp = array[i];
            array[i] = array[j];
            array[j] = tmp;
        }
        return array;
    }

    /** Picks one element at random from a non-empty array. */
    pick<T>(array: T[]): T {
        return array[Math.floor(this.next() * array.length)];
    }
}

/** Generates a random 32-bit seed (used by the host for a fresh board). */
export function createRandomSeed(): number {
    return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
}

/** Converts an arbitrary string into a 32-bit seed (room id -> seed). */
export function hashSeed(input: string): number {
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
}
