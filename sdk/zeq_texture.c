#include "zeq_texture.h"

#include <string.h>

static uint16_t u16(const uint8_t *p)
{
    return (uint16_t)((uint16_t)p[0] | ((uint16_t)p[1] << 8));
}

static int16_t s16(const uint8_t *p) { return (int16_t)u16(p); }

static uint32_t u32(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8)
         | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static int arguments(const void *data, size_t size)
{
    return data != NULL && size <= ZEQ_TEXTURE_MAX_LUMP_BYTES;
}

int ZEQ_TextureValidatePNames(const void *data, size_t size, uint32_t *name_count)
{
    const uint8_t *bytes = (const uint8_t *)data;
    uint32_t count;
    if (name_count) *name_count = 0;
    if (!arguments(data, size)) return ZEQ_TEXTURE_INVALID_ARGUMENT;
    if (size < 4) return ZEQ_TEXTURE_TRUNCATED;
    count = u32(bytes);
    if (count == 0 || count > ZEQ_TEXTURE_MAX_NAMES) return ZEQ_TEXTURE_COUNT;
    if ((uint64_t)count * 8u + 4u != size) return ZEQ_TEXTURE_TRUNCATED;
    if (name_count) *name_count = count;
    return ZEQ_TEXTURE_OK;
}

int ZEQ_TextureValidateDirectory(const void *data, size_t size,
                                 uint32_t pname_count, uint32_t *texture_count)
{
    const uint8_t *bytes = (const uint8_t *)data;
    uint32_t count;
    uint32_t i;
    size_t directory_end;
    if (texture_count) *texture_count = 0;
    if (!arguments(data, size) || pname_count == 0
        || pname_count > ZEQ_TEXTURE_MAX_NAMES) return ZEQ_TEXTURE_INVALID_ARGUMENT;
    if (size < 4) return ZEQ_TEXTURE_TRUNCATED;
    count = u32(bytes);
    if (count == 0 || count > ZEQ_TEXTURE_MAX_TEXTURES) return ZEQ_TEXTURE_COUNT;
    if ((uint64_t)count * 4u + 4u > size) return ZEQ_TEXTURE_TRUNCATED;
    directory_end = 4u + (size_t)count * 4u;
    for (i = 0; i < count; i++)
    {
        uint32_t offset = u32(bytes + 4u + (size_t)i * 4u);
        const uint8_t *texture;
        int32_t width;
        int32_t height;
        uint32_t patches;
        uint32_t j;
        size_t required;
        if (offset < directory_end || offset > size || size - offset < 22u)
            return ZEQ_TEXTURE_DIRECTORY;
        texture = bytes + offset;
        width = s16(texture + 12);
        height = s16(texture + 14);
        patches = u16(texture + 20);
        if (width <= 0 || height <= 0
            || width > (int32_t)ZEQ_TEXTURE_MAX_DIMENSION
            || height > (int32_t)ZEQ_TEXTURE_MAX_DIMENSION) return ZEQ_TEXTURE_LIMIT;
        if (patches == 0 || patches > ZEQ_TEXTURE_MAX_PATCHES) return ZEQ_TEXTURE_COUNT;
        required = 22u + (size_t)patches * 10u;
        if (required > size - offset) return ZEQ_TEXTURE_TRUNCATED;
        for (j = 0; j < patches; j++)
        {
            const uint8_t *patch = texture + 22u + (size_t)j * 10u;
            if (u16(patch + 4) >= pname_count) return ZEQ_TEXTURE_DIRECTORY;
        }
    }
    if (texture_count) *texture_count = count;
    return ZEQ_TEXTURE_OK;
}

int ZEQ_TextureValidatePatch(const void *data, size_t size)
{
    const uint8_t *bytes = (const uint8_t *)data;
    uint32_t width;
    uint32_t height;
    uint32_t x;
    size_t directory_end;
    if (!arguments(data, size)) return ZEQ_TEXTURE_INVALID_ARGUMENT;
    if (size < 8) return ZEQ_TEXTURE_TRUNCATED;
    width = u16(bytes);
    height = u16(bytes + 2);
    if (width == 0 || height == 0 || width > ZEQ_TEXTURE_MAX_DIMENSION
        || height > ZEQ_TEXTURE_MAX_DIMENSION) return ZEQ_TEXTURE_LIMIT;
    if ((uint64_t)width * 4u + 8u > size) return ZEQ_TEXTURE_TRUNCATED;
    directory_end = 8u + (size_t)width * 4u;
    for (x = 0; x < width; x++)
    {
        uint32_t offset = u32(bytes + 8u + (size_t)x * 4u);
        size_t cursor;
        uint32_t posts = 0;
        if (offset < directory_end || offset >= size) return ZEQ_TEXTURE_PATCH;
        cursor = offset;
        for (;;)
        {
            uint32_t length;
            if (cursor >= size) return ZEQ_TEXTURE_TRUNCATED;
            if (bytes[cursor] == 255) break;
            if (++posts > size / 4u || size - cursor < 4u) return ZEQ_TEXTURE_TRUNCATED;
            length = bytes[cursor + 1];
            if (length > height || (uint64_t)length + 4u > size - cursor)
                return ZEQ_TEXTURE_PATCH;
            cursor += (size_t)length + 4u;
        }
    }
    return ZEQ_TEXTURE_OK;
}

int ZEQ_TextureValidateFlat(const void *data, size_t size)
{
    if (!arguments(data, size)) return ZEQ_TEXTURE_INVALID_ARGUMENT;
    return size == ZEQ_TEXTURE_FLAT_BYTES ? ZEQ_TEXTURE_OK : ZEQ_TEXTURE_FLAT;
}

int ZEQ_TextureValidatePalette(const void *data, size_t size)
{
    if (!arguments(data, size)) return ZEQ_TEXTURE_INVALID_ARGUMENT;
    if (size < ZEQ_TEXTURE_PALETTE_BYTES || size % ZEQ_TEXTURE_PALETTE_BYTES != 0)
        return ZEQ_TEXTURE_PALETTE;
    return ZEQ_TEXTURE_OK;
}

int ZEQ_TextureValidateColormap(const void *data, size_t size)
{
    if (!arguments(data, size)) return ZEQ_TEXTURE_INVALID_ARGUMENT;
    if (size < ZEQ_TEXTURE_COLORMAP_BYTES || size % 256u != 0)
        return ZEQ_TEXTURE_COLORMAP;
    return ZEQ_TEXTURE_OK;
}

const char *ZEQ_TextureStatusName(int status)
{
    static const char *const names[] = {
        "ok", "invalid-argument", "truncated", "count", "directory",
        "patch", "flat", "palette", "colormap", "limit"
    };
    if (status < 0 || status > ZEQ_TEXTURE_LIMIT) return "unknown";
    return names[status];
}
