#ifndef ZEQ_CAPTURE_H
#define ZEQ_CAPTURE_H

#include "d_ticcmd.h"
#include <stdint.h>

void ZEQ_CaptureTiccmd(int gametic, const ticcmd_t *command);
void ZEQ_CaptureReset(void);
int32_t ZEQ_CaptureRead(int32_t maximum_records);
uint8_t *ZEQ_CaptureData(void);
int32_t ZEQ_CaptureDropped(void);

#endif
