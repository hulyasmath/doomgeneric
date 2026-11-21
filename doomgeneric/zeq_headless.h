#ifndef ZEQ_HEADLESS_H
#define ZEQ_HEADLESS_H

#include "d_ticcmd.h"
#include "d_think.h"
#include <stdint.h>

void ZEQ_HeadlessInit(void);
void ZEQ_HeadlessPump(void);
int ZEQ_HeadlessBuildTiccmd(ticcmd_t *cmd, int maketic);
int ZEQ_HeadlessInputFailed(void);
void ZEQ_HeadlessAfterTic(void);
void ZEQ_HeadlessFlushVisual(void);
int ZEQ_HeadlessStateHash(int completed_tics, char output[65]);
int ZEQ_HeadlessShouldStop(void);
int ZEQ_HeadlessRealtime(void);
int ZEQ_ThinkerArchived(thinker_t *th);
int32_t ZEQ_CanonicalPointer(void *pointer);
int32_t ZEQ_CanonicalAction(actionf_p1 action);
void ZEQ_CanonicalSetInterval(int32_t interval);
void ZEQ_CanonicalAfterTic(void);
int32_t ZEQ_CanonicalRead(void);
uint8_t *ZEQ_CanonicalData(void);
int32_t ZEQ_CanonicalDropped(void);
int32_t ZEQ_CanonicalErrors(void);

#endif
