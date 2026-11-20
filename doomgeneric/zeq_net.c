// Real two-process TCP command exchange, prediction, and save-state rollback.
// This path runs the original Doom RunTic and P_* savegame serializers. It is
// deliberately limited to the native headless reference host in Phase 6.

#include "zeq_net.h"
#include "zeq_headless.h"
#include "zeq_doom.h"
#include "zeq_sha256.h"
#include "doomstat.h"
#include "d_main.h"
#include "g_game.h"
#include "m_random.h"
#include "p_local.h"
#include "p_saveg.h"
#include "p_spec.h"
#include "r_main.h"
#include "r_state.h"

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#define NET_PROTOCOL_VERSION 1
#define NET_PLAYERS 2
#define NET_WINDOW 32
#define NET_PREDICTION 8
#define NET_SNAPSHOT_BYTES 262144
#define NET_FRAME_HEADER 5
#define NET_FRAME_MAX 128
#define NET_COMMAND_BODY 19
#define NET_HASH_BODY 68
#define NET_STATE_MAGIC 0x3654454e
#define NET_WAD_SHA256 "1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771"

// Original Doom consistency diagnostics are rebuilt from the restored state
// before each RunTic. SHA-256 checkpoints, not predicted consistency bytes,
// determine whether two rollback-capable peers have desynchronized.
extern byte consistancy[MAXPLAYERS][BACKUPTICS];

typedef struct
{
    int tic;
    int valid;
    int executed;
    unsigned int actual_mask;
    ticcmd_t actual[NET_PLAYERS];
    ticcmd_t used[NET_PLAYERS];
    char hash[65];
    unsigned char *snapshot;
    size_t snapshot_length;
} net_tic_t;

typedef struct
{
    int valid;
    int tic;
    char hash[65];
} net_hash_t;

static int net_enabled;
static int net_player;
static int net_socket = -1;
static int net_failed;
static int net_max_tics = 350;
static int net_confirmed;
static int net_peer_confirmed;
static int net_frontier;
static int net_stop_linger;
static int net_summary_sent;
static int net_peer_done;
static int net_rollbacks;
static int net_mispredictions;
static int net_resimulated;
static int net_duplicate_commands;
static unsigned int net_send_pass;
static uint64_t net_last_retransmit_ms;
static uint64_t net_last_wait_ms;

static uint64_t monotonic_ms(void)
{
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) return 0;
    return (uint64_t)now.tv_sec * 1000 + (uint64_t)now.tv_nsec / 1000000;
}
static char net_session[33];
static char net_descriptor_hash[65];
static char net_previous_hash[65];
static net_tic_t net_tics[NET_WINDOW];
static net_hash_t net_remote_hashes[NET_WINDOW];
static unsigned char net_input[8192];
static size_t net_input_used;

extern int rndindex;
extern int prndindex;
extern mobj_t *bodyque[32];
extern int numbraintargets;
extern int braintargeton;
extern mobj_t *braintargets[32];

static int env_int(const char *name, int fallback, int minimum, int maximum)
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

static void put16(unsigned char *output, unsigned int value)
{
    output[0] = value & 255;
    output[1] = (value >> 8) & 255;
}

static void put32(unsigned char *output, uint32_t value)
{
    output[0] = value & 255;
    output[1] = (value >> 8) & 255;
    output[2] = (value >> 16) & 255;
    output[3] = (value >> 24) & 255;
}

static unsigned int get16(const unsigned char *input)
{
    return input[0] | ((unsigned int)input[1] << 8);
}

static uint32_t get32(const unsigned char *input)
{
    return (uint32_t)input[0] | ((uint32_t)input[1] << 8)
         | ((uint32_t)input[2] << 16) | ((uint32_t)input[3] << 24);
}

static void hash_hex(const void *data, size_t length, char output[65])
{
    static const char digits[] = "0123456789abcdef";
    zeq_sha256_t sha;
    unsigned char digest[32];
    int i;
    ZEQ_SHA256_Init(&sha);
    ZEQ_SHA256_Update(&sha, data, length);
    ZEQ_SHA256_Final(&sha, digest);
    for (i = 0; i < 32; i++)
    {
        output[i * 2] = digits[digest[i] >> 4];
        output[i * 2 + 1] = digits[digest[i] & 15];
    }
    output[64] = 0;
}

static int hex_session(const char *text, unsigned char output[16])
{
    int i;
    int value;
    if (!text || strlen(text) != 32) return 0;
    for (i = 0; i < 32; i++)
    {
        char c = text[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return 0;
    }
    for (i = 0; i < 16; i++)
    {
        sscanf(text + i * 2, "%2x", &value);
        output[i] = (unsigned char)value;
    }
    return 1;
}

static int simulation_command_equal(const ticcmd_t *a, const ticcmd_t *b)
{
    return a->forwardmove == b->forwardmove && a->sidemove == b->sidemove
        && a->angleturn == b->angleturn && a->chatchar == b->chatchar
        && a->buttons == b->buttons
        && a->buttons2 == b->buttons2 && a->inventory == b->inventory
        && a->lookfly == b->lookfly && a->arti == b->arti;
}

static int command_equal(const ticcmd_t *a, const ticcmd_t *b)
{
    return simulation_command_equal(a, b) && a->consistancy == b->consistancy;
}

static void encode_command(unsigned char output[14], const ticcmd_t *cmd)
{
    output[0] = (unsigned char)cmd->forwardmove;
    output[1] = (unsigned char)cmd->sidemove;
    put16(output + 2, (uint16_t)cmd->angleturn);
    output[4] = cmd->chatchar;
    output[5] = cmd->buttons;
    output[6] = cmd->consistancy;
    output[7] = cmd->buttons2;
    put32(output + 8, (uint32_t)cmd->inventory);
    output[12] = cmd->lookfly;
    output[13] = cmd->arti;
}

static void decode_command(ticcmd_t *cmd, const unsigned char input[14])
{
    memset(cmd, 0, sizeof(*cmd));
    cmd->forwardmove = (int8_t)input[0];
    cmd->sidemove = (int8_t)input[1];
    cmd->angleturn = (int16_t)get16(input + 2);
    cmd->chatchar = input[4];
    cmd->buttons = input[5];
    cmd->consistancy = input[6];
    cmd->buttons2 = input[7];
    cmd->inventory = (int32_t)get32(input + 8);
    cmd->lookfly = input[12];
    cmd->arti = input[13];
}

static void net_fail(const char *reason)
{
    if (!net_failed)
        printf("ZEQJ{\"kind\":\"net-error\",\"session_id\":\"%s\",\"player\":%d,\"reason\":\"%s\",\"confirmed_tic\":%d,\"predicted_tic\":%d}\n",
               net_session, net_player, reason, net_confirmed, net_frontier);
    net_failed = 1;
    fflush(stdout);
}

static int write_all(int fd, const unsigned char *data, size_t length, int timeout_ms)
{
    size_t offset = 0;
    while (offset < length)
    {
        ssize_t amount = send(fd, data + offset, length - offset, MSG_NOSIGNAL);
        if (amount > 0) { offset += (size_t)amount; continue; }
        if (amount < 0 && errno == EINTR) continue;
        if (amount < 0 && (errno == EAGAIN || errno == EWOULDBLOCK))
        {
            struct pollfd pfd;
            int ready;
            pfd.fd = fd;
            pfd.events = POLLOUT;
            ready = poll(&pfd, 1, timeout_ms);
            if (ready > 0) continue;
        }
        return 0;
    }
    return 1;
}

static int read_all(int fd, unsigned char *data, size_t length, int timeout_ms)
{
    size_t offset = 0;
    while (offset < length)
    {
        ssize_t amount = recv(fd, data + offset, length - offset, 0);
        if (amount > 0) { offset += (size_t)amount; continue; }
        if (amount < 0 && errno == EINTR) continue;
        if (amount < 0 && (errno == EAGAIN || errno == EWOULDBLOCK))
        {
            struct pollfd pfd;
            int ready;
            pfd.fd = fd;
            pfd.events = POLLIN;
            ready = poll(&pfd, 1, timeout_ms);
            if (ready > 0) continue;
        }
        return 0;
    }
    return 1;
}

static int send_frame(unsigned char type, const unsigned char *body, size_t length)
{
    unsigned char header[NET_FRAME_HEADER];
    if (net_peer_done && type != 3) return 1;
    if (net_failed || net_socket < 0 || length > NET_FRAME_MAX) return 0;
    header[0] = 0x5a;
    header[1] = 0x4e;
    header[2] = type;
    put16(header + 3, (unsigned int)length);
    if (!write_all(net_socket, header, sizeof(header), 1000)
        || !write_all(net_socket, body, length, 1000))
    {
        net_fail("transport-write");
        return 0;
    }
    return 1;
}

static void send_command(int tic)
{
    net_tic_t *slot = &net_tics[tic % NET_WINDOW];
    unsigned char body[NET_COMMAND_BODY];
    if (!slot->valid || slot->tic != tic || !(slot->actual_mask & (1u << net_player))) return;
    body[0] = (unsigned char)net_player;
    put32(body + 1, (uint32_t)tic);
    encode_command(body + 5, &slot->actual[net_player]);
    send_frame(1, body, sizeof(body));
}

static void send_hash(int tic, const char hash[65])
{
    unsigned char body[NET_HASH_BODY];
    put32(body, (uint32_t)tic);
    memcpy(body + 4, hash, 64);
    send_frame(2, body, sizeof(body));
}

static void accept_command(const unsigned char *body)
{
    int player = body[0];
    int tic = (int)get32(body + 1);
    ticcmd_t command;
    net_tic_t *slot;
    if (player != 1 - net_player || tic < 0 || tic >= net_max_tics)
    {
        net_fail("command-identity-or-range");
        return;
    }
    if (tic < net_confirmed) { net_duplicate_commands++; return; }
    if (tic >= net_confirmed + NET_WINDOW)
    {
        net_fail("command-window-overflow");
        return;
    }
    decode_command(&command, body + 5);
    if (command.buttons & BT_SPECIAL)
    {
        net_fail("special-command-unsupported");
        return;
    }
    slot = &net_tics[tic % NET_WINDOW];
    if (!slot->valid || slot->tic != tic)
    {
        unsigned char *snapshot = slot->snapshot;
        memset(slot, 0, sizeof(*slot));
        slot->valid = 1;
        slot->tic = tic;
        slot->snapshot = snapshot ? snapshot : calloc(1, NET_SNAPSHOT_BYTES);
        if (!slot->snapshot) { net_fail("snapshot-allocation"); return; }
    }
    if (slot->actual_mask & (1u << player))
    {
        if (!command_equal(&slot->actual[player], &command))
            net_fail("conflicting-command");
        else
            net_duplicate_commands++;
        return;
    }
    slot->actual[player] = command;
    slot->actual_mask |= 1u << player;
    if (slot->executed && !simulation_command_equal(&slot->used[player], &command))
    {
        net_mispredictions++;
        printf("ZEQJ{\"kind\":\"net-misprediction\",\"session_id\":\"%s\",\"player\":%d,\"tic\":%d}\n",
               net_session, net_player, tic);
        fflush(stdout);
    }
}

static void compare_remote_hash(net_hash_t *remote)
{
    net_tic_t *slot;
    // A future peer hash must wait until local rollback/resimulation and
    // confirmation have produced the corrected state. Equality is valid: the
    // caller may have just confirmed this exact completed tic.
    if (remote->tic <= 0 || remote->tic > net_confirmed) return;
    slot = &net_tics[(remote->tic - 1) % NET_WINDOW];
    if (!slot->valid || slot->tic != remote->tic - 1 || !slot->executed
        || slot->actual_mask != 3) return;
    if (strcmp(slot->hash, remote->hash) != 0)
    {
        printf("ZEQJ{\"kind\":\"net-desync\",\"session_id\":\"%s\",\"player\":%d,\"confirmed_tic\":%d,\"local_sha256\":\"%s\",\"remote_sha256\":\"%s\"}\n",
               net_session, net_player, remote->tic, slot->hash, remote->hash);
        fflush(stdout);
        net_fail("canonical-hash-mismatch");
    }
}

static void accept_hash(const unsigned char *body)
{
    int tic = (int)get32(body);
    net_hash_t *remote;
    int i;
    if (tic <= 0 || tic > net_max_tics || tic < net_confirmed - NET_WINDOW)
    {
        net_fail("hash-range");
        return;
    }
    for (i = 0; i < 64; i++)
    {
        char c = (char)body[4 + i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')))
        {
            net_fail("hash-syntax");
            return;
        }
    }
    if (tic > net_peer_confirmed) net_peer_confirmed = tic;
    remote = &net_remote_hashes[tic % NET_WINDOW];
    remote->valid = 1;
    remote->tic = tic;
    memcpy(remote->hash, body + 4, 64);
    remote->hash[64] = 0;
    compare_remote_hash(remote);
}

static void accept_frame(unsigned char type, const unsigned char *body, size_t length)
{
    if (type == 1 && length == NET_COMMAND_BODY) accept_command(body);
    else if (type == 2 && length == NET_HASH_BODY) accept_hash(body);
    else if (type == 3 && length == 4 && get32(body) == (uint32_t)net_max_tics)
        net_peer_done = 1;
    else net_fail("frame-type-or-length");
}

static void pump_socket(void)
{
    if (net_failed || net_socket < 0) return;
    for (;;)
    {
        ssize_t amount = recv(net_socket, net_input + net_input_used,
                              sizeof(net_input) - net_input_used, 0);
        if (amount > 0)
        {
            size_t offset = 0;
            net_input_used += (size_t)amount;
            while (net_input_used - offset >= NET_FRAME_HEADER)
            {
                const unsigned char *header = net_input + offset;
                size_t length;
                if (header[0] != 0x5a || header[1] != 0x4e)
                {
                    net_fail("frame-magic");
                    break;
                }
                length = get16(header + 3);
                if (length > NET_FRAME_MAX)
                {
                    net_fail("frame-limit");
                    break;
                }
                if (net_input_used - offset < NET_FRAME_HEADER + length) break;
                accept_frame(header[2], header + NET_FRAME_HEADER, length);
                offset += NET_FRAME_HEADER + length;
                if (net_failed) break;
            }
            if (net_failed) return;
            if (offset)
            {
                memmove(net_input, net_input + offset, net_input_used - offset);
                net_input_used -= offset;
            }
            if (net_input_used == sizeof(net_input))
            {
                net_fail("receive-buffer-limit");
                return;
            }
            continue;
        }
        if (amount == 0)
        {
            if (net_peer_done || net_confirmed >= net_max_tics)
            {
                close(net_socket);
                net_socket = -1;
                return;
            }
            net_fail("peer-closed");
            return;
        }
        if (errno == EINTR) continue;
        if (errno == EAGAIN || errno == EWOULDBLOCK) break;
        net_fail("transport-read");
        return;
    }
}

static int make_listener(const char *port_text)
{
    int fd;
    int one = 1;
    int port;
    struct sockaddr_in address;
    char *end;
    long parsed;
    errno = 0;
    parsed = strtol(port_text, &end, 10);
    if (errno || *end || parsed < 1 || parsed > 65535) return -1;
    port = (int)parsed;
    fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return -1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
    memset(&address, 0, sizeof(address));
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    address.sin_port = htons((uint16_t)port);
    if (bind(fd, (struct sockaddr *)&address, sizeof(address)) != 0 || listen(fd, 1) != 0)
    {
        close(fd);
        return -1;
    }
    return fd;
}

static int make_connection(const char *endpoint)
{
    int fd;
    int port;
    char *end;
    const char *colon = strrchr(endpoint, ':');
    long parsed;
    struct sockaddr_in address;
    char host[64];
    size_t host_length;
    if (!colon || colon == endpoint) return -1;
    host_length = (size_t)(colon - endpoint);
    if (host_length >= sizeof(host)) return -1;
    memcpy(host, endpoint, host_length);
    host[host_length] = 0;
    errno = 0;
    parsed = strtol(colon + 1, &end, 10);
    if (errno || *end || parsed < 1 || parsed > 65535) return -1;
    port = (int)parsed;
    fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return -1;
    memset(&address, 0, sizeof(address));
    address.sin_family = AF_INET;
    address.sin_port = htons((uint16_t)port);
    if (inet_pton(AF_INET, host, &address.sin_addr) != 1
        || connect(fd, (struct sockaddr *)&address, sizeof(address)) != 0)
    {
        close(fd);
        return -1;
    }
    return fd;
}

void ZEQ_NetInit(void)
{
    const char *listen_port = getenv("ZEQ_NET_LISTEN");
    const char *connect_to = getenv("ZEQ_NET_CONNECT");
    const char *session;
    if (!listen_port && !connect_to) return;
    if (listen_port && connect_to)
    {
        fprintf(stderr, "ZEQ_NET_LISTEN and ZEQ_NET_CONNECT are mutually exclusive\n");
        exit(2);
    }
    net_enabled = 1;
    net_player = listen_port ? 0 : 1;
    net_max_tics = env_int("ZEQ_MAX_TIC", 350, 1, 2000000);
    session = getenv("ZEQ_NET_SESSION");
    if (!session) session = getenv("ZEQ_RUN_ID");
    if (!session) session = "00000000000000000000000000000000";
    if (!hex_session(session, (unsigned char[16]){0}))
    {
        fprintf(stderr, "invalid ZEQ_NET_SESSION\n");
        exit(2);
    }
    memcpy(net_session, session, 33);
}

int ZEQ_NetEnabled(void) { return net_enabled; }
int ZEQ_NetPlayer(void) { return net_player; }

int ZEQ_NetConnect(void)
{
    const char *listen_port = getenv("ZEQ_NET_LISTEN");
    const char *connect_to = getenv("ZEQ_NET_CONNECT");
    const char *engine_build = getenv("ZEQ_NET_ENGINE_BUILD");
    const char *corrupt_at = getenv("ZEQ_NET_CORRUPT_HASH_AT");
    const char *ruleset = ZEQ_RulesetName(ZEQ_GetRuleset());
    unsigned char session_bytes[16];
    unsigned char hello[60];
    unsigned char peer[60];
    char settings_hash[65];
    char descriptor[2048];
    int listener = -1;
    int flags;
    int i;
    (void)corrupt_at;
    if (!net_enabled) return 1;
    if (!engine_build) engine_build = "doomgeneric-zeq-phase6-v1";
    if (strlen(engine_build) > 96 || strpbrk(engine_build, "\\\"\r\n"))
    {
        net_fail("engine-build-syntax");
        return 0;
    }
    if (!hex_session(net_session, session_bytes)) return 0;
    hash_hex("deathmatch=0;fast=0;lowres=0;nomonsters=0;prediction=8;respawn=0;ticdup=1",
             strlen("deathmatch=0;fast=0;lowres=0;nomonsters=0;prediction=8;respawn=0;ticdup=1"),
             settings_hash);
    snprintf(descriptor, sizeof(descriptor),
        "{\"content_sha256\":\"%s\",\"engine_api\":\"doomgeneric-zeq-v1\",\"engine_build\":\"%s\",\"episode\":\"1\",\"format\":\"zeq-net-session-v1\",\"initial_rng\":\"0\",\"map\":\"1\",\"protocol\":\"zeq-doom-net-v1\",\"ruleset\":\"%s\",\"session_id\":\"%s\",\"settings_sha256\":\"%s\",\"skill\":\"2\",\"tick_rate\":\"35\",\"wad_sha256\":\"%s\"}",
        NET_WAD_SHA256, engine_build, ruleset, net_session, settings_hash, NET_WAD_SHA256);
    hash_hex(descriptor, strlen(descriptor), net_descriptor_hash);

    if (listen_port)
    {
        struct pollfd pfd;
        listener = make_listener(listen_port);
        if (listener < 0) { net_fail("listen"); return 0; }
        pfd.fd = listener;
        pfd.events = POLLIN;
        if (poll(&pfd, 1, env_int("ZEQ_NET_TIMEOUT_MS", 10000, 1, 120000)) <= 0)
        {
            close(listener);
            net_fail("accept-timeout");
            return 0;
        }
        net_socket = accept(listener, NULL, NULL);
        close(listener);
    }
    else net_socket = make_connection(connect_to);
    if (net_socket < 0) { net_fail("connect"); return 0; }

    memcpy(hello, "ZEQNET6", 8);
    put16(hello + 8, NET_PROTOCOL_VERSION);
    hello[10] = NET_PLAYERS;
    hello[11] = (unsigned char)net_player;
    memcpy(hello + 12, session_bytes, 16);
    memcpy(hello + 28, net_descriptor_hash, 32); // Raw digest bytes below.
    {
        zeq_sha256_t sha;
        unsigned char digest[32];
        ZEQ_SHA256_Init(&sha);
        ZEQ_SHA256_Update(&sha, descriptor, strlen(descriptor));
        ZEQ_SHA256_Final(&sha, digest);
        memcpy(hello + 28, digest, 32);
    }
    if (!write_all(net_socket, hello, sizeof(hello), 10000)
        || !read_all(net_socket, peer, sizeof(peer), 10000))
    {
        net_fail("hello-transport");
        return 0;
    }
    if (memcmp(peer, "ZEQNET6", 8) != 0 || get16(peer + 8) != NET_PROTOCOL_VERSION
        || peer[10] != NET_PLAYERS || peer[11] != 1 - net_player)
    {
        net_fail("protocol-or-player-mismatch");
        return 0;
    }
    if (memcmp(peer + 12, session_bytes, 16) != 0)
    {
        net_fail("session-identity-mismatch");
        return 0;
    }
    {
        zeq_sha256_t sha;
        unsigned char digest[32];
        ZEQ_SHA256_Init(&sha);
        ZEQ_SHA256_Update(&sha, descriptor, strlen(descriptor));
        ZEQ_SHA256_Final(&sha, digest);
        if (memcmp(peer + 28, digest, 32) != 0)
        {
            net_fail("session-descriptor-mismatch");
            return 0;
        }
    }
    flags = fcntl(net_socket, F_GETFL, 0);
    if (flags < 0 || fcntl(net_socket, F_SETFL, flags | O_NONBLOCK) < 0)
    {
        net_fail("nonblocking-socket");
        return 0;
    }
    printf("ZEQJ{\"kind\":\"net-descriptor\",\"descriptor\":%s,\"descriptor_sha256\":\"%s\"}\n",
           descriptor, net_descriptor_hash);
    printf("ZEQJ{\"kind\":\"net-ready\",\"protocol\":\"zeq-doom-net-v1\",\"session_id\":\"%s\",\"player\":%d,\"players\":2,\"prediction_window\":%d,\"snapshot_window\":%d}\n",
           net_session, net_player, NET_PREDICTION, NET_WINDOW);
    fflush(stdout);
    for (i = 0; i < NET_WINDOW; i++) net_tics[i].valid = 0;
    return 1;
}

static void write32_value(int32_t value)
{
    unsigned char bytes[4];
    put32(bytes, (uint32_t)value);
    fwrite(bytes, 1, 4, save_stream);
}

static int32_t read32_value(void)
{
    unsigned char bytes[4] = {0, 0, 0, 0};
    fread(bytes, 1, 4, save_stream);
    return (int32_t)get32(bytes);
}

static void *resolve_pointer(int32_t symbolic)
{
    thinker_t *th;
    int32_t ordinal = 1;
    int kind = symbolic & 0x70000000;
    int value = symbolic & 0x0fffffff;
    if (!symbolic) return NULL;
    if (symbolic == INT32_MAX) return &thinkercap;
    for (th = thinkercap.next; th != &thinkercap; th = th->next, ordinal++)
    {
        if (kind == 0x20000000 && th->function.acp1 == (actionf_p1)P_MobjThinker
            && ((mobj_t *)th)->zeq_id == (uint32_t)value) return th;
        if (kind == 0x10000000 && ordinal == value) return th;
    }
    if (kind == 0x40000000 && value >= 0 && value < NUMMOBJTYPES) return &mobjinfo[value];
    if (kind == 0x50000000 && value >= 0 && value < numsubsectors) return &subsectors[value];
    if (kind == 0x60000000 && value >= 0 && value < MAXPLAYERS) return &players[value];
    return NULL;
}

static void write_thinker_order(void)
{
    thinker_t *th;
    int mobj_ordinal = 0;
    int special_ordinal = 0;
    for (th = thinkercap.next; th != &thinkercap; th = th->next)
    {
        if (th->function.acp1 == (actionf_p1)P_MobjThinker)
            write32_value(0x20000000 | ++mobj_ordinal);
        else
            write32_value(0x10000000 | ++special_ordinal);
    }
    write32_value(0);
}

static int read_thinker_order(void)
{
    thinker_t *th;
    thinker_t **mobjs = NULL;
    thinker_t **specials = NULL;
    int *used = NULL;
    int mobj_count = 0;
    int special_count = 0;
    int total = 0;
    int restored = 0;
    int ok = 0;
    for (th = thinkercap.next; th != &thinkercap; th = th->next)
    {
        total++;
        if (th->function.acp1 == (actionf_p1)P_MobjThinker) mobj_count++;
        else special_count++;
    }
    mobjs = calloc(mobj_count ? mobj_count : 1, sizeof(*mobjs));
    specials = calloc(special_count ? special_count : 1, sizeof(*specials));
    used = calloc(total ? total : 1, sizeof(*used));
    if (!mobjs || !specials || !used) goto done;
    mobj_count = special_count = 0;
    for (th = thinkercap.next; th != &thinkercap; th = th->next)
    {
        if (th->function.acp1 == (actionf_p1)P_MobjThinker) mobjs[mobj_count++] = th;
        else specials[special_count++] = th;
    }
    thinkercap.next = thinkercap.prev = &thinkercap;
    while (restored < total)
    {
        int32_t order = read32_value();
        int kind = order & 0x70000000;
        int ordinal = order & 0x0fffffff;
        if ((kind != 0x20000000 && kind != 0x10000000) || ordinal <= 0
            || (kind == 0x20000000 && ordinal > mobj_count)
            || (kind == 0x10000000 && ordinal > special_count)
            || used[restored]) goto done;
        // Duplicate identity detection is completed by the ordinal checks below.
        {
            int i;
            int absolute = kind == 0x20000000 ? ordinal - 1 : mobj_count + ordinal - 1;
            for (i = 0; i < restored; i++) if (used[i] == absolute + 1) goto done;
            used[restored] = absolute + 1;
        }
        th = kind == 0x20000000 ? mobjs[ordinal - 1] : specials[ordinal - 1];
        th->prev = thinkercap.prev;
        th->next = &thinkercap;
        thinkercap.prev->next = th;
        thinkercap.prev = th;
        restored++;
    }
    if (read32_value() != 0 || restored != total) goto done;
    ok = 1;
done:
    free(mobjs);
    free(specials);
    free(used);
    return ok;
}

static int save_snapshot(net_tic_t *slot, int tic)
{
    FILE *memory;
    FILE *original = save_stream;
    int i;
    if (!slot->snapshot) return 0;
    memory = fmemopen(slot->snapshot, NET_SNAPSHOT_BYTES, "wb");
    if (!memory) return 0;
    save_stream = memory;
    savegame_error = false;
    P_WriteSaveGameHeader("zeq-net-rollback-v1");
    P_ArchivePlayers();
    P_ArchiveWorld();
    P_ArchiveThinkers();
    P_ArchiveSpecials();
    P_WriteSaveGameEOF();
    write32_value(NET_STATE_MAGIC);
    write32_value(gamestate);
    write32_value(gameaction);
    write32_value(paused);
    write32_value(usergame);
    write32_value(deathmatch);
    write32_value(netgame);
    write32_value(gameskill);
    write32_value(gameepisode);
    write32_value(gamemap);
    write32_value(leveltime);
    write32_value(levelstarttic);
    write32_value(totalkills);
    write32_value(totalitems);
    write32_value(totalsecret);
    write32_value(rndindex);
    write32_value(prndindex);
    write32_value(validcount);
    write32_value(numbraintargets);
    write32_value(braintargeton);
    write32_value(P_BrainSpitParity());
    for (i = 0; i < 32; i++) write32_value(ZEQ_CanonicalPointer(braintargets[i]));
    write32_value(bodyqueslot);
    for (i = 0; i < 32; i++) write32_value(ZEQ_CanonicalPointer(bodyque[i]));
    write32_value(iquehead);
    write32_value(iquetail);
    for (i = 0; i < ITEMQUESIZE; i++)
    {
        write32_value(itemrespawntime[i]);
        write32_value(itemrespawnque[i].x);
        write32_value(itemrespawnque[i].y);
        write32_value(itemrespawnque[i].angle);
        write32_value(itemrespawnque[i].type);
        write32_value(itemrespawnque[i].options);
    }
    for (i = 0; i < numsectors; i++) write32_value(ZEQ_CanonicalPointer(sectors[i].soundtarget));
    // The save trailer contains the first extension. This second copy belongs
    // to the rollback trailer after the extra globals and is restored below.
    ZEQ_WriteSaveExtension(write32_value);
    // Vanilla clears these pointers while unarchiving. Reconnect them only
    // after the Zeq extension has restored stable mobj IDs.
    {
        thinker_t *th;
        for (th = thinkercap.next; th != &thinkercap; th = th->next)
        {
            mobj_t *mo;
            if (th->function.acp1 != (actionf_p1)P_MobjThinker) continue;
            mo = (mobj_t *)th;
            write32_value(ZEQ_CanonicalPointer(mo->target));
            write32_value(ZEQ_CanonicalPointer(mo->tracer));
            write32_value(mo->floorz);
            write32_value(mo->ceilingz);
        }
        for (i = 0; i < MAXPLAYERS; i++)
            write32_value(ZEQ_CanonicalPointer(players[i].attacker));
    }
    write_thinker_order();
    ZEQ_WriteNetExtra(write32_value);
    if (fflush(memory) != 0) savegame_error = true;
    slot->snapshot_length = (size_t)ftell(memory);
    if (savegame_error || ferror(memory) || slot->snapshot_length >= NET_SNAPSHOT_BYTES)
    {
        fclose(memory);
        save_stream = original;
        return 0;
    }
    fclose(memory);
    save_stream = original;
    return 1;
}

static int restore_snapshot(net_tic_t *slot)
{
    FILE *memory;
    FILE *original = save_stream;
    int savedleveltime;
    int i;
    memory = fmemopen(slot->snapshot, slot->snapshot_length, "rb");
    if (!memory) return 0;
    save_stream = memory;
    savegame_error = false;
    if (!P_ReadSaveGameHeader()) goto failure;
    savedleveltime = leveltime;
    G_InitNew(gameskill, gameepisode, gamemap);
    leveltime = savedleveltime;
    P_UnArchivePlayers();
    P_UnArchiveWorld();
    P_UnArchiveThinkers();
    P_UnArchiveSpecials();
    if (!P_ReadSaveGameEOF() || read32_value() != NET_STATE_MAGIC) goto failure;
    gamestate = read32_value();
    gameaction = read32_value();
    paused = read32_value();
    usergame = read32_value();
    deathmatch = read32_value();
    netgame = read32_value();
    gameskill = read32_value();
    gameepisode = read32_value();
    gamemap = read32_value();
    leveltime = read32_value();
    levelstarttic = read32_value();
    totalkills = read32_value();
    totalitems = read32_value();
    totalsecret = read32_value();
    rndindex = read32_value();
    prndindex = read32_value();
    validcount = read32_value();
    numbraintargets = read32_value();
    braintargeton = read32_value();
    P_SetBrainSpitParity(read32_value());
    for (i = 0; i < 32; i++) braintargets[i] = resolve_pointer(read32_value());
    bodyqueslot = read32_value();
    for (i = 0; i < 32; i++) bodyque[i] = resolve_pointer(read32_value());
    iquehead = read32_value();
    iquetail = read32_value();
    for (i = 0; i < ITEMQUESIZE; i++)
    {
        itemrespawntime[i] = read32_value();
        itemrespawnque[i].x = read32_value();
        itemrespawnque[i].y = read32_value();
        itemrespawnque[i].angle = read32_value();
        itemrespawnque[i].type = read32_value();
        itemrespawnque[i].options = read32_value();
    }
    for (i = 0; i < numsectors; i++) sectors[i].soundtarget = resolve_pointer(read32_value());
    if (!ZEQ_ReadSaveExtension(read32_value)) goto failure;
    {
        thinker_t *th;
        for (th = thinkercap.next; th != &thinkercap; th = th->next)
        {
            mobj_t *mo;
            if (th->function.acp1 != (actionf_p1)P_MobjThinker) continue;
            mo = (mobj_t *)th;
            mo->target = resolve_pointer(read32_value());
            mo->tracer = resolve_pointer(read32_value());
            mo->floorz = read32_value();
            mo->ceilingz = read32_value();
        }
        for (i = 0; i < MAXPLAYERS; i++)
            players[i].attacker = resolve_pointer(read32_value());
    }
    if (!read_thinker_order() || !ZEQ_ReadNetExtra(read32_value)
        || savegame_error || ferror(memory)) goto failure;
    fclose(memory);
    save_stream = original;
    return 1;
failure:
    fclose(memory);
    save_stream = original;
    return 0;
}

static ticcmd_t predict_remote(int tic)
{
    ticcmd_t command;
    int previous = tic - 1;
    memset(&command, 0, sizeof(command));
    while (previous >= 0 && tic - previous < NET_WINDOW)
    {
        net_tic_t *slot = &net_tics[previous % NET_WINDOW];
        if (slot->valid && slot->tic == previous
            && (slot->actual_mask & (1u << (1 - net_player))))
        {
            command = slot->actual[1 - net_player];
            break;
        }
        previous--;
    }
    command.chatchar = 0;
    command.buttons &= ~BT_SPECIAL;
    return command;
}

static int execute_tic(loop_interface_t *loop, int tic)
{
    net_tic_t *slot = &net_tics[tic % NET_WINDOW];
    ticcmd_t commands[MAXPLAYERS];
    boolean ingame[MAXPLAYERS];
    char hash[65];
    int i;
    if (!slot->valid || slot->tic != tic || !(slot->actual_mask & (1u << net_player)))
    {
        net_fail("local-command-missing");
        return 0;
    }
    commands[0] = slot->used[0] = slot->actual[0];
    if (slot->actual_mask & 2) commands[1] = slot->used[1] = slot->actual[1];
    else commands[1] = slot->used[1] = predict_remote(tic);
    if (net_player == 1)
    {
        commands[0] = slot->used[0] = (slot->actual_mask & 1) ? slot->actual[0] : predict_remote(tic);
        commands[1] = slot->used[1] = slot->actual[1];
    }
    for (i = 0; i < MAXPLAYERS; i++) ingame[i] = i < NET_PLAYERS;
    for (i = 0; i < NET_PLAYERS; i++)
        commands[i].consistancy = consistancy[i][tic % BACKUPTICS];
    if (commands[0].buttons & BT_SPECIAL || commands[1].buttons & BT_SPECIAL)
    {
        net_fail("special-command-unsupported");
        return 0;
    }
    if (tic > 0 && getenv("ZEQ_NET_VERIFY_BOUNDARIES"))
    {
        net_tic_t *previous = &net_tics[(tic - 1) % NET_WINDOW];
        char boundary_hash[65];
        if (!previous->valid || previous->tic != tic - 1 || !previous->executed
            || !ZEQ_HeadlessStateHash(tic, boundary_hash)
            || strcmp(previous->hash, boundary_hash) != 0)
        {
            net_fail("pre-tic-boundary-mismatch");
            return 0;
        }
    }
    if (!save_snapshot(slot, tic)) { net_fail("snapshot-save"); return 0; }
    loop->RunTic(commands, ingame);
    gametic++;
    if (!ZEQ_HeadlessStateHash(tic + 1, hash)) { net_fail("state-serialization"); return 0; }
    memcpy(slot->hash, hash, 65);
    slot->executed = 1;
    // Predicted and rolled-back executions do not enter the confirmed event or
    // checkpoint chain. The ordinary single-player evidence path is unchanged.
    while (ZEQ_GetEvent()) {}
    while (ZEQ_GetImpulseRecord()) {}
    return 1;
}

static int earliest_misprediction(void)
{
    int tic;
    for (tic = net_confirmed; tic < net_frontier; tic++)
    {
        net_tic_t *slot = &net_tics[tic % NET_WINDOW];
        int remote = 1 - net_player;
        if (slot->valid && slot->tic == tic && slot->executed
            && (slot->actual_mask & (1u << remote))
            && !simulation_command_equal(&slot->used[remote], &slot->actual[remote])) return tic;
    }
    return -1;
}

static void confirm_tics(void)
{
    while (net_confirmed < net_frontier && net_confirmed < net_max_tics)
    {
        int tic = net_confirmed;
        net_tic_t *slot = &net_tics[tic % NET_WINDOW];
        net_hash_t *remote = &net_remote_hashes[(tic + 1) % NET_WINDOW];
        char hash[65];
        const char *corrupt = getenv("ZEQ_NET_CORRUPT_HASH_AT");
        if (!slot->valid || slot->tic != tic || !slot->executed || slot->actual_mask != 3) break;
        memcpy(hash, slot->hash, 65);
        if (corrupt && atoi(corrupt) == tic + 1) hash[0] = hash[0] == '0' ? '1' : '0';
        printf("ZEQJ{\"kind\":\"checkpoint\",\"format\":\"zeq-state-hash-v1\",\"run_id\":\"%s\",\"gametic\":\"%d\",\"state_format\":\"zeq-doom-state-v1\",\"state_sha256\":\"%s\",\"previous_state_sha256\":%s%s%s,\"protocol\":\"zeq-doom-net-v1\",\"player\":%d,\"confirmed\":true}\n",
               net_session, tic + 1, slot->hash,
               net_previous_hash[0] ? "\"" : "", net_previous_hash[0] ? net_previous_hash : "null", net_previous_hash[0] ? "\"" : "",
               net_player);
        memcpy(net_previous_hash, slot->hash, 65);
        send_hash(tic + 1, hash);
        net_confirmed++;
        // Early peer hashes are checked now, after any required rollback and
        // after local confirmation. Late hashes are checked on receipt.
        if (remote->valid && remote->tic == tic + 1) compare_remote_hash(remote);
        fflush(stdout);
        if (net_failed) return;
    }
    if (net_confirmed >= net_max_tics && !net_summary_sent)
    {
        printf("ZEQJ{\"kind\":\"net-summary\",\"session_id\":\"%s\",\"player\":%d,\"confirmed_tics\":%d,\"rollbacks\":%d,\"mispredictions\":%d,\"resimulated_tics\":%d,\"duplicate_commands\":%d}\n",
               net_session, net_player, net_confirmed, net_rollbacks, net_mispredictions,
               net_resimulated, net_duplicate_commands);
        {
            unsigned char body[4];
            put32(body, (uint32_t)net_max_tics);
            send_frame(3, body, sizeof(body));
        }
        net_summary_sent = 1;
        fflush(stdout);
    }
}

void ZEQ_NetTryRunTics(loop_interface_t *loop)
{
    int rollback;
    int tic;
    int made_progress = 0;
    if (!net_enabled || net_failed) return;
    // D_DoomLoop calls TryRunTics once before the platform's ordinary pump.
    // Pump stdin here as well so the initial prediction window cannot run with
    // empty local input and then reject those records as late on the next frame.
    ZEQ_HeadlessPump();
    pump_socket();
    if (net_failed) return;

    while (net_frontier < net_confirmed + NET_PREDICTION
           && net_frontier < net_peer_confirmed + NET_WINDOW
           && net_frontier < net_max_tics)
    {
        net_tic_t *slot;
        tic = net_frontier;
        slot = &net_tics[tic % NET_WINDOW];
        if (!slot->valid || slot->tic != tic)
        {
            unsigned char *snapshot = slot->snapshot;
            memset(slot, 0, sizeof(*slot));
            slot->valid = 1;
            slot->tic = tic;
            slot->snapshot = snapshot ? snapshot : calloc(1, NET_SNAPSHOT_BYTES);
            if (!slot->snapshot) { net_fail("snapshot-allocation"); return; }
        }
        if (!(slot->actual_mask & (1u << net_player)))
        {
            ticcmd_t command;
            loop->ProcessEvents();
            loop->RunMenu();
            loop->BuildTiccmd(&command, tic);
            if (ZEQ_HeadlessInputFailed()) { net_fail("input-stream"); return; }
            if (command.buttons & BT_SPECIAL) { net_fail("special-command-unsupported"); return; }
            slot->actual[net_player] = command;
            slot->actual_mask |= 1u << net_player;
            send_command(tic);
        }
        if (!execute_tic(loop, tic)) return;
        net_frontier++;
        made_progress = 1;
    }

    rollback = earliest_misprediction();
    if (rollback >= 0)
    {
        int old_frontier = net_frontier;
        net_tic_t *slot = &net_tics[rollback % NET_WINDOW];
        if (!slot->valid || slot->tic != rollback || !slot->snapshot_length)
        {
            net_fail("rollback-snapshot-expired");
            return;
        }
        if (!restore_snapshot(slot)) { net_fail("snapshot-restore"); return; }
        if (rollback > 0)
        {
            net_tic_t *previous = &net_tics[(rollback - 1) % NET_WINDOW];
            char restored_hash[65];
            if (!previous->valid || previous->tic != rollback - 1 || !previous->executed
                || !ZEQ_HeadlessStateHash(rollback, restored_hash))
            {
                net_fail("rollback-verification-unavailable");
                return;
            }
            if (strcmp(previous->hash, restored_hash) != 0)
            {
                fprintf(stderr, "Zeq rollback restore mismatch at %d: expected %s, got %s\n",
                        rollback, previous->hash, restored_hash);
                net_fail("rollback-restore-hash-mismatch");
                return;
            }
        }
        net_rollbacks++;
        printf("ZEQJ{\"kind\":\"net-rollback\",\"session_id\":\"%s\",\"player\":%d,\"from_tic\":%d,\"through_tic\":%d,\"snapshot_tic\":%d}\n",
               net_session, net_player, old_frontier, rollback, rollback);
        fflush(stdout);
        net_frontier = rollback;
        for (tic = rollback; tic < old_frontier; tic++)
        {
            net_tic_t *resim = &net_tics[tic % NET_WINDOW];
            resim->executed = 0;
            if (!execute_tic(loop, tic)) return;
            net_resimulated++;
            net_frontier++;
        }
        made_progress = 1;
    }
    confirm_tics();

    // Redundant complete commands make deterministic frame loss recoverable;
    // duplicate delivery is idempotent and conflicting duplicates are refused.
    {
        uint64_t now = monotonic_ms();
        int progress_pass = made_progress && ++net_send_pass % 4 == 0;
        int timed_pass = now >= net_last_retransmit_ms + 20;
        if (net_confirmed < net_max_tics && now >= net_last_wait_ms + 5000)
        {
            net_tic_t *wait = &net_tics[net_confirmed % NET_WINDOW];
            printf("ZEQJ{\"kind\":\"net-wait\",\"player\":%d,\"confirmed_tic\":%d,\"predicted_tic\":%d,\"actual_mask\":%u,\"slot_valid\":%d}\n",
                   net_player, net_confirmed, net_frontier,
                   wait->valid && wait->tic == net_confirmed ? wait->actual_mask : 0,
                   wait->valid && wait->tic == net_confirmed);
            fflush(stdout);
            net_last_wait_ms = now;
        }
        if (progress_pass || timed_pass)
        {
            // Every unconfirmed authoritative command is required. Limiting
            // retransmission to a recent subrange can permanently strand an
            // older dropped command once the predicted frontier advances.
            int first = net_confirmed < net_peer_confirmed ? net_confirmed : net_peer_confirmed;
            for (tic = first; tic < net_frontier; tic++) send_command(tic);
            net_last_retransmit_ms = now;
        }
    }
    if (net_confirmed >= net_max_tics
        || (!made_progress && net_frontier >= net_confirmed + NET_PREDICTION)) usleep(1000);
}

int ZEQ_NetShouldStop(void)
{
    if (!net_enabled) return 0;
    if (net_failed) return 1;
    if (net_confirmed < net_max_tics) return 0;
    net_stop_linger++;
    return (net_peer_done && net_stop_linger > 10) || net_stop_linger > 2000;
}

void ZEQ_NetClose(void)
{
    int i;
    if (net_socket >= 0) close(net_socket);
    net_socket = -1;
    for (i = 0; i < NET_WINDOW; i++)
    {
        free(net_tics[i].snapshot);
        net_tics[i].snapshot = NULL;
    }
}
