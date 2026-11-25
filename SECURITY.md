# Security: Sensitive Data Handling

This document defines how `pear-wrk-wdk` handles secret material in
memory and across its RPC boundaries — the seed, the BIP-39 mnemonic and
entropy it's derived from, and the encryption keys used to protect them
at rest. It is the single source of truth for who owns cleanup of a given
buffer, where secrets may and may not exist as strings, and where they
may and may not be logged.

If you're changing anything that touches a seed, mnemonic, entropy, or
encryption key, read this first.

## Reporting a vulnerability

- **User funds at risk** — submit through the [Tether Bug Bounty](https://tether.to/en/bug-bounty/). Do not open a public issue.
- **Behavioural or informational** — open a [GitHub issue](https://github.com/tetherto/pear-wrk-wdk/issues/new).

## Scope

Treated as sensitive throughout this codebase:

- the BIP-39 **mnemonic** phrase
- the derived **seed** (64 bytes, via `mnemonicToSeedSync`)
- the raw **entropy** it was generated from
- the **encryption key** used to encrypt the seed/entropy for storage/transit
- the **encrypted** seed/entropy blobs themselves (lower sensitivity than
  the plaintext, but still handled deliberately — see "No caching," below)
- **`callMethod`/`callModule` args and results** — these can carry bare
  secrets and, unlike the fields above, can't be redacted by name; treat
  them as sensitive by default
- the **worklet config** — commonly carries provider API keys
- the **seed handed to generic module factories** at construction time

## The core rule: allocator owns cleanup

**A function only zeroes a buffer it allocated itself. It never destroys a
buffer it was merely handed as a parameter.** That's the rule for
primitives (`src/utils/crypto.js`). Handlers (`src/handlers/*.js`) go
further: they own every inbound request buffer *and* everything they
allocate, and zero all of it before returning — on every path, not just
the happy one.

`WDK` and the `wdk-wallet-*` packages already follow the primitives rule.
`pear-wrk-wdk` applies it internally too, concretely in `src/utils/crypto.js`:

| Function | Zeroes | Does *not* zero |
|---|---|---|
| `encrypt(data, key)` | `iv`, `encrypted`, `authTag`; the internal copy of `data` *if* one had to be made (`Uint8Array` input) | `key` (may be reused across calls); a `Buffer` `data` passed in directly; the returned `result` |
| `decrypt(encryptedBuffer, key)` | the internal `decipher.update()`/`.final()` intermediates | `encryptedBuffer`, `key`, and the returned plaintext — all caller-owned |
| `encryptSecrets(seed, entropy)` | the internal `Buffer` copy of `seed`/`entropy` *if* one had to be made; also `encryptionKeyBuffer` and the first `encryptedSeedBuffer`, if the second internal `encrypt()` call fails | a `Buffer` `seed`/`entropy` passed in directly; the three returned values, on success |

Each function's JSDoc states these contracts explicitly, and every listed
cleanup runs inside a `try`/`finally` — never conditional on the happy path.

For the handler rule above, the discipline is `createSecretScope()`
(`src/utils/secret-scope.js`): track a buffer where it's created or
received, `release()` only the ones being returned or handed off, and
`close()` it in a `finally`. Zeroing becomes a property of the scope
itself, not something hand-traced through every branch a handler can
exit from — which is what made it easy to miss in the first place.

Because of this rule, **callers must zero what they own**.

## The buffer boundary: HRPC vs. bare-rpc

- **Buffer is the first-class representation for secret material.**
  Secret-bearing fields are declared as `buffer` in `schema.json`, not
  `string`, wherever possible.
- **Strings cannot be zeroed.** A JS string is immutable — once a secret
  exists as one, it's unzeroable for the rest of its life. Be mindful
  before putting secret data in a string. `mnemonic` is the one
  unavoidable exception (`@scure/bip39`'s API is string-in/string-out);
  everywhere else, prefer a Buffer.
- **The bare-rpc transport cannot carry a binary type.** Its payloads
  are JSON, which has none — this is a known, permanent limitation of
  that transport, not a bug to fix. `src/bare-rpc/runtime.js` converts
  the `buffer` fields to/from base64 at that transport's boundary only,
  and zeroes each Buffer of a response immediately after encoding it
  (also when the encoding fails) — closing the window between a handler
  returning a secret and the response leaving the process, for the
  Buffer. What it cannot close is the text: on the way in, the JSON and
  the base64 string of a field exist before its Buffer does, and on the
  way out they exist after the Buffer is zeroed. They stay in memory
  until the engine reuses it.
- **HRPC is the first-class transport.** It carries these fields as real
  Buffers end-to-end, with no string step at all. It has no step after
  the handler either: its generated code encodes the response once the
  handler has returned, so the Buffers a handler returns are not zeroed
  by the worklet. Any future transport follows the same pattern: convert
  at its own boundary, never weaken what HRPC guarantees.
- **Neither transport zeroes the frames.** The bytes a request was read
  from, and the bytes a response was written as, also pass through the
  buffers of the RPC library and of the IPC stream. This package does
  not own those and does not zero them.
- **A host that must keep secret material out of strings uses HRPC.**

## The seed's lifecycle across `WDK`'s life

`WDK` reuses the same seed reference for its entire lifetime by design,
and never zeroes it. Responsibility for cleaning it up falls to
`pear-wrk-wdk`, so it keeps its own reference on `context.wdkSeedBuffer`,
zeroed once the instance is truly discarded:

- on a **full** dispose (a targeted per-blockchain dispose leaves the
  wallet, and the seed, running on purpose)
- on re-init, when an existing `WDK` instance is replaced

## No caching, anywhere, ever

`pear-wrk-wdk` never caches secret material. Every secret-returning RPC
call recomputes fresh from encrypted-at-rest material; nothing is
retained after a response is sent (aside from the seed's dispose-cleanup
above, which exists for zeroing, not reuse).

## Logging and error messages

No request or response is logged at the transport level, on either
transport — not the payload, and not the method name. Transport
logs are errors only. Anything closer to secret material logs at
`debug` (off by default), not `info`. Error messages report shape, not
value — e.g. `validateMnemonic` reports which word position is invalid,
never the word itself.

An error returned to the host carries the name and message of the thrown
error, its simple properties (`details`) and the same for each error in
its `cause` chain (`causes`). Only strings, finite numbers and booleans
are copied — never an object or an array, so a request or response body
attached to an error stays in the worklet. The secret field names the
logger redacts (`src/utils/secret-keys.js`) are skipped, strings in
`details` are cut at 256 characters, and at most 16 properties of one
error and 8 causes are reported. The `name` and the `message` are always
strings, cut at 128 and 4096 characters. A name that is not a string is
not sent. A message that is not a string (a library can set an object
there) is the one object that is serialized: it is sent as its JSON, cut
at 256 characters, without those secret fields and without byte arrays.

Stack traces are not returned in the error of a request. The one
exception is a worklet built with `debug: true` in its context, which
adds the `stack` of the thrown error and of each cause. The flag is part
of the bundle: a host cannot turn it on at run time, and a production
build must not set it.

The `error` event of a module that fails to construct
(`src/handlers/modules.js`) follows the same rule for the stack: it
carries the name and the message of the failure, and the stack only in a
debug build. Its name and message are sent as they are, without the cuts
above.

One thing reaches the host with a stack in every build: an error nobody
catches ends the worklet. Under `bare-stow`, the runtime that started the
worklet sends the message and the stack of that error to the host before
it exits. This package does not see or change what is sent there.

**When adding a log line or error message near secret material: if
there's any doubt, log the shape (a field name, a count, a boolean), not
the value.**
