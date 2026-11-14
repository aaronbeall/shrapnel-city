// enemy assets/enemy stinger3, frame 1 (moved from the FLA timeline)
if(health == undefined) health = 80;
if(turnSpeed == undefined) turnSpeed = 5;
if(shot == undefined) shot = "shot_mcERed";
if(shotSpread == undefined) shotSpread = 4;
if(refireRate == undefined) refireRate = 3;
if(burstCount == undefined) burstCount = 3;
if(burstReload == undefined) burstReload = 25;
if(powerupDrop == undefined)
	powerupDrop = {
		type:"health",
		item:"health",
		quantity:10,
		probability:.25
	}


#include "as/object/enemyTurret.as"
