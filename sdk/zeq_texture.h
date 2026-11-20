// Structural validation for Doom-format rendering resources.
// This module validates byte ranges only; it does not load or execute content.
#ifndef ZEQ_TEXTURE_H
#define ZEQ_TEXTURE_H

#include <stddef.h>
#include <stdint.h>

#define ZEQ_TEXTURE_FORMAT "zeq-texture-validation-v1"
#define ZEQ_TEXTURE_MAX_LUMP_BYTES (64u * 1024u * 1024u)
#define ZEQ_TEXTURE_MAX_NAMES 16384u
#define ZEQ_TEXTURE_MAX_TEXTURES 4096u
#define ZEQ_TEXTURE_MAX_PATCHES 4096u
#define ZEQ_TEXTURE_MAX_DIMENSION 4096u
#define ZEQ_TEXTURE_FLAT_BYTES 4096u
#define ZEQ_TEXTURE_PALETTE_BYTES 768u
#define ZEQ_TEXTURE_COLORMAP_BYTES 8448u

typedef enum
{
    ZEQ_TEXTURE_OK = 0,
    ZEQ_TEXTURE_INVALID_ARGUMENT = 1,
    ZEQ_TEXTURE_TRUNCATED = 2,
    ZEQ_TEXTURE_COUNT = 3,
    ZEQ_TEXTURE_DIRECTORY = 4,
    ZEQ_TEXTURE_PATCH = 5,
    ZEQ_TEXTURE_FLAT = 6,
    ZEQ_TEXTURE_PALETTE = 7,
    ZEQ_TEXTURE_COLORMAP = 8,
    ZEQ_TEXTURE_LIMIT = 9
} zeq_texture_status_t;

int ZEQ_TextureValidatePNames(const void *data, size_t size, uint32_t *name_count);
int ZEQ_TextureValidateDirectory(const void *data, size_t size,
                                 uint32_t pname_count, uint32_t *texture_count);
int ZEQ_TextureValidatePatch(const void *data, size_t size);
int ZEQ_TextureValidateFlat(const void *data, size_t size);
int ZEQ_TextureValidatePalette(const void *data, size_t size);
int ZEQ_TextureValidateColormap(const void *data, size_t size);
const char *ZEQ_TextureStatusName(int status);

#endif
