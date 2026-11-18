// ZEQ systems embedded in the original Doom simulation.

#include "zeq_doom.h"
#include "doomstat.h"
#include "d_event.h"
#include "g_game.h"
#include "p_local.h"
#include "tables.h"
#include "i_sound.h"
#include "s_sound.h"

#include <limits.h>
#include <stddef.h>
#include <string.h>

#define ZEQ_EVENT_CAPACITY 32
#define ZEQ_IMPULSE_CAPACITY 64

static zeq_snapshot_t snapshot;
static zeq_exact_snapshot_t exact_snapshot;
static zeq_event_t events[ZEQ_EVENT_CAPACITY];
static int event_read = 0;
static int event_write = 0;
static zeq_impulse_record_t impulse_records[ZEQ_IMPULSE_CAPACITY];
static int impulse_read = 0;
static int impulse_write = 0;
static zeq_impulse_record_t last_impulse;
static int phase_enabled = 1;
static int phase_shot = 0;
static int phase_shots = 0;
static int phase_hits = 0;
static int phase_kills = 0;
static int damage_taken = 0;
static zeq_ruleset_t ruleset = ZEQ_RULESET_PHYSICS;
static zeq_ruleset_t pending_ruleset = ZEQ_RULESET_PHYSICS;
static uint32_t next_mobj_id = 1;
static uint32_t impulse_count = 0;
static uint32_t physics_errors = 0;
static int explosion_context = 0;

// Original attack-state cadence. Durations are rounded to milli-Zeqonds,
// then converted back to the first eligible Doom tic with an exact ceiling.
static const int weapon_cadence_tics[NUMWEAPONS] = {22, 19, 39, 8, 20, 23, 60, 8, 55};

static void ZEQ_ClearImpulse(mobj_t* mo)
{
    mo->zeq_impulse_x = mo->zeq_impulse_y = mo->zeq_impulse_z = 0;
    mo->zeq_impulse_kind = ZEQ_IMPULSE_NONE;
    mo->zeq_impulse_mass = 0;
    mo->zeq_impulse_source_id = 0;
    mo->zeq_impulse_inflictor_id = 0;
}

static void ZEQ_ResetRunState(void)
{
    int i;
    int j;
    for (i = 0; i < MAXPLAYERS; i++)
    {
        for (j = 0; j < NUMWEAPONS; j++)
        {
            players[i].zeq_cooldown_start[j] = 0;
            players[i].zeq_cooldown_ready[j] = 0;
        }
    }
    memset(&last_impulse, 0, sizeof(last_impulse));
    impulse_count = 0;
    physics_errors = 0;
    impulse_read = impulse_write = 0;
}

int ZEQ_GetRuleset(void) { return ruleset; }
int ZEQ_GetPendingRuleset(void) { return pending_ruleset; }
int ZEQ_PhysicsActive(void) { return ruleset == ZEQ_RULESET_PHYSICS; }

const char* ZEQ_RulesetName(int value)
{
    switch (value)
    {
        case ZEQ_RULESET_VANILLA: return "doom-vanilla-v1";
        case ZEQ_RULESET_PHYSICS: return "zeq-physics-v1";
        case ZEQ_RULESET_LEGACY: return "zeq-arcade-legacy-v1";
        default: return "invalid";
    }
}

void ZEQ_SetRuleset(int value)
{
    if (value < ZEQ_RULESET_VANILLA || value > ZEQ_RULESET_LEGACY) return;
    pending_ruleset = (zeq_ruleset_t)value;
}

void ZEQ_InitMobj(mobj_t* mo)
{
    if (next_mobj_id == 0) next_mobj_id = 1;
    mo->zeq_id = next_mobj_id++;
    mo->zeq_phase = 0;
    mo->zeq_phase_hit = 0;
    mo->zeq_accel_x = mo->zeq_accel_y = mo->zeq_accel_z = 0;
    mo->zeq_impulse_residual_x = 0;
    mo->zeq_impulse_residual_y = 0;
    mo->zeq_impulse_residual_z = 0;
    mo->zeq_integrated_tic = -1;
    mo->zeq_step_z = 0;
    ZEQ_ClearImpulse(mo);
}

void ZEQ_AddAcceleration(mobj_t* mo, fixed_t x, fixed_t y, fixed_t z)
{
    int64_t sum;
    if (!mo || !ZEQ_PhysicsActive()) return;
    sum = (int64_t)mo->zeq_accel_x + x;
    if (sum < INT32_MIN || sum > INT32_MAX) { physics_errors++; return; }
    mo->zeq_accel_x = (fixed_t)sum;
    sum = (int64_t)mo->zeq_accel_y + y;
    if (sum < INT32_MIN || sum > INT32_MAX) { physics_errors++; return; }
    mo->zeq_accel_y = (fixed_t)sum;
    sum = (int64_t)mo->zeq_accel_z + z;
    if (sum < INT32_MIN || sum > INT32_MAX) { physics_errors++; return; }
    mo->zeq_accel_z = (fixed_t)sum;
}

int ZEQ_Phase(void)
{
    return (int)(((int64_t)gametic * ZEQ_CARRIER_NUMERATOR) % ZEQ_CARRIER_DENOMINATOR);
}

int ZEQ_PhaseAligned(void)
{
    const int phase = ZEQ_Phase();
    return phase >= ZEQ_PHASE_MIN && phase <= ZEQ_PHASE_MAX;
}

int ZEQ_CarrierPermille(void)
{
    const int angle = (int)(((int64_t)ZEQ_Phase() * FINEANGLES) / ZEQ_CARRIER_DENOMINATOR) & FINEMASK;
    return 1000 + (24 * finesine[angle]) / FRACUNIT;
}

void ZEQ_RecordEvent(zeq_event_type_t type, int value)
{
    zeq_event_t* event = &events[event_write];
    event->type = type;
    event->gametic = gametic;
    event->phase = ZEQ_Phase();
    event->value = value;
    event_write = (event_write + 1) % ZEQ_EVENT_CAPACITY;
    if (event_write == event_read)
        event_read = (event_read + 1) % ZEQ_EVENT_CAPACITY;
}

void ZEQ_UpdateSnapshot(void)
{
    player_t* player = &players[consoleplayer];
    const ammotype_t ammo_type = weaponinfo[player->readyweapon].ammo;
    snapshot.version = ZEQ_SNAPSHOT_VERSION;
    snapshot.gametic = gametic;
    snapshot.zeqond = (int)(((int64_t)gametic * 777) / (35 * 1000));
    snapshot.phase = ZEQ_Phase();
    snapshot.aligned = ZEQ_PhaseAligned();
    snapshot.pulse = ZEQ_CarrierPermille();
    snapshot.gamestate = gamestate;
    snapshot.paused = paused;
    snapshot.menuactive = menuactive;
    snapshot.health = player->health;
    snapshot.armor = player->armorpoints;
    snapshot.ammo = ammo_type == am_noammo ? -1 : player->ammo[ammo_type];
    snapshot.maxammo = ammo_type == am_noammo ? -1 : player->maxammo[ammo_type];
    snapshot.weapon = player->readyweapon;
    snapshot.episode = gameepisode;
    snapshot.map = gamemap;
    snapshot.kills = player->killcount;
    snapshot.totalkills = totalkills;
    snapshot.items = player->itemcount;
    snapshot.totalitems = totalitems;
    snapshot.secrets = player->secretcount;
    snapshot.totalsecret = totalsecret;
    snapshot.phaseShots = phase_shots;
    snapshot.phaseHits = phase_hits;
    snapshot.phaseKills = phase_kills;
    snapshot.damageTaken = damage_taken;
    snapshot.leveltime = leveltime;
    snapshot.playerstate = player->playerstate;
}

void ZEQ_PhaseShot(player_t* player)
{
    if (ruleset == ZEQ_RULESET_PHYSICS)
    {
        phase_shot = 0;
        ZEQ_RecordEvent(ZEQ_EVENT_WEAPON_FIRED, player->readyweapon);
        return;
    }
    if (ruleset != ZEQ_RULESET_LEGACY)
    {
        phase_shot = 0;
        return;
    }
    phase_shot = phase_enabled && player == &players[consoleplayer] && ZEQ_PhaseAligned();
    if (phase_shot)
    {
        phase_shots++;
        player->message = "ZEQ // PHASE LOCK: DAMAGE +50%";
        ZEQ_RecordEvent(ZEQ_EVENT_PHASE_SHOT, player->readyweapon);
    }
}

int ZEQ_PhaseAttack(player_t* player)
{
    return ruleset == ZEQ_RULESET_LEGACY && phase_shot && player == &players[consoleplayer];
}

int ZEQ_PhaseHit(player_t* player, int damage, int phase_attack)
{
    if (ruleset == ZEQ_RULESET_LEGACY && phase_attack && player == &players[consoleplayer])
    {
        damage += damage / 2 + 1;
        phase_hits++;
        ZEQ_RecordEvent(ZEQ_EVENT_PHASE_HIT, damage);
    }
    return damage;
}

void ZEQ_PhaseKill(player_t* player)
{
    if (ruleset == ZEQ_RULESET_LEGACY && player == &players[consoleplayer])
    {
        phase_kills++;
        ZEQ_RecordEvent(ZEQ_EVENT_PHASE_KILL, phase_kills);
    }
}

void ZEQ_PlayerDamage(player_t* player, int damage)
{
    if (player == &players[consoleplayer])
    {
        damage_taken += damage;
        ZEQ_RecordEvent(ZEQ_EVENT_DAMAGE, damage);
        if (player->health <= 0)
            ZEQ_RecordEvent(ZEQ_EVENT_DEATH, gamemap);
    }
}

void ZEQ_CooldownDuration(int weapon, int32_t* numerator, int32_t* denominator)
{
    int ok = 0;
    int64_t duration;
    if (weapon < 0 || weapon >= NUMWEAPONS) weapon = wp_fist;
    duration = ZEQ_RoundDivI64((int64_t)weapon_cadence_tics[weapon] * INT64_C(1000000000) * 1000,
                               35 * ZEQ_ZEQOND_NS, &ok);
    if (!ok) duration = 1;
    if (numerator) *numerator = (int32_t)duration;
    if (denominator) *denominator = 1000;
}

int ZEQ_WeaponReady(player_t* player)
{
    int weapon;
    if (!player) return 0;
    if (!ZEQ_PhysicsActive()) return 1;
    weapon = player->readyweapon;
    if (weapon < 0 || weapon >= NUMWEAPONS) return 0;
    return gametic >= player->zeq_cooldown_ready[weapon];
}

void ZEQ_StartCooldown(player_t* player)
{
    int32_t numerator;
    int32_t denominator;
    int64_t ready;
    int weapon;
    if (!player || !ZEQ_PhysicsActive()) return;
    weapon = player->readyweapon;
    if (weapon < 0 || weapon >= NUMWEAPONS) return;
    ZEQ_CooldownDuration(weapon, &numerator, &denominator);
    if (!ZEQ_CooldownReadyTic(gametic, TICRATE, numerator, denominator, &ready)
        || ready > INT32_MAX)
    {
        physics_errors++;
        return;
    }
    player->zeq_cooldown_start[weapon] = gametic;
    player->zeq_cooldown_ready[weapon] = (int32_t)ready;
    ZEQ_RecordEvent(ZEQ_EVENT_COOLDOWN_STARTED, (int)ready);
}

void ZEQ_BeginExplosion(void) { explosion_context++; }
void ZEQ_EndExplosion(void) { if (explosion_context > 0) explosion_context--; }
zeq_impulse_kind_t ZEQ_ImpulseContext(void)
{
    return explosion_context ? ZEQ_IMPULSE_EXPLOSION : ZEQ_IMPULSE_IMPACT;
}

void ZEQ_QueueImpulse(mobj_t* target, mobj_t* inflictor, mobj_t* source,
                      zeq_impulse_kind_t kind, fixed_t x, fixed_t y, fixed_t z,
                      int mass)
{
    int64_t sum;
    if (!target || !ZEQ_PhysicsActive()) return;
    if (target->zeq_impulse_kind != ZEQ_IMPULSE_NONE
        && target->zeq_impulse_kind != kind)
        target->zeq_impulse_kind = ZEQ_IMPULSE_MIXED;
    else
        target->zeq_impulse_kind = kind;
    sum = (int64_t)target->zeq_impulse_x + x;
    if (sum < INT32_MIN || sum > INT32_MAX) { physics_errors++; return; }
    target->zeq_impulse_x = (fixed_t)sum;
    sum = (int64_t)target->zeq_impulse_y + y;
    if (sum < INT32_MIN || sum > INT32_MAX) { physics_errors++; return; }
    target->zeq_impulse_y = (fixed_t)sum;
    sum = (int64_t)target->zeq_impulse_z + z;
    if (sum < INT32_MIN || sum > INT32_MAX) { physics_errors++; return; }
    target->zeq_impulse_z = (fixed_t)sum;
    target->zeq_impulse_mass = mass > 0 ? (uint32_t)mass : 1;
    target->zeq_impulse_source_id = source ? source->zeq_id : 0;
    target->zeq_impulse_inflictor_id = inflictor ? inflictor->zeq_id : 0;
    ZEQ_RecordEvent(kind == ZEQ_IMPULSE_EXPLOSION ? ZEQ_EVENT_EXPLOSION : ZEQ_EVENT_PROJECTILE_IMPACT,
                    (int)target->zeq_id);
}

static void ZEQ_RecordImpulse(mobj_t* target, zeq_impulse_kind_t kind,
                              uint32_t source_id, uint32_t inflictor_id,
                              int mass, fixed_t base_x, fixed_t base_y, fixed_t base_z,
                              const zeq_step_t* sx, const zeq_step_t* sy,
                              const zeq_step_t* sz)
{
    zeq_impulse_record_t* record = &impulse_records[impulse_write];
    memset(record, 0, sizeof(*record));
    record->kind = kind;
    record->gametic = gametic;
    record->phase64_hi = (uint32_t)(sx->start_phase64 >> 32);
    record->phase64_lo = (uint32_t)sx->start_phase64;
    record->source_id = source_id;
    record->inflictor_id = inflictor_id;
    record->target_id = target->zeq_id;
    record->mass = mass;
    record->base_x = base_x;
    record->base_y = base_y;
    record->base_z = base_z;
    record->delta_x = sx->delta_velocity;
    record->delta_y = sy ? sy->delta_velocity : 0;
    record->delta_z = sz ? sz->delta_velocity : 0;
    record->residual_x = sx->position_residual;
    record->residual_y = sy ? sy->position_residual : 0;
    record->residual_z = sz ? sz->position_residual : 0;
    record->interval_tics = 1;
    record->substeps = ZEQ_IMPULSE_SUBSTEPS;
    last_impulse = *record;
    impulse_count++;
    impulse_write = (impulse_write + 1) % ZEQ_IMPULSE_CAPACITY;
    if (impulse_write == impulse_read)
        impulse_read = (impulse_read + 1) % ZEQ_IMPULSE_CAPACITY;
    target->zeq_impulse_residual_x = record->residual_x;
    target->zeq_impulse_residual_y = record->residual_y;
    target->zeq_impulse_residual_z = record->residual_z;
    ZEQ_RecordEvent(ZEQ_EVENT_IMPULSE_INTEGRATED, kind);
}

static fixed_t ZEQ_GravityAcceleration(mobj_t* mo)
{
    if (!(mo->flags & MF_NOGRAVITY) && mo->z + mo->momz > mo->floorz)
        return mo->momz == 0 ? -GRAVITY*2 : -GRAVITY;
    return 0;
}

static int ZEQ_CombineAcceleration(mobj_t* mo, fixed_t gravity, fixed_t* out)
{
    int64_t sum = (int64_t)gravity + mo->zeq_accel_z;
    if (sum < INT32_MIN || sum > INT32_MAX) return 0;
    *out = (fixed_t)sum;
    return 1;
}

int ZEQ_StepMobjXY(mobj_t* mo, fixed_t* xmove, fixed_t* ymove)
{
    zeq_step_t sx;
    zeq_step_t sy;
    zeq_step_t sz;
    fixed_t base_x = mo->zeq_impulse_x;
    fixed_t base_y = mo->zeq_impulse_y;
    fixed_t base_z = mo->zeq_impulse_z;
    fixed_t acceleration_z;
    zeq_impulse_kind_t kind = mo->zeq_impulse_kind;
    uint32_t source_id = mo->zeq_impulse_source_id;
    uint32_t inflictor_id = mo->zeq_impulse_inflictor_id;
    int mass = (int)mo->zeq_impulse_mass;

    if (!ZEQ_CombineAcceleration(mo, ZEQ_GravityAcceleration(mo), &acceleration_z)
        || !ZEQ_IntegrateTic(gametic, TICRATE, mo->momx, mo->zeq_accel_x,
                             base_x, &sx)
        || !ZEQ_IntegrateTic(gametic, TICRATE, mo->momy, mo->zeq_accel_y,
                             base_y, &sy)
        || !ZEQ_IntegrateTic(gametic, TICRATE, mo->momz, acceleration_z,
                             base_z, &sz))
    {
        physics_errors++;
        mo->zeq_accel_x = mo->zeq_accel_y = mo->zeq_accel_z = 0;
        ZEQ_ClearImpulse(mo);
        *xmove = mo->momx;
        *ymove = mo->momy;
        mo->zeq_step_z = mo->momz;
        mo->zeq_integrated_tic = gametic;
        return 0;
    }
    mo->momx = sx.velocity;
    mo->momy = sy.velocity;
    mo->momz = sz.velocity;
    *xmove = sx.position_delta;
    *ymove = sy.position_delta;
    mo->zeq_step_z = sz.position_delta;
    mo->zeq_integrated_tic = gametic;
    mo->zeq_accel_x = mo->zeq_accel_y = mo->zeq_accel_z = 0;
    if (kind != ZEQ_IMPULSE_NONE)
        ZEQ_RecordImpulse(mo, kind, source_id, inflictor_id, mass,
                          base_x, base_y, base_z, &sx, &sy, &sz);
    ZEQ_ClearImpulse(mo);
    return 1;
}

int ZEQ_StepMobjZ(mobj_t* mo, fixed_t acceleration, fixed_t* zmove)
{
    zeq_step_t step;
    if (mo->zeq_integrated_tic == gametic)
    {
        *zmove = mo->zeq_step_z;
        mo->zeq_step_z = 0;
        return 1;
    }
    if (!ZEQ_CombineAcceleration(mo, acceleration, &acceleration)
        || !ZEQ_IntegrateTic(gametic, TICRATE, mo->momz, acceleration,
                             mo->zeq_impulse_z, &step))
    {
        physics_errors++;
        mo->zeq_accel_z = 0;
        ZEQ_ClearImpulse(mo);
        *zmove = mo->momz;
        return 0;
    }
    mo->momz = step.velocity;
    *zmove = step.position_delta;
    mo->zeq_accel_z = 0;
    ZEQ_ClearImpulse(mo);
    return 1;
}

zeq_snapshot_t* ZEQ_GetSnapshot(void)
{
    ZEQ_UpdateSnapshot();
    return &snapshot;
}

zeq_exact_snapshot_t* ZEQ_GetExactSnapshot(void)
{
    zeq_instant_t instant;
    zeq_lapse_t lapse;
    player_t* player = &players[consoleplayer];
    mobj_t* mo = player->mo;
    int weapon = player->readyweapon;
    uint64_t bits;

    if (!ZEQ_TimeFromTic(gametic, TICRATE, &instant))
    {
        exact_snapshot.version = 0;
        return &exact_snapshot;
    }
    ZEQ_LapseAt(instant.phase64, &lapse);
    exact_snapshot.version = ZEQ_EXACT_SNAPSHOT_VERSION;
    exact_snapshot.gametic = gametic;
    bits = (uint64_t)instant.tick;
    exact_snapshot.zeqond_hi = (int32_t)(bits >> 32);
    exact_snapshot.zeqond_lo = (uint32_t)bits;
    exact_snapshot.phase64_hi = (uint32_t)(instant.phase64 >> 32);
    exact_snapshot.phase64_lo = (uint32_t)instant.phase64;
    exact_snapshot.carrier_q30 = lapse.carrier_q30;
    exact_snapshot.lapse2_q30 = lapse.lapse2_q30;
    exact_snapshot.lapse_q30 = lapse.lapse_q30;
    bits = (uint64_t)lapse.dln_cycle_q40;
    exact_snapshot.dln_cycle_q40_hi = (int32_t)(bits >> 32);
    exact_snapshot.dln_cycle_q40_lo = (uint32_t)bits;
    exact_snapshot.x = mo ? mo->x : 0;
    exact_snapshot.y = mo ? mo->y : 0;
    exact_snapshot.z = mo ? mo->z : 0;
    exact_snapshot.angle = mo ? (int32_t)mo->angle : 0;
    exact_snapshot.momx = mo ? mo->momx : 0;
    exact_snapshot.momy = mo ? mo->momy : 0;
    exact_snapshot.momz = mo ? mo->momz : 0;
    exact_snapshot.ruleset = ruleset;
    exact_snapshot.pending_ruleset = pending_ruleset;
    exact_snapshot.cooldown_weapon = weapon;
    exact_snapshot.cooldown_start = (weapon >= 0 && weapon < NUMWEAPONS) ? player->zeq_cooldown_start[weapon] : 0;
    exact_snapshot.cooldown_ready = (weapon >= 0 && weapon < NUMWEAPONS) ? player->zeq_cooldown_ready[weapon] : 0;
    exact_snapshot.cooldown_remaining = exact_snapshot.cooldown_ready > gametic ? exact_snapshot.cooldown_ready - gametic : 0;
    exact_snapshot.impulse_count = (int32_t)impulse_count;
    exact_snapshot.last_impulse_kind = last_impulse.kind;
    exact_snapshot.last_impulse_tic = last_impulse.gametic;
    exact_snapshot.last_phase64_hi = last_impulse.phase64_hi;
    exact_snapshot.last_phase64_lo = last_impulse.phase64_lo;
    exact_snapshot.last_mass = last_impulse.mass;
    exact_snapshot.last_base_x = last_impulse.base_x;
    exact_snapshot.last_base_y = last_impulse.base_y;
    exact_snapshot.last_base_z = last_impulse.base_z;
    exact_snapshot.last_delta_x = last_impulse.delta_x;
    exact_snapshot.last_delta_y = last_impulse.delta_y;
    exact_snapshot.last_delta_z = last_impulse.delta_z;
    exact_snapshot.last_residual_x = last_impulse.residual_x;
    exact_snapshot.last_residual_y = last_impulse.residual_y;
    exact_snapshot.last_residual_z = last_impulse.residual_z;
    exact_snapshot.last_source_id = last_impulse.source_id;
    exact_snapshot.last_inflictor_id = last_impulse.inflictor_id;
    exact_snapshot.last_target_id = last_impulse.target_id;
    exact_snapshot.last_interval_tics = last_impulse.interval_tics;
    exact_snapshot.last_substeps = last_impulse.substeps;
    exact_snapshot.physics_errors = (int32_t)physics_errors;
    exact_snapshot.acceleration_x = mo ? mo->zeq_accel_x : 0;
    exact_snapshot.acceleration_y = mo ? mo->zeq_accel_y : 0;
    exact_snapshot.acceleration_z = mo ? mo->zeq_accel_z : 0;
    exact_snapshot.pending_impulse_x = mo ? mo->zeq_impulse_x : 0;
    exact_snapshot.pending_impulse_y = mo ? mo->zeq_impulse_y : 0;
    exact_snapshot.pending_impulse_z = mo ? mo->zeq_impulse_z : 0;
    ZEQ_CooldownDuration(weapon, &exact_snapshot.cooldown_duration_num,
                         &exact_snapshot.cooldown_duration_den);
    exact_snapshot.weapon_cadence_tics = (weapon >= 0 && weapon < NUMWEAPONS) ? weapon_cadence_tics[weapon] : 0;
    return &exact_snapshot;
}

zeq_event_t* ZEQ_GetEvent(void)
{
    zeq_event_t* event;
    if (event_read == event_write)
        return NULL;
    event = &events[event_read];
    event_read = (event_read + 1) % ZEQ_EVENT_CAPACITY;
    return event;
}

zeq_impulse_record_t* ZEQ_GetImpulseRecord(void)
{
    zeq_impulse_record_t* record;
    if (impulse_read == impulse_write)
        return NULL;
    record = &impulse_records[impulse_read];
    impulse_read = (impulse_read + 1) % ZEQ_IMPULSE_CAPACITY;
    return record;
}

void ZEQ_SetPhaseBonus(int enabled)
{
    phase_enabled = enabled != 0;
    if (!phase_enabled)
        phase_shot = 0;
}

void ZEQ_SaveGame(void)
{
    if (gamestate == GS_LEVEL && players[consoleplayer].playerstate == PST_LIVE)
    {
        G_SaveGame(0, "ZEQ LOCAL CAPSULE");
        ZEQ_RecordEvent(ZEQ_EVENT_SAVE, 0);
    }
}

void ZEQ_LoadGame(void)
{
    G_LoadGame("./.savegame/doomsav0.dsg");
    ZEQ_RecordEvent(ZEQ_EVENT_LOAD, 0);
}

void ZEQ_SetMuted(int muted)
{
    sfxVolume = muted ? 0 : 8;
    musicVolume = muted ? 0 : 8;
    S_SetSfxVolume(sfxVolume);
    I_SetMusicVolume(musicVolume);
}

void ZEQ_NewGame(int skill)
{
    phase_shot = 0;
    phase_shots = 0;
    phase_hits = 0;
    phase_kills = 0;
    damage_taken = 0;
    ruleset = pending_ruleset;
    ZEQ_ResetRunState();
    next_mobj_id = 1;
    ZEQ_RecordEvent(ZEQ_EVENT_RULESET, ruleset);
    if (skill < sk_baby || skill > sk_nightmare)
        skill = sk_medium;
    G_DeferedInitNew((skill_t)skill, 1, 1);
}

void ZEQ_Mouse(int dx, int dy, int buttons)
{
    event_t event;
    event.type = ev_mouse;
    event.data1 = buttons;
    event.data2 = dx;
    event.data3 = -dy;
    D_PostEvent(&event);
}

void ZEQ_WriteSaveExtension(void (*write32)(int32_t value))
{
    thinker_t* th;
    int i;
    int j;
    write32(ZEQ_SAVE_EXTENSION_VERSION);
    write32(ruleset);
    // Vanilla Doom omits the global simulation clock. Zeq cooldowns and
    // pending impulse phases are absolute, so extended saves must resume it.
    write32(gametic);
    write32(levelstarttic);
    write32((int32_t)next_mobj_id);
    write32((int32_t)impulse_count);
    write32((int32_t)physics_errors);
    for (i = 0; i < MAXPLAYERS; i++)
    {
        for (j = 0; j < NUMWEAPONS; j++)
        {
            write32(players[i].zeq_cooldown_start[j]);
            write32(players[i].zeq_cooldown_ready[j]);
        }
    }
    for (th = thinkercap.next; th != &thinkercap; th = th->next)
    {
        mobj_t* mo;
        if (th->function.acp1 != (actionf_p1)P_MobjThinker) continue;
        mo = (mobj_t*)th;
        write32((int32_t)mo->zeq_id);
        write32(mo->zeq_phase);
        write32(mo->zeq_phase_hit);
        write32(mo->zeq_accel_x);
        write32(mo->zeq_accel_y);
        write32(mo->zeq_accel_z);
        write32(mo->zeq_impulse_x);
        write32(mo->zeq_impulse_y);
        write32(mo->zeq_impulse_z);
        write32((int32_t)mo->zeq_impulse_kind);
        write32((int32_t)mo->zeq_impulse_mass);
        write32((int32_t)mo->zeq_impulse_source_id);
        write32((int32_t)mo->zeq_impulse_inflictor_id);
        write32(mo->zeq_impulse_residual_x);
        write32(mo->zeq_impulse_residual_y);
        write32(mo->zeq_impulse_residual_z);
    }
}

int ZEQ_ReadSaveExtension(int32_t (*read32)(void))
{
    thinker_t* th;
    int32_t version = read32();
    int32_t saved_ruleset = read32();
    int32_t saved_gametic;
    int32_t saved_levelstarttic;
    int i;
    int j;
    if ((version != 1 && version != ZEQ_SAVE_EXTENSION_VERSION)
        || saved_ruleset < ZEQ_RULESET_VANILLA || saved_ruleset > ZEQ_RULESET_LEGACY)
        return 0;
    if (version >= 2)
    {
        saved_gametic = read32();
        saved_levelstarttic = read32();
        if (saved_gametic < 0 || saved_levelstarttic < 0
            || saved_levelstarttic > saved_gametic)
            return 0;
    }
    else
    {
        // Development-format v1 did not resume the global clock. Preserve
        // its original load semantics rather than inventing a saved time.
        saved_gametic = gametic;
        saved_levelstarttic = levelstarttic;
    }
    ruleset = pending_ruleset = (zeq_ruleset_t)saved_ruleset;
    phase_shot = 0;
    explosion_context = 0;
    impulse_read = impulse_write = 0;
    memset(&last_impulse, 0, sizeof(last_impulse));
    next_mobj_id = (uint32_t)read32();
    impulse_count = (uint32_t)read32();
    physics_errors = (uint32_t)read32();
    if (next_mobj_id == 0) return 0;
    for (i = 0; i < MAXPLAYERS; i++)
    {
        for (j = 0; j < NUMWEAPONS; j++)
        {
            players[i].zeq_cooldown_start[j] = read32();
            players[i].zeq_cooldown_ready[j] = read32();
        }
    }
    for (th = thinkercap.next; th != &thinkercap; th = th->next)
    {
        mobj_t* mo;
        if (th->function.acp1 != (actionf_p1)P_MobjThinker) continue;
        mo = (mobj_t*)th;
        mo->zeq_id = (uint32_t)read32();
        mo->zeq_phase = read32();
        mo->zeq_phase_hit = read32();
        mo->zeq_accel_x = read32();
        mo->zeq_accel_y = read32();
        mo->zeq_accel_z = read32();
        mo->zeq_impulse_x = read32();
        mo->zeq_impulse_y = read32();
        mo->zeq_impulse_z = read32();
        mo->zeq_impulse_kind = (uint32_t)read32();
        mo->zeq_impulse_mass = (uint32_t)read32();
        mo->zeq_impulse_source_id = (uint32_t)read32();
        mo->zeq_impulse_inflictor_id = (uint32_t)read32();
        mo->zeq_impulse_residual_x = read32();
        mo->zeq_impulse_residual_y = read32();
        mo->zeq_impulse_residual_z = read32();
        mo->zeq_integrated_tic = -1;
        mo->zeq_step_z = 0;
        if (mo->zeq_id == 0 || mo->zeq_impulse_kind > ZEQ_IMPULSE_MIXED) return 0;
    }
    gametic = saved_gametic;
    levelstarttic = saved_levelstarttic;
    return 1;
}

void ZEQ_LoadLegacySave(void)
{
    thinker_t* th;
    ruleset = pending_ruleset = ZEQ_RULESET_VANILLA;
    ZEQ_ResetRunState();
    next_mobj_id = 1;
    for (th = thinkercap.next; th != &thinkercap; th = th->next)
    {
        if (th->function.acp1 == (actionf_p1)P_MobjThinker)
            ZEQ_InitMobj((mobj_t*)th);
    }
}
