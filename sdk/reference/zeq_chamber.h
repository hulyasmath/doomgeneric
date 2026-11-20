#ifndef ZEQ_CHAMBER_H
#define ZEQ_CHAMBER_H

#include <stddef.h>
#include <stdint.h>

#define ZEQ_CHAMBER_FORMAT "zeq-chamber-v1"
#define ZEQ_CHAMBER_SCALE 1024
#define ZEQ_CHAMBER_LIMIT 1048576
#define ZEQ_CHAMBER_MAX_SPEED 65536
#define ZEQ_CHAMBER_MAX_PARTICLES 16
#define ZEQ_CHAMBER_MAX_TICS 2000000u

typedef enum {
    ZEQ_CHAMBER_OK = 0,
    ZEQ_CHAMBER_INVALID_INPUT = 1,
    ZEQ_CHAMBER_LIMIT_EXCEEDED = 2,
    ZEQ_CHAMBER_SHORT_BUFFER = 3
} zeq_chamber_status;

typedef struct { int32_t x, y, vx, vy; } zeq_chamber_particle;
typedef struct {
    uint32_t tic, seed, rng;
    uint16_t count;
    zeq_chamber_particle particles[ZEQ_CHAMBER_MAX_PARTICLES];
} zeq_chamber;
typedef struct { int8_t ax, ay; } zeq_chamber_command;

zeq_chamber_status zeq_chamber_init(zeq_chamber *state, uint32_t seed, uint16_t particles);
zeq_chamber_status zeq_chamber_step(zeq_chamber *state, zeq_chamber_command command);
size_t zeq_chamber_state_size(const zeq_chamber *state);
zeq_chamber_status zeq_chamber_canonical(const zeq_chamber *state, uint8_t *output, size_t capacity);

#endif
