#ifndef ZEQ_HEADLESS_H
#define ZEQ_HEADLESS_H

#include "d_ticcmd.h"
#include "d_think.h"
#include <stdint.h>

void ZEQ_HeadlessInit(void);
void ZEQ_HeadlessPump(void);
int ZEQ_HeadlessBuildTiccmd(ticcmd_t *cmd, int maketic);
void ZEQ_HeadlessAfterTic(void);
int ZEQ_HeadlessShouldStop(void);
int ZEQ_HeadlessRealtime(void);
int32_t ZEQ_CanonicalPointer(void *pointer);
int32_t ZEQ_CanonicalAction(actionf_p1 action);

#endif
