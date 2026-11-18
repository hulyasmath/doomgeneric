#ifndef ZEQ_SHA256_H
#define ZEQ_SHA256_H

#include <stddef.h>
#include <stdint.h>

typedef struct
{
    uint32_t state[8];
    uint64_t bytes;
    uint8_t block[64];
    size_t used;
} zeq_sha256_t;

void ZEQ_SHA256_Init(zeq_sha256_t *context);
void ZEQ_SHA256_Update(zeq_sha256_t *context, const void *data, size_t length);
void ZEQ_SHA256_Final(zeq_sha256_t *context, uint8_t digest[32]);

#endif
