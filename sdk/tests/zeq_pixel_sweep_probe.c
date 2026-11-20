#include "zeq_pixel.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void put32(uint8_t *p, uint32_t value)
{
    p[0] = value & 255; p[1] = (value >> 8) & 255;
    p[2] = (value >> 16) & 255; p[3] = (value >> 24) & 255;
}
static void account(uint32_t counts[4], int status)
{
    if (status >= 0 && status <= 3) counts[status]++;
}
static int write_hex(const uint8_t *data, size_t size)
{
    static const char digits[] = "0123456789abcdef";
    size_t i;
    for (i = 0; i < size; i++)
        if (fputc(digits[data[i] >> 4], stdout) == EOF
            || fputc(digits[data[i] & 15], stdout) == EOF) return 0;
    return 1;
}
static int scene(uint32_t width, uint32_t height)
{
    size_t count = (size_t)width * height;
    zeq_pixel_t *storage = malloc(count * sizeof(*storage));
    zeq_pixel_surface_t surface;
    uint8_t header[32] = {0};
    uint8_t *frame = NULL;
    uint8_t *occupancy = NULL;
    size_t frame_size;
    size_t occupancy_size;
    uint32_t counts[4] = {0};
    uint32_t x, y;
    int status = 1;
    if (!storage || !ZEQ_PixelInit(&surface, width, height, storage, count)) goto done;
    for (y = 0; y < height; y++) for (x = 0; x < width; x++)
    {
        uint32_t rgba = ((x * 17u + y * 3u) & 255u) << 24
                      | ((x * 5u + y * 29u) & 255u) << 16
                      | ((x * 41u + y * 7u) & 255u) << 8 | 255u;
        account(counts, ZEQ_PixelWrite(&surface, x, y, 100u + (x + y) % 17u,
            1u + (x * 3u + y) % 7u, (int32_t)(x % 5u) - 2,
            1u << ((x + y) % 8u), rgba));
        if ((x + y * width) % 97u == 0)
        {
            account(counts, ZEQ_PixelWrite(&surface, x, y, 100u + (x + y) % 17u,
                1u + (x * 3u + y) % 7u, (int32_t)(x % 5u) - 2, 256u, rgba));
            account(counts, ZEQ_PixelWrite(&surface, x, y, 100u + (x + y) % 17u,
                1u + (x * 3u + y) % 7u, (int32_t)(x % 5u) - 2, 256u, rgba ^ 0x100u));
            account(counts, ZEQ_PixelWrite(&surface, x, y, 1000u, 99, 99, 1, 0x102030ffu));
            account(counts, ZEQ_PixelWrite(&surface, x, y, 1u, 1, -10, 512u, 0xf02030ffu));
        }
    }
    for (y = 0; y < height; y += 16)
    {
        zeq_pixel_rational_t start = {-1, 3}, end = {(int32_t)width * 3 + 1, 3};
        status = ZEQ_PixelSpan(&surface, y, start, end, 50, 15, 0, 1024, 0x304050ffu);
        if (status < 0) { status = 1; goto done; }
    }
    for (x = 0; x < width; x += 31)
    {
        zeq_pixel_rational_t start = {-2, 5}, end = {(int32_t)height * 5 + 2, 5};
        status = ZEQ_PixelColumn(&surface, x, start, end, 25, 16, -1, 2048, 0x506070ffu);
        if (status < 0) { status = 1; goto done; }
    }
    frame_size = ZEQ_PixelFrameSize(&surface);
    occupancy_size = ZEQ_PixelOccupancySize(&surface);
    frame = malloc(frame_size);
    occupancy = malloc(occupancy_size);
    if (!frame || !occupancy || !ZEQ_PixelFrameBytes(&surface, frame, frame_size)
        || !ZEQ_PixelOccupancyBytes(&surface, occupancy, occupancy_size)) goto done;
    put32(header, width); put32(header + 4, height);
    put32(header + 8, (uint32_t)frame_size); put32(header + 12, (uint32_t)occupancy_size);
    for (x = 0; x < 4; x++) put32(header + 16 + x * 4, counts[x]);
    if (!write_hex(header, sizeof(header)) || !write_hex(frame, frame_size)
        || !write_hex(occupancy, occupancy_size)) goto done;
    status = 0;
done:
    free(storage); free(frame); free(occupancy);
    return status;
}
int main(void)
{
    static const uint32_t sizes[][2] = {{1,1},{17,13},{127,63},{320,200}};
    size_t i;
    for (i = 0; i < sizeof(sizes) / sizeof(sizes[0]); i++)
        if (scene(sizes[i][0], sizes[i][1])) return 1;
    if (fputc('\n', stdout) == EOF) return 1;
    return fflush(stdout) == 0 ? 0 : 1;
}
