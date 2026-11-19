// Phase 6 deterministic two-peer networking for the native headless engine.
#ifndef ZEQ_NET_H
#define ZEQ_NET_H

#include "d_loop.h"

void ZEQ_NetInit(void);
int ZEQ_NetEnabled(void);
int ZEQ_NetConnect(void);
int ZEQ_NetPlayer(void);
void ZEQ_NetTryRunTics(loop_interface_t *loop);
int ZEQ_NetShouldStop(void);
void ZEQ_NetClose(void);

#endif
