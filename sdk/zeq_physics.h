/* Deterministic Zeq lapse integration in Doom 16.16 momentum units. */
#ifndef ZEQ_PHYSICS_H
#define ZEQ_PHYSICS_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define ZEQ_PHYSICS_FORMAT "zeq-physics-v1"
#define ZEQ_IMPULSE_FORMAT "zeq-impulse-half-sine-v1"
#define ZEQ_IMPULSE_SUBSTEPS 32

typedef struct
{
    int32_t position_delta;
    int32_t velocity;
    int32_t delta_velocity;
    int32_t position_residual;
    int32_t applied_force;
    int32_t applied_drag;
    uint64_t start_phase64;
    uint64_t end_phase64;
} zeq_step_t;

/* velocity/acceleration/impulse use Doom 16.16 units per tic. */
int ZEQ_IntegrateTicAlpha(int64_t gametic, int32_t tick_rate,
                          int32_t velocity, int32_t acceleration,
                          int32_t impulse, int32_t substeps,
                          int32_t alpha_num, zeq_step_t *out);
int ZEQ_IntegrateTic(int64_t gametic, int32_t tick_rate,
                     int32_t velocity, int32_t acceleration,
                     int32_t impulse, zeq_step_t *out);
int ZEQ_CooldownReadyTic(int64_t start_tic, int32_t tick_rate,
                         int64_t duration_num, int64_t duration_den,
                         int64_t *ready_tic);

#ifdef __cplusplus
}
#endif

#endif /* ZEQ_PHYSICS_H */
