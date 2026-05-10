/* tslint:disable */
/* eslint-disable */

/**
 * The main MeCab-Ko tokenizer for WebAssembly
 *
 * This class provides Korean morphological analysis capabilities
 * in JavaScript/TypeScript environments.
 */
export class Mecab {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Extract morphemes (형태소) from text
     *
     * Returns an array of morpheme strings without POS information.
     *
     * # Example (JavaScript)
     *
     * ```javascript
     * const morphs = mecab.morphs("안녕하세요");
     * console.log(morphs); // ["안녕", "하", "세요"]
     * ```
     */
    morphs(text: string): string[];
    /**
     * Create a new Mecab instance with the default dictionary
     *
     * # Example (JavaScript)
     *
     * ```javascript
     * const mecab = new Mecab();
     * ```
     *
     * # Errors
     *
     * Returns an error if tokenizer initialization fails
     */
    constructor();
    /**
     * Extract nouns (명사) from text
     *
     * Returns an array of noun strings.
     *
     * # Example (JavaScript)
     *
     * ```javascript
     * const nouns = mecab.nouns("형태소 분석기입니다");
     * console.log(nouns); // ["형태소", "분석기"]
     * ```
     */
    nouns(text: string): string[];
    /**
     * Extract part-of-speech tagged pairs
     *
     * Returns a JSON string containing an array of [surface, pos] pairs.
     *
     * # Example (JavaScript)
     *
     * ```javascript
     * const posJson = mecab.pos("안녕하세요");
     * const pos = JSON.parse(posJson);
     * console.log(pos); // [["안녕", "NNG"], ["하", "XSV"], ["세요", "EP+EF"]]
     * ```
     *
     * # Errors
     *
     * Returns an error if JSON serialization fails
     */
    pos(text: string): string;
    /**
     * Tokenize text and return detailed token information
     *
     * Returns an array of tokens with surface form, POS tag, and position information.
     *
     * # Example (JavaScript)
     *
     * ```javascript
     * const tokens = mecab.tokenize("안녕하세요");
     * tokens.forEach(token => {
     *   console.log(`${token.surface}: ${token.pos}`);
     * });
     * ```
     */
    tokenize(text: string): WasmToken[];
    /**
     * Perform wakati (분리) tokenization
     *
     * Returns an array of morpheme strings, similar to `morphs()`.
     *
     * # Example (JavaScript)
     *
     * ```javascript
     * const words = mecab.wakati("형태소 분석");
     * console.log(words); // ["형태소", "분석"]
     * ```
     */
    wakati(text: string): string[];
    /**
     * Create a Mecab instance from raw dictionary bytes.
     *
     * Use this in browsers and other filesystem-less environments where
     * `new Mecab()` cannot find the system dictionary on disk. Pass the
     * three required dict files as `Uint8Array` (gunzipped, raw `.bin`
     * content). `char.bin` and `unk.bin` are not needed — the Korean
     * `UnknownHandler` defaults are baked into the WASM binary.
     *
     * # Example (JavaScript)
     *
     * ```javascript
     * const trie    = new Uint8Array(await (await fetch('sys.dic')).arrayBuffer());
     * const matrix  = new Uint8Array(await (await fetch('matrix.bin')).arrayBuffer());
     * const entries = new Uint8Array(await (await fetch('entries.bin')).arrayBuffer());
     * const mecab   = Mecab.withDictBytes(trie, matrix, entries);
     * ```
     *
     * # Errors
     *
     * Returns an error if any of the three byte slices fails to parse.
     */
    static withDictBytes(trie: Uint8Array, matrix: Uint8Array, entries: Uint8Array): Mecab;
}

/**
 * A JavaScript-friendly token representation
 */
export class WasmToken {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Convert to JSON string for easier JavaScript interop
     *
     * # Errors
     *
     * Returns an error if serialization fails
     */
    toJSON(): string;
    /**
     * Get the end position in bytes
     */
    readonly end: number;
    /**
     * Get the lemma/base form (if available)
     */
    readonly lemma: string | undefined;
    /**
     * Get the part-of-speech tag (품사)
     */
    readonly pos: string;
    /**
     * Get the reading (if available)
     */
    readonly reading: string | undefined;
    /**
     * Get the start position in bytes
     */
    readonly start: number;
    /**
     * Get the surface form (표면형)
     */
    readonly surface: string;
}

/**
 * Initialize the WASM module
 *
 * This function should be called once before using the library.
 * It sets up panic hooks for better error messages in development.
 */
export function init(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_mecab_free: (a: number, b: number) => void;
    readonly __wbg_wasmtoken_free: (a: number, b: number) => void;
    readonly mecab_morphs: (a: number, b: number, c: number) => [number, number];
    readonly mecab_new: () => [number, number, number];
    readonly mecab_nouns: (a: number, b: number, c: number) => [number, number];
    readonly mecab_pos: (a: number, b: number, c: number) => [number, number, number, number];
    readonly mecab_tokenize: (a: number, b: number, c: number) => [number, number];
    readonly mecab_wakati: (a: number, b: number, c: number) => [number, number];
    readonly mecab_withDictBytes: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly wasmtoken_end: (a: number) => number;
    readonly wasmtoken_lemma: (a: number) => [number, number];
    readonly wasmtoken_pos: (a: number) => [number, number];
    readonly wasmtoken_reading: (a: number) => [number, number];
    readonly wasmtoken_start: (a: number) => number;
    readonly wasmtoken_surface: (a: number) => [number, number];
    readonly wasmtoken_toJSON: (a: number) => [number, number, number, number];
    readonly init: () => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
