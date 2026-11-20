// Optional visual evidence for the real Doom indexed framebuffer.
// No function in this interface participates in canonical gameplay state.
#ifndef ZEQ_VISUAL_H
#define ZEQ_VISUAL_H

#include <stddef.h>
#include <stdint.h>

#define ZEQ_VISUAL_FORMAT "zeq-doom-visual-v1"
#define ZEQ_VISUAL_RECORD_BYTES 144
#define ZEQ_VISUAL_IDENTITY_BYTES 2048

void ZEQ_VisualSetInterval(int32_t interval);
int ZEQ_VisualEnabled(void);
void ZEQ_VisualContentChanged(void);
void ZEQ_VisualBindContent(void);
void ZEQ_VisualPresent(const uint8_t *indexed, uint32_t width, uint32_t height,
                       const uint8_t *palette_rgb, int gamma, int detail);
int32_t ZEQ_VisualRead(void);
uint8_t *ZEQ_VisualData(void);
int32_t ZEQ_VisualDropped(void);
int32_t ZEQ_VisualErrors(void);
const char *ZEQ_VisualIdentity(void);
int32_t ZEQ_VisualSelectFrame(int32_t gametic);
uint8_t *ZEQ_VisualFrameData(void);
uint8_t *ZEQ_VisualOccupancyData(void);
int32_t ZEQ_VisualFrameSize(void);
int32_t ZEQ_VisualOccupancySize(void);
int ZEQ_VisualWriteLatest(const char *directory);

#endif
