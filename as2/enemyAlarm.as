// ENEMY ALARM (first used by level 10 Interface)
// Include after the enemy's class (enemyTurret.as or enemyVehicle.as). An alarm unit doesn't
// shoot; it watches. It sees the player within alarmRange px, inside alarmCone degrees either
// side of where it faces (180 = all round), in line of sight. Then it sounds the alarm: every
// hunter paths to the player ("playerDetected", the trigger an alerter sends) and the triggers in
// `alarm` are sent, e.g. "west:alarm" to wake a group of trap tiles or "door3:close" for a
// lockdown. While it still sees the player it keeps the hunters posted every alarmRepeat
// seconds; once it has lost the player for alarmCooldown seconds it can sound again.
// Kill it before it sees you (or sneak up behind a sentinel) and nothing happens.
//
// Its own sight replaces the vision-zone check, so `attacking` means "sees the player" (a
// patrolling sentinel stops and stares). The symbol may have a beacon_mc, which turns and
// flashes while the alarm is up.

// params
if(alarm == undefined) alarm = "";
if(alarmRange == undefined) alarmRange = 260;
if(alarmCone == undefined) alarmCone = 180;
if(alarmCooldown == undefined) alarmCooldown = 8;
if(alarmRepeat == undefined) alarmRepeat = 2;
if(alarmNotice == undefined) alarmNotice = "ALARM!";

// vars
var alarmUp = false;
var alarmTime = 0;
var alarmLost = 0;
var alarmCheck = random(5);
var ALARM_DETECTED = "playerDetected";
beacon_mc._visible = false;

// the base class's vision check is off: this unit's own sight decides
LOS_CHECK_INTERVAL = losCheck = 1000000000;

function alarmSees(){
	if(!_player._visible || _player.dying)
		return false;
	if(getDistanceSquare(this, _player) > alarmRange * alarmRange)
		return false;
	if(alarmCone < 180){
		var d = (getAngle(this, _player) - _rotation) % 360;
		if(d > 180) d -= 360;
		if(d < -180) d += 360;
		if(Math.abs(d) > alarmCone)
			return false;
	}
	return lineOfSight(this, _player, 12);
}

function soundAlarm(){
	alarmUp = true;
	alarmTime = alarmLost = 0;
	trigger(ALARM_DETECTED);
	var a = alarm instanceof Array ? alarm : (alarm ? [alarm] : []);
	for(var i = 0; i < a.length; i++)
		trigger(a[i]);
	if(alarmNotice)
		notify(this, alarmNotice, frameRate * 2);
	if(onAlarm)
		onAlarm();
}

_alarmUpdate = update;
update = function(time){
	_alarmUpdate(time);
	if(dying || _currentframe != 1)
		return beacon_mc._visible = false;
	if(!stunned && --alarmCheck <= 0){
		alarmCheck = 5;
		attacking = alarmSees();
	}
	if(stunned)
		attacking = false;
	if(attacking){
		if(!alarmUp)
			soundAlarm();
		else if(++alarmTime >= alarmRepeat * frameRate){
			alarmTime = 0;
			trigger(ALARM_DETECTED);
		}
		alarmLost = 0;
	}else if(alarmUp && ++alarmLost >= alarmCooldown * frameRate){
		alarmUp = false;
	}
	// beacon: a turning red strobe while the alarm is up
	if(beacon_mc){
		beacon_mc._visible = alarmUp && (getTimer() % 360) < 240;
		beacon_mc._rotation += 30;
	}
}
