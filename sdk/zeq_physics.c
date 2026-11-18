#include "zeq_physics.h"
#include "zeq_time.h"

#include <limits.h>
#include <stddef.h>

#if !defined(__SIZEOF_INT128__)
#error "ZEQ physics requires a compiler with checked 128-bit integer support"
#endif

typedef __int128 zeq_i128_t;

#define ZEQ_H_NUM INT64_C(1000000000)
#define ZEQ_Q40_ONE (INT64_C(1) << 40)

static int zeq_round_i32(zeq_i128_t numerator, zeq_i128_t denominator, int32_t *out)
{
    zeq_i128_t quotient;
    zeq_i128_t remainder;
    int negative;
    if (!out || denominator <= 0) return 0;
    negative = numerator < 0;
    if (negative) numerator = -numerator;
    quotient = numerator / denominator;
    remainder = numerator % denominator;
    if (remainder * 2 > denominator
        || (remainder * 2 == denominator && (quotient & 1)))
        quotient++;
    if (negative) quotient = -quotient;
    if (quotient < INT32_MIN || quotient > INT32_MAX) return 0;
    *out = (int32_t)quotient;
    return 1;
}

static int zeq_add_i32(int32_t a, int32_t b, int32_t *out)
{
    int64_t sum = (int64_t)a + b;
    if (sum < INT32_MIN || sum > INT32_MAX) return 0;
    *out = (int32_t)sum;
    return 1;
}

static void zeq_metrics_alpha(uint64_t phase64, int32_t alpha_num,
                              int32_t *lapse2_q30, int64_t *dln_cycle_q40)
{
    if (alpha_num == 0)
    {
        *lapse2_q30 = ZEQ_Q30_ONE;
        *dln_cycle_q40 = 0;
    }
    else
    {
        *lapse2_q30 = ZEQ_Lapse2Q30(phase64);
        *dln_cycle_q40 = ZEQ_DlnCycleQ40(phase64);
    }
}

int ZEQ_IntegrateTicAlpha(int64_t gametic, int32_t tick_rate,
                          int32_t velocity, int32_t acceleration,
                          int32_t impulse, int32_t substeps,
                          int32_t alpha_num, zeq_step_t *out)
{
    zeq_i128_t h_den;
    int64_t initial_velocity = velocity;
    int64_t midpoint_sum = 0;
    int64_t applied_force = 0;
    int64_t applied_drag = 0;
    int32_t step;
    int32_t delta_velocity;
    int32_t total_force;
    int32_t total_drag;
    zeq_instant_t instant;
    int k;

    if (!out || gametic < 0 || tick_rate <= 0 || substeps <= 0
        || substeps > 1024 || (alpha_num != 0 && alpha_num != ZEQ_ALPHA_NUM))
        return 0;

    /* Every scaled tic/rate below is passed through a signed C integer API.
     * Reject domains whose intermediate expressions could overflow before
     * evaluating them. Ordinary Doom uses gametic >= 0, rate 35, S <= 32. */
    if (tick_rate > INT32_MAX / (2 * substeps)
        || gametic > (INT64_MAX / 2 - (substeps - 1)) / substeps)
        return 0;
    h_den = (zeq_i128_t)tick_rate * ZEQ_ZEQOND_NS;

    for (k = 0; k < substeps; k++)
    {
        zeq_instant_t start;
        zeq_instant_t middle;
        int32_t start_n2;
        int32_t middle_n2;
        int64_t start_d;
        int64_t middle_d;
        int64_t acceleration_tic = acceleration;
        int32_t drag;
        int32_t force;
        int32_t midpoint;
        int32_t next;

        if (!ZEQ_TimeFromTic(gametic * substeps + k,
                             tick_rate * substeps, &start)
            || !ZEQ_TimeFromTic(2 * (gametic * substeps + k) + 1,
                                2 * tick_rate * substeps, &middle))
            return 0;

        if (impulse)
        {
            uint64_t half_phase = (uint64_t)(((zeq_i128_t)(2 * k + 1) << 63)
                                             / (2 * substeps));
            int32_t sine_q30 = ZEQ_SinQ30(half_phase);
            int32_t impulse_force;
            if (!zeq_round_i32((zeq_i128_t)ZEQ_PI_Q40 * impulse * sine_q30,
                               (zeq_i128_t)2 * ZEQ_Q40_ONE * ZEQ_Q30_ONE,
                               &impulse_force))
                return 0;
            acceleration_tic += impulse_force;
        }

        zeq_metrics_alpha(start.phase64, alpha_num, &start_n2, &start_d);
        zeq_metrics_alpha(middle.phase64, alpha_num, &middle_n2, &middle_d);

        if (!zeq_round_i32((zeq_i128_t)ZEQ_H_NUM * start_d * velocity,
                           (zeq_i128_t)2 * substeps * h_den * ZEQ_Q40_ONE,
                           &drag)
            || !zeq_round_i32((zeq_i128_t)start_n2 * acceleration_tic,
                              (zeq_i128_t)2 * substeps * ZEQ_Q30_ONE,
                              &force)
            || !zeq_add_i32(velocity, drag, &midpoint)
            || !zeq_add_i32(midpoint, force, &midpoint))
            return 0;

        midpoint_sum += midpoint;

        if (!zeq_round_i32((zeq_i128_t)ZEQ_H_NUM * middle_d * midpoint,
                           (zeq_i128_t)substeps * h_den * ZEQ_Q40_ONE,
                           &drag)
            || !zeq_round_i32((zeq_i128_t)middle_n2 * acceleration_tic,
                              (zeq_i128_t)substeps * ZEQ_Q30_ONE,
                              &force)
            || !zeq_add_i32(velocity, drag, &next)
            || !zeq_add_i32(next, force, &next))
            return 0;

        applied_drag += drag;
        applied_force += force;
        velocity = next;
    }

    if (!zeq_round_i32(midpoint_sum, substeps, &step)
        || !zeq_round_i32((zeq_i128_t)velocity - initial_velocity, 1, &delta_velocity)
        || !zeq_round_i32(applied_force, 1, &total_force)
        || !zeq_round_i32(applied_drag, 1, &total_drag))
        return 0;
    if (!ZEQ_TimeFromTic(gametic, tick_rate, &instant)) return 0;
    out->start_phase64 = instant.phase64;
    if (!ZEQ_TimeFromTic(gametic + 1, tick_rate, &instant)) return 0;
    out->end_phase64 = instant.phase64;
    out->position_delta = step;
    out->velocity = velocity;
    out->delta_velocity = delta_velocity;
    out->position_residual = (int32_t)(midpoint_sum - (int64_t)step * substeps);
    out->applied_force = total_force;
    out->applied_drag = total_drag;
    return 1;
}

int ZEQ_IntegrateTic(int64_t gametic, int32_t tick_rate,
                     int32_t velocity, int32_t acceleration,
                     int32_t impulse, zeq_step_t *out)
{
    return ZEQ_IntegrateTicAlpha(gametic, tick_rate, velocity, acceleration,
                                 impulse, impulse ? ZEQ_IMPULSE_SUBSTEPS : 1,
                                 ZEQ_ALPHA_NUM, out);
}

int ZEQ_CooldownReadyTic(int64_t start_tic, int32_t tick_rate,
                         int64_t duration_num, int64_t duration_den,
                         int64_t *ready_tic)
{
    zeq_i128_t numerator;
    zeq_i128_t denominator;
    zeq_i128_t offset;
    zeq_i128_t ready;
    if (!ready_tic || start_tic < 0 || tick_rate <= 0
        || duration_num <= 0 || duration_den <= 0)
        return 0;
    numerator = (zeq_i128_t)duration_num * tick_rate * ZEQ_ZEQOND_NS;
    denominator = (zeq_i128_t)duration_den * INT64_C(1000000000);
    offset = (numerator + denominator - 1) / denominator;
    ready = (zeq_i128_t)start_tic + offset;
    if (ready < 0 || ready > INT64_MAX) return 0;
    *ready_tic = (int64_t)ready;
    return 1;
}
