/* Optional zeq-pixel-v1 deterministic opaque raster primitives.
 * C99 + GCC/Clang i128 for checked rational intermediates. No Doom types. */
#ifndef ZEQ_PIXEL_H
#define ZEQ_PIXEL_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define ZEQ_PIXEL_FORMAT "zeq-pixel-v1"
#define ZEQ_PIXEL_SUBPIXEL 256
#define ZEQ_PIXEL_MAX_DIMENSION 4096
#define ZEQ_PIXEL_MAX_PIXELS 16777216
#define ZEQ_PIXEL_RATIONAL_LIMIT INT64_C(1000000000)

typedef struct
{
    uint32_t depth_q32;
    uint32_t owner_id;
    int32_t layer_rank;
    uint32_t claimed_mask;
    uint32_t rgba8;
} zeq_pixel_t;

typedef struct
{
    uint32_t width;
    uint32_t height;
    size_t pixel_count;
    zeq_pixel_t *pixels;
} zeq_pixel_surface_t;

typedef struct
{
    int64_t num;
    int64_t den;
} zeq_pixel_rational_t;

typedef struct
{
    zeq_pixel_rational_t x;
    zeq_pixel_rational_t y;
} zeq_pixel_point_t;

typedef enum
{
    ZEQ_PIXEL_INVALID = 0,
    ZEQ_PIXEL_WRITTEN = 1,
    ZEQ_PIXEL_OCCLUDED = 2,
    ZEQ_PIXEL_IDENTICAL = 3
} zeq_pixel_write_result_t;

typedef enum
{
    ZEQ_PROJECT_INVALID = 0,
    ZEQ_PROJECT_INSIDE = 1,
    ZEQ_PROJECT_OUTSIDE = 2
} zeq_pixel_projection_result_t;

/* The caller owns storage and must keep it alive until the surface is done. */
int ZEQ_PixelInit(zeq_pixel_surface_t *surface, uint32_t width, uint32_t height,
                  zeq_pixel_t *storage, size_t storage_count);
void ZEQ_PixelClear(zeq_pixel_surface_t *surface);

/* RGBA8 requires alpha=255 and claimed_mask != 0. Lower depth wins, then
 * lower layer_rank, then lower owner_id. Identical keys may only repeat the
 * same color; their claim masks merge. A conflicting color is refused. */
zeq_pixel_write_result_t ZEQ_PixelWrite(zeq_pixel_surface_t *surface,
    int32_t x, int32_t y, uint32_t depth_q32, uint32_t owner_id,
    int32_t layer_rank, uint32_t claimed_mask, uint32_t rgba8);

/* Perspective projection about the viewport center:
 * x = width/2 + focal*x/z, y = height/2 - focal*y/z.
 * Inputs and outputs are rational subpixels (1/256 pixel). z must be positive.
 * Rational magnitudes are bounded by ZEQ_PIXEL_RATIONAL_LIMIT. */
zeq_pixel_projection_result_t ZEQ_PixelProject(
    zeq_pixel_rational_t x, zeq_pixel_rational_t y, zeq_pixel_rational_t z,
    zeq_pixel_rational_t focal, uint32_t width, uint32_t height,
    zeq_pixel_point_t *output);

/* Half-open clipped ranges [start,end), in integer pixel coordinates derived
 * from rational endpoints. Reversed/malformed ranges return -1; off-screen or
 * degenerate ranges return 0. Otherwise the return is the number of accepted
 * writes. Arbitration is per pixel and partial prior writes are not rolled back
 * if a later same-key color conflict is encountered. */
int ZEQ_PixelSpan(zeq_pixel_surface_t *surface, int32_t y,
    zeq_pixel_rational_t start, zeq_pixel_rational_t end,
    uint32_t depth_q32, uint32_t owner_id, int32_t layer_rank,
    uint32_t claimed_mask, uint32_t rgba8);
int ZEQ_PixelColumn(zeq_pixel_surface_t *surface, int32_t x,
    zeq_pixel_rational_t start, zeq_pixel_rational_t end,
    uint32_t depth_q32, uint32_t owner_id, int32_t layer_rank,
    uint32_t claimed_mask, uint32_t rgba8);

/* Canonical little-endian bytes include format magic and dimensions. Frame
 * records carry RGBA8 only; occupancy records carry depth/owner/layer/claims.
 * A return of zero means invalid arguments or insufficient output capacity. */
size_t ZEQ_PixelFrameSize(const zeq_pixel_surface_t *surface);
size_t ZEQ_PixelOccupancySize(const zeq_pixel_surface_t *surface);
size_t ZEQ_PixelFrameBytes(const zeq_pixel_surface_t *surface,
                           uint8_t *output, size_t capacity);
size_t ZEQ_PixelOccupancyBytes(const zeq_pixel_surface_t *surface,
                               uint8_t *output, size_t capacity);

#ifdef __cplusplus
}
#endif

#endif /* ZEQ_PIXEL_H */
