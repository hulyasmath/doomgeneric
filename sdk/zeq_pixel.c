#include "zeq_pixel.h"

#include <limits.h>
#include <string.h>

static int valid_surface(const zeq_pixel_surface_t *surface)
{
    uint64_t count;
    if (!surface || !surface->pixels || !surface->width || !surface->height
        || surface->width > ZEQ_PIXEL_MAX_DIMENSION
        || surface->height > ZEQ_PIXEL_MAX_DIMENSION) return 0;
    count = (uint64_t)surface->width * surface->height;
    return count <= ZEQ_PIXEL_MAX_PIXELS && surface->pixel_count == (size_t)count;
}

int ZEQ_PixelInit(zeq_pixel_surface_t *surface, uint32_t width, uint32_t height,
                  zeq_pixel_t *storage, size_t storage_count)
{
    uint64_t count;
    if (!surface || !storage || !width || !height
        || width > ZEQ_PIXEL_MAX_DIMENSION || height > ZEQ_PIXEL_MAX_DIMENSION)
        return 0;
    count = (uint64_t)width * height;
    if (count > ZEQ_PIXEL_MAX_PIXELS || storage_count < (size_t)count) return 0;
    surface->width = width;
    surface->height = height;
    surface->pixel_count = (size_t)count;
    surface->pixels = storage;
    ZEQ_PixelClear(surface);
    return 1;
}

void ZEQ_PixelClear(zeq_pixel_surface_t *surface)
{
    size_t i;
    if (!valid_surface(surface)) return;
    for (i = 0; i < surface->pixel_count; i++)
    {
        surface->pixels[i].depth_q32 = UINT32_MAX;
        surface->pixels[i].owner_id = 0;
        surface->pixels[i].layer_rank = INT32_MAX;
        surface->pixels[i].claimed_mask = 0;
        surface->pixels[i].rgba8 = 0;
    }
}

zeq_pixel_write_result_t ZEQ_PixelWrite(zeq_pixel_surface_t *surface,
    int32_t x, int32_t y, uint32_t depth_q32, uint32_t owner_id,
    int32_t layer_rank, uint32_t claimed_mask, uint32_t rgba8)
{
    zeq_pixel_t *pixel;
    if (!valid_surface(surface) || x < 0 || y < 0
        || (uint32_t)x >= surface->width || (uint32_t)y >= surface->height
        || !owner_id || !claimed_mask || (rgba8 & 255u) != 255u)
        return ZEQ_PIXEL_INVALID;
    pixel = &surface->pixels[(size_t)y * surface->width + (uint32_t)x];
    if (pixel->claimed_mask)
    {
        int existing_wins = pixel->depth_q32 < depth_q32
            || (pixel->depth_q32 == depth_q32 && pixel->layer_rank < layer_rank)
            || (pixel->depth_q32 == depth_q32 && pixel->layer_rank == layer_rank
                && pixel->owner_id < owner_id);
        if (existing_wins) return ZEQ_PIXEL_OCCLUDED;
        if (pixel->depth_q32 == depth_q32 && pixel->layer_rank == layer_rank
            && pixel->owner_id == owner_id)
        {
            if (pixel->rgba8 != rgba8) return ZEQ_PIXEL_INVALID;
            pixel->claimed_mask |= claimed_mask;
            return ZEQ_PIXEL_IDENTICAL;
        }
    }
    pixel->depth_q32 = depth_q32;
    pixel->owner_id = owner_id;
    pixel->layer_rank = layer_rank;
    pixel->claimed_mask = claimed_mask;
    pixel->rgba8 = rgba8;
    return ZEQ_PIXEL_WRITTEN;
}

static int valid_rational(zeq_pixel_rational_t value)
{
    return value.den > 0 && value.den <= ZEQ_PIXEL_RATIONAL_LIMIT
        && value.num >= -ZEQ_PIXEL_RATIONAL_LIMIT
        && value.num <= ZEQ_PIXEL_RATIONAL_LIMIT;
}

static __int128 abs128(__int128 value)
{
    return value < 0 ? -value : value;
}

static __int128 gcd128(__int128 a, __int128 b)
{
    a = abs128(a);
    while (a)
    {
        __int128 remainder = b % a;
        b = a;
        a = remainder;
    }
    return b;
}

static int reduce_output(__int128 numerator, __int128 denominator,
                         zeq_pixel_rational_t *output)
{
    __int128 divisor;
    if (denominator <= 0) return 0;
    divisor = gcd128(numerator, denominator);
    numerator /= divisor;
    denominator /= divisor;
    if (numerator < -(__int128)INT64_MAX || numerator > (__int128)INT64_MAX
        || denominator > (__int128)INT64_MAX) return 0;
    output->num = (int64_t)numerator;
    output->den = (int64_t)denominator;
    return 1;
}

zeq_pixel_projection_result_t ZEQ_PixelProject(
    zeq_pixel_rational_t x, zeq_pixel_rational_t y, zeq_pixel_rational_t z,
    zeq_pixel_rational_t focal, uint32_t width, uint32_t height,
    zeq_pixel_point_t *output)
{
    __int128 denominator, y_denominator, x_numerator, y_numerator;
    __int128 center_x, center_y;
    if (!output || !width || !height || width > ZEQ_PIXEL_MAX_DIMENSION
        || height > ZEQ_PIXEL_MAX_DIMENSION || !valid_rational(x)
        || !valid_rational(y) || !valid_rational(z) || !valid_rational(focal)
        || z.num <= 0 || focal.num <= 0) return ZEQ_PROJECT_INVALID;
    /* Bounded inputs keep every intermediate below 2^111. */
    denominator = (__int128)focal.den * x.den * z.num;
    y_denominator = (__int128)focal.den * y.den * z.num;
    x_numerator = (__int128)ZEQ_PIXEL_SUBPIXEL * focal.num * x.num * z.den;
    y_numerator = (__int128)ZEQ_PIXEL_SUBPIXEL * focal.num * y.num * z.den;
    center_x = (__int128)width * (ZEQ_PIXEL_SUBPIXEL / 2);
    center_y = (__int128)height * (ZEQ_PIXEL_SUBPIXEL / 2);
    x_numerator += center_x * denominator;
    y_numerator = center_y * y_denominator - y_numerator;
    if (!reduce_output(x_numerator, denominator, &output->x)
        || !reduce_output(y_numerator, y_denominator, &output->y))
        return ZEQ_PROJECT_INVALID;
    if (output->x.num < 0 || output->y.num < 0
        || (__int128)output->x.num >= (__int128)width * ZEQ_PIXEL_SUBPIXEL * output->x.den
        || (__int128)output->y.num >= (__int128)height * ZEQ_PIXEL_SUBPIXEL * output->y.den)
        return ZEQ_PROJECT_OUTSIDE;
    return ZEQ_PROJECT_INSIDE;
}

static __int128 floor_ratio(zeq_pixel_rational_t value)
{
    __int128 quotient = value.num / value.den;
    if (value.num % value.den < 0) quotient--;
    return quotient;
}

static __int128 ceil_ratio(zeq_pixel_rational_t value)
{
    __int128 quotient = value.num / value.den;
    if (value.num % value.den > 0) quotient++;
    return quotient;
}

static int raster_line(zeq_pixel_surface_t *surface, int vertical, int32_t fixed,
    zeq_pixel_rational_t start, zeq_pixel_rational_t end,
    uint32_t depth_q32, uint32_t owner_id, int32_t layer_rank,
    uint32_t claimed_mask, uint32_t rgba8)
{
    __int128 first, last;
    int64_t i;
    int accepted = 0;
    int limit;
    if (!valid_surface(surface) || !valid_rational(start) || !valid_rational(end)
        || (__int128)start.num * end.den > (__int128)end.num * start.den) return -1;
    limit = vertical ? (int)surface->height : (int)surface->width;
    if (fixed < 0 || fixed >= (vertical ? (int)surface->width : (int)surface->height)) return 0;
    first = floor_ratio(start);
    last = ceil_ratio(end);
    if (last < first) return -1;
    if (first < 0) first = 0;
    if (last > limit) last = limit;
    if (last <= first) return 0;
    for (i = (int64_t)first; i < (int64_t)last; i++)
    {
        zeq_pixel_write_result_t result = vertical
            ? ZEQ_PixelWrite(surface, fixed, (int32_t)i, depth_q32, owner_id,
                             layer_rank, claimed_mask, rgba8)
            : ZEQ_PixelWrite(surface, (int32_t)i, fixed, depth_q32, owner_id,
                             layer_rank, claimed_mask, rgba8);
        if (result == ZEQ_PIXEL_INVALID) return -1;
        if (result == ZEQ_PIXEL_WRITTEN || result == ZEQ_PIXEL_IDENTICAL) accepted++;
    }
    return accepted;
}

int ZEQ_PixelSpan(zeq_pixel_surface_t *surface, int32_t y,
    zeq_pixel_rational_t start, zeq_pixel_rational_t end,
    uint32_t depth_q32, uint32_t owner_id, int32_t layer_rank,
    uint32_t claimed_mask, uint32_t rgba8)
{
    return raster_line(surface, 0, y, start, end, depth_q32, owner_id,
                       layer_rank, claimed_mask, rgba8);
}

int ZEQ_PixelColumn(zeq_pixel_surface_t *surface, int32_t x,
    zeq_pixel_rational_t start, zeq_pixel_rational_t end,
    uint32_t depth_q32, uint32_t owner_id, int32_t layer_rank,
    uint32_t claimed_mask, uint32_t rgba8)
{
    return raster_line(surface, 1, x, start, end, depth_q32, owner_id,
                       layer_rank, claimed_mask, rgba8);
}

static void put32(uint8_t *output, uint32_t value)
{
    output[0] = value & 255u;
    output[1] = (value >> 8) & 255u;
    output[2] = (value >> 16) & 255u;
    output[3] = (value >> 24) & 255u;
}

static size_t serialized_size(const zeq_pixel_surface_t *surface, size_t stride)
{
    if (!valid_surface(surface) || surface->pixel_count > (SIZE_MAX - 16) / stride) return 0;
    return 16 + surface->pixel_count * stride;
}

size_t ZEQ_PixelFrameSize(const zeq_pixel_surface_t *surface)
{
    return serialized_size(surface, 4);
}

size_t ZEQ_PixelOccupancySize(const zeq_pixel_surface_t *surface)
{
    return serialized_size(surface, 16);
}

static size_t serialize(const zeq_pixel_surface_t *surface, uint8_t *output,
                        size_t capacity, int occupancy)
{
    size_t i, offset = 16;
    size_t stride = occupancy ? 16 : 4;
    size_t size = serialized_size(surface, stride);
    if (!size || !output || capacity < size) return 0;
    memcpy(output, occupancy ? "ZEQOCC1" : "ZEQFRM1", 8);
    put32(output + 8, surface->width);
    put32(output + 12, surface->height);
    for (i = 0; i < surface->pixel_count; i++)
    {
        const zeq_pixel_t *pixel = &surface->pixels[i];
        if (occupancy)
        {
            put32(output + offset, pixel->depth_q32);
            put32(output + offset + 4, pixel->owner_id);
            put32(output + offset + 8, (uint32_t)pixel->layer_rank);
            put32(output + offset + 12, pixel->claimed_mask);
        }
        else put32(output + offset, pixel->rgba8);
        offset += stride;
    }
    return size;
}

size_t ZEQ_PixelFrameBytes(const zeq_pixel_surface_t *surface,
                           uint8_t *output, size_t capacity)
{
    return serialize(surface, output, capacity, 0);
}

size_t ZEQ_PixelOccupancyBytes(const zeq_pixel_surface_t *surface,
                               uint8_t *output, size_t capacity)
{
    return serialize(surface, output, capacity, 1);
}
