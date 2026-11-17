// ZEQ systems embedded in the original Doom simulation.

#include "zeq_doom.h"
#include "doomstat.h"
#include "d_event.h"
#include "g_game.h"
#include "tables.h"
#include "i_sound.h"
#include "s_sound.h"

#include <stddef.h>

#define ZEQ_EVENT_CAPACITY 32

static zeq_snapshot_t snapshot;
static zeq_event_t events[ZEQ_EVENT_CAPACITY];
static int event_read = 0;
static int event_write = 0;
static int phase_enabled = 1;
static int phase_shot = 0;
static int phase_shots = 0;
static int phase_hits = 0;
static int phase_kills = 0;
static int damage_taken = 0;

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
    return phase_shot && player == &players[consoleplayer];
}

int ZEQ_PhaseHit(player_t* player, int damage, int phase_attack)
{
    if (phase_attack && player == &players[consoleplayer])
    {
        damage += damage / 2 + 1;
        phase_hits++;
        ZEQ_RecordEvent(ZEQ_EVENT_PHASE_HIT, damage);
    }
    return damage;
}

void ZEQ_PhaseKill(player_t* player)
{
    if (player == &players[consoleplayer])
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

zeq_snapshot_t* ZEQ_GetSnapshot(void)
{
    ZEQ_UpdateSnapshot();
    return &snapshot;
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
