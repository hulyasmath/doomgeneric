#include "../zeq_time.h"
#include "zeq_test_vectors.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>

#define CHECK(condition) do { if (!(condition)) { fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #condition); exit(1); } } while (0)

int main(void)
{
    size_t i;
    zeq_instant_t instant;
    zeq_lapse_t lapse;
    int ok;
    for (i = 0; i < ZEQ_TEST_NS_COUNT; i++)
    {
        CHECK(ZEQ_TimeFromNs(zeq_test_ns[i].input, &instant));
        CHECK(instant.tick == zeq_test_ns[i].tick);
        CHECK(instant.phase64 == zeq_test_ns[i].phase64);
    }
    for (i = 0; i < ZEQ_TEST_TIC_COUNT; i++)
    {
        CHECK(ZEQ_TimeFromTic(zeq_test_tic[i].input, 35, &instant));
        CHECK(instant.tick == zeq_test_tic[i].tick);
        CHECK(instant.phase64 == zeq_test_tic[i].phase64);
    }
    for (i = 0; i < ZEQ_TEST_LAPSE_COUNT; i++)
    {
        CHECK(ZEQ_LapseAt(zeq_test_lapse[i].phase64, &lapse));
        CHECK(lapse.sine_q30 == zeq_test_lapse[i].sine);
        CHECK(lapse.cosine_q30 == zeq_test_lapse[i].cosine);
        CHECK(lapse.carrier_q30 == zeq_test_lapse[i].carrier);
        CHECK(lapse.lapse2_q30 == zeq_test_lapse[i].lapse2);
        CHECK(lapse.lapse_q30 == zeq_test_lapse[i].lapse);
        CHECK(lapse.dln_cycle_q40 == zeq_test_lapse[i].derivative);
    }
    CHECK(!ZEQ_TimeFromTic(-1, 35, &instant));
    CHECK(!ZEQ_TimeFromTic(0, 0, &instant));
    CHECK(!ZEQ_TimeFromNs(0, NULL));
    CHECK(ZEQ_RoundDivI64(1, 2, &ok) == 0 && ok);
    CHECK(ZEQ_RoundDivI64(3, 2, &ok) == 2 && ok);
    CHECK(ZEQ_RoundDivI64(-1, 2, &ok) == 0 && ok);
    CHECK(ZEQ_RoundDivI64(-3, 2, &ok) == -2 && ok);
    CHECK(ZEQ_RoundDivI64(1, 0, &ok) == 0 && !ok);
    CHECK(ZEQ_Isqrt64(0) == 0);
    CHECK(ZEQ_Isqrt64(1) == 1);
    CHECK(ZEQ_Isqrt64(2) == 1);
    CHECK(ZEQ_Isqrt64(4) == 2);
    CHECK(ZEQ_Isqrt64(UINT64_MAX) == UINT32_MAX);
    printf("C OK: %zu ns + %zu tic + %zu lapse vectors; negative tests OK\n",
           ZEQ_TEST_NS_COUNT, ZEQ_TEST_TIC_COUNT, ZEQ_TEST_LAPSE_COUNT);
    return 0;
}
