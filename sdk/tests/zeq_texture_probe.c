#include "zeq_texture.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static uint32_t rng_state = 0x7e9a31c7u;
static uint32_t next_random(void)
{
    rng_state ^= rng_state << 13;
    rng_state ^= rng_state >> 17;
    rng_state ^= rng_state << 5;
    return rng_state;
}
static void put16(uint8_t *p, uint16_t v) { p[0] = v & 255; p[1] = v >> 8; }
static void put32(uint8_t *p, uint32_t v)
{
    p[0] = v & 255; p[1] = (v >> 8) & 255; p[2] = (v >> 16) & 255; p[3] = v >> 24;
}
static int expect(int actual, int expected, const char *name)
{
    if (actual == expected) return 1;
    fprintf(stderr, "%s: got %s expected %s\n", name,
            ZEQ_TextureStatusName(actual), ZEQ_TextureStatusName(expected));
    return 0;
}
int main(void)
{
    uint8_t pnames[12] = {1,0,0,0,'T','E','S','T','0',0,0,0};
    uint8_t directory[40] = {0};
    uint8_t patch[32] = {0};
    uint8_t flat[4096] = {0};
    uint8_t palette[768] = {0};
    uint8_t colormap[8448] = {0};
    uint8_t fuzz[160];
    uint32_t count = 0;
    int i;
    int ok = 1;
    int accepted = 0;
    ok &= expect(ZEQ_TextureValidatePNames(pnames, sizeof(pnames), &count), ZEQ_TEXTURE_OK, "pnames");
    ok &= count == 1;
    put32(directory, 1); put32(directory + 4, 8);
    memcpy(directory + 8, "TEST", 4);
    put16(directory + 20, 64); put16(directory + 22, 128); put16(directory + 28, 1);
    ok &= expect(ZEQ_TextureValidateDirectory(directory, sizeof(directory), 1, &count), ZEQ_TEXTURE_OK, "directory");
    ok &= count == 1;
    put16(patch, 1); put16(patch + 2, 3); put32(patch + 8, 12);
    patch[12] = 0; patch[13] = 2; patch[15] = 4; patch[16] = 5; patch[18] = 255;
    ok &= expect(ZEQ_TextureValidatePatch(patch, sizeof(patch)), ZEQ_TEXTURE_OK, "patch");
    ok &= expect(ZEQ_TextureValidateFlat(flat, sizeof(flat)), ZEQ_TEXTURE_OK, "flat");
    ok &= expect(ZEQ_TextureValidatePalette(palette, sizeof(palette)), ZEQ_TEXTURE_OK, "palette");
    ok &= expect(ZEQ_TextureValidateColormap(colormap, sizeof(colormap)), ZEQ_TEXTURE_OK, "colormap");

    ok &= expect(ZEQ_TextureValidatePNames(pnames, 3, &count), ZEQ_TEXTURE_TRUNCATED, "short pnames");
    pnames[0] = 0;
    ok &= expect(ZEQ_TextureValidatePNames(pnames, sizeof(pnames), &count), ZEQ_TEXTURE_COUNT, "zero pnames");
    pnames[0] = 1;
    put32(directory + 4, 4);
    ok &= expect(ZEQ_TextureValidateDirectory(directory, sizeof(directory), 1, &count), ZEQ_TEXTURE_DIRECTORY, "overlapping texture directory");
    put32(directory + 4, 8);
    put16(directory + 34, 1);
    ok &= expect(ZEQ_TextureValidateDirectory(directory, sizeof(directory), 1, &count), ZEQ_TEXTURE_DIRECTORY, "patch name index");
    put16(directory + 34, 0);
    put16(directory + 20, 0);
    ok &= expect(ZEQ_TextureValidateDirectory(directory, sizeof(directory), 1, &count), ZEQ_TEXTURE_LIMIT, "zero texture width");
    put16(directory + 20, 64);

    put32(patch + 8, 31);
    ok &= expect(ZEQ_TextureValidatePatch(patch, sizeof(patch)), ZEQ_TEXTURE_TRUNCATED, "unterminated column beyond lump");
    put32(patch + 8, 12); patch[18] = 0;
    ok &= expect(ZEQ_TextureValidatePatch(patch, sizeof(patch)), ZEQ_TEXTURE_TRUNCATED, "unterminated post");
    patch[18] = 255; patch[13] = 4;
    ok &= expect(ZEQ_TextureValidatePatch(patch, sizeof(patch)), ZEQ_TEXTURE_PATCH, "post exceeds patch height");
    patch[13] = 2;
    ok &= expect(ZEQ_TextureValidateFlat(flat, sizeof(flat) - 1), ZEQ_TEXTURE_FLAT, "short flat");
    ok &= expect(ZEQ_TextureValidatePalette(palette, sizeof(palette) - 1), ZEQ_TEXTURE_PALETTE, "short palette");
    ok &= expect(ZEQ_TextureValidateColormap(colormap, sizeof(colormap) - 256), ZEQ_TEXTURE_COLORMAP, "missing inverse colormap");
    ok &= expect(ZEQ_TextureValidatePatch(NULL, 0), ZEQ_TEXTURE_INVALID_ARGUMENT, "null patch");

    for (i = 0; i < 20000; i++)
    {
        size_t size = next_random() % sizeof(fuzz);
        size_t j;
        for (j = 0; j < size; j++) fuzz[j] = next_random() & 255;
        accepted += ZEQ_TextureValidatePNames(fuzz, size, &count) == ZEQ_TEXTURE_OK;
        accepted += ZEQ_TextureValidateDirectory(fuzz, size, 1, &count) == ZEQ_TEXTURE_OK;
        accepted += ZEQ_TextureValidatePatch(fuzz, size) == ZEQ_TEXTURE_OK;
        accepted += ZEQ_TextureValidateFlat(fuzz, size) == ZEQ_TEXTURE_OK;
        accepted += ZEQ_TextureValidatePalette(fuzz, size) == ZEQ_TEXTURE_OK;
        accepted += ZEQ_TextureValidateColormap(fuzz, size) == ZEQ_TEXTURE_OK;
    }
    if (!ok) return 1;
    printf("{\"format\":\"zeq-texture-validation-v1\",\"ok\":true,\"negative_cases\":12,\"fuzz_cases\":20000,\"fuzz_accepted\":%d}\n", accepted);
    return 0;
}
