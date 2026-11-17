// ZEQ gameplay and telemetry bridge for doomgeneric.
// The game-facing calculations use Doom tics and integer arithmetic only.

#ifndef ZEQ_DOOM_H
#define ZEQ_DOOM_H

#include <stdint.h>
#include "doomkeys.h"
#include "d_player.h"

#define ZEQ_SNAPSHOT_VERSION 1
#define ZEQ_CARRIER_NUMERATOR 1287
#define ZEQ_CARRIER_DENOMINATOR 35000
#define ZEQ_PHASE_MIN 6475
#define ZEQ_PHASE_MAX 11025

typedef enum
{
    ZEQ_EVENT_PHASE_SHOT = 1,
    ZEQ_EVENT_PHASE_HIT = 2,
    ZEQ_EVENT_PHASE_KILL = 3,
    ZEQ_EVENT_LEVEL = 4,
    ZEQ_EVENT_DAMAGE = 5,
    ZEQ_EVENT_DEATH = 6,
    ZEQ_EVENT_SAVE = 7,
    ZEQ_EVENT_LOAD = 8
} zeq_event_type_t;

typedef struct
{
    int32_t version;
    int32_t gametic;
    int32_t zeqond;
    int32_t phase;
    int32_t aligned;
    int32_t pulse;
    int32_t gamestate;
    int32_t paused;
    int32_t menuactive;
    int32_t health;
    int32_t armor;
    int32_t ammo;
    int32_t maxammo;
    int32_t weapon;
    int32_t episode;
    int32_t map;
    int32_t kills;
    int32_t totalkills;
    int32_t items;
    int32_t totalitems;
    int32_t secrets;
    int32_t totalsecret;
    int32_t phaseShots;
    int32_t phaseHits;
    int32_t phaseKills;
    int32_t damageTaken;
    int32_t leveltime;
    int32_t playerstate;
} zeq_snapshot_t;

typedef struct
{
    int32_t type;
    int32_t gametic;
    int32_t phase;
    int32_t value;
} zeq_event_t;

int ZEQ_Phase(void);
int ZEQ_PhaseAligned(void);
int ZEQ_CarrierPermille(void);
void ZEQ_UpdateSnapshot(void);
void ZEQ_RecordEvent(zeq_event_type_t type, int value);
void ZEQ_PhaseShot(player_t* player);
int ZEQ_PhaseAttack(player_t* player);
int ZEQ_PhaseHit(player_t* player, int damage, int phase_attack);
void ZEQ_PhaseKill(player_t* player);
void ZEQ_PlayerDamage(player_t* player, int damage);

#endif
