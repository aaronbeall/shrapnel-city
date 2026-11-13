// enemy assets/enemy wolfgun, frame 1 (moved from the FLA timeline)
// wolfgun turret

if(health == undefined) health = 100;
if(turnSpeed == undefined) turnSpeed = 3;
if(shot == undefined) shot = "shot_mcEPlasma";
if(shotSpread == undefined) shotSpread = 4;
if(refireRate == undefined) refireRate = 50;
if(particleType == undefined) particleType = "particle_mcBlue";
if(powerupDrop == undefined && shot == "shot_mcEPlasma")
	powerupDrop = {
		type:"primary",
		item:"Plasma",
		quantity:10 + random(6),
		probability:.25
	}

#include "as/object/enemyTurret.as"
