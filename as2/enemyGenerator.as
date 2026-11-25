// ENEMY GENERATOR
// a fixed hive that prints enemies while the player is near, until it's destroyed (level 06 Downtown)

// params (set before the base classes fill in their defaults)
if(health == undefined) health = 450;
if(blastRange == undefined) blastRange = 120;
if(damage == undefined) damage = 60;
if(frag == undefined) frag = "frag_mc";
if(fragCount == undefined) fragCount = 20;
if(breed == undefined) breed = "enemyDroneGnat";	// linkage id(s) it prints, comma separated: one at random each time
if(breedMax == undefined) breedMax = 3;		// most of its prints alive at once
if(breedRate == undefined) breedRate = 75;		// frames between prints
if(breedTotal == undefined) breedTotal = 0;		// prints in all before it runs dry (0: no limit)
if(breedRange == undefined) breedRange = 260;	// prints when the player is this close, or seen from further
if(breedSpeed == undefined) breedSpeed = 4;		// how fast a print leaves the hive
if(breedOffset == undefined) breedOffset = 34;	// how far from the middle a print appears

#include "enemyTurret.as"

// init
_name = "enemyGenerator_mc" + getDepth();
fixed = true;

var breedList = breed.split(",");
var prints = [];
var printed = 0;
var bays = [0, 120, 240];
var printTime = breedRate * .5;
var heat = 0;
var pulse = 0;
var breedRangeSquare = breedRange * breedRange;
vents_mc._alpha = 30;

// generator AI
var __generatorUpdate = update;
update = function(time){
	__generatorUpdate(time);
	if(_currentframe != 1 || dying)
		return;

	// forget prints that have died
	var i = prints.length;
	while(i--)
		if(prints[i]._currentframe != 1)
			prints.splice(i, 1);

	// the core's glow and the bays cool down after a print
	heat = Math.max(0, heat - time * .04);
	vents_mc._alpha = 30 + 70 * heat;
	pulse += time;
	glow_mc._alpha = 35 + 65 * heat + 10 * Math.sin(pulse / 6);

	// print while the player is close or in sight
	var active = attacking || getDistanceSquare(this, _player) < breedRangeSquare;
	if(!active || prints.length >= breedMax || (breedTotal && printed >= breedTotal))
		return;
	printTime += time;
	if(printTime < breedRate)
		return;
	printTime = 0;
	printed++;
	heat = 1;
	iris_mc.gotoAndPlay("open");
	makeShrapnel(this, "particle_mcFire", 6);
	makeLightFlash(this);
	var id = breedList[random(breedList.length)];
	var d = _screen.enemies_mc.getNextHighestDepth();
	// out of one of its three print bays (up, lower right, lower left)
	var a = bays[printed % bays.length] + jitter(10);
	var v = getVector(breedOffset, a);
	var init = {_x:_x + v.x, _y:_y + v.y, _rotation:a, speed:breedSpeed};
	prints.push(_screen.enemies_mc.attachMovie(id, "enemy_mc" + d, d, init));
}
