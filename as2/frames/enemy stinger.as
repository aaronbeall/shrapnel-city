// enemy assets/enemy stinger, frame 1 (moved from the FLA timeline)
// stinger turret

if(health == undefined) health = 50;
if(turnSpeed == undefined) turnSpeed = 5;
if(shot == undefined) shot = "shot_mcEYellow";
if(shotSpread == undefined) shotSpread = 4;
if(refireRate == undefined) refireRate = 25;
if(powerupDrop == undefined && shot == "shot_mcEYellow")
	powerupDrop = {
		type:"primary",
		item:"Bolter",
		quantity:15 + random(11),
		probability:.15
	}

#include "as/object/enemyTurret.as"
