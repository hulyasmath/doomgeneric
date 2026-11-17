/*
 * ZEQ PLUGIN / 0.1.0
 * Portable engine integration layer for the Zeq framework.
 *
 * Single header, no dependencies, C99. Drop it into any game or
 * simulation: it provides the exact integer carrier timebase, the
 * Zeqond clock, the phase-alignment window, and a small event ring
 * the host drains toward the sidecar bridge.
 *
 * All functions are `static`: include this header in ONE translation
 * unit of the host engine (e.g. doomgeneric includes it from its
 * platform glue). If you need it in several TUs, move the ring
 * storage behind your own singleton.
 *
 * Doom reference: doomgeneric/zeq_doom.c implements this same surface
 * against finesine[] and the 35 Hz gametic; the numbers below are
 * chosen so both agree bit-for-bit.
 */
#ifndef ZEQ_PLUGIN_H
#define ZEQ_PLUGIN_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define ZEQ_CARRIER_NUMERATOR 1287  /* carrier: 1.287 Hz */
#define ZEQ_ZEQOND_NUMERATOR   777  /* one Zeqond: 0.777 s */
#define ZEQ_WINDOW_LO_NUM       37  /* aligned window: 37/200 = 0.185 */
#define ZEQ_WINDOW_HI_NUM       63  /*                 63/200 = 0.315 */
#define ZEQ_WINDOW_DEN         200
#define ZEQ_PULSE_DEPTH         24  /* carrier pulse depth, permille */

/* --- timebase ---------------------------------------------------- */

static int64_t zeq_period(int tick_rate) { return (int64_t)tick_rate * 1000; }

/* Exact integer phase in [0, tick_rate*1000). Advances 1287/1000 of a
 * cycle per second at any tick rate, so the carrier is exactly
 * 1.287 Hz on a 35 Hz Doom gametic or a 60 Hz simulation step alike. */
static int32_t zeq_phase(int64_t gametic, int tick_rate)
{
    return (int32_t)((gametic * ZEQ_CARRIER_NUMERATOR) % zeq_period(tick_rate));
}

static int zeq_phase_aligned(int32_t phase, int tick_rate)
{
    int64_t scaled = (int64_t)phase * ZEQ_WINDOW_DEN;
    int64_t period = zeq_period(tick_rate);
    return scaled >= period * ZEQ_WINDOW_LO_NUM
        && scaled <= period * ZEQ_WINDOW_HI_NUM;
}

static int zeq_aligned(int64_t gametic, int tick_rate)
{
    return zeq_phase_aligned(zeq_phase(gametic, tick_rate), tick_rate);
}

/* Chrono-tactical Zeqond clock: integer count of 0.777 s units. */
static int64_t zeq_zeqond(int64_t gametic, int tick_rate)
{
    return (gametic * ZEQ_ZEQOND_NUMERATOR) / zeq_period(tick_rate);
}

/* --- carrier pulse ----------------------------------------------- */

/* Host-injectable Q16 sine (angle 0..65535 = one full turn).
 * Default is Bhaskara I's rational approximation, accurate to ~0.2%;
 * engines with a lookup table (Doom: finesine[]) should inject it so
 * gameplay math stays exactly on the engine's own table. */
typedef int32_t (*zeq_sine_fn)(uint16_t angle);

static int32_t zeq_sin_q16_default(uint16_t angle)
{
    /* Bhaskara I: sin(x) ~= 4x(180-x) / (40500 - x(180-x)), x in deg. */
    int64_t x = ((int32_t)angle * 360) >> 16; /* 0..359 */
    int64_t ax;
    int64_t v;
    if (x > 180) x -= 360;                    /* -180..179 */
    ax = x < 0 ? -x : x;
    v = ((4 * ax * (180 - ax)) << 16) / (40500 - ax * (180 - ax));
    return (int32_t)(x < 0 ? -v : v);
}

static zeq_sine_fn zeq__sine = zeq_sin_q16_default;

static void zeq_set_sine(zeq_sine_fn fn)
{
    zeq__sine = fn ? fn : zeq_sin_q16_default;
}

/* R(t) in permille, 1000 = unity. Range 1000 +/- ZEQ_PULSE_DEPTH. */
static int32_t zeq_carrier_permille(int32_t phase, int tick_rate)
{
    uint16_t angle = (uint16_t)(((int64_t)phase * 65536) / zeq_period(tick_rate));
    return 1000 + (int32_t)(((int64_t)ZEQ_PULSE_DEPTH * zeq__sine(angle)) >> 16);
}

/* --- event ring --------------------------------------------------- */

#define ZEQ_EVENT_RING 32

typedef struct zeq_event_s {
    int32_t type;
    int64_t tic;
    int32_t phase;
    int64_t value;
} zeq_event_t;

typedef struct zeq_host_s {
    int tick_rate;
    zeq_event_t ring[ZEQ_EVENT_RING];
    int head;  /* next write */
    int tail;  /* next read  */
    int dropped;
    /* Optional sink called inline for hosts that stream events
     * directly (the sidecar bridge drains the ring instead). */
    void (*emit)(const zeq_event_t *event, void *user);
    void *user;
} zeq_host_t;

static void zeq_host_init(zeq_host_t *host, int tick_rate)
{
    host->tick_rate = tick_rate;
    host->head = host->tail = host->dropped = 0;
    host->emit = 0;
    host->user = 0;
}

static void zeq_record(zeq_host_t *host, int32_t type, int64_t tic, int64_t value)
{
    zeq_event_t event;
    event.type = type;
    event.tic = tic;
    event.phase = zeq_phase(tic, host->tick_rate);
    event.value = value;
    if (host->emit) host->emit(&event, host->user);
    if (host->head - host->tail >= ZEQ_EVENT_RING) {
        host->tail++;      /* ring full: drop the oldest, count it */
        host->dropped++;
    }
    host->ring[host->head & (ZEQ_EVENT_RING - 1)] = event;
    host->head++;
}

/* Drain one event; returns 1 while events remain. */
static int zeq_next(zeq_host_t *host, zeq_event_t *out)
{
    if (host->tail >= host->head) return 0;
    *out = host->ring[host->tail & (ZEQ_EVENT_RING - 1)];
    host->tail++;
    return 1;
}

#ifdef __cplusplus
}
#endif

#endif /* ZEQ_PLUGIN_H */
