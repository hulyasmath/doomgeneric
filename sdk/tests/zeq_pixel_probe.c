#include "zeq_pixel.h"

#include <stdio.h>
#include <string.h>

static zeq_pixel_t pixels[9 * 7];
static uint8_t frame[16 + 9 * 7 * 4];
static uint8_t occupancy[16 + 9 * 7 * 16];

static zeq_pixel_rational_t r(int64_t num, int64_t den)
{
    zeq_pixel_rational_t value;
    value.num = num;
    value.den = den;
    return value;
}

static void hex(const uint8_t *bytes, size_t count)
{
    size_t i;
    for (i = 0; i < count; i++) printf("%02x", bytes[i]);
}

static void projection(zeq_pixel_rational_t x, zeq_pixel_rational_t y,
                       zeq_pixel_rational_t z, zeq_pixel_rational_t focal)
{
    zeq_pixel_point_t point;
    zeq_pixel_projection_result_t status = ZEQ_PixelProject(x, y, z, focal, 9, 7, &point);
    printf("%d", (int)status);
    if (status != ZEQ_PROJECT_INVALID)
        printf(",%lld,%lld,%lld,%lld", (long long)point.x.num, (long long)point.x.den,
               (long long)point.y.num, (long long)point.y.den);
}

int main(void)
{
    zeq_pixel_surface_t surface;
    zeq_pixel_point_t point;
    int results[20];
    size_t frame_size, occupancy_size;
    memset(results, -99, sizeof(results));
    if (!ZEQ_PixelInit(&surface, 9, 7, pixels, 9 * 7)) return 2;
    if (ZEQ_PixelInit(&surface, 0, 7, pixels, 9 * 7)
        || ZEQ_PixelInit(&surface, 9, 7, pixels, 2)
        || ZEQ_PixelInit(&surface, 4097, 1, pixels, 9 * 7)) return 3;
    ZEQ_PixelInit(&surface, 9, 7, pixels, 9 * 7);
    results[0] = ZEQ_PixelWrite(&surface, 1, 1, 100, 2, 3, 1, 0x112233ff);
    results[1] = ZEQ_PixelWrite(&surface, 1, 1, 101, 1, 0, 2, 0x445566ff);
    results[2] = ZEQ_PixelWrite(&surface, 1, 1, 90, 9, 3, 1, 0x112233ff);
    results[3] = ZEQ_PixelWrite(&surface, 1, 1, 90, 1, 4, 2, 0x445566ff);
    results[4] = ZEQ_PixelWrite(&surface, 1, 1, 90, 9, 3, 2, 0x112233ff);
    results[5] = ZEQ_PixelWrite(&surface, 1, 1, 90, 9, 3, 4, 0xaabbccff);
    results[6] = ZEQ_PixelWrite(&surface, 2, 1, 90, 9, 3, 4, 0xaabbccfe);
    results[7] = ZEQ_PixelWrite(&surface, 2, 1, 90, 0, 3, 4, 0xaabbccff);
    results[8] = ZEQ_PixelWrite(&surface, -1, 1, 90, 9, 3, 4, 0xaabbccff);
    results[9] = ZEQ_PixelSpan(&surface, 3, r(-3, 2), r(17, 2), 50, 4, 0, 4, 0x204060ff);
    results[10] = ZEQ_PixelSpan(&surface, 4, r(3, 1), r(2, 1), 50, 4, 0, 4, 0x204060ff);
    results[11] = ZEQ_PixelSpan(&surface, 4, r(3, 1), r(3, 1), 50, 4, 0, 4, 0x204060ff);
    results[12] = ZEQ_PixelSpan(&surface, 2, r(2, 1), r(4, 1), 60, 6, 0, 8, 0x8090a0ff);
    results[13] = ZEQ_PixelColumn(&surface, 4, r(1, 3), r(11, 2), 40, 5, -1, 16, 0xff8000ff);
    results[14] = ZEQ_PixelColumn(&surface, 99, r(0, 1), r(2, 1), 40, 5, -1, 16, 0xff8000ff);
    results[15] = ZEQ_PixelProject(r(0, 1), r(0, 1), r(1, 1), r(1, 1), 9, 7, &point);
    results[16] = ZEQ_PixelProject(r(0, 1), r(0, 1), r(0, 1), r(1, 1), 9, 7, &point);
    results[17] = ZEQ_PixelProject(r(0, 1), r(0, 1), r(-1, 1), r(1, 1), 9, 7, &point);
    results[18] = ZEQ_PixelProject(r(1000000000, 1), r(0, 1), r(1, 1000000000),
                                   r(1000000000, 1), 9, 7, &point);
    results[19] = ZEQ_PixelProject(r(1, 0), r(0, 1), r(1, 1), r(1, 1), 9, 7, &point);
    frame_size = ZEQ_PixelFrameBytes(&surface, frame, sizeof(frame));
    occupancy_size = ZEQ_PixelOccupancyBytes(&surface, occupancy, sizeof(occupancy));
    if (!frame_size || !occupancy_size || ZEQ_PixelFrameBytes(&surface, frame, 2)
        || ZEQ_PixelOccupancyBytes(&surface, occupancy, 2)) return 4;
    printf("{\"format\":\"zeq-pixel-conformance-v1\",\"results\":[");
    for (frame_size = 0; frame_size < 20; frame_size++)
        printf("%s%d", frame_size ? "," : "", results[frame_size]);
    printf("],\"center\":["); projection(r(0, 1), r(0, 1), r(1, 1), r(1, 1));
    printf("],\"fractional\":["); projection(r(1, 2), r(-1, 4), r(2, 1), r(3, 2));
    printf("],\"outside\":["); projection(r(10000, 1), r(0, 1), r(1, 1), r(1, 1));
    printf("],\"frame_hex\":\""); hex(frame, ZEQ_PixelFrameBytes(&surface, frame, sizeof(frame)));
    printf("\",\"occupancy_hex\":\""); hex(occupancy, ZEQ_PixelOccupancyBytes(&surface, occupancy, sizeof(occupancy)));
    printf("\"}\n");
    return 0;
}
