// Deterministic headless adapter for the real doomgeneric simulation.
#include "zeq_headless.h"
#include "zeq_doom.h"
#include "zeq_sha256.h"
#include "doomstat.h"
#include "d_main.h"
#include "d_loop.h"
#include "g_game.h"
#include "m_random.h"
#include "p_local.h"
#include "p_saveg.h"
#include "p_spec.h"
#include "r_state.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define INPUT_RECORD_BYTES 24
#define INPUT_RECORD_LIMIT 200000
#define STATE_MAGIC 0x3154535a

typedef struct
{
    uint32_t gametic;
    ticcmd_t command;
} headless_input_t;

static headless_input_t *inputs;
static size_t input_count;
static size_t input_capacity;
static size_t input_cursor;
static uint8_t input_bytes[INPUT_RECORD_BYTES];
static size_t input_used;
static int input_failed;
static int completed_tics;
static int max_tics;
static int checkpoint_interval = 1;
static int realtime;
static char run_id[33] = "00000000000000000000000000000000";
static char previous_hash[65];

extern int rndindex;
extern int prndindex;
extern mobj_t *bodyque[32];
extern int numbraintargets;
extern int braintargeton;
extern mobj_t *braintargets[32];
void T_FireFlicker(fireflicker_t *flick);

static void write32le(FILE *stream, int32_t value)
{
    uint32_t bits = (uint32_t)value;
    fputc(bits & 0xff, stream);
    fputc((bits >> 8) & 0xff, stream);
    fputc((bits >> 16) & 0xff, stream);
    fputc((bits >> 24) & 0xff, stream);
}

static int environment_int(const char *name, int fallback, int minimum, int maximum)
{
    const char *text = getenv(name);
    char *end;
    long value;
    if (!text || !*text) return fallback;
    errno = 0;
    value = strtol(text, &end, 10);
    if (errno || *end || value < minimum || value > maximum)
    {
        fprintf(stderr, "invalid %s\n", name);
        exit(2);
    }
    return (int)value;
}

void ZEQ_HeadlessInit(void)
{
    const char *identity = getenv("ZEQ_RUN_ID");
    size_t i;
    if (identity && strlen(identity) == 32)
    {
        for (i = 0; i < 32; i++)
            if (!((identity[i] >= '0' && identity[i] <= '9') || (identity[i] >= 'a' && identity[i] <= 'f'))) break;
        if (i == 32) memcpy(run_id, identity, 32);
    }
    max_tics = environment_int("ZEQ_MAX_TIC", 350, 1, 2000000);
    checkpoint_interval = environment_int("ZEQ_CHECKPOINT_INTERVAL", 1, 1, 2000000);
    realtime = environment_int("ZEQ_REALTIME", 0, 0, 1);
    singletics = true;
    ZEQ_SetRulesetImmediate(environment_int("ZEQ_RULESET", 1, 0, 2));
    fcntl(STDIN_FILENO, F_SETFL, fcntl(STDIN_FILENO, F_GETFL, 0) | O_NONBLOCK);
}

static void input_error(const char *reason)
{
    input_failed = 1;
    printf("ZEQJ{\"kind\":\"input-error\",\"reason\":\"%s\"}\n", reason);
    fflush(stdout);
}

static void accept_input(const uint8_t record[INPUT_RECORD_BYTES])
{
    headless_input_t *input;
    uint32_t tic;
    if (memcmp(record, "ZEQI", 4) != 0 || record[22] || record[23])
    {
        input_error("invalid-record");
        return;
    }
    tic = (uint32_t)record[4] | ((uint32_t)record[5] << 8)
        | ((uint32_t)record[6] << 16) | ((uint32_t)record[7] << 24);
    if (tic >= 2000000 || (input_count && tic <= inputs[input_count - 1].gametic))
    {
        input_error("non-increasing-or-excessive-tic");
        return;
    }
    if (input_count >= INPUT_RECORD_LIMIT)
    {
        input_error("input-limit");
        return;
    }
    if (input_count == input_capacity)
    {
        size_t capacity = input_capacity ? input_capacity * 2 : 1024;
        headless_input_t *grown = realloc(inputs, capacity * sizeof(*inputs));
        if (!grown)
        {
            input_error("input-allocation");
            return;
        }
        inputs = grown;
        input_capacity = capacity;
    }
    input = &inputs[input_count++];
    memset(input, 0, sizeof(*input));
    input->gametic = tic;
    input->command.forwardmove = (int8_t)record[8];
    input->command.sidemove = (int8_t)record[9];
    input->command.angleturn = (int16_t)((uint16_t)record[10] | ((uint16_t)record[11] << 8));
    input->command.chatchar = record[12];
    input->command.buttons = record[13];
    input->command.consistancy = record[14];
    input->command.buttons2 = record[15];
    input->command.inventory = (int32_t)((uint32_t)record[16] | ((uint32_t)record[17] << 8)
                                       | ((uint32_t)record[18] << 16) | ((uint32_t)record[19] << 24));
    input->command.lookfly = record[20];
    input->command.arti = record[21];
}

void ZEQ_HeadlessPump(void)
{
    while (!input_failed)
    {
        ssize_t amount = read(STDIN_FILENO, input_bytes + input_used, sizeof(input_bytes) - input_used);
        if (amount > 0)
        {
            input_used += (size_t)amount;
            if (input_used == sizeof(input_bytes))
            {
                accept_input(input_bytes);
                input_used = 0;
            }
            continue;
        }
        if (amount < 0 && errno == EINTR) continue;
        if (amount < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) return;
        return;
    }
}

int ZEQ_HeadlessBuildTiccmd(ticcmd_t *cmd, int maketic)
{
    memset(cmd, 0, sizeof(*cmd));
    while (input_cursor < input_count && inputs[input_cursor].gametic < (uint32_t)maketic)
    {
        input_error("late-input");
        input_cursor++;
    }
    if (input_cursor < input_count && inputs[input_cursor].gametic == (uint32_t)maketic)
    {
        *cmd = inputs[input_cursor].command;
        input_cursor++;
    }
    return 1;
}

int32_t ZEQ_CanonicalPointer(void *pointer)
{
    thinker_t *th;
    uintptr_t address = (uintptr_t)pointer;
    int32_t ordinal = 1;
    if (!pointer) return 0;
    for (th = thinkercap.next; th != &thinkercap; th = th->next, ordinal++)
    {
        if (pointer != (void *)th) continue;
        if (th->function.acp1 == (actionf_p1)P_MobjThinker)
            return 0x20000000 | (int32_t)((mobj_t *)th)->zeq_id;
        return 0x10000000 | ordinal;
    }
    if (pointer == (void *)&thinkercap) return INT32_MAX;
    if (address >= (uintptr_t)mobjinfo && address < (uintptr_t)(mobjinfo + NUMMOBJTYPES))
        return 0x40000000 | (int32_t)((mobjinfo_t *)pointer - mobjinfo);
    if (address >= (uintptr_t)subsectors && address < (uintptr_t)(subsectors + numsubsectors))
        return 0x50000000 | (int32_t)((subsector_t *)pointer - subsectors);
    if (address >= (uintptr_t)players && address < (uintptr_t)(players + MAXPLAYERS))
        return 0x60000000 | (int32_t)((player_t *)pointer - players);
    return 0;
}

int32_t ZEQ_CanonicalAction(actionf_p1 action)
{
    if (action == (actionf_p1)NULL) return 0;
    if (action == (actionf_p1)P_MobjThinker) return 1;
    if (action == (actionf_p1)P_RemoveThinker) return 2;
    if (action == (actionf_p1)T_MoveCeiling) return 3;
    if (action == (actionf_p1)T_VerticalDoor) return 4;
    if (action == (actionf_p1)T_MoveFloor) return 5;
    if (action == (actionf_p1)T_PlatRaise) return 6;
    if (action == (actionf_p1)T_FireFlicker) return 7;
    if (action == (actionf_p1)T_LightFlash) return 8;
    if (action == (actionf_p1)T_StrobeFlash) return 9;
    if (action == (actionf_p1)T_Glow) return 10;
    return -1;
}

static int canonical_state_hash(int completed_tics, char output[65])
{
    static const char digits[] = "0123456789abcdef";
    FILE *state = tmpfile();
    FILE *original_stream;
    zeq_sha256_t sha;
    uint8_t digest[32];
    uint8_t buffer[8192];
    size_t amount;
    int i;
    if (!state) return 0;
    original_stream = save_stream;
    save_stream = state;
    savegame_error = false;
    P_SetSaveGameCanonical(true);
    P_WriteSaveGameHeader("zeq-state-hash-v1");
    P_ArchivePlayers();
    P_ArchiveWorld();
    P_ArchiveThinkers();
    P_ArchiveSpecials();
    P_WriteSaveGameEOF();
    P_SetSaveGameCanonical(false);
    save_stream = original_stream;

    // Extend the save-game starting point with deterministic globals that the
    // original serializer omitted. No host pointers, padding, clocks, or caches.
    write32le(state, STATE_MAGIC);
    write32le(state, completed_tics);
    write32le(state, gametic);
    write32le(state, gamestate);
    write32le(state, gameaction);
    write32le(state, paused);
    write32le(state, usergame);
    write32le(state, deathmatch);
    write32le(state, netgame);
    write32le(state, gameskill);
    write32le(state, gameepisode);
    write32le(state, gamemap);
    write32le(state, leveltime);
    write32le(state, levelstarttic);
    write32le(state, totalkills);
    write32le(state, totalitems);
    write32le(state, totalsecret);
    write32le(state, rndindex);
    write32le(state, prndindex);
    // validcount is a transient collision/render traversal cache, not state.
    write32le(state, numbraintargets);
    write32le(state, braintargeton);
    write32le(state, P_BrainSpitParity());
    for (i = 0; i < 32; i++) write32le(state, ZEQ_CanonicalPointer(braintargets[i]));
    write32le(state, bodyqueslot);
    for (i = 0; i < 32; i++) write32le(state, ZEQ_CanonicalPointer(bodyque[i]));
    write32le(state, iquehead);
    write32le(state, iquetail);
    for (i = 0; i < ITEMQUESIZE; i++)
    {
        write32le(state, itemrespawntime[i]);
        write32le(state, itemrespawnque[i].x);
        write32le(state, itemrespawnque[i].y);
        write32le(state, itemrespawnque[i].angle);
        write32le(state, itemrespawnque[i].type);
        write32le(state, itemrespawnque[i].options);
    }
    for (i = 0; i < numsectors; i++)
        write32le(state, ZEQ_CanonicalPointer(sectors[i].soundtarget));
    ZEQ_WriteCanonicalExtra(state, write32le);

    if (savegame_error || ferror(state) || fseek(state, 0, SEEK_SET) != 0)
    {
        fclose(state);
        return 0;
    }
    ZEQ_SHA256_Init(&sha);
    while ((amount = fread(buffer, 1, sizeof(buffer), state)) != 0)
        ZEQ_SHA256_Update(&sha, buffer, amount);
    if (ferror(state))
    {
        fclose(state);
        return 0;
    }
    fclose(state);
    ZEQ_SHA256_Final(&sha, digest);
    for (i = 0; i < 32; i++)
    {
        output[i * 2] = digits[digest[i] >> 4];
        output[i * 2 + 1] = digits[digest[i] & 15];
    }
    output[64] = 0;
    return 1;
}

#ifdef ZEQ_CANONICAL
#define CANONICAL_CAPACITY 64
#define CANONICAL_RECORD_BYTES 68

static uint8_t canonical_ring[CANONICAL_CAPACITY][CANONICAL_RECORD_BYTES];
static uint8_t canonical_export[CANONICAL_RECORD_BYTES];
static uint32_t canonical_read_index;
static uint32_t canonical_write_index;
static uint32_t canonical_dropped;
static uint32_t canonical_errors;
static int32_t canonical_interval;

void ZEQ_CanonicalSetInterval(int32_t interval)
{
    canonical_read_index = canonical_write_index = 0;
    canonical_dropped = canonical_errors = 0;
    canonical_interval = interval;
    if (interval < 0 || interval > 2000000)
    {
        canonical_interval = 0;
        canonical_errors++;
    }
}

void ZEQ_CanonicalAfterTic(void)
{
    int completed = gametic + 1;
    char hash[65];
    uint8_t *record;
    uint32_t bits;
    int i;
    if (canonical_interval <= 0 || completed % canonical_interval != 0) return;
    if (!canonical_state_hash(completed, hash))
    {
        canonical_errors++;
        return;
    }
    if (canonical_write_index - canonical_read_index == CANONICAL_CAPACITY)
    {
        canonical_read_index++;
        canonical_dropped++;
    }
    record = canonical_ring[canonical_write_index % CANONICAL_CAPACITY];
    bits = (uint32_t)completed;
    record[0] = bits & 255;
    record[1] = (bits >> 8) & 255;
    record[2] = (bits >> 16) & 255;
    record[3] = (bits >> 24) & 255;
    for (i = 0; i < 64; i++) record[4 + i] = (uint8_t)hash[i];
    canonical_write_index++;
}

int32_t ZEQ_CanonicalRead(void)
{
    if (canonical_read_index == canonical_write_index) return 0;
    memcpy(canonical_export, canonical_ring[canonical_read_index % CANONICAL_CAPACITY],
           CANONICAL_RECORD_BYTES);
    canonical_read_index++;
    return CANONICAL_RECORD_BYTES;
}

uint8_t *ZEQ_CanonicalData(void) { return canonical_export; }
int32_t ZEQ_CanonicalDropped(void) { return (int32_t)canonical_dropped; }
int32_t ZEQ_CanonicalErrors(void) { return (int32_t)canonical_errors; }
#endif

static void emit_checkpoint(void)
{
    char hash[65];
    player_t *player = &players[consoleplayer];
    mobj_t *mo = player->mo;
    if (!canonical_state_hash(completed_tics, hash))
    {
        input_error("state-serialization");
        return;
    }
    printf("ZEQJ{\"kind\":\"checkpoint\",\"format\":\"zeq-state-hash-v1\",\"run_id\":\"%s\",\"gametic\":\"%d\",\"state_format\":\"zeq-doom-state-v1\",\"state_sha256\":\"%s\",\"previous_state_sha256\":%s%s%s,\"gamestate\":%d,\"health\":%d,\"x\":\"%d\",\"y\":\"%d\",\"z\":\"%d\",\"angle\":\"%u\",\"ruleset\":%d}\n",
           run_id, completed_tics, hash,
           previous_hash[0] ? "\"" : "", previous_hash[0] ? previous_hash : "null", previous_hash[0] ? "\"" : "",
           gamestate, player->health, mo ? mo->x : 0, mo ? mo->y : 0, mo ? mo->z : 0,
           mo ? (unsigned int)mo->angle : 0, ZEQ_GetRuleset());
    memcpy(previous_hash, hash, 65);
    fflush(stdout);
}

void ZEQ_HeadlessAfterTic(void)
{
    zeq_event_t *event;
    completed_tics = gametic + 1;
    while ((event = ZEQ_GetEvent()) != NULL)
    {
        printf("ZEQJ{\"kind\":\"engine-event\",\"type\":%d,\"gametic\":\"%d\",\"phase\":%d,\"value\":%d}\n",
               event->type, event->gametic, event->phase, event->value);
    }
    if (completed_tics % checkpoint_interval == 0 || completed_tics == max_tics)
        emit_checkpoint();
    fflush(stdout);
}

int ZEQ_HeadlessShouldStop(void)
{
    return input_failed || gametic >= max_tics;
}

int ZEQ_HeadlessRealtime(void)
{
    return realtime;
}
