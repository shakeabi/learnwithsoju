/* @ts-self-types="./mecab_ko_wasm.d.ts" */

/**
 * The main MeCab-Ko tokenizer for WebAssembly
 *
 * This class provides Korean morphological analysis capabilities
 * in JavaScript/TypeScript environments.
 */
export class Mecab {
    static __wrap(ptr) {
        const obj = Object.create(Mecab.prototype);
        obj.__wbg_ptr = ptr;
        MecabFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MecabFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_mecab_free(ptr, 0);
    }
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
     * @param {string} text
     * @returns {string[]}
     */
    morphs(text) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.mecab_morphs(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
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
    constructor() {
        const ret = wasm.mecab_new();
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        MecabFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
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
     * @param {string} text
     * @returns {string[]}
     */
    nouns(text) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.mecab_nouns(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
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
     * @param {string} text
     * @returns {string}
     */
    pos(text) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.mecab_pos(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
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
     * @param {string} text
     * @returns {WasmToken[]}
     */
    tokenize(text) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.mecab_tokenize(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * N-best 형태소 분석
     *
     * Returns up to `n` candidate paths as a JS array of
     * `{ tokens: WasmToken[], cost: number }` objects, sorted by cost ascending.
     * Use this to surface alternative analyses for ambiguous words.
     *
     * # Example (JavaScript)
     *
     * ```javascript
     * const paths = mecab.tokenize_nbest("아버지가방에들어가신다", 3);
     * paths.forEach(({ tokens, cost }) => {
     *   console.log(cost, tokens.map(t => `${t.surface}/${t.pos}`).join(" "));
     * });
     * ```
     *
     * # Errors
     *
     * Returns an error if the JS array/object construction fails.
     * @param {string} text
     * @param {number} n
     * @returns {any}
     */
    tokenize_nbest(text, n) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.mecab_tokenize_nbest(this.__wbg_ptr, ptr0, len0, n);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
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
     * @param {string} text
     * @returns {string[]}
     */
    wakati(text) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.mecab_wakati(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
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
     * @param {Uint8Array} trie
     * @param {Uint8Array} matrix
     * @param {Uint8Array} entries
     * @returns {Mecab}
     */
    static withDictBytes(trie, matrix, entries) {
        const ptr0 = passArray8ToWasm0(trie, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(matrix, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(entries, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.mecab_withDictBytes(ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Mecab.__wrap(ret[0]);
    }
}
if (Symbol.dispose) Mecab.prototype[Symbol.dispose] = Mecab.prototype.free;

/**
 * A JavaScript-friendly token representation
 */
export class WasmToken {
    static __wrap(ptr) {
        const obj = Object.create(WasmToken.prototype);
        obj.__wbg_ptr = ptr;
        WasmTokenFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmTokenFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmtoken_free(ptr, 0);
    }
    /**
     * Get the end position in bytes
     * @returns {number}
     */
    get end() {
        const ret = wasm.wasmtoken_end(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get the full raw CSV feature string from the dictionary entry.
     *
     * Format: `pos,semantic,jongseong,reading,type,first_pos,last_pos,decomposition`.
     * For Inflect-type tokens (e.g. `걸려` from `걸리다 + 어`), index 7
     * holds the morpheme breakdown like `걸리/VV/*+어/EC/*`. The `lemma`
     * getter only surfaces the reading at index 3; callers needing the
     * actual dictionary stem must parse `features` themselves.
     * @returns {string}
     */
    get features() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmtoken_features(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Get the lemma/base form (if available)
     * @returns {string | undefined}
     */
    get lemma() {
        const ret = wasm.wasmtoken_lemma(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Get the part-of-speech tag (품사)
     * @returns {string}
     */
    get pos() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmtoken_pos(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Get the reading (if available)
     * @returns {string | undefined}
     */
    get reading() {
        const ret = wasm.wasmtoken_reading(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Get the start position in bytes
     * @returns {number}
     */
    get start() {
        const ret = wasm.wasmtoken_start(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get the surface form (표면형)
     * @returns {string}
     */
    get surface() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmtoken_surface(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Convert to JSON string for easier JavaScript interop
     *
     * # Errors
     *
     * Returns an error if serialization fails
     * @returns {string}
     */
    toJSON() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.wasmtoken_toJSON(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
}
if (Symbol.dispose) WasmToken.prototype[Symbol.dispose] = WasmToken.prototype.free;

/**
 * Initialize the WASM module
 *
 * This function should be called once before using the library.
 * It sets up panic hooks for better error messages in development.
 */
export function init() {
    wasm.init();
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_9c31b086c2b26051: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_error_a6fa202b58aa1cd3: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_new_02d162bc6cf02f60: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_227d7c05414eb861: function() {
            const ret = new Error();
            return ret;
        },
        __wbg_new_310879b66b6e95e1: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_push_b77c476b01548d0a: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_set_a0e911be3da02782: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_wasmtoken_new: function(arg0) {
            const ret = WasmToken.__wrap(arg0);
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./mecab_ko_wasm_bg.js": import0,
    };
}

const MecabFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_mecab_free(ptr, 1));
const WasmTokenFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmtoken_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('mecab_ko_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
