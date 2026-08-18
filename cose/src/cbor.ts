/*
 * Copyright (c) 2026 GraphDefined GmbH <achim.friedland@graphdefined.com>
 * This file is part of Vanaheimr COSE <https://github.com/Vanaheimr/MCBORConformanceTests>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one seam between this COSE implementation and a CBOR codec.
 *
 * COSE is a thin layer over CBOR, and everything delicate about it is a
 * question of exact bytes: what a signature covers, whether an empty protected
 * bucket is `h''` or `h'A0'`, whether a map keeps the order it arrived in.
 * Keeping the codec behind a single module means those questions are answered
 * in one place, and it means this directory can be lifted into a repository of
 * its own by changing the import below to the published package name.
 *
 * The codec is the one from Metrological CBOR, which is a deterministic
 * encoder by default — and that default is wrong here. A COSE message is
 * somebody else's bytes: its header maps are in the order the signer wrote
 * them, and re-sorting them on the way out would invalidate signatures this
 * implementation never touched. Every encode below therefore passes
 * `PRESERVE`, and the one place that does not is the RFC 9679 thumbprint,
 * where deterministic encoding is what the specification asks for.
 */

export { cbor }        from '../../libs/MetrologicalCBOR.TS/src/index.ts';
export type { CborValue } from '../../libs/MetrologicalCBOR.TS/src/index.ts';

import { cbor }        from '../../libs/MetrologicalCBOR.TS/src/index.ts';
import type { CborValue } from '../../libs/MetrologicalCBOR.TS/src/index.ts';


/** One entry of a CBOR map. */
export type CborEntry = readonly [CborValue, CborValue];


/**
 * Encoder options for reproducing foreign bytes: no sorting, no float
 * re-widening. What was read is what is written.
 */
export const PRESERVE = { mapKeys: 'preserve', floats: 'preserve' } as const;


/**
 * Encoder options for the deterministic encoding of RFC 8949 Section 4.2.1,
 * which RFC 9679 requires for a COSE Key Thumbprint.
 */
export const DETERMINISTIC = { mapKeys: 'sorted', floats: 'shortest' } as const;


/** Encode a value as the bytes of a COSE message or structure. */
export const encode = (value: CborValue): Uint8Array =>
    cbor.encode(value, PRESERVE);


/**
 * Decode the bytes of a COSE message.
 *
 * Deliberately not in strict mode: a COSE message arrives from the wire and
 * has to be read as it is. Rejecting a message because its unprotected bucket
 * is not in deterministic order would refuse messages that are perfectly valid
 * COSE — and would refuse them *after* the signature over the protected part
 * would have verified.
 */
export const decode = (data: Uint8Array): CborValue =>
    cbor.decode(data, { strict: false });


/** Whether two byte strings are equal. */
export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {

    if (left.length !== right.length)
        return false;

    for (let index = 0; index < left.length; index++) {
        if (left[index] !== right[index])
            return false;
    }

    return true;

}


/** The empty byte string, which COSE uses rather more often than one expects. */
export const NO_BYTES = new Uint8Array();
