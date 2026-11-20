/* Binary batch adapter for cross-language chamber differential tests. */
#include "../reference/zeq_chamber.h"
#include <stdio.h>
#include <string.h>

static int read_exact(uint8_t *output, size_t size)
{
    return size == 0 || fread(output, 1, size, stdin) == size;
}
static uint16_t read16(const uint8_t *p) { return (uint16_t)p[0] | ((uint16_t)p[1] << 8); }
static uint32_t read32(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
int main(void)
{
    static const char digits[] = "0123456789abcdef";
    zeq_chamber selftest;
    uint8_t short_buffer[4];
    if (zeq_chamber_init(&selftest, 1, 0) != ZEQ_CHAMBER_INVALID_INPUT
        || zeq_chamber_init(&selftest, 1, 1) != ZEQ_CHAMBER_OK
        || zeq_chamber_canonical(&selftest, short_buffer, sizeof(short_buffer)) != ZEQ_CHAMBER_SHORT_BUFFER
        || zeq_chamber_canonical(&selftest, NULL, 0) != ZEQ_CHAMBER_INVALID_INPUT) return 1;
    uint8_t header[16];
    while (read_exact(header, sizeof(header)))
    {
        zeq_chamber state;
        uint32_t tic, tics;
        uint16_t particles;
        uint8_t canonical[24 + ZEQ_CHAMBER_MAX_PARTICLES * 16];
        size_t size, i;
        if (memcmp(header, "ZEQCHRQ1", 8) != 0) return 2;
        tics = read16(header + 12); particles = read16(header + 14);
        if (zeq_chamber_init(&state, read32(header + 8), particles) != ZEQ_CHAMBER_OK) return 3;
        for (tic = 0; tic < tics; tic++)
        {
            uint8_t command[2];
            if (!read_exact(command, 2) || zeq_chamber_step(&state,
                (zeq_chamber_command){ (int8_t)command[0], (int8_t)command[1] }) != ZEQ_CHAMBER_OK) return 4;
        }
        size = zeq_chamber_state_size(&state);
        if (zeq_chamber_canonical(&state, canonical, sizeof(canonical)) != ZEQ_CHAMBER_OK) return 5;
        for (i = 0; i < size; i++)
        {
            putchar(digits[canonical[i] >> 4]); putchar(digits[canonical[i] & 15]);
        }
        putchar('\n');
    }
    return ferror(stdin) ? 6 : 0;
}
