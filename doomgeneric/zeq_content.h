// Verified content handoff for the real doomgeneric WAD directory.
// The host SDK authenticates the signature and makes the trust decision.
// This adapter independently binds the copied bytes to the manifest digest.

#ifndef ZEQ_CONTENT_H
#define ZEQ_CONTENT_H

#include <stddef.h>
#include <stdint.h>

#define ZEQ_CONTENT_EVIDENCE_VERSION 1
#define ZEQ_CONTENT_MAX_WAD_BYTES (64u * 1024u * 1024u)
#define ZEQ_CONTENT_MAX_WAD_LUMPS 65536u

typedef enum
{
    ZEQ_CONTENT_NONE = 0,
    ZEQ_CONTENT_LOADED = 1,
    ZEQ_CONTENT_INVALID_ARGUMENT = 2,
    ZEQ_CONTENT_UNTRUSTED = 3,
    ZEQ_CONTENT_INCOMPATIBLE_RULESET = 4,
    ZEQ_CONTENT_INVALID_SIZE = 5,
    ZEQ_CONTENT_DIGEST_MISMATCH = 6,
    ZEQ_CONTENT_MALFORMED_WAD = 7,
    ZEQ_CONTENT_ENGINE_REFUSED = 8,
    ZEQ_CONTENT_DUPLICATE = 9,
    ZEQ_CONTENT_VALIDATED = 10
} zeq_content_status_t;

typedef struct
{
    int32_t version;
    int32_t status;
    int32_t trusted;
    int32_t ruleset_compatible;
    int32_t ruleset;
    int32_t digest_verified;
    int32_t lump_count;
    int32_t engine_lump_count;
    char mod_id[129];
    char mod_version[129];
    char publisher_key_id[65];
    char content_sha256[65];
} zeq_content_evidence_t;

int ZEQ_LoadVerifiedWad(const void *data, uint32_t length,
                        const char *expected_sha256,
                        const char *mod_id, const char *mod_version,
                        const char *publisher_key_id,
                        int publisher_trusted, unsigned int ruleset_mask);
int ZEQ_ValidateVerifiedWad(const void *data, uint32_t length,
                            const char *expected_sha256,
                            const char *mod_id, const char *mod_version,
                            const char *publisher_key_id,
                            int publisher_trusted, unsigned int ruleset_mask);
const zeq_content_evidence_t *ZEQ_GetContentEvidence(void);
int ZEQ_ContentLumpPresent(const char *name);
int ZEQ_ContentReadLump(const char *name, void *output, uint32_t capacity);

#endif
