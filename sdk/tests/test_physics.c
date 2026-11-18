#include "../zeq_physics.h"
#include "../zeq_time.h"
#include "zeq_test_physics_vectors.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>

#define CHECK(condition) do { if (!(condition)) { fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #condition); exit(1); } } while (0)

int main(void)
{
    size_t i;
    zeq_step_t step;
    int64_t ready;
    for (i = 0; i < ZEQ_TEST_STEPS_COUNT; i++)
    {
        const zeq_test_step_vector_t *v = &zeq_test_steps[i];
        CHECK(ZEQ_IntegrateTicAlpha(v->gametic, v->tick_rate, v->initial,
                                    v->acceleration, v->impulse, v->substeps,
                                    v->alpha, &step));
        CHECK(step.position_delta == v->position);
        CHECK(step.velocity == v->velocity);
        CHECK(step.delta_velocity == v->delta);
        CHECK(step.position_residual == v->residual);
        CHECK(step.applied_force == v->force);
        CHECK(step.applied_drag == v->drag);
        CHECK(step.start_phase64 == v->start_phase);
        CHECK(step.end_phase64 == v->end_phase);
    }
    for (i = 0; i < ZEQ_TEST_COOLDOWNS_COUNT; i++)
    {
        const zeq_test_cooldown_vector_t *v = &zeq_test_cooldowns[i];
        CHECK(ZEQ_CooldownReadyTic(v->start, v->tick_rate, v->numerator,
                                   v->denominator, &ready));
        CHECK(ready == v->ready);
    }
    CHECK(ZEQ_IntegrateTicAlpha(9, 35, 0, 0, 0, 1, ZEQ_ALPHA_NUM, &step));
    CHECK(step.position_delta == 0 && step.velocity == 0 && step.delta_velocity == 0);
    CHECK(!ZEQ_IntegrateTicAlpha(-1, 35, 0, 0, 0, 1, ZEQ_ALPHA_NUM, &step));
    CHECK(!ZEQ_IntegrateTicAlpha(0, 0, 0, 0, 0, 1, ZEQ_ALPHA_NUM, &step));
    CHECK(!ZEQ_IntegrateTicAlpha(0, 35, 0, 0, 0, 0, ZEQ_ALPHA_NUM, &step));
    CHECK(!ZEQ_IntegrateTicAlpha(0, 35, 0, 0, 0, 1, 1, &step));
    CHECK(!ZEQ_IntegrateTicAlpha(0, 35, 0, 0, 0, 1, ZEQ_ALPHA_NUM, NULL));
    CHECK(!ZEQ_IntegrateTicAlpha(INT64_MAX, 35, 0, 0, 0, 1, ZEQ_ALPHA_NUM, &step));
    CHECK(!ZEQ_IntegrateTicAlpha(0, INT32_MAX, 0, 0, 0, 32, ZEQ_ALPHA_NUM, &step));
    CHECK(!ZEQ_IntegrateTicAlpha(0, 35, INT32_MAX, INT32_MAX, 0, 1, 0, &step));
    CHECK(!ZEQ_CooldownReadyTic(-1, 35, 1, 1, &ready));
    CHECK(!ZEQ_CooldownReadyTic(0, 35, 0, 1, &ready));
    CHECK(!ZEQ_CooldownReadyTic(0, 35, 1, 0, &ready));
    CHECK(!ZEQ_CooldownReadyTic(0, 0, 1, 1, &ready));
    CHECK(!ZEQ_CooldownReadyTic(0, 35, 1, 1, NULL));
    printf("C OK: %zu integration + %zu cooldown vectors; zero-force and negative tests OK\n",
           ZEQ_TEST_STEPS_COUNT, ZEQ_TEST_COOLDOWNS_COUNT);
    return 0;
}
