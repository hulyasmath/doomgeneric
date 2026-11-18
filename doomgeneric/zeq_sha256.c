// SHA-256 (FIPS 180-4), used only for canonical engine-state checkpoints.
#include "zeq_sha256.h"
#include <string.h>

static const uint32_t constants[64] = {
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
};

static uint32_t rotate(uint32_t value, unsigned int count)
{
    return (value >> count) | (value << (32 - count));
}

static void transform(zeq_sha256_t *context, const uint8_t block[64])
{
    uint32_t words[64];
    uint32_t a, b, c, d, e, f, g, h;
    int i;
    for (i = 0; i < 16; i++)
    {
        words[i] = ((uint32_t)block[i * 4] << 24)
                 | ((uint32_t)block[i * 4 + 1] << 16)
                 | ((uint32_t)block[i * 4 + 2] << 8)
                 | block[i * 4 + 3];
    }
    for (i = 16; i < 64; i++)
    {
        const uint32_t s0 = rotate(words[i - 15], 7) ^ rotate(words[i - 15], 18) ^ (words[i - 15] >> 3);
        const uint32_t s1 = rotate(words[i - 2], 17) ^ rotate(words[i - 2], 19) ^ (words[i - 2] >> 10);
        words[i] = words[i - 16] + s0 + words[i - 7] + s1;
    }
    a = context->state[0]; b = context->state[1]; c = context->state[2]; d = context->state[3];
    e = context->state[4]; f = context->state[5]; g = context->state[6]; h = context->state[7];
    for (i = 0; i < 64; i++)
    {
        const uint32_t s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
        const uint32_t choice = (e & f) ^ (~e & g);
        const uint32_t first = h + s1 + choice + constants[i] + words[i];
        const uint32_t s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
        const uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
        const uint32_t second = s0 + majority;
        h = g; g = f; f = e; e = d + first;
        d = c; c = b; b = a; a = first + second;
    }
    context->state[0] += a; context->state[1] += b; context->state[2] += c; context->state[3] += d;
    context->state[4] += e; context->state[5] += f; context->state[6] += g; context->state[7] += h;
}

void ZEQ_SHA256_Init(zeq_sha256_t *context)
{
    static const uint32_t initial[8] = {
        0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
        0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19
    };
    memcpy(context->state, initial, sizeof(initial));
    context->bytes = 0;
    context->used = 0;
}

void ZEQ_SHA256_Update(zeq_sha256_t *context, const void *data, size_t length)
{
    const uint8_t *bytes = data;
    context->bytes += length;
    while (length)
    {
        size_t amount = 64 - context->used;
        if (amount > length) amount = length;
        memcpy(context->block + context->used, bytes, amount);
        context->used += amount;
        bytes += amount;
        length -= amount;
        if (context->used == 64)
        {
            transform(context, context->block);
            context->used = 0;
        }
    }
}

void ZEQ_SHA256_Final(zeq_sha256_t *context, uint8_t digest[32])
{
    uint64_t bits = context->bytes * 8;
    int i;
    context->block[context->used++] = 0x80;
    if (context->used > 56)
    {
        memset(context->block + context->used, 0, 64 - context->used);
        transform(context, context->block);
        context->used = 0;
    }
    memset(context->block + context->used, 0, 56 - context->used);
    for (i = 0; i < 8; i++) context->block[63 - i] = (uint8_t)(bits >> (i * 8));
    transform(context, context->block);
    for (i = 0; i < 8; i++)
    {
        digest[i * 4] = (uint8_t)(context->state[i] >> 24);
        digest[i * 4 + 1] = (uint8_t)(context->state[i] >> 16);
        digest[i * 4 + 2] = (uint8_t)(context->state[i] >> 8);
        digest[i * 4 + 3] = (uint8_t)context->state[i];
    }
    memset(context, 0, sizeof(*context));
}
