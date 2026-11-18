#include "zeq_capture.h"
#include <stdio.h>
#include <string.h>

int main(void)
{
    ticcmd_t command;
    uint8_t *data;
    int i;
    memset(&command, 0, sizeof(command));
    command.forwardmove = -25;
    command.sidemove = 12;
    command.angleturn = -300;
    command.buttons = 1;
    command.inventory = -123456;
    ZEQ_CaptureReset();
    ZEQ_CaptureTiccmd(7, &command);
    if (ZEQ_CaptureRead(256) != 24) return 1;
    data = ZEQ_CaptureData();
    if (memcmp(data, "ZEQI", 4) || data[4] != 7 || data[8] != (uint8_t)-25 || data[9] != 12 || data[13] != 1) return 2;
    if (ZEQ_CaptureRead(256) != 0 || ZEQ_CaptureDropped() != 0) return 3;
    for (i = 0; i < 9000; i++) ZEQ_CaptureTiccmd(i, &command);
    if (ZEQ_CaptureDropped() != 808) return 4;
    if (ZEQ_CaptureRead(256) != 256 * 24 || data[4] != 40 || data[5] != 3) return 5;
    puts("C capture OK: exact ticcmd bytes, drain, bounded overrun visibility");
    return 0;
}
