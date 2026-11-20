#include "zeq_visual.h"

#include "doomstat.h"
#include "w_wad.h"
#include "z_zone.h"
#include "zeq_pixel.h"
#include "zeq_sha256.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define VISUAL_RING 4
#define VISUAL_MAX_BYTES (16u + ZEQ_PIXEL_MAX_PIXELS * 16u)

typedef struct
{
    int valid;
    uint32_t gametic;
    uint16_t width;
    uint16_t height;
    uint8_t gamma;
    uint8_t detail;
    char frame_sha256[65];
    char occupancy_sha256[65];
    size_t frame_size;
    size_t occupancy_size;
    size_t frame_capacity;
    size_t occupancy_capacity;
    uint8_t *frame;
    uint8_t *occupancy;
} visual_frame_t;

static zeq_pixel_surface_t surface;
static zeq_pixel_t *pixels;
static visual_frame_t frames[VISUAL_RING];
static uint32_t write_index;
static uint32_t read_index;
static uint32_t dropped;
static uint32_t errors;
static int32_t interval;
static int32_t last_presented = -1;
static int selected = -1;
static int content_dirty = 1;
static char content_sha256[65];
static char palette_sha256[65];
static char identity[ZEQ_VISUAL_IDENTITY_BYTES];
static uint8_t export_record[ZEQ_VISUAL_RECORD_BYTES];

static void hex_digest(const uint8_t digest[32], char output[65])
{
    static const char digits[] = "0123456789abcdef";
    int i;
    for (i = 0; i < 32; i++)
    {
        output[i * 2] = digits[digest[i] >> 4];
        output[i * 2 + 1] = digits[digest[i] & 15];
    }
    output[64] = 0;
}

static void hash_bytes(const void *data, size_t size, char output[65])
{
    zeq_sha256_t sha;
    uint8_t digest[32];
    ZEQ_SHA256_Init(&sha);
    ZEQ_SHA256_Update(&sha, data, size);
    ZEQ_SHA256_Final(&sha, digest);
    hex_digest(digest, output);
}

void ZEQ_VisualContentChanged(void) { content_dirty = 1; }

void ZEQ_VisualBindContent(void)
{
    zeq_sha256_t sha;
    uint8_t digest[32];
    uint8_t *buffer = NULL;
    size_t capacity = 0;
    unsigned int i;
    int palette;
    int palette_size;
    uint8_t *palette_data;
    ZEQ_SHA256_Init(&sha);
    for (i = 0; i < numlumps; i++)
    {
        int size = W_LumpLength(i);
        uint8_t header[24];
        uint32_t bits;
        if (size < 0) { content_dirty = 1; return; }
        if ((size_t)size > capacity)
        {
            uint8_t *grown = realloc(buffer, (size_t)size ? (size_t)size : 1u);
            if (!grown) { free(buffer); content_dirty = 1; return; }
            buffer = grown;
            capacity = (size_t)size;
        }
        memcpy(header, lumpinfo[i].name, 8);
        bits = (uint32_t)size;
        header[8] = bits & 255; header[9] = (bits >> 8) & 255;
        header[10] = (bits >> 16) & 255; header[11] = (bits >> 24) & 255;
        bits = i;
        header[12] = bits & 255; header[13] = (bits >> 8) & 255;
        header[14] = (bits >> 16) & 255; header[15] = (bits >> 24) & 255;
        memcpy(header + 16, "ZEQWAD1\0", 8);
        ZEQ_SHA256_Update(&sha, header, sizeof(header));
        if (size)
        {
            W_ReadLump(i, buffer);
            ZEQ_SHA256_Update(&sha, buffer, (size_t)size);
        }
    }
    free(buffer);
    ZEQ_SHA256_Final(&sha, digest);
    hex_digest(digest, content_sha256);
    palette = W_GetNumForName("PLAYPAL");
    palette_size = W_LumpLength((unsigned int)palette);
    palette_data = W_CacheLumpNum(palette, PU_CACHE);
    hash_bytes(palette_data, (size_t)palette_size, palette_sha256);
    content_dirty = 0;
}

int ZEQ_VisualEnabled(void) { return interval > 0; }

void ZEQ_VisualSetInterval(int32_t value)
{
    interval = value;
    read_index = write_index = 0;
    dropped = errors = 0;
    last_presented = -1;
    selected = -1;
    if (value < 0 || value > 2000000)
    {
        interval = 0;
        errors++;
    }
}

static visual_frame_t *latest_frame(void)
{
    if (write_index == 0) return NULL;
    return &frames[(write_index - 1) % VISUAL_RING];
}

void ZEQ_VisualPresent(const uint8_t *indexed, uint32_t width, uint32_t height,
                       const uint8_t *palette_rgb, int gamma, int detail)
{
    visual_frame_t *frame;
    size_t count;
    size_t i;
    if (interval <= 0 || gametic < 0 || gametic % interval != 0
        || gametic == last_presented) return;
    if (!indexed || !palette_rgb || width == 0 || height == 0
        || width > ZEQ_PIXEL_MAX_DIMENSION || height > ZEQ_PIXEL_MAX_DIMENSION
        || (uint64_t)width * height > ZEQ_PIXEL_MAX_PIXELS)
    {
        errors++;
        return;
    }
    if (content_dirty) ZEQ_VisualBindContent();
    if (content_dirty) { errors++; return; }
    count = (size_t)width * height;
    if (!surface.pixels)
    {
        pixels = malloc(count * sizeof(*pixels));
        if (!pixels || !ZEQ_PixelInit(&surface, width, height, pixels, count))
        {
            free(pixels);
            pixels = NULL;
            errors++;
            return;
        }
    }
    if (surface.width != width || surface.height != height)
    {
        zeq_pixel_t *grown = realloc(pixels, count * sizeof(*pixels));
        if (!grown || !ZEQ_PixelInit(&surface, width, height, grown, count))
        {
            errors++;
            return;
        }
        pixels = grown;
    }
    ZEQ_PixelClear(&surface);
    for (i = 0; i < count; i++)
    {
        const uint8_t *color = palette_rgb + (size_t)indexed[i] * 3u;
        uint32_t rgba = ((uint32_t)color[0] << 24) | ((uint32_t)color[1] << 16)
                      | ((uint32_t)color[2] << 8) | 255u;
        if (ZEQ_PixelWrite(&surface, (int32_t)(i % width), (int32_t)(i / width),
                           0, 1, 0, 1, rgba) != ZEQ_PIXEL_WRITTEN)
        {
            errors++;
            return;
        }
    }
    if (write_index - read_index == VISUAL_RING)
    {
        read_index++;
        dropped++;
    }
    frame = &frames[write_index % VISUAL_RING];
    {
        size_t frame_required = ZEQ_PixelFrameSize(&surface);
        size_t occupancy_required = ZEQ_PixelOccupancySize(&surface);
        if (frame->frame_capacity < frame_required)
        {
            uint8_t *grown = realloc(frame->frame, frame_required);
            if (!grown) { errors++; return; }
            frame->frame = grown;
            frame->frame_capacity = frame_required;
        }
        if (frame->occupancy_capacity < occupancy_required)
        {
            uint8_t *grown = realloc(frame->occupancy, occupancy_required);
            if (!grown) { errors++; return; }
            frame->occupancy = grown;
            frame->occupancy_capacity = occupancy_required;
        }
    }
    frame->valid = 1;
    frame->frame_size = ZEQ_PixelFrameBytes(&surface, frame->frame, frame->frame_capacity);
    frame->occupancy_size = ZEQ_PixelOccupancyBytes(&surface, frame->occupancy, frame->occupancy_capacity);
    if (!frame->frame_size || !frame->occupancy_size) { errors++; return; }
    frame->gametic = (uint32_t)gametic;
    frame->width = (uint16_t)width;
    frame->height = (uint16_t)height;
    frame->gamma = (uint8_t)gamma;
    frame->detail = (uint8_t)detail;
    hash_bytes(frame->frame, frame->frame_size, frame->frame_sha256);
    hash_bytes(frame->occupancy, frame->occupancy_size, frame->occupancy_sha256);
    last_presented = gametic;
    write_index++;
    selected = (int)((write_index - 1) % VISUAL_RING);
    (void)gamma;
    (void)detail;
}

int32_t ZEQ_VisualRead(void)
{
    visual_frame_t *frame;
    uint32_t bits;
    if (read_index == write_index) return 0;
    frame = &frames[read_index % VISUAL_RING];
    bits = frame->gametic;
    export_record[0] = bits & 255;
    export_record[1] = (bits >> 8) & 255;
    export_record[2] = (bits >> 16) & 255;
    export_record[3] = (bits >> 24) & 255;
    memcpy(export_record + 4, frame->frame_sha256, 64);
    memcpy(export_record + 68, frame->occupancy_sha256, 64);
    export_record[132] = frame->width & 255;
    export_record[133] = frame->width >> 8;
    export_record[134] = frame->height & 255;
    export_record[135] = frame->height >> 8;
    export_record[136] = frame->gamma;
    export_record[137] = frame->detail;
    export_record[138] = export_record[139] = 0;
    bits = (uint32_t)frame->frame_size;
    export_record[140] = bits & 255; export_record[141] = (bits >> 8) & 255;
    export_record[142] = (bits >> 16) & 255; export_record[143] = (bits >> 24) & 255;
    read_index++;
    return ZEQ_VISUAL_RECORD_BYTES;
}

uint8_t *ZEQ_VisualData(void) { return export_record; }
int32_t ZEQ_VisualDropped(void) { return (int32_t)dropped; }
int32_t ZEQ_VisualErrors(void) { return (int32_t)errors; }

const char *ZEQ_VisualIdentity(void)
{
    snprintf(identity, sizeof(identity),
        "{\"format\":\"%s\",\"pixel_format\":\"%s\",\"renderer\":\"doom-indexed-final-frame-strict-commit-v1\","
        "\"color_pipeline\":\"doom-playpal-gamma-rgba8-v1\",\"effects\":\"doom-colormap-fuzz-translucency-final-index-v1\","
        "\"content_sha256\":\"%s\",\"palette_sha256\":\"%s\","
        "\"evidence_scope\":\"visual byte conformance only; not gameplay or competitive-legitimacy proof\"}",
        ZEQ_VISUAL_FORMAT, ZEQ_PIXEL_FORMAT, content_sha256, palette_sha256);
    return identity;
}

int32_t ZEQ_VisualSelectFrame(int32_t gametic)
{
    uint32_t i;
    if (gametic < 0) return 0;
    i = write_index > VISUAL_RING ? write_index - VISUAL_RING : 0;
    for (; i < write_index; i++)
    {
        if (frames[i % VISUAL_RING].gametic == (uint32_t)gametic)
        {
            selected = (int)(i % VISUAL_RING);
            return 1;
        }
    }
    return 0;
}

uint8_t *ZEQ_VisualFrameData(void)
{
    return selected >= 0 ? frames[selected].frame : NULL;
}
uint8_t *ZEQ_VisualOccupancyData(void)
{
    return selected >= 0 ? frames[selected].occupancy : NULL;
}
int32_t ZEQ_VisualFrameSize(void)
{
    return selected >= 0 ? (int32_t)frames[selected].frame_size : 0;
}
int32_t ZEQ_VisualOccupancySize(void)
{
    return selected >= 0 ? (int32_t)frames[selected].occupancy_size : 0;
}

int ZEQ_VisualWriteLatest(const char *directory)
{
    char path[1024];
    FILE *output;
    visual_frame_t *frame = latest_frame();
    int ok = 1;
    if (!directory || !*directory || !frame) return 0;
    if (snprintf(path, sizeof(path), "%s/visual-frame.bin", directory) >= (int)sizeof(path)) return 0;
    output = fopen(path, "wb");
    if (!output || fwrite(frame->frame, 1, frame->frame_size, output) != frame->frame_size) ok = 0;
    if (output && fclose(output) != 0) ok = 0;
    if (snprintf(path, sizeof(path), "%s/visual-occupancy.bin", directory) >= (int)sizeof(path)) return 0;
    output = fopen(path, "wb");
    if (!output || fwrite(frame->occupancy, 1, frame->occupancy_size, output) != frame->occupancy_size) ok = 0;
    if (output && fclose(output) != 0) ok = 0;
    return ok;
}
