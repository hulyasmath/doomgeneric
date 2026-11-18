// Actual final ticcmd_t capture from G_BuildTiccmd; bounded and loss-visible.
#include "zeq_capture.h"
#include <string.h>

#define CAPACITY 8192
#define EXPORT_CAPACITY 256
#define RECORD_BYTES 24

static uint8_t ring[CAPACITY][RECORD_BYTES];
static uint8_t exported[EXPORT_CAPACITY][RECORD_BYTES];
static uint32_t read_index;
static uint32_t write_index;
static uint32_t dropped;

void ZEQ_CaptureReset(void)
{
    read_index = write_index = dropped = 0;
}

static void write16(uint8_t *output, int16_t value)
{
    uint16_t bits = (uint16_t)value;
    output[0] = bits & 255;
    output[1] = bits >> 8;
}

static void write32(uint8_t *output, int32_t value)
{
    uint32_t bits = (uint32_t)value;
    output[0] = bits & 255;
    output[1] = (bits >> 8) & 255;
    output[2] = (bits >> 16) & 255;
    output[3] = bits >> 24;
}

void ZEQ_CaptureTiccmd(int gametic, const ticcmd_t *command)
{
    uint8_t *record;
    if (write_index - read_index == CAPACITY)
    {
        read_index++;
        dropped++;
    }
    record = ring[write_index % CAPACITY];
    memset(record, 0, RECORD_BYTES);
    memcpy(record, "ZEQI", 4);
    write32(record + 4, gametic);
    record[8] = (uint8_t)command->forwardmove;
    record[9] = (uint8_t)command->sidemove;
    write16(record + 10, command->angleturn);
    record[12] = command->chatchar;
    record[13] = command->buttons;
    record[14] = command->consistancy;
    record[15] = command->buttons2;
    write32(record + 16, command->inventory);
    record[20] = command->lookfly;
    record[21] = command->arti;
    write_index++;
}

int32_t ZEQ_CaptureRead(int32_t maximum_records)
{
    int32_t count = 0;
    if (maximum_records < 0) return 0;
    if (maximum_records > EXPORT_CAPACITY) maximum_records = EXPORT_CAPACITY;
    while (count < maximum_records && read_index != write_index)
    {
        memcpy(exported[count], ring[read_index % CAPACITY], RECORD_BYTES);
        read_index++;
        count++;
    }
    return count * RECORD_BYTES;
}

uint8_t *ZEQ_CaptureData(void) { return &exported[0][0]; }
int32_t ZEQ_CaptureDropped(void) { return (int32_t)dropped; }
