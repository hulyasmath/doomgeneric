#include "zeq_time.h"

#include <limits.h>
#include <stddef.h>

#if !defined(__SIZEOF_INT128__)
#error "ZEQ time requires a compiler with checked 128-bit integer support"
#endif

typedef __int128 zeq_i128_t;
typedef unsigned __int128 zeq_u128_t;

#include "zeq_sine_q30.inc"

static int64_t zeq_round_div_i128(zeq_i128_t numerator, zeq_i128_t denominator)
{
    zeq_i128_t quotient;
    zeq_i128_t remainder;
    int negative = numerator < 0;
    if (negative) numerator = -numerator;
    quotient = numerator / denominator;
    remainder = numerator % denominator;
    if (remainder * 2 > denominator
        || (remainder * 2 == denominator && (quotient & 1)))
        quotient++;
    return (int64_t)(negative ? -quotient : quotient);
}

/* Exact floor(remainder * 2^64 / denominator), without a 128-bit shift. */
static uint64_t zeq_phase64_ratio(uint64_t remainder, uint64_t denominator)
{
    uint64_t quotient = 0;
    int bit;
    for (bit = 0; bit < 64; bit++)
    {
        uint64_t next = 0;
        /* remainder * 2 >= denominator, evaluated without overflow. */
        if (remainder >= denominator - remainder)
        {
            remainder -= denominator - remainder;
            next = 1;
        }
        else
        {
            remainder += remainder;
        }
        quotient = (quotient << 1) | next;
    }
    return quotient;
}

int ZEQ_TimeFromNs(int64_t ns, zeq_instant_t *out)
{
    int64_t tick;
    int64_t remainder;
    if (!out) return 0;
    tick = ns / ZEQ_ZEQOND_NS;
    remainder = ns % ZEQ_ZEQOND_NS;
    if (remainder < 0)
    {
        remainder += ZEQ_ZEQOND_NS;
        tick--;
    }
    out->tick = tick;
    out->phase64 = zeq_phase64_ratio((uint64_t)remainder, (uint64_t)ZEQ_ZEQOND_NS);
    return 1;
}

int ZEQ_TimeFromTic(int64_t gametic, int32_t tick_rate, zeq_instant_t *out)
{
    zeq_i128_t numerator;
    zeq_i128_t denominator;
    zeq_i128_t tick;
    uint64_t remainder;
    if (!out || gametic < 0 || tick_rate <= 0) return 0;
    numerator = (zeq_i128_t)gametic * INT64_C(1000000000);
    denominator = (zeq_i128_t)tick_rate * ZEQ_ZEQOND_NS;
    tick = numerator / denominator;
    if (tick > INT64_MAX) return 0;
    remainder = (uint64_t)(numerator % denominator);
    out->tick = (int64_t)tick;
    out->phase64 = zeq_phase64_ratio(remainder, (uint64_t)denominator);
    return 1;
}

int32_t ZEQ_SinQ30(uint64_t phase64)
{
    const uint64_t fraction_mask = (UINT64_C(1) << 52) - 1;
    uint32_t index = (uint32_t)(phase64 >> 52);
    uint64_t fraction = phase64 & fraction_mask;
    int32_t base = zeq_sine_table_q30[index];
    int32_t delta = zeq_sine_table_q30[index + 1] - base;
    zeq_i128_t product = (zeq_i128_t)delta * fraction;
    return base + (int32_t)zeq_round_div_i128(product, (zeq_i128_t)1 << 52);
}

int32_t ZEQ_CosQ30(uint64_t phase64)
{
    return ZEQ_SinQ30(phase64 + (UINT64_C(1) << 62));
}

int32_t ZEQ_CarrierQ30(uint64_t phase64)
{
    return ZEQ_Q30_ONE + (int32_t)zeq_round_div_i128(
        (zeq_i128_t)ZEQ_ALPHA_NUM * ZEQ_SinQ30(phase64), ZEQ_ALPHA_DEN);
}

int32_t ZEQ_Lapse2Q30(uint64_t phase64)
{
    return ZEQ_Q30_ONE - (int32_t)zeq_round_div_i128(
        (zeq_i128_t)ZEQ_ALPHA_NUM * ZEQ_SinQ30(phase64), ZEQ_ALPHA_DEN);
}

uint32_t ZEQ_Isqrt64(uint64_t value)
{
    uint64_t result = 0;
    uint64_t bit = UINT64_C(1) << 62;
    while (bit > value) bit >>= 2;
    while (bit)
    {
        if (value >= result + bit)
        {
            value -= result + bit;
            result = (result >> 1) + bit;
        }
        else
        {
            result >>= 1;
        }
        bit >>= 2;
    }
    return (uint32_t)result;
}

int32_t ZEQ_LapseQ30(uint64_t phase64)
{
    uint64_t radicand = (uint64_t)(uint32_t)ZEQ_Lapse2Q30(phase64) << 30;
    return (int32_t)ZEQ_Isqrt64(radicand);
}

int64_t ZEQ_DlnCycleQ40(uint64_t phase64)
{
    zeq_i128_t numerator = -(zeq_i128_t)ZEQ_ALPHA_NUM * ZEQ_PI_Q40 * ZEQ_CosQ30(phase64);
    zeq_i128_t denominator = (zeq_i128_t)ZEQ_ALPHA_DEN * ZEQ_Lapse2Q30(phase64);
    return zeq_round_div_i128(numerator, denominator);
}

int ZEQ_LapseAt(uint64_t phase64, zeq_lapse_t *out)
{
    if (!out) return 0;
    out->sine_q30 = ZEQ_SinQ30(phase64);
    out->cosine_q30 = ZEQ_CosQ30(phase64);
    out->carrier_q30 = ZEQ_CarrierQ30(phase64);
    out->lapse2_q30 = ZEQ_Lapse2Q30(phase64);
    out->lapse_q30 = ZEQ_LapseQ30(phase64);
    out->dln_cycle_q40 = ZEQ_DlnCycleQ40(phase64);
    return 1;
}

int64_t ZEQ_RoundDivI64(int64_t numerator, int64_t denominator, int *ok)
{
    if (ok) *ok = 0;
    if (denominator <= 0) return 0;
    if (ok) *ok = 1;
    return zeq_round_div_i128((zeq_i128_t)numerator, (zeq_i128_t)denominator);
}
