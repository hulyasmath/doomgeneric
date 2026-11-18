// Null platform for deterministic, headless execution of the real engine.
#include "doomgeneric.h"
#include "doomstat.h"
#include "zeq_headless.h"

#include <stdint.h>
#include <stdio.h>
#include <time.h>

static uint32_t realtime_origin;

static uint32_t monotonic_ms(void)
{
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return (uint32_t)(now.tv_sec * 1000u + now.tv_nsec / 1000000u);
}

void DG_Init(void)
{
    realtime_origin = monotonic_ms();
    ZEQ_HeadlessInit();
}

void DG_DrawFrame(void) {}
void DG_SetWindowTitle(const char *title) { (void)title; }
int DG_GetKey(int *pressed, unsigned char *key)
{
    (void)pressed;
    (void)key;
    return 0;
}

uint32_t DG_GetTicksMs(void)
{
    ZEQ_HeadlessPump();
    if (ZEQ_HeadlessRealtime())
        return monotonic_ms() - realtime_origin;
    return (uint32_t)((int64_t)gametic * 1000 / TICRATE);
}

void DG_SleepMs(uint32_t ms)
{
    if (!ZEQ_HeadlessRealtime()) return;
    {
        struct timespec delay;
        delay.tv_sec = ms / 1000;
        delay.tv_nsec = (long)(ms % 1000) * 1000000L;
        nanosleep(&delay, NULL);
    }
}

int main(int argc, char **argv)
{
    doomgeneric_Create(argc, argv);
    while (!ZEQ_HeadlessShouldStop())
    {
        ZEQ_HeadlessPump();
        doomgeneric_Tick();
    }
    return 0;
}
