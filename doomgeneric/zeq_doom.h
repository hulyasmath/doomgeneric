// ZEQ gameplay and telemetry bridge for doomgeneric.
// Game-facing calculations use Doom tics and checked integer arithmetic only.

#ifndef ZEQ_DOOM_H
#define ZEQ_DOOM_H

#include <stdint.h>
#include "doomkeys.h"
#include "d_player.h"
#include "zeq_time.h"
#include "zeq_physics.h"

#define ZEQ_SNAPSHOT_VERSION 1
#define ZEQ_EXACT_SNAPSHOT_VERSION 3
#define ZEQ_SAVE_EXTENSION_VERSION 2
#define ZEQ_CARRIER_NUMERATOR 1287
#define ZEQ_CARRIER_DENOMINATOR 35000
#define ZEQ_PHASE_MIN 6475
#define ZEQ_PHASE_MAX 11025

typedef enum
{
    ZEQ_RULESET_VANILLA = 0,
    ZEQ_RULESET_PHYSICS = 1,
    ZEQ_RULESET_LEGACY = 2
} zeq_ruleset_t;

typedef enum
{
    ZEQ_EVENT_PHASE_SHOT = 1,
    ZEQ_EVENT_PHASE_HIT = 2,
    ZEQ_EVENT_PHASE_KILL = 3,
    ZEQ_EVENT_LEVEL = 4,
    ZEQ_EVENT_DAMAGE = 5,
    ZEQ_EVENT_DEATH = 6,
    ZEQ_EVENT_SAVE = 7,
    ZEQ_EVENT_LOAD = 8,
    ZEQ_EVENT_WEAPON_FIRED = 9,
    ZEQ_EVENT_PROJECTILE_IMPACT = 10,
    ZEQ_EVENT_EXPLOSION = 11,
    ZEQ_EVENT_IMPULSE_INTEGRATED = 12,
    ZEQ_EVENT_COOLDOWN_STARTED = 13,
    ZEQ_EVENT_RULESET = 14
} zeq_event_type_t;

typedef enum
{
    ZEQ_IMPULSE_NONE = 0,
    ZEQ_IMPULSE_IMPACT = 1,
    ZEQ_IMPULSE_EXPLOSION = 2,
    ZEQ_IMPULSE_MIXED = 3
} zeq_impulse_kind_t;

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
    int32_t version;
    int32_t gametic;
    int32_t zeqond_hi;
    uint32_t zeqond_lo;
    uint32_t phase64_hi;
    uint32_t phase64_lo;
    int32_t carrier_q30;
    int32_t lapse2_q30;
    int32_t lapse_q30;
    int32_t dln_cycle_q40_hi;
    uint32_t dln_cycle_q40_lo;
    int32_t x;
    int32_t y;
    int32_t z;
    int32_t angle;
    int32_t momx;
    int32_t momy;
    int32_t momz;
    int32_t ruleset;
    int32_t pending_ruleset;
    int32_t cooldown_weapon;
    int32_t cooldown_start;
    int32_t cooldown_ready;
    int32_t cooldown_remaining;
    int32_t impulse_count;
    int32_t last_impulse_kind;
    int32_t last_impulse_tic;
    uint32_t last_phase64_hi;
    uint32_t last_phase64_lo;
    int32_t last_mass;
    int32_t last_base_x;
    int32_t last_base_y;
    int32_t last_base_z;
    int32_t last_delta_x;
    int32_t last_delta_y;
    int32_t last_delta_z;
    int32_t last_residual_x;
    int32_t last_residual_y;
    int32_t last_residual_z;
    uint32_t last_source_id;
    uint32_t last_inflictor_id;
    uint32_t last_target_id;
    int32_t last_interval_tics;
    int32_t last_substeps;
    int32_t physics_errors;
    int32_t acceleration_x;
    int32_t acceleration_y;
    int32_t acceleration_z;
    int32_t pending_impulse_x;
    int32_t pending_impulse_y;
    int32_t pending_impulse_z;
    int32_t cooldown_duration_num;
    int32_t cooldown_duration_den;
    int32_t weapon_cadence_tics;
} zeq_exact_snapshot_t;

typedef struct
{
    int32_t type;
    int32_t gametic;
    int32_t phase;
    int32_t value;
} zeq_event_t;

typedef struct
{
    int32_t kind;
    int32_t gametic;
    uint32_t phase64_hi;
    uint32_t phase64_lo;
    uint32_t source_id;
    uint32_t inflictor_id;
    uint32_t target_id;
    int32_t mass;
    int32_t base_x;
    int32_t base_y;
    int32_t base_z;
    int32_t delta_x;
    int32_t delta_y;
    int32_t delta_z;
    int32_t residual_x;
    int32_t residual_y;
    int32_t residual_z;
    int32_t interval_tics;
    int32_t substeps;
} zeq_impulse_record_t;

zeq_exact_snapshot_t* ZEQ_GetExactSnapshot(void);
zeq_impulse_record_t* ZEQ_GetImpulseRecord(void);
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

int ZEQ_GetRuleset(void);
int ZEQ_GetPendingRuleset(void);
int ZEQ_PhysicsActive(void);
void ZEQ_SetRuleset(int ruleset);
const char* ZEQ_RulesetName(int ruleset);
void ZEQ_InitMobj(mobj_t* mo);
void ZEQ_AddAcceleration(mobj_t* mo, fixed_t x, fixed_t y, fixed_t z);
void ZEQ_QueueImpulse(mobj_t* target, mobj_t* inflictor, mobj_t* source,
                      zeq_impulse_kind_t kind, fixed_t x, fixed_t y, fixed_t z,
                      int mass);
int ZEQ_StepMobjXY(mobj_t* mo, fixed_t* xmove, fixed_t* ymove);
int ZEQ_StepMobjZ(mobj_t* mo, fixed_t acceleration, fixed_t* zmove);
int ZEQ_WeaponReady(player_t* player);
void ZEQ_StartCooldown(player_t* player);
void ZEQ_CooldownDuration(int weapon, int32_t* numerator, int32_t* denominator);
void ZEQ_BeginExplosion(void);
void ZEQ_EndExplosion(void);
zeq_impulse_kind_t ZEQ_ImpulseContext(void);

void ZEQ_WriteSaveExtension(void (*write32)(int32_t));
int ZEQ_ReadSaveExtension(int32_t (*read32)(void));
void ZEQ_LoadLegacySave(void);

#endif
