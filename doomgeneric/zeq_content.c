// Phase 5 signed-WAD engine handoff.
// Signature verification intentionally remains in the portable host SDK.
// This boundary requires an explicit trust result, checks ruleset membership,
// copies the input, verifies SHA-256 in C, validates every WAD directory range,
// and transfers ownership of those same bytes to the memory-backed WAD reader.

#include "zeq_content.h"
#include "w_wad.h"
#include "zeq_doom.h"
#include "zeq_sha256.h"
#include "zeq_visual.h"

#include <stdlib.h>
#include <string.h>

static zeq_content_evidence_t evidence;
static char loaded_digest[65];

static uint32_t read32le(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8)
         | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static int valid_hex(const char *text)
{
    size_t i;
    if (!text || strlen(text) != 64) return 0;
    for (i = 0; i < 64; i++)
        if (!((text[i] >= '0' && text[i] <= '9')
              || (text[i] >= 'a' && text[i] <= 'f'))) return 0;
    return 1;
}

static int valid_id(const char *text)
{
    size_t i;
    size_t length;
    if (!text) return 0;
    length = strlen(text);
    if (!length || length > 128
        || !((text[0] >= 'A' && text[0] <= 'Z')
             || (text[0] >= 'a' && text[0] <= 'z')
             || (text[0] >= '0' && text[0] <= '9'))) return 0;
    for (i = 1; i < length; i++)
        if (!((text[i] >= 'A' && text[i] <= 'Z')
              || (text[i] >= 'a' && text[i] <= 'z')
              || (text[i] >= '0' && text[i] <= '9')
              || text[i] == '.' || text[i] == '_' || text[i] == '-')) return 0;
    return 1;
}

static void copy_field(char *destination, size_t capacity, const char *source)
{
    if (!source) source = "";
    strncpy(destination, source, capacity - 1);
    destination[capacity - 1] = 0;
}

static int reject(zeq_content_status_t status)
{
    evidence.status = status;
    evidence.engine_lump_count = (int32_t)W_NumLumps();
    return -(int)status;
}

static int validate_wad(const uint8_t *data, size_t length, uint32_t *lump_count)
{
    uint32_t count;
    uint32_t directory;
    uint32_t i;
    if (length < 12 || memcmp(data, "PWAD", 4) != 0) return 0;
    count = read32le(data + 4);
    directory = read32le(data + 8);
    if (count > ZEQ_CONTENT_MAX_WAD_LUMPS || directory > length
        || (uint64_t)count * 16u > (uint64_t)length - directory) return 0;
    for (i = 0; i < count; i++)
    {
        const uint8_t *entry = data + directory + (size_t)i * 16u;
        uint32_t position = read32le(entry);
        uint32_t size = read32le(entry + 4);
        if (position > length || (uint64_t)size > (uint64_t)length - position) return 0;
    }
    *lump_count = count;
    return 1;
}

static int verified_wad(const void *data, uint32_t length,
                        const char *expected_sha256,
                        const char *mod_id, const char *mod_version,
                        const char *publisher_key_id,
                        int publisher_trusted, unsigned int ruleset_mask,
                        int commit)
{
    static const char digits[] = "0123456789abcdef";
    zeq_sha256_t sha;
    uint8_t digest[32];
    uint8_t *owned;
    uint32_t lumps = 0;
    int current_ruleset = ZEQ_GetRuleset();
    int i;

    memset(&evidence, 0, sizeof(evidence));
    evidence.version = ZEQ_CONTENT_EVIDENCE_VERSION;
    evidence.status = ZEQ_CONTENT_NONE;
    evidence.trusted = publisher_trusted == 1;
    evidence.ruleset = current_ruleset;
    evidence.ruleset_compatible = current_ruleset >= ZEQ_RULESET_VANILLA
        && current_ruleset <= ZEQ_RULESET_LEGACY
        && (ruleset_mask & (1u << current_ruleset)) != 0;
    copy_field(evidence.mod_id, sizeof(evidence.mod_id), mod_id);
    copy_field(evidence.mod_version, sizeof(evidence.mod_version), mod_version);
    copy_field(evidence.publisher_key_id, sizeof(evidence.publisher_key_id), publisher_key_id);
    copy_field(evidence.content_sha256, sizeof(evidence.content_sha256), expected_sha256);

    if (!valid_id(mod_id) || !valid_id(mod_version)
        || !valid_hex(expected_sha256) || !valid_hex(publisher_key_id)
        || (ruleset_mask & ~7u) != 0) return reject(ZEQ_CONTENT_INVALID_ARGUMENT);
    if (publisher_trusted != 1) return reject(ZEQ_CONTENT_UNTRUSTED);
    if (!evidence.ruleset_compatible) return reject(ZEQ_CONTENT_INCOMPATIBLE_RULESET);
    if (!data || length < 12 || length > ZEQ_CONTENT_MAX_WAD_BYTES)
        return reject(ZEQ_CONTENT_INVALID_SIZE);

    // Copy before hashing or parsing. The engine never reopens a host path and
    // never retains the caller's mutable buffer.
    owned = malloc(length);
    if (!owned) return reject(ZEQ_CONTENT_ENGINE_REFUSED);
    memcpy(owned, data, length);
    ZEQ_SHA256_Init(&sha);
    ZEQ_SHA256_Update(&sha, owned, length);
    ZEQ_SHA256_Final(&sha, digest);
    for (i = 0; i < 32; i++)
    {
        evidence.content_sha256[i * 2] = digits[digest[i] >> 4];
        evidence.content_sha256[i * 2 + 1] = digits[digest[i] & 15];
    }
    evidence.content_sha256[64] = 0;
    if (memcmp(evidence.content_sha256, expected_sha256, 65) != 0)
    {
        free(owned);
        return reject(ZEQ_CONTENT_DIGEST_MISMATCH);
    }
    evidence.digest_verified = 1;
    if (loaded_digest[0] && memcmp(loaded_digest, evidence.content_sha256, 65) == 0)
    {
        free(owned);
        return reject(ZEQ_CONTENT_DUPLICATE);
    }
    if (!validate_wad(owned, length, &lumps))
    {
        free(owned);
        return reject(ZEQ_CONTENT_MALFORMED_WAD);
    }
    evidence.lump_count = (int32_t)lumps;
    if (!commit)
    {
        free(owned);
        evidence.status = ZEQ_CONTENT_VALIDATED;
        return 1;
    }
    if (!W_AddMemoryFile(owned, length))
    {
        // W_AddMemoryFile owns and releases the buffer on every path.
        return reject(ZEQ_CONTENT_ENGINE_REFUSED);
    }
    memcpy(loaded_digest, evidence.content_sha256, sizeof(loaded_digest));
    evidence.status = ZEQ_CONTENT_LOADED;
    evidence.engine_lump_count = (int32_t)W_NumLumps();
    ZEQ_VisualContentChanged();
    return 1;
}

int ZEQ_LoadVerifiedWad(const void *data, uint32_t length,
                        const char *expected_sha256,
                        const char *mod_id, const char *mod_version,
                        const char *publisher_key_id,
                        int publisher_trusted, unsigned int ruleset_mask)
{
    return verified_wad(data, length, expected_sha256, mod_id, mod_version,
                        publisher_key_id, publisher_trusted, ruleset_mask, 1);
}

int ZEQ_ValidateVerifiedWad(const void *data, uint32_t length,
                            const char *expected_sha256,
                            const char *mod_id, const char *mod_version,
                            const char *publisher_key_id,
                            int publisher_trusted, unsigned int ruleset_mask)
{
    return verified_wad(data, length, expected_sha256, mod_id, mod_version,
                        publisher_key_id, publisher_trusted, ruleset_mask, 0);
}

const zeq_content_evidence_t *ZEQ_GetContentEvidence(void)
{
    return &evidence;
}

int ZEQ_ContentLumpPresent(const char *name)
{
    if (!name) return -1;
    return W_CheckNumForName((char *)name);
}

int ZEQ_ContentReadLump(const char *name, void *output, uint32_t capacity)
{
    int lump;
    int length;
    if (!name || !output) return -1;
    lump = W_CheckNumForName((char *)name);
    if (lump < 0) return -1;
    length = W_LumpLength((unsigned int)lump);
    if (length < 0 || (uint32_t)length > capacity) return -2;
    W_ReadLump((unsigned int)lump, output);
    return length;
}
