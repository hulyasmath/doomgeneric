//
// Copyright(C) 1993-1996 Id Software, Inc.
// Copyright(C) 2005-2014 Simon Howard
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// DESCRIPTION:
//	Archiving: SaveGame I/O.
//	Thinker, Ticker.
//

#include <stdlib.h>

#include "doomstat.h"
#include "i_system.h"
#include "p_local.h"
#include "p_saveg.h"
#include "zeq_doom.h"

// State.
#include "r_state.h"

#define SAVEGAME_EOF 0x1d

FILE *save_stream;
boolean savegame_error;


// Get the filename of a temporary file to write the savegame to.  The
// specified filename must already exist.

char *P_TempSaveGameFile(void)
{
    static char *filename = NULL;

    if (filename == NULL)
    {
        filename = strdup(P_SaveGameFile(0));
    }

    return filename;
}

// Get the filename of the savegame file to use for the specified slot.

char *P_SaveGameFile(int slot)
{
    static char *filename = NULL;
    static size_t filename_size;
    char basename[32];

    if (filename == NULL)
    {
        filename_size = 256;
        filename = malloc(filename_size);
    }

    DEH_snprintf(basename, 32, "doomsav%d.dsg", slot);
    M_snprintf(filename, filename_size, "%s%s", savegamedir, basename);

    return filename;
}


//
// P_WriteSaveGameHeader
//
void P_WriteSaveGameHeader(char *description)
{
    int i;
    
    for (i=0; description[i] != '\0'; ++i)
    {
        saveg_write8(description[i]);
    }

    for (; i<SAVESTRINGSIZE; ++i)
    {
        saveg_write8(0);
    }

    saveg_write8(0);
    saveg_write8(gameskill);
    saveg_write8(gameepisode);
    saveg_write8(gamemap);

    for (i=0; i<MAXPLAYERS; ++i)
    {
        saveg_write8(playeringame[i]);
    }

    saveg_write8(leveltime >> 16);
    saveg_write8(leveltime >> 8);
    saveg_write8(leveltime);
}


//
// P_ReadSaveGameHeader
//
boolean P_ReadSaveGameHeader(void)
{
    int i;
    int a, b, c;
    char vcheck[VERSIONSIZE];
    char read_vcheck[VERSIONSIZE];

    // skip the description field

    for (i=0; i<SAVESTRINGSIZE; ++i)
    {
        saveg_read8();
    }

    saveg_read8();
    gameskill = saveg_read8();
    gameepisode = saveg_read8();
    gamemap = saveg_read8();

    for (i=0; i<MAXPLAYERS; ++i)
    {
        playeringame[i] = saveg_read8();
    }

    // get the times

    a = saveg_read8();
    b = saveg_read8();
    c = saveg_read8();

    leveltime = (a << 16) + (b << 8) + c;

    return true;
}


//
// P_ArchivePlayers
//
void P_ArchivePlayers (void)
{
    int		i;
    int		j;
    player_t*	dest;
		
    for (i=0 ; i<MAXPLAYERS ; i++)
    {
	if (!playeringame[i])
	    continue;
	
	dest = &players[i];
		
	saveg_write32(dest->playerstate);
	saveg_write_ticcmd_t(&dest->cmd);

	saveg_write32(dest->viewz);
	saveg_write32(dest->viewheight);
	saveg_write32(dest->deltaviewheight);
	saveg_write32(dest->bob);
	saveg_write32(dest->health);
	saveg_write32(dest->armorpoints);
	saveg_write32(dest->armortype);

	for (j=0 ; j<NUMPOWERS ; j++)
	    saveg_write32(dest->powers[j]);

	for (j=0 ; j<NUMCARDS ; j++)
	    saveg_write32(dest->cards[j]);

	saveg_write32(dest->backpack);

	for (j=0 ; j<MAXPLAYERS ; j++)
	    saveg_write32(dest->frags[j]);

	saveg_write32(dest->readyweapon);
	saveg_write32(dest->pendingweapon);

	for (j=0 ; j<NUMWEAPONS ; j++)
	    saveg_write32(dest->weaponowned[j]);

	for (j=0 ; j<NUMAMMO ; j++)
	    saveg_write32(dest->ammo[j]);

	for (j=0 ; j<NUMAMMO ; j++)
	    saveg_write32(dest->maxammo[j]);

	saveg_write32(dest->attackdown);
	saveg_write32(dest->usedown);
	saveg_write32(dest->cheats);
	saveg_write32(dest->refire);
	saveg_write32(dest->killcount);
	saveg_write32(dest->itemcount);
	saveg_write32(dest->secretcount);
	saveg_write32(dest->damagecount);
	saveg_write32(dest->bonuscount);
	saveg_write32(dest->extralight);
	saveg_write32(dest->fixedcolormap);
	saveg_write32(dest->colormap);

	for (j=0 ; j<NUMPSPRITES ; j++)
	    saveg_write_pspdef_t(&dest->psprites[j]);

	saveg_write32(dest->didsecret);
    }
}



//
// P_UnArchivePlayers
//
void P_UnArchivePlayers (void)
{
    int		i;
    int		j;
	
    for (i=0 ; i<MAXPLAYERS ; i++)
    {
	if (!playeringame[i])
	    continue;
	
	players[i].playerstate = saveg_read32();
	saveg_read_ticcmd_t(&players[i].cmd);

	players[i].viewz = saveg_read32();
	players[i].viewheight = saveg_read32();
	players[i].deltaviewheight = saveg_read32();
	players[i].bob = saveg_read32();
	players[i].health = saveg_read32();
	players[i].armorpoints = saveg_read32();
	players[i].armortype = saveg_read32();

	for (j=0 ; j<NUMPOWERS ; j++)
	    players[i].powers[j] = saveg_read32();

	for (j=0 ; j<NUMCARDS ; j++)
	    players[i].cards[j] = saveg_read32();

	players[i].backpack = saveg_read32();

	for (j=0 ; j<MAXPLAYERS ; j++)
	    players[i].frags[j] = saveg_read32();

	players[i].readyweapon = saveg_read32();
	players[i].pendingweapon = saveg_read32();

	for (j=0 ; j<NUMWEAPONS ; j++)
	    players[i].weaponowned[j] = saveg_read32();

	for (j=0 ; j<NUMAMMO ; j++)
	    players[i].ammo[j] = saveg_read32();

	for (j=0 ; j<NUMAMMO ; j++)
	    players[i].maxammo[j] = saveg_read32();

	players[i].attackdown = saveg_read32();
	players[i].usedown = saveg_read32();
	players[i].cheats = saveg_read32();
	players[i].refire = saveg_read32();
	players[i].killcount = saveg_read32();
	players[i].itemcount = saveg_read32();
	players[i].secretcount = saveg_read32();
	players[i].damagecount = saveg_read32();
	players[i].bonuscount = saveg_read32();
	players[i].extralight = saveg_read32();
	players[i].fixedcolormap = saveg_read32();
	players[i].colormap = saveg_read32();

	for (j=0 ; j<NUMPSPRITES ; j++)
	    saveg_read_pspdef_t(&players[i].psprites[j]);

	players[i].didsecret = saveg_read32();
    }
}


//
// P_ArchiveWorld
//
void P_ArchiveWorld (void)
{
    int			i;
    int			j;
    sector_t*		sec;
    line_t*		li;
    side_t*		si;
    short*		put;
	
    put = (short *)save_p;
    
    // do sectors
    for (i=0, sec = sectors ; i<numsectors ; i++,sec++)
    {
	saveg_write16(sec->floorheight);
	saveg_write16(sec->ceilingheight);
	saveg_write16(sec->floorpic);
	saveg_write16(sec->ceilingpic);
	saveg_write16(sec->lightlevel);
	saveg_write16(sec->special);
	saveg_write16(sec->tag);
    }
    
    
    // do lines
    for (i=0, li = lines ; i<numlines ; i++,li++)
    {
	saveg_write16(li->flags);
	saveg_write16(li->special);
	saveg_write16(li->tag);

	for (j=0 ; j<2 ; j++)
	{
	    if (li->sidenum[j] == NO_INDEX)
		continue;
	    
	    si = &sides[li->sidenum[j]];

	    saveg_write16(si->textureoffset);
	    saveg_write16(si->rowoffset);
	    saveg_write16(si->toptexture);
	    saveg_write16(si->bottomtexture);
	    saveg_write16(si->midtexture);	
	}
    }
}



//
// P_UnArchiveWorld
//
void P_UnArchiveWorld (void)
{
    int			i;
    int			j;
    sector_t*		sec;
    line_t*		li;
    side_t*		si;
    short*		get;
	
    get = (short *)save_p;
    
    // do sectors
    for (i=0, sec = sectors ; i<numsectors ; i++,sec++)
    {
	sec->floorheight = saveg_read16() << FRACBITS;
	sec->ceilingheight = saveg_read16() << FRACBITS;
	sec->floorpic = saveg_read16();
	sec->ceilingpic = saveg_read16();
	sec->lightlevel = saveg_read16();
	sec->special = saveg_read16();
	sec->tag = saveg_read16();
	sec->specialdata = 0;
	sec->soundtarget = 0;
    }
    
    // do lines
    for (i=0, li = lines ; i<numlines ; i++,li++)
    {
	li->flags = saveg_read16();
	li->special = saveg_read16();
	li->tag = saveg_read16();

	for (j=0 ; j<2 ; j++)
	{
	    if (li->sidenum[j] == NO_INDEX)
		continue;

	    si = &sides[li->sidenum[j]];

	    si->textureoffset = saveg_read16() << FRACBITS;
	    si->rowoffset = saveg_read16() << FRACBITS;
	    si->toptexture = saveg_read16();
	    si->bottomtexture = saveg_read16();
	    si->midtexture = saveg_read16();
	}
    }
}





//
// Thinkers
//

//
// P_ArchiveThinkers
//
void P_ArchiveThinkers (void)
{
    thinker_t*		th;
		
    // save off the current thinkers
    for (th = thinkercap.next ; th != &thinkercap ; th=th->next)
    {
	if (th->function.acp1 == (actionf_p1)P_MobjThinker)
	{
	    saveg_write8(tc_mobj);
	    saveg_write_mobj_t((mobj_t *) th);
	    continue;
	}
		
	// I_Error ("P_ArchiveThinkers: Unknown thinker function");
    }

    // add a terminating marker
    saveg_write8(tc_end);
}



//
// P_UnArchiveThinkers
//
void P_UnArchiveThinkers (void)
{
    byte		tclass;
    thinker_t*		currentthinker;
    thinker_t*		next;
    mobj_t*		mobj;
    
    // remove all the current thinkers
    currentthinker = thinkercap.next;
    while (currentthinker != &thinkercap)
    {
	next = currentthinker->next;
	
	if (currentthinker->function.acp1 == (actionf_p1)P_MobjThinker)
	    P_RemoveMobj ((mobj_t *)currentthinker);
	else
	    Z_Free (currentthinker);
	
	currentthinker = next;
    }
    
    // free the blockmap links
    P_FreeBlockmap();
    
    // read in saved thinkers
    while (1)
    {
	tclass = saveg_read8();
	switch (tclass)
	{
	  case tc_end:
	    return; 	// end of list
			
	  case tc_mobj:
	    mobj = Z_Malloc (sizeof(*mobj), PU_LEVEL, NULL);
	    saveg_read_mobj_t(mobj);
	    mobj->target = NULL;
	    mobj->tracer = NULL;
	    P_SetThingPosition (mobj);
	    mobj->info = &mobjinfo[mobj->type];
	    mobj->floorz = mobj->subsector->sector->floorheight;
	    mobj->ceilingz = mobj->subsector->sector->ceilingheight;
	    mobj->thinker.function.acp1 = (actionf_p1)P_MobjThinker;
	    P_AddThinker (&mobj->thinker);
	    break;
			
	  default:
	    I_Error ("Unknown tclass %i in savegame",tclass);
	}
	
    }
}


//
// P_ArchiveSpecials
//
void P_ArchiveSpecials (void)
{
    thinker_t*		th;
    int			i;
	
    // save off the current thinkers
    for (th = thinkercap.next ; th != &thinkercap ; th=th->next)
    {
	if (th->function.acv == (actionf_v)NULL)
	{
	    for (i = 0; i < MAXCEILINGS; i++)
		if (activeceilings[i] == (ceiling_t *)th)
		    break;
	    
	    if (i<MAXCEILINGS)
	    {
		saveg_write8(tc_ceiling);
		saveg_write_ceiling_t((ceiling_t *) th);
		continue;
	    }
	}
		
	if (th->function.acp1 == (actionf_p1)T_MoveCeiling)
	{
	    saveg_write8(tc_ceiling);
	    saveg_write_ceiling_t((ceiling_t *) th);
	    continue;
	}
		
	if (th->function.acp1 == (actionf_p1)T_VerticalDoor)
	{
	    saveg_write8(tc_door);
	    saveg_write_vldoor_t((vldoor_t *) th);
	    continue;
	}
		
	if (th->function.acp1 == (actionf_p1)T_MoveFloor)
	{
	    saveg_write8(tc_floor);
	    saveg_write_floormove_t((floormove_t *) th);
	    continue;
	}
		
	if (th->function.acp1 == (actionf_p1)T_PlatRaise)
	{
	    saveg_write8(tc_plat);
	    saveg_write_plat_t((plat_t *) th);
	    continue;
	}
		
	if (th->function.acp1 == (actionf_p1)T_LightFlash)
	{
	    saveg_write8(tc_flash);
	    saveg_write_lightflash_t((lightflash_t *) th);
	    continue;
	}
		
	if (th->function.acp1 == (actionf_p1)T_StrobeFlash)
	{
	    saveg_write8(tc_strobe);
	    saveg_write_strobe_t((strobe_t *) th);
	    continue;
	}
		
	if (th->function.acp1 == (actionf_p1)T_Glow)
	{
	    saveg_write8(tc_glow);
	    saveg_write_glow_t((glow_t *) th);
	    continue;
	}
    }
	
    // add a terminating marker
    saveg_write8(tc_endspecials);
}



//
// P_UnArchiveSpecials
//
void P_UnArchiveSpecials (void)
{
    byte		tclass;
    ceiling_t*		ceiling;
    vldoor_t*		door;
    floormove_t*	floor;
    plat_t*		plat;
    lightflash_t*	flash;
    strobe_t*		strobe;
    glow_t*		glow;
	
	
    // read in saved thinkers
    while (1)
    {
	tclass = saveg_read8();
	switch (tclass)
	{
	  case tc_endspecials:
	    return;	// end of list
			
	  case tc_ceiling:
	    ceiling = Z_Malloc (sizeof(*ceiling), PU_LEVEL, NULL);
	    saveg_read_ceiling_t(ceiling);
	    ceiling->sector->specialdata = ceiling;

	    if (ceiling->thinker.function.acp1)
		ceiling->thinker.function.acp1 = (actionf_p1)T_MoveCeiling;

	    P_AddThinker (&ceiling->thinker);
	    P_AddActiveCeiling(ceiling);
	    break;
			
	  case tc_door:
	    door = Z_Malloc (sizeof(*door), PU_LEVEL, NULL);
	    saveg_read_vldoor_t(door);
	    door->sector->specialdata = door;
	    door->thinker.function.acp1 = (actionf_p1)T_VerticalDoor;
	    P_AddThinker (&door->thinker);
	    break;
			
	  case tc_floor:
	    floor = Z_Malloc (sizeof(*floor), PU_LEVEL, NULL);
	    saveg_read_floormove_t(floor);
	    floor->sector->specialdata = floor;
	    floor->thinker.function.acp1 = (actionf_p1)T_MoveFloor;
	    P_AddThinker (&floor->thinker);
	    break;
			
	  case tc_plat:
	    plat = Z_Malloc (sizeof(*plat), PU_LEVEL, NULL);
	    saveg_read_plat_t(plat);
	    plat->sector->specialdata = plat;

	    if (plat->thinker.function.acp1)
		plat->thinker.function.acp1 = (actionf_p1)T_PlatRaise;

	    P_AddThinker (&plat->thinker);
	    P_AddActivePlat(plat);
	    break;
			
	  case tc_flash:
	    flash = Z_Malloc (sizeof(*flash), PU_LEVEL, NULL);
	    saveg_read_lightflash_t(flash);
	    flash->thinker.function.acp1 = (actionf_p1)T_LightFlash;
	    P_AddThinker (&flash->thinker);
	    break;
			
	  case tc_strobe:
	    strobe = Z_Malloc (sizeof(*strobe), PU_LEVEL, NULL);
	    saveg_read_strobe_t(strobe);
	    strobe->thinker.function.acp1 = (actionf_p1)T_StrobeFlash;
	    P_AddThinker (&strobe->thinker);
	    break;
			
	  case tc_glow:
	    glow = Z_Malloc (sizeof(*glow), PU_LEVEL, NULL);
	    saveg_read_glow_t(glow);
	    glow->thinker.function.acp1 = (actionf_p1)T_Glow;
	    P_AddThinker (&glow->thinker);
	    break;
			
	  default:
	    I_Error ("P_UnarchiveSpecials:Unknown tclass %i "
		     "in savegame",tclass);
	}
	
    }
}



//
// P_WriteSaveGameEOF
//
void P_WriteSaveGameEOF(void)
{
    ZEQ_WriteSaveExtension (saveg_write32);
    saveg_write8(SAVEGAME_EOF);
}

//
// P_ReadSaveGameEOF
//
boolean P_ReadSaveGameEOF(void)
{
    if (ZEQ_ReadSaveExtension (saveg_read32))
        return true;
    ZEQ_LoadLegacySave();
    return saveg_read8() == SAVEGAME_EOF;
}
