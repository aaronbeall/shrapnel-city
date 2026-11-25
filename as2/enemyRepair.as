// ENEMY REPAIR
// a flying repair drone (level 09 Complex): keeps close to the other robots and mends them.
// Every healRate frames it gives healAmount health back to the most damaged robot it can see
// within healRange (never above that robot's starting health), with a green repair beam.
// Unarmed by default; it hovers near whoever it's fixing, or the nearest robot, and dodges.

#include "enemyVehicle.as"

// params
if(healRange == undefined) healRange = 170;
if(healAmount == undefined) healAmount = 5;
if(healRate == undefined) healRate = 8;
if(followRange == undefined) followRange = 450;
if(beamColor == undefined) beamColor = 0x55ff99;

// vars
var healTime = random(healRate);
var patient = null;
var buddy = null;
var buddyCheck = 0;
var healFlash = 0;
var beamDepth = _parent.getNextHighestDepth();
var beamMC = _parent.createEmptyMovieClip("repairBeam_mc" + beamDepth, beamDepth);
beamMC.blendMode = "add";

// the most damaged robot in reach (in sight, alive, below its starting health)
function findPatient(){
	var best = null, worst = 1;
	var r2 = healRange * healRange;
	for(var i in _root.enemies){
		var e = _root.enemies[i];
		if(e == this || e.dying || !(e.health > 0) || !(e.initHealth > 0) || e.health >= e.initHealth)
			continue;
		if(getDistanceSquare(this, e) > r2)
			continue;
		var f = e.health / e.initHealth;
		if(f < worst && lineOfSight(this, e, LOS_SAMPLE_SIZE)){
			worst = f;
			best = e;
		}
	}
	return best;
}

// the nearest other robot to stay with
function findBuddy(){
	var best = null, d = followRange * followRange;
	for(var i in _root.enemies){
		var e = _root.enemies[i];
		if(e == this || e.dying || !(e.health > 0) || e.isRepairDrone || !(e.initHealth > 0))
			continue;
		var dd = getDistanceSquare(this, e);
		if(dd < d && lineOfSight(this, e, LOS_SAMPLE_SIZE)){
			d = dd;
			best = e;
		}
	}
	return best;
}
isRepairDrone = true;

function drawBeam(){
	beamMC.clear();
	if(!patient || healFlash <= 0)
		return;
	var a = 25 + 50 * (healFlash / healRate);
	beamMC.lineStyle(6, beamColor, a * .4);
	beamMC.moveTo(_x, _y);
	beamMC.lineTo(patient._x, patient._y);
	beamMC.lineStyle(2, 0xeeffee, a);
	beamMC.moveTo(_x, _y);
	beamMC.lineTo(patient._x + jitter(3), patient._y + jitter(3));
}

_repairUpdate = update;
update = function(time){
	_repairUpdate(time);

	if(dying || stunned || !(health > 0)){
		patient = null;
		beamMC.clear();
		return;
	}

	// repairs
	healTime += time;
	if(healFlash > 0)
		healFlash -= time;
	if(patient && (patient.dying || !(patient.health > 0) || patient.health >= patient.initHealth))
		patient = null;
	if(healTime >= healRate){
		healTime = 0;
		patient = findPatient();
		if(patient){
			patient.health = Math.min(patient.initHealth, patient.health + healAmount);
			healFlash = healRate;
			if(!random(3))
				makeSparks(patient, .5);
		}
	}
	drawBeam();

	// stay near the patient, or a buddy
	if(--buddyCheck <= 0){
		buddyCheck = 20 + random(10);
		if(!patient)
			buddy = findBuddy();
	}
	var target = patient || buddy;
	if(target && !moveTarget){
		var d = getDistance(this, target);
		if(d > healRange * .6){
			var a = getAngle(target, this) + jitter(40);
			var v = getVector(healRange * .4, a);
			moveTarget = {_x:target._x + v.x, _y:target._y + v.y};
		}
	}
}

_repairDie = die;
die = function(){
	beamMC.removeMovieClip();
	_repairDie();
}
