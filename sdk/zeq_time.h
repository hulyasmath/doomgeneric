/* Exact Zeq time and deterministic fixed-point arithmetic. C99 + GCC/Clang i128. */
#ifndef ZEQ_TIME_H
#define ZEQ_TIME_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define ZEQ_TIME_FORMAT "zeq-time-v1"
#define ZEQ_ZEQOND_NS INT64_C(777000777)
#define ZEQ_ALPHA_NUM INT32_C(129)
#define ZEQ_ALPHA_DEN INT32_C(100000)
#define ZEQ_Q30_ONE INT32_C(1073741824)
#define ZEQ_PI_Q40 INT64_C(3454217652358)

typedef struct
{
    int64_t tick;
    uint64_t phase64;
} zeq_instant_t;

typedef struct
{
    int32_t sine_q30;
    int32_t cosine_q30;
    int32_t carrier_q30;
    int32_t lapse2_q30;
    int32_t lapse_q30;
    int64_t dln_cycle_q40;
} zeq_lapse_t;

/* Return zero on invalid input or arithmetic overflow. */
int ZEQ_TimeFromNs(int64_t ns, zeq_instant_t *out);
int ZEQ_TimeFromTic(int64_t gametic, int32_t tick_rate, zeq_instant_t *out);
int ZEQ_LapseAt(uint64_t phase64, zeq_lapse_t *out);

int32_t ZEQ_SinQ30(uint64_t phase64);
int32_t ZEQ_CosQ30(uint64_t phase64);
int32_t ZEQ_CarrierQ30(uint64_t phase64);
int32_t ZEQ_Lapse2Q30(uint64_t phase64);
int32_t ZEQ_LapseQ30(uint64_t phase64);
int64_t ZEQ_DlnCycleQ40(uint64_t phase64);
uint32_t ZEQ_Isqrt64(uint64_t value);
int64_t ZEQ_RoundDivI64(int64_t numerator, int64_t denominator, int *ok);

#ifdef __cplusplus
}
#endif

#endif /* ZEQ_TIME_H */
