/* Exact C99 adapter for zeq-chamber-v1; independent of Doom and host clocks. */
#include "zeq_chamber.h"
#include <string.h>

static uint32_t next_random(uint32_t value)
{
    value ^= value << 13;
    value ^= value >> 17;
    value ^= value << 5;
    return value;
}

static int32_t clamp_speed(int64_t value)
{
    if (value < -ZEQ_CHAMBER_MAX_SPEED) return -ZEQ_CHAMBER_MAX_SPEED;
    if (value > ZEQ_CHAMBER_MAX_SPEED) return ZEQ_CHAMBER_MAX_SPEED;
    return (int32_t)value;
}

static zeq_chamber_status reflect(int64_t input, int32_t *output)
{
    int bounces = 0;
    while (input < -ZEQ_CHAMBER_LIMIT || input > ZEQ_CHAMBER_LIMIT)
    {
        input = input > ZEQ_CHAMBER_LIMIT
            ? 2 * (int64_t)ZEQ_CHAMBER_LIMIT - input
            : -2 * (int64_t)ZEQ_CHAMBER_LIMIT - input;
        if (++bounces > 8) return ZEQ_CHAMBER_LIMIT_EXCEEDED;
    }
    *output = (int32_t)input;
    return ZEQ_CHAMBER_OK;
}

zeq_chamber_status zeq_chamber_init(zeq_chamber *state, uint32_t seed, uint16_t particles)
{
    uint16_t i;
    if (!state || particles < 1 || particles > ZEQ_CHAMBER_MAX_PARTICLES)
        return ZEQ_CHAMBER_INVALID_INPUT;
    memset(state, 0, sizeof(*state));
    state->seed = seed;
    state->rng = seed ? seed : UINT32_C(0x6d2b79f5);
    state->count = particles;
    for (i = 0; i < particles; i++)
    {
        zeq_chamber_particle *p = &state->particles[i];
        state->rng = next_random(state->rng);
        p->x = (int32_t)(state->rng % ((uint32_t)ZEQ_CHAMBER_LIMIT + 1u)) - ZEQ_CHAMBER_LIMIT / 2;
        state->rng = next_random(state->rng);
        p->y = (int32_t)(state->rng % ((uint32_t)ZEQ_CHAMBER_LIMIT + 1u)) - ZEQ_CHAMBER_LIMIT / 2;
        state->rng = next_random(state->rng);
        p->vx = (int32_t)(state->rng & 511u) - 256;
        state->rng = next_random(state->rng);
        p->vy = (int32_t)(state->rng & 511u) - 256;
    }
    return ZEQ_CHAMBER_OK;
}

zeq_chamber_status zeq_chamber_step(zeq_chamber *state, zeq_chamber_command command)
{
    uint16_t i;
    zeq_chamber next;
    if (!state || state->count < 1 || state->count > ZEQ_CHAMBER_MAX_PARTICLES
        || state->tic >= ZEQ_CHAMBER_MAX_TICS) return ZEQ_CHAMBER_INVALID_INPUT;
    memcpy(&next, state, sizeof(next));
    for (i = 0; i < next.count; i++)
    {
        zeq_chamber_particle *p = &next.particles[i];
        zeq_chamber_status status;
        p->vx = clamp_speed((int64_t)p->vx + command.ax);
        p->vy = clamp_speed((int64_t)p->vy + command.ay);
        status = reflect((int64_t)p->x + p->vx, &p->x);
        if (status != ZEQ_CHAMBER_OK) return status;
        status = reflect((int64_t)p->y + p->vy, &p->y);
        if (status != ZEQ_CHAMBER_OK) return status;
    }
    next.tic++;
    memcpy(state, &next, sizeof(next));
    return ZEQ_CHAMBER_OK;
}

size_t zeq_chamber_state_size(const zeq_chamber *state)
{
    if (!state || state->count < 1 || state->count > ZEQ_CHAMBER_MAX_PARTICLES) return 0;
    return 24u + (size_t)state->count * 16u;
}

static void write16(uint8_t *p, uint16_t value)
{
    p[0] = (uint8_t)value; p[1] = (uint8_t)(value >> 8);
}
static void write32(uint8_t *p, uint32_t value)
{
    p[0] = (uint8_t)value; p[1] = (uint8_t)(value >> 8);
    p[2] = (uint8_t)(value >> 16); p[3] = (uint8_t)(value >> 24);
}

zeq_chamber_status zeq_chamber_canonical(const zeq_chamber *state, uint8_t *output, size_t capacity)
{
    uint16_t i;
    size_t size = zeq_chamber_state_size(state);
    if (!size || !output) return ZEQ_CHAMBER_INVALID_INPUT;
    if (capacity < size) return ZEQ_CHAMBER_SHORT_BUFFER;
    memset(output, 0, size);
    memcpy(output, "ZEQCHM1\0", 8);
    write32(output + 8, state->tic); write16(output + 12, state->count);
    write32(output + 16, state->seed); write32(output + 20, state->rng);
    for (i = 0; i < state->count; i++)
    {
        const zeq_chamber_particle *p = &state->particles[i];
        uint8_t *target = output + 24u + (size_t)i * 16u;
        write32(target, (uint32_t)p->x); write32(target + 4, (uint32_t)p->y);
        write32(target + 8, (uint32_t)p->vx); write32(target + 12, (uint32_t)p->vy);
    }
    return ZEQ_CHAMBER_OK;
}
