// enemy assets/enemy gnat, frame 1 (moved from the FLA timeline)
// gnat drone

if(health == undefined) health = 15;
if(turnSpeed == undefined) turnSpeed = 8;
if(speedMax == undefined) speedMax = _player.speedMax * 1.25;
if(accel == undefined) accel = 1;
if(resistence == undefined) resistence = 1;
//if(blastRange == undefined) blastRange = 50;
//if(damage == undefined) damage = 30;
//if(shakeStrength == undefined) shakeStrength = 0;
chaser = true;
suicidal = true;
if(suicideDamage == undefined) suicideDamage = 10;

#include "as/object/enemyVehicle.as"
